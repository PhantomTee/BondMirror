import { createClient } from '@supabase/supabase-js'
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  formatUnits,
  getAddress,
  http,
  isAddress,
  keccak256,
  toBytes,
  type Address,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { bondMirrorBondAbi } from '../../src/abi/bondMirrorBond'
import { fetchHyperliquidSummary } from '../../src/services/hyperliquid'
import { fetchPolymarketSummary } from '../../src/services/polymarket'
import { scoreStrategy } from '../../src/services/risk'
import type { HyperliquidSummary, PolymarketSummary, RiskMandate, SlashRule } from '../../src/types'

// ── Vercel serverless shims ───────────────────────────────────────────────────

type VercelRequest = {
  method?: string
  headers: Record<string, string | string[] | undefined>
  query?: Record<string, string | string[] | undefined>
}

type VercelResponse = {
  status: (code: number) => VercelResponse
  json: (body: unknown) => void
}

// ── Onchain types ─────────────────────────────────────────────────────────────

type StrategyTuple = readonly [Address, bigint, bigint, string, string, number, bigint, bigint, bigint, number, bigint, bigint]
// fields: leader, bond, cooldownEndsAt, mandateURI, benchmark, status, followerCount, totalFollowerWeight, totalClaimable, performanceFeeBps, subscriptionFeeUsdc, totalFeesEarned

// ── Supabase loose type (service role, all tables) ────────────────────────────

type AnyQ = Record<string, unknown>
type AnySupabase = {
  from: (table: string) => {
    insert: (payload: AnyQ | AnyQ[]) => Promise<{ data: unknown; error: { message?: string } | null }>
    select: (cols: string) => AnyFilterBuilder
    upsert: (payload: AnyQ, opts: AnyQ) => { select: (cols: string) => { single: () => Promise<{ data: { id: string } | null; error: { message?: string } | null }> } }
    delete: () => AnyFilterBuilder
    update: (payload: AnyQ) => AnyFilterBuilder
  }
}

type AnyFilterBuilder = {
  eq: (col: string, val: unknown) => AnyFilterBuilder
  gte: (col: string, val: unknown) => AnyFilterBuilder
  in: (col: string, vals: unknown[]) => AnyFilterBuilder
  order: (col: string, opts?: { ascending?: boolean }) => AnyFilterBuilder
  limit: (n: number) => AnyFilterBuilder
  maybeSingle: () => Promise<{ data: AnyQ | null; error: { message?: string } | null }>
  single: () => Promise<{ data: AnyQ | null; error: { message?: string } | null }>
  then: (resolve: (result: { data: AnyQ[] | null; error: unknown }) => void) => void
}

// ── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_ARC_CHAIN_ID = 5_042_002
const DEFAULT_ARC_RPC_URL = 'https://rpc.testnet.arc.network'
const HYPERLIQUID_INFO_URL = 'https://api.hyperliquid.xyz/info'
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' satisfies Address
const statusByContractStatus = ['active', 'paused', 'slashed', 'withdrawn'] as const

const arcTestnet = defineChain({
  id: Number(process.env.ARC_CHAIN_ID ?? process.env.VITE_ARC_CHAIN_ID ?? DEFAULT_ARC_CHAIN_ID),
  name: 'Arc Testnet',
  nativeCurrency: { name: 'Arc Testnet Gas', symbol: 'USDC', decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.ARC_RPC_URL ?? process.env.VITE_ARC_RPC_URL ?? DEFAULT_ARC_RPC_URL] },
  },
})

// ── Helpers ──────────────────────────────────────────────────────────────────

function env(name: string, fallback?: string) {
  const value = process.env[name] ?? fallback
  if (!value) throw new Error(`Missing ${name}`)
  return value
}

function optionalAddress(value: string | undefined): Address | undefined {
  return value && isAddress(value) ? getAddress(value) : undefined
}

function numberFrom(value: unknown, fallback: number) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function slashRules(value: unknown): SlashRule[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return undefined
      const rule = item as Record<string, unknown>
      if (typeof rule.condition !== 'string') return undefined
      return { condition: rule.condition, slashPercent: numberFrom(rule.slashPercent, 0) }
    })
    .filter((item): item is SlashRule => Boolean(item))
}

