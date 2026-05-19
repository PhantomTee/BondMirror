import { createClient } from '@supabase/supabase-js'
import { createPublicClient, createWalletClient, defineChain, formatUnits, getAddress, http, isAddress, keccak256, toBytes, type Address } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { bondMirrorBondAbi } from '../../src/abi/bondMirrorBond'
import { fetchHyperliquidSummary } from '../../src/services/hyperliquid'
import { fetchPolymarketSummary } from '../../src/services/polymarket'
import { scoreStrategy } from '../../src/services/risk'
import type { HyperliquidSummary, PolymarketSummary, RiskMandate, SlashRule } from '../../src/types'

type VercelRequest = {
  method?: string
  headers: Record<string, string | string[] | undefined>
  query?: Record<string, string | string[] | undefined>
}

type VercelResponse = {
  status: (code: number) => VercelResponse
  json: (body: unknown) => void
}

type StrategyTuple = readonly [Address, bigint, bigint, string, string, number, bigint, bigint, bigint]

type SupabaseError = {
  message?: string
}

type SupabaseIdRow = {
  id: string
}

type SupabaseFilterBuilder = {
  eq: (column: string, value: unknown) => SupabaseFilterBuilder
  gte: (column: string, value: unknown) => SupabaseFilterBuilder
  limit: (count: number) => SupabaseFilterBuilder
  maybeSingle: () => Promise<{ data: SupabaseIdRow | null; error: SupabaseError | null }>
}

type SupabaseMutationBuilder = {
  select: (columns: string) => {
    single: () => Promise<{ data: SupabaseIdRow | null; error: SupabaseError | null }>
  }
}

type BondMirrorSupabase = {
  from: (table: string) => {
    insert: (payload: Record<string, unknown>) => Promise<{ data: unknown; error: SupabaseError | null }>
    select: (columns: string) => SupabaseFilterBuilder
    upsert: (payload: Record<string, unknown>, options: Record<string, string>) => SupabaseMutationBuilder
  }
}

const DEFAULT_ARC_CHAIN_ID = 5_042_002
const DEFAULT_ARC_RPC_URL = 'https://rpc.testnet.arc.network'
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' satisfies Address

const statusByContractStatus = ['active', 'paused', 'slashed', 'withdrawn'] as const

const arcTestnet = defineChain({
  id: Number(process.env.ARC_CHAIN_ID ?? process.env.VITE_ARC_CHAIN_ID ?? DEFAULT_ARC_CHAIN_ID),
  name: 'Arc Testnet',
  nativeCurrency: {
    name: 'Arc Testnet Gas',
    symbol: 'USDC',
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: [process.env.ARC_RPC_URL ?? process.env.VITE_ARC_RPC_URL ?? DEFAULT_ARC_RPC_URL],
    },
  },
})

function env(name: string, fallback?: string) {
  const value = process.env[name] ?? fallback
  if (!value) {
    throw new Error(`Missing ${name}`)
  }
  return value
}

function optionalAddress(value: string | undefined): Address | undefined {
  return value && isAddress(value) ? getAddress(value) : undefined
}

function numberFrom(value: unknown, fallback: number) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }
  return fallback
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function slashRules(value: unknown): SlashRule[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return undefined
      }

      const rule = item as Record<string, unknown>
      if (typeof rule.condition !== 'string') {
        return undefined
      }

      return {
        condition: rule.condition,
        slashPercent: numberFrom(rule.slashPercent, 0),
      }
    })
    .filter((item): item is SlashRule => Boolean(item))
}

async function fetchMandate(uri: string, benchmark: string): Promise<RiskMandate | undefined> {
  if (!uri) {
    return undefined
  }

  let raw: unknown
  if (uri.startsWith('data:application/json,')) {
    raw = JSON.parse(decodeURIComponent(uri.slice('data:application/json,'.length)))
  } else {
    const ipfsGateway = process.env.IPFS_GATEWAY ?? process.env.VITE_IPFS_GATEWAY ?? 'https://ipfs.io/ipfs/'
    const url = uri.startsWith('ipfs://') ? `${ipfsGateway}${uri.slice('ipfs://'.length)}` : uri
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`Mandate fetch failed (${response.status}) for ${uri}`)
    }
    raw = await response.json()
  }

  if (!raw || typeof raw !== 'object') {
    throw new Error(`Mandate at ${uri} is not a JSON object`)
  }

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