function numeric(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const n = Number(v)
    return Number.isFinite(n) ? n : 0
  }
  return 0
}

// ── Mandate loading ──────────────────────────────────────────────────────────

async function fetchMandate(uri: string, benchmark: string): Promise<RiskMandate | undefined> {
  if (!uri) return undefined
  let raw: unknown
  if (uri.startsWith('data:application/json,')) {
    raw = JSON.parse(decodeURIComponent(uri.slice('data:application/json,'.length)))
  } else {
    const ipfsGateway = process.env.IPFS_GATEWAY ?? process.env.VITE_IPFS_GATEWAY ?? 'https://ipfs.io/ipfs/'
    const url = uri.startsWith('ipfs://') ? `${ipfsGateway}${uri.slice('ipfs://'.length)}` : uri
    const response = await fetch(url)
    if (!response.ok) throw new Error(`Mandate fetch failed (${response.status}) for ${uri}`)
    raw = await response.json()
  }
  if (!raw || typeof raw !== 'object') throw new Error(`Mandate at ${uri} is not a JSON object`)
  const data = raw as Record<string, unknown>
  return {
    displayName: typeof data.displayName === 'string' ? data.displayName : undefined,
    strategy: typeof data.strategy === 'string' ? data.strategy : undefined,
    hyperliquidUser: optionalAddress(typeof data.hyperliquidUser === 'string' ? data.hyperliquidUser : undefined),
    polymarketProxy: optionalAddress(typeof data.polymarketProxy === 'string' ? data.polymarketProxy : undefined),
    markets: stringArray(data.markets),
    maxLeverage: numberFrom(data.maxLeverage, 1),
    maxDrawdown: numberFrom(data.maxDrawdown, 0.12),
    maxPositionSize: numberFrom(data.maxPositionSize, 0.2),
    cooldownHours: numberFrom(data.cooldownHours, 24),
    benchmark: typeof data.benchmark === 'string' ? data.benchmark : benchmark,
    slashRules: slashRules(data.slashRules),
  }
}

// ── Auth ─────────────────────────────────────────────────────────────────────

function supabaseUrl() {
  return process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
}

function assertCronAuth(req: VercelRequest) {
  const expected = process.env.CRON_SECRET
  if (!expected) return
  const authorization = Array.isArray(req.headers.authorization)
    ? req.headers.authorization[0]
    : req.headers.authorization
  if (authorization !== `Bearer ${expected}`) throw new Error('Unauthorized cron request')
}

// ── Wallet client (for onchain writes) ───────────────────────────────────────

function agentWalletClient(rpcUrl: string) {
  const raw = process.env.RISK_AGENT_PRIVATE_KEY
  if (!raw) return null
  const key = raw.startsWith('0x') ? raw : `0x${raw}`
  const account = privateKeyToAccount(key as `0x${string}`)
  return createWalletClient({ account, chain: arcTestnet, transport: http(rpcUrl) })
}

// ── Onchain attestation ──────────────────────────────────────────────────────

async function recordAttestationOnchain(params: {
  walletClient: ReturnType<typeof createWalletClient>
  contract: Address
  strategyId: bigint
  condition: string
  evidenceURI: string
  slashBps: number
}) {
  const conditionBytes32 = keccak256(toBytes(params.condition))
  const safeBps = Math.min(Math.max(params.slashBps, 0), 5000)
  await params.walletClient.writeContract({
    address: params.contract,
    abi: bondMirrorBondAbi,
    functionName: 'recordAttestation',
    args: [params.strategyId, conditionBytes32, params.evidenceURI, safeBps],
  })
}

// ── Onchain slash ─────────────────────────────────────────────────────────────

async function executeSlashOnchain(params: {
  walletClient: ReturnType<typeof createWalletClient>
  publicClient: ReturnType<typeof createPublicClient>
  contract: Address
  strategyId: bigint
  followerAddresses: Address[]
}) {
  if (!params.followerAddresses.length) {
    console.log(`Strategy ${params.strategyId.toString()}: no followers to slash`)
    return
  }
  await params.walletClient.writeContract({
    address: params.contract,
    abi: bondMirrorBondAbi,
    functionName: 'slashBond',
    args: [params.strategyId, params.followerAddresses],
  })
  console.log(`Slashed strategy ${params.strategyId.toString()} — ${params.followerAddresses.length} followers compensated`)
}

// ── Hyperliquid position types ────────────────────────────────────────────────

type HlPosition = {
  position?: {
    coin?: string
    szi?: string | number
    positionValue?: string | number
    leverage?: { value?: number }
    entryPx?: string | number
  }
}

type HlClearinghouse = {
  assetPositions?: HlPosition[]
}

async function fetchCurrentPositions(user: Address): Promise<HlPosition[]> {
  try {
    const resp = await fetch(HYPERLIQUID_INFO_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'clearinghouseState', user }),
    })
    if (!resp.ok) return []
    const state = (await resp.json()) as HlClearinghouse
    return (state.assetPositions ?? []).filter((p) => p.position?.coin)
  } catch {
    return []
  }
}

// ── Mirror signal detection ───────────────────────────────────────────────────

type StoredPosition = {
  coin: string
  size_signed: number
  entry_price: number | null
  leverage: number | null
  notional_value: number | null
}

async function trackAndEmitMirrorSignals(params: {
  supabase: AnySupabase
  strategyDbId: string
  contractStrategyId: bigint
  hlUser: Address
}) {
  const { supabase, strategyDbId, contractStrategyId, hlUser } = params

  const currentRaw = await fetchCurrentPositions(hlUser)
  const current = currentRaw
    .map((p) => ({
      coin: p.position!.coin!,
      sizeSigned: numeric(p.position!.szi),
      entryPrice: p.position?.entryPx != null ? numeric(p.position.entryPx) : null,
      leverage: p.position?.leverage?.value ?? null,
      notional: p.position?.positionValue != null ? numeric(p.position.positionValue) : null,
    }))
    .filter((p) => Math.abs(p.sizeSigned) > 0.000_01)

  // Load previous snapshot from Supabase
  const { data: prevData } = await (
    supabase.from('hl_positions').select('*').eq('strategy_id', strategyDbId) as unknown as Promise<{
      data: StoredPosition[] | null
    }>
  )
  const prev: StoredPosition[] = prevData ?? []

  const signals: AnyQ[] = []

  // Detect newly opened or changed positions
  for (const cur of current) {
    const old = prev.find((p) => p.coin === cur.coin)
    if (!old) {
      // New position opened
      signals.push({
        strategy_id: strategyDbId,
        contract_strategy_id: Number(contractStrategyId),
        coin: cur.coin,
        action: cur.sizeSigned > 0 ? 'open_long' : 'open_short',
        size: Math.abs(cur.sizeSigned),
        price_estimate: cur.entryPrice,
        leverage: cur.leverage,
        raw_evidence: { sizeSigned: cur.sizeSigned, notional: cur.notional },
      })
    } else if (Math.abs(cur.sizeSigned - old.size_signed) > Math.abs(old.size_signed) * 0.15) {
      // Size changed by more than 15%
      signals.push({
        strategy_id: strategyDbId,
        contract_strategy_id: Number(contractStrategyId),
        coin: cur.coin,
        action: 'size_change',
        size: Math.abs(cur.sizeSigned - old.size_signed),
        price_estimate: cur.entryPrice,
        leverage: cur.leverage,
        raw_evidence: { from: old.size_signed, to: cur.sizeSigned },
      })
    }
  }

  // Detect closed positions (in prev but not in current)
  for (const old of prev) {
    const stillOpen = current.find((c) => c.coin === old.coin)
    if (!stillOpen) {
      signals.push({
        strategy_id: strategyDbId,
        contract_strategy_id: Number(contractStrategyId),
        coin: old.coin,
        action: old.size_signed > 0 ? 'close_long' : 'close_short',
        size: Math.abs(old.size_signed),
        price_estimate: null,
        leverage: old.leverage,
        raw_evidence: { closedSize: old.size_signed },
      })
    }
  }

  // Emit signals to Supabase
  if (signals.length) {
    for (const sig of signals) {
      await supabase.from('mirror_signals').insert(sig)
    }
    console.log(
      `Strategy ${contractStrategyId.toString()}: ${signals.length} mirror signal(s) — ${signals.map((s) => `${s.coin as string} ${s.action as string}`).join(', ')}`,
    )
  }

  // Update position snapshot — delete old rows then insert current
  await (supabase.from('hl_positions').delete().eq('strategy_id', strategyDbId) as unknown as Promise<unknown>)
  if (current.length) {
    for (const pos of current) {
      await supabase.from('hl_positions').insert({
        strategy_id: strategyDbId,
        contract_strategy_id: Number(contractStrategyId),
        coin: pos.coin,
        size_signed: pos.sizeSigned,
        entry_price: pos.entryPrice,
        leverage: pos.leverage,
        notional_value: pos.notional,
      })
    }
  }
}