function supabaseUrl() {
  return process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
}

function assertCronAuth(req: VercelRequest) {
  const expected = process.env.CRON_SECRET
  if (!expected) {
    return
  }

  const authorization = Array.isArray(req.headers.authorization)
    ? req.headers.authorization[0]
    : req.headers.authorization

  if (authorization !== `Bearer ${expected}`) {
    throw new Error('Unauthorized cron request')
  }
}

function dbStrategyStatus(contractStatus: number, riskStatus: ReturnType<typeof scoreStrategy>['status']) {
  if (riskStatus === 'slash_pending') {
    return 'slash_pending'
  }

  return statusByContractStatus[contractStatus] ?? 'active'
}

function mandateIntegrity(risk: ReturnType<typeof scoreStrategy>) {
  if (!risk.violations.length) {
    return 100
  }

  if (risk.violations.includes('leverage_above_max') || risk.violations.includes('drawdown_above_max')) {
    return 65
  }

  return Math.max(50, 100 - risk.violations.length * 12)
}

async function upsertAttestation(params: {
  supabase: BondMirrorSupabase
  strategyDbId: string
  contractStrategyId: bigint
  condition: string
  risk: ReturnType<typeof scoreStrategy>
  mandate?: RiskMandate
  hyperliquid?: HyperliquidSummary
  polymarket?: PolymarketSummary
}) {
  const slashPercent = params.mandate?.slashRules.find((rule) => rule.condition === params.condition)?.slashPercent ?? 0.1
  const attester = optionalAddress(process.env.RISK_AGENT_ADDRESS) ?? ZERO_ADDRESS
  const agentOutput = {
    score: params.risk.riskScore,
    copyWeight: params.risk.copyWeight,
    status: params.risk.status,
    slashRisk: params.risk.slashRisk,
    reason: params.risk.reason,
    action: params.risk.action,
    violations: params.risk.violations,
    hyperliquid: params.hyperliquid,
    polymarket: params.polymarket,
    observedAt: new Date().toISOString(),
  }
  const duplicateWindow = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const { data: recentAttestation } = await params.supabase
    .from('risk_attestations')
    .select('id')
    .eq('strategy_id', params.strategyDbId)
    .eq('condition', params.condition)
    .gte('created_at', duplicateWindow)
    .limit(1)
    .maybeSingle()

  if (recentAttestation) {
    return
  }

  await params.supabase.from('risk_attestations').insert({
    strategy_id: params.strategyDbId,
    contract_strategy_id: Number(params.contractStrategyId),
    attester_address: attester,
    condition: params.condition,
    evidence_uri: `data:application/json,${encodeURIComponent(JSON.stringify(agentOutput))}`,
    slash_percent_bps: Math.round(slashPercent * 10_000),
    severity: 'violation',
    decision_status: 'recorded',
    agent_output: agentOutput,
  })
}

function agentWalletClient(rpcUrl: string) {
  const raw = process.env.RISK_AGENT_PRIVATE_KEY
  if (!raw) return null
  const key = raw.startsWith('0x') ? raw : `0x${raw}`
  const account = privateKeyToAccount(key as `0x${string}`)
  return createWalletClient({ account, chain: arcTestnet, transport: http(rpcUrl) })
}

async function recordAttestationOnchain(params: {
  walletClient: ReturnType<typeof createWalletClient>
  contract: Address
  strategyId: bigint
  condition: string
  evidenceURI: string
  slashBps: number
}) {
  const conditionBytes32 = keccak256(toBytes(params.condition))
  const safeBps = Math.min(Math.max(params.slashBps, 0), 5000) as number
  await params.walletClient.writeContract({
    address: params.contract,
    abi: bondMirrorBondAbi,
    functionName: 'recordAttestation',
    args: [params.strategyId, conditionBytes32, params.evidenceURI, safeBps],
  })
}