// ── Decay detection ───────────────────────────────────────────────────────────

async function detectAndWarnDecay(params: {
  supabase: AnySupabase
  strategyDbId: string
  contractStrategyId: bigint
  currentScore: number
}): Promise<{ decaying: boolean; slope: number; warningLevel: string }> {
  const { supabase, strategyDbId, currentScore } = params

  const { data } = await (
    supabase
      .from('score_snapshots')
      .select('risk_score, created_at')
      .eq('strategy_id', strategyDbId)
      .order('created_at', { ascending: false })
      .limit(10) as unknown as Promise<{ data: { risk_score: number; created_at: string }[] | null }>
  )

  const scores = [...(data ?? []).map((r) => r.risk_score).reverse(), currentScore]

  if (scores.length < 4) return { decaying: false, slope: 0, warningLevel: 'none' }

  const slope = (scores[scores.length - 1] - scores[0]) / (scores.length - 1)
  const warningLevel = slope < -8 ? 'critical' : slope < -5 ? 'warn' : slope < -3 ? 'watch' : 'none'

  if (warningLevel !== 'none') {
    console.log(
      `⚠️  Decay detected for strategy ${params.contractStrategyId.toString()}: slope=${slope.toFixed(2)} level=${warningLevel} scores=[${scores.join(', ')}]`,
    )
  }

  return { decaying: slope < -3, slope, warningLevel }
}

// ── Weekly performance oracle check ──────────────────────────────────────────

async function weeklyPerformanceCheck(params: {
  supabase: AnySupabase
  strategyDbId: string
  contractStrategyId: bigint
  hyperliquid?: HyperliquidSummary
  mandate?: RiskMandate
  risk: ReturnType<typeof scoreStrategy>
}): Promise<boolean> {
  const { supabase, strategyDbId, contractStrategyId, hyperliquid, mandate, risk } = params

  // Check if we've already run a weekly check in the past 6 days
  const sixDaysAgo = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString()
  const { data: recentWeeklyCheck } = await (
    supabase
      .from('agent_runs')
      .select('id')
      .eq('strategy_id', strategyDbId)
      .eq('run_type', 'weekly_check')
      .gte('created_at', sixDaysAgo)
      .limit(1)
      .maybeSingle() as unknown as Promise<{ data: { id: string } | null }>
  )

  if (recentWeeklyCheck) return false // Already ran this week

  const returnPct = hyperliquid?.returnWindowPercent ?? null
  const benchmarkUnderperformThreshold = -10 // flag if down >10% vs benchmark in window

  let weeklyViolation: string | null = null

  if (returnPct !== null && returnPct < benchmarkUnderperformThreshold) {
    weeklyViolation = 'weekly_return_below_threshold'
  }

  if (risk.riskScore < 40) {
    weeklyViolation = weeklyViolation ?? 'weekly_risk_score_critical'
  }

  // Log weekly check regardless
  await supabase.from('agent_runs').insert({
    strategy_id: strategyDbId,
    run_type: 'weekly_check',
    status: weeklyViolation ? 'violation_found' : 'completed',
    input_payload: { contractStrategyId: contractStrategyId.toString() },
    output_payload: {
      returnPct,
      benchmarkUnderperformThreshold,
      riskScore: risk.riskScore,
      weeklyViolation,
      mandate: mandate?.benchmark,
    },
    finished_at: new Date().toISOString(),
  })

  if (weeklyViolation) {
    console.log(
      `📅 Weekly check: strategy ${contractStrategyId.toString()} failed — ${weeklyViolation} (return=${returnPct?.toFixed(2) ?? 'n/a'}%, score=${risk.riskScore})`,
    )
  }

  return Boolean(weeklyViolation)
}

// ── Follower address collection ───────────────────────────────────────────────
// Read FollowerSubscribed events to build the slash list

async function collectFollowerAddresses(params: {
  publicClient: ReturnType<typeof createPublicClient>
  contract: Address
  strategyId: bigint
  fromBlock: bigint
  latestBlock: bigint
}): Promise<Address[]> {
  const { publicClient, contract, strategyId, fromBlock, latestBlock } = params
  const maxRange = 9_999n
  const allLogs: { args: { follower?: Address } }[] = []

  for (let start = fromBlock; start <= latestBlock; start += maxRange + 1n) {
    const toBlock = start + maxRange > latestBlock ? latestBlock : start + maxRange
    const chunk = await publicClient.getContractEvents({
      address: contract,
      abi: bondMirrorBondAbi,
      eventName: 'FollowerSubscribed',
      args: { strategyId },
      fromBlock: start,
      toBlock,
    })
    allLogs.push(...(chunk as typeof allLogs))
  }

  const seen = new Set<string>()
  const followers: Address[] = []
  for (const log of allLogs) {
    const addr = log.args.follower
    if (addr && !seen.has(addr.toLowerCase())) {
      seen.add(addr.toLowerCase())
      followers.push(addr)
    }
  }
  return followers
}

// ── Supabase attestation upsert ───────────────────────────────────────────────

function mandateIntegrity(risk: ReturnType<typeof scoreStrategy>) {
  if (!risk.violations.length) return 100
  if (risk.violations.includes('leverage_above_max') || risk.violations.includes('drawdown_above_max')) return 65
  return Math.max(50, 100 - risk.violations.length * 12)
}

function dbStrategyStatus(contractStatus: number, riskStatus: ReturnType<typeof scoreStrategy>['status']) {
  if (riskStatus === 'slash_pending') return 'slash_pending'
  return statusByContractStatus[contractStatus] ?? 'active'
}

// ── Main agent ────────────────────────────────────────────────────────────────