export async function runRiskAgent() {
  const rpcUrl = process.env.ARC_RPC_URL ?? process.env.VITE_ARC_RPC_URL ?? DEFAULT_ARC_RPC_URL
  const contract = optionalAddress(process.env.BONDMIRROR_CONTRACT_ADDRESS ?? process.env.VITE_BONDMIRROR_CONTRACT_ADDRESS)
  if (!contract) {
    throw new Error('Missing BONDMIRROR_CONTRACT_ADDRESS')
  }

  const wallet = agentWalletClient(rpcUrl)
  const url = env('SUPABASE_URL', supabaseUrl())
  const serviceKey = env('SUPABASE_SERVICE_ROLE_KEY')
  const supabase = createClient(url, serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  }) as unknown as BondMirrorSupabase
  const publicClient = createPublicClient({
    chain: arcTestnet,
    transport: http(rpcUrl),
  })
  const polymarketBuilderCode = process.env.POLYMARKET_BUILDER_CODE ?? process.env.VITE_POLYMARKET_BUILDER_CODE
  const nextStrategyId = (await publicClient.readContract({
    address: contract,
    abi: bondMirrorBondAbi,
    functionName: 'nextStrategyId',
  })) as bigint

  const processed: Array<Record<string, unknown>> = []

  for (let id = 1n; id < nextStrategyId; id++) {
    const strategy = (await publicClient.readContract({
      address: contract,
      abi: bondMirrorBondAbi,
      functionName: 'strategies',
      args: [id],
    })) as StrategyTuple
    const [leader, bond, , mandateURI, benchmark, contractStatus, followerCount, totalFollowerWeight] = strategy
    const bondUsdc = Number(formatUnits(bond, 6))
    const mandate = await fetchMandate(mandateURI, benchmark).catch((error) => {
      console.error(`Mandate ${id.toString()} failed`, error)
      return undefined
    })
    const [hyperliquid, polymarket] = await Promise.all([
      mandate?.hyperliquidUser ? fetchHyperliquidSummary(mandate.hyperliquidUser) : Promise.resolve(undefined),
      mandate?.polymarketProxy
        ? fetchPolymarketSummary(mandate.polymarketProxy, polymarketBuilderCode)
        : Promise.resolve(undefined),
    ])
    const risk = scoreStrategy({ bondUsdc, mandate, hyperliquid, polymarket, followerCount: Number(followerCount), totalFollowerWeight: Number(totalFollowerWeight) })

    const { data, error } = await supabase
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
        {
          onConflict: 'chain_id,contract_address,contract_strategy_id',
        },
      )
      .select('id')
      .single()

    if (error) {
      throw new Error(error.message ?? 'Supabase strategy upsert failed')
    }

    if (data?.id && risk.status === 'slash_pending') {
      const condition = risk.violations.find((item) => item === 'leverage_above_max' || item === 'drawdown_above_max')
      if (condition) {
        const slashPercent = mandate?.slashRules.find((rule) => rule.condition === condition)?.slashPercent ?? 0.1
        const slashBps = Math.round(slashPercent * 10_000)
        const evidenceURI = `data:application/json,${encodeURIComponent(JSON.stringify({
          score: risk.riskScore,
          violations: risk.violations,
          reason: risk.reason,
          observedAt: new Date().toISOString(),
        }))}`

        await upsertAttestation({
          supabase,
          strategyDbId: data.id,
          contractStrategyId: id,
          condition,
          risk,
          mandate,
          hyperliquid,
          polymarket,
        })

        if (wallet) {
          try {
            await recordAttestationOnchain({ walletClient: wallet, contract, strategyId: id, condition, evidenceURI, slashBps })
            console.log(`Onchain attestation recorded for strategy ${id.toString()} condition=${condition}`)
          } catch (err) {
            console.error(`Onchain attestation failed for strategy ${id.toString()}:`, err)
          }
        }
      }
    }

    if (data?.id) {
      await supabase.from('agent_runs').insert({
        strategy_id: data.id,
        run_type: 'mandate_check',
        status: 'completed',
        input_payload: {
          contractStrategyId: id.toString(),
          contract,
          chainId: arcTestnet.id,
        },
        output_payload: {
          risk,
          hyperliquid,
          polymarket,
          polymarketBuilderCode,
          mandateLoaded: Boolean(mandate),
        },
        finished_at: new Date().toISOString(),
      })
    }

    processed.push({
      contractStrategyId: id.toString(),
      leader,
      bondUsdc,
      riskScore: risk.riskScore,
      copyWeight: risk.copyWeight,
      slashRisk: risk.slashRisk,
      status: risk.status,
      violations: risk.violations,
      builderTrades: polymarket?.builderTrades ?? null,
    })
  }

  return {
    ok: true,
    chainId: arcTestnet.id,
    contract,
    scannedStrategies: processed.length,
    processed,
  }
}

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