export async function runRiskAgent() {
  const rpcUrl = process.env.ARC_RPC_URL ?? process.env.VITE_ARC_RPC_URL ?? DEFAULT_ARC_RPC_URL
  const contract = optionalAddress(
    (process.env.BONDMIRROR_CONTRACT_ADDRESS ?? process.env.VITE_BONDMIRROR_CONTRACT_ADDRESS)?.trim(),
  )
  if (!contract) throw new Error('Missing BONDMIRROR_CONTRACT_ADDRESS')

  const wallet = agentWalletClient(rpcUrl)
  const url = env('SUPABASE_URL', supabaseUrl())
  const serviceKey = env('SUPABASE_SERVICE_ROLE_KEY')
  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  }) as unknown as AnySupabase

  const publicClient = createPublicClient({ chain: arcTestnet, transport: http(rpcUrl) })
  const polymarketBuilderCode = process.env.POLYMARKET_BUILDER_CODE ?? process.env.VITE_POLYMARKET_BUILDER_CODE

  const latestBlock = await publicClient.getBlockNumber()
  const configuredFromBlock = process.env.BONDMIRROR_FROM_BLOCK ?? process.env.VITE_BONDMIRROR_FROM_BLOCK
  const fromBlock = configuredFromBlock ? BigInt(configuredFromBlock) : (latestBlock > 200_000n ? latestBlock - 200_000n : 0n)

  const nextStrategyId = (await publicClient.readContract({
    address: contract,
    abi: bondMirrorBondAbi,
    functionName: 'nextStrategyId',
  })) as bigint

  const processed: Array<Record<string, unknown>> = []

  for (let id = 1n; id < nextStrategyId; id++) {
    try {
      const strategy = (await publicClient.readContract({
        address: contract,
        abi: bondMirrorBondAbi,
        functionName: 'strategies',
        args: [id],
      })) as StrategyTuple

      const [leader, bond, , mandateURI, benchmark, contractStatus, followerCount, totalFollowerWeight] = strategy
      const bondUsdc = Number(formatUnits(bond, 6))

      const mandate = await fetchMandate(mandateURI, benchmark).catch((err) => {
        console.error(`Mandate ${id.toString()} failed:`, err)
        return undefined
      })

      const [hyperliquid, polymarket] = await Promise.all([
        mandate?.hyperliquidUser
          ? fetchHyperliquidSummary(mandate.hyperliquidUser)
          : Promise.resolve(undefined),
        mandate?.polymarketProxy
          ? fetchPolymarketSummary(mandate.polymarketProxy, polymarketBuilderCode)
          : Promise.resolve(undefined),
      ])

      const risk = scoreStrategy({
        bondUsdc,
        mandate,
        hyperliquid,
        polymarket,
        followerCount: Number(followerCount),
        totalFollowerWeight: Number(totalFollowerWeight),
      })

      // ── 1. Upsert strategy to Supabase ──────────────────────────────────────

      const attester = optionalAddress(process.env.RISK_AGENT_ADDRESS) ?? ZERO_ADDRESS

      const { data: strategyRow, error: upsertError } = await supabase
        .from('strategy_mandates')
        .upsert(
          {
            contract_strategy_id: Number(id),
            contract_address: contract,
            chain_id: arcTestnet.id,
            leader_address: leader,
            mandate_uri: mandateURI,
            strategy_name: mandate?.displayName ?? `BondMirror Strategy ${id.toString()}`,
            strategy_summary: mandate?.strategy ?? 'Arc slash-bonded copy strategy',
            markets: mandate?.markets ?? [],
            max_leverage: mandate?.maxLeverage ?? 1,
            max_drawdown: mandate?.maxDrawdown ?? 0.12,
            max_position_size: mandate?.maxPositionSize ?? 0.2,
            cooldown_hours: Math.round(mandate?.cooldownHours ?? 24),
            benchmark: mandate?.benchmark ?? benchmark,
            slash_rules: mandate?.slashRules ?? [],
            current_bond_usdc: bondUsdc,
            follower_count: Number(followerCount),
            total_follower_weight: Number(formatUnits(totalFollowerWeight, 6)),
            mandate_integrity: mandateIntegrity(risk),
            risk_score: risk.riskScore,
            copy_weight: risk.copyWeight,
            slash_risk: risk.slashRisk,
            status: dbStrategyStatus(contractStatus, risk.status),
          },
          { onConflict: 'chain_id,contract_address,contract_strategy_id' },
        )
        .select('id')
        .single()

      if (upsertError) {
        console.error(`Supabase upsert failed for strategy ${id.toString()}:`, upsertError.message)
        continue
      }

      const strategyDbId = strategyRow?.id
      if (!strategyDbId) continue

      // ── 2. Score snapshot (for decay detection) ─────────────────────────────

      await supabase.from('score_snapshots').insert({
        strategy_id: strategyDbId,
        contract_strategy_id: Number(id),
        risk_score: risk.riskScore,
        violations: risk.violations,
        copy_weight: risk.copyWeight,
      })

      // ── 3. Position tracking + mirror signals ────────────────────────────────

      if (mandate?.hyperliquidUser) {
        await trackAndEmitMirrorSignals({
          supabase,
          strategyDbId,
          contractStrategyId: id,
          hlUser: mandate.hyperliquidUser,
        }).catch((err) => console.error(`Mirror signal tracking failed for strategy ${id.toString()}:`, err))
      }

      // ── 4. Decay detection ───────────────────────────────────────────────────

      const decay = await detectAndWarnDecay({
        supabase,
        strategyDbId,
        contractStrategyId: id,
        currentScore: risk.riskScore,
      })

      // ── 5. Weekly performance oracle check ──────────────────────────────────

      const weeklyFlag = await weeklyPerformanceCheck({
        supabase,
        strategyDbId,
        contractStrategyId: id,
        hyperliquid,
        mandate,
        risk,
      })

      // ── 6. Onchain attestation + slash if needed ─────────────────────────────

      const shouldAttest =
        risk.status === 'slash_pending' ||
        weeklyFlag ||
        decay.warningLevel === 'critical'

      if (shouldAttest) {
        const condition =
          risk.violations.find(
            (v) => v === 'leverage_above_max' || v === 'drawdown_above_max' || v === 'weekly_return_below_threshold',
          ) ??
          risk.violations[0] ??
          (weeklyFlag ? 'weekly_return_below_threshold' : 'decay_critical')

        const slashPercent = mandate?.slashRules.find((r) => r.condition === condition)?.slashPercent ?? 0.1
        const slashBps = Math.round(slashPercent * 10_000)

        const evidenceURI = `data:application/json,${encodeURIComponent(
          JSON.stringify({
            score: risk.riskScore,
            violations: risk.violations,
            reason: risk.reason,
            decaySlope: decay.slope,
            decayLevel: decay.warningLevel,
            weeklyFlag,
            observedAt: new Date().toISOString(),
          }),
        )}`

        // Supabase record
        const dupWindow = new Date(Date.now() - 60 * 60 * 1000).toISOString()
        const { data: recentAttestation } = await (
          supabase
            .from('risk_attestations')
            .select('id')
            .eq('strategy_id', strategyDbId)
            .eq('condition', condition)
            .gte('created_at', dupWindow)
            .limit(1)
            .maybeSingle() as unknown as Promise<{ data: { id: string } | null }>
        )

        if (!recentAttestation) {
          await supabase.from('risk_attestations').insert({
            strategy_id: strategyDbId,
            contract_strategy_id: Number(id),
            attester_address: attester,
            condition,
            evidence_uri: evidenceURI,
            slash_percent_bps: slashBps,
            severity: decay.warningLevel === 'critical' ? 'critical' : 'violation',
            decision_status: 'recorded',
            agent_output: {
              score: risk.riskScore,
              violations: risk.violations,
              decay,
              weeklyFlag,
              hyperliquid,
              polymarket,
              observedAt: new Date().toISOString(),
            },
          })
        }

        // Onchain attestation
        if (wallet) {
          try {
            await recordAttestationOnchain({
              walletClient: wallet,
              contract,
              strategyId: id,
              condition,
              evidenceURI,
              slashBps,
            })
            console.log(`✅ Onchain attestation: strategy ${id.toString()} condition=${condition}`)
          } catch (err) {
            console.error(`Onchain attestation failed for strategy ${id.toString()}:`, err)
          }
        }

        // Execute onchain slash if hard violation + wallet available + followers exist
        if (wallet && (risk.status === 'slash_pending' || weeklyFlag)) {
          try {
            const followers = await collectFollowerAddresses({
              publicClient,
              contract,
              strategyId: id,
              fromBlock,
              latestBlock,
            })
            if (followers.length > 0) {
              await executeSlashOnchain({ walletClient: wallet, publicClient, contract, strategyId: id, followerAddresses: followers })
            }
          } catch (err) {
            console.error(`Onchain slash failed for strategy ${id.toString()}:`, err)
          }
        }
      }

      // ── 7. Agent run log ─────────────────────────────────────────────────────

      await supabase.from('agent_runs').insert({
        strategy_id: strategyDbId,
        run_type: 'mandate_check',
        status: 'completed',
        input_payload: { contractStrategyId: id.toString(), contract, chainId: arcTestnet.id },
        output_payload: {
          risk,
          hyperliquid,
          polymarket,
          mandateLoaded: Boolean(mandate),
          decay,
          weeklyFlag,
        },
        finished_at: new Date().toISOString(),
      })

      processed.push({
        contractStrategyId: id.toString(),
        leader,
        bondUsdc,
        riskScore: risk.riskScore,
        copyWeight: risk.copyWeight,
        slashRisk: risk.slashRisk,
        status: risk.status,
        violations: risk.violations,
        decayLevel: decay.warningLevel,
      })

      console.log(
        `Strategy ${id.toString()}: score=${risk.riskScore} status=${risk.status} decay=${decay.warningLevel} violations=${JSON.stringify(risk.violations)}`,
      )
    } catch (err) {
      console.error(`Strategy ${id.toString()} agent run failed:`, err)
    }
  }

  return {
    ok: true,
    chainId: arcTestnet.id,
    contract,
    scannedStrategies: processed.length,
    processed,
  }
}

// ── Vercel handler ────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method && !['GET', 'POST'].includes(req.method)) {
    res.status(405).json({ ok: false, error: 'Method not allowed' })
    return
  }
  try {
    assertCronAuth(req)
    const result = await runRiskAgent()
    res.status(200).json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Risk agent failed'
    const status = message === 'Unauthorized cron request' ? 401 : 500
    res.status(status).json({ ok: false, error: message })
  }
}
