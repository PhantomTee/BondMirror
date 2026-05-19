import { createPublicClient, formatUnits, http, type Address } from 'viem'
import { bondMirrorBondAbi } from '../abi/bondMirrorBond'
import { appConfig, arcTestnet, setupProblems } from '../config'
import type { ArcTransactionView, AttestationView, BondMirrorState, StrategyStatus, StrategyView } from '../types'
import { fetchHyperliquidSummary } from './hyperliquid'
import { loadMandate } from './mandate'
import { fetchPolymarketSummary } from './polymarket'
import { scoreStrategy } from './risk'
import { summarizeEvidenceUri } from './evidence'

type StrategyTuple = readonly [
  Address,
  bigint,
  bigint,
  string,
  string,
  number,
  bigint,
  bigint,
  bigint,
]

type AttestationTuple = readonly [bigint, `0x${string}`, string, number, Address, bigint]
type BondMirrorEventName =
  | 'StrategyCreated'
  | 'BondStaked'
  | 'FollowerSubscribed'
  | 'AttestationRecorded'
  | 'BondSlashed'
  | 'CompensationClaimed'

const usdcDecimals = 6

function statusFromChain(status: number): StrategyStatus {
  switch (status) {
    case 0:
      return 'active'
    case 1:
      return 'paused'
    case 2:
      return 'slashed'
    case 3:
      return 'withdrawn'
    default:
      return 'unknown'
  }
}

function formatUsdc(amount: bigint) {
  return Number(formatUnits(amount, usdcDecimals))
}

function shortHash(hash: string) {
  return `${hash.slice(0, 8)}...${hash.slice(-6)}`
}

function conditionLabel(condition: `0x${string}`) {
  return shortHash(condition)
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unknown Arc RPC error'
}

const publicClient = createPublicClient({
  chain: arcTestnet,
  transport: http(appConfig.arcRpcUrl),
})

async function loadAttestations(strategyId: bigint): Promise<AttestationView[]> {
  const contract = appConfig.bondContract
  if (!contract) {
    return []
  }

  const count = await publicClient.readContract({
    address: contract,
    abi: bondMirrorBondAbi,
    functionName: 'attestationCount',
    args: [strategyId],
  })

  return Promise.all(
    Array.from({ length: Number(count) }, async (_, index) => {
      const attestation = (await publicClient.readContract({
        address: contract,
        abi: bondMirrorBondAbi,
        functionName: 'attestations',
        args: [strategyId, BigInt(index)],
      })) as AttestationTuple

      return {
        strategyId: attestation[0],
        condition: conditionLabel(attestation[1]),
        evidenceURI: attestation[2],
        slashPercent: Number(attestation[3]) / 100,
        agent: attestation[4],
        createdAt: new Date(Number(attestation[5]) * 1000),
      }
    }),
  )
}

async function loadStrategy(strategyId: bigint): Promise<StrategyView> {
  const contract = appConfig.bondContract
  if (!contract) {
    throw new Error('BondMirror contract is not configured')
  }

  const strategy = (await publicClient.readContract({
    address: contract,
    abi: bondMirrorBondAbi,
    functionName: 'strategies',
    args: [strategyId],
  })) as StrategyTuple

  const [leader, bond, cooldownEndsAt, mandateURI, benchmark, status, followerCount, totalFollowerWeight, totalClaimable] = strategy
  const errors: string[] = []
  const mandate = await loadMandate(mandateURI, benchmark).catch((error) => {
    errors.push(error instanceof Error ? error.message : 'Mandate fetch failed')
    return undefined
  })
  const [hyperliquid, polymarket] = await Promise.all([
    mandate?.hyperliquidUser ? fetchHyperliquidSummary(mandate.hyperliquidUser) : Promise.resolve(undefined),
    mandate?.polymarketProxy ? fetchPolymarketSummary(mandate.polymarketProxy, appConfig.polymarketBuilderCode) : Promise.resolve(undefined),
  ])
  const bondUsdc = formatUsdc(bond)

  return {
    id: strategyId,
    leader,
    bond,
    bondUsdc,
    cooldownEndsAt,
    mandateURI,
    benchmark,
    status: statusFromChain(status),
    followerCount,
    totalFollowerWeight,
    totalClaimable,
    mandate,
    hyperliquid,
    polymarket,
    risk: scoreStrategy({ bondUsdc, mandate, hyperliquid, polymarket, followerCount: Number(followerCount), totalFollowerWeight: Number(totalFollowerWeight) }),
  }
}

async function loadTransactions(fromBlock: bigint, latestBlock: bigint): Promise<ArcTransactionView[]> {
  const contract = appConfig.bondContract
  if (!contract) {
    return []
  }

  async function getEvents(eventName: BondMirrorEventName) {
    const logs = []
    const maxRange = 9_999n
    for (let start = fromBlock; start <= latestBlock; start += maxRange + 1n) {
      const toBlock = start + maxRange > latestBlock ? latestBlock : start + maxRange
      const chunk = await publicClient.getContractEvents({
        address: contract,
        abi: bondMirrorBondAbi,
        eventName,
        fromBlock: start,
        toBlock,
      })
      logs.push(...chunk)
    }
    return logs
  }

  const [created, bonded, subscribed, attested, slashed, claimed] = await Promise.all([
    getEvents('StrategyCreated'),
    getEvents('BondStaked'),
    getEvents('FollowerSubscribed'),
    getEvents('AttestationRecorded'),
    getEvents('BondSlashed'),
    getEvents('CompensationClaimed'),
  ])

  type EventWithArgs<T> = {
    transactionHash: `0x${string}`
    blockNumber: bigint
    args: T
  }
  const createdEvents = created as unknown as EventWithArgs<{ leader?: Address; strategyId?: bigint }>[]
  const bondedEvents = bonded as unknown as EventWithArgs<{ strategyId?: bigint; amount?: bigint }>[]
  const subscribedEvents = subscribed as unknown as EventWithArgs<{ strategyId?: bigint; follower?: Address; weight?: bigint }>[]
  const attestedEvents = attested as unknown as EventWithArgs<{ strategyId?: bigint; condition?: `0x${string}`; slashBps?: number; evidenceURI?: string }>[]
  const slashedEvents = slashed as unknown as EventWithArgs<{ strategyId?: bigint; amount?: bigint }>[]
  const claimedEvents = claimed as unknown as EventWithArgs<{ strategyId?: bigint; follower?: Address; amount?: bigint }>[]

  const rows: ArcTransactionView[] = [
    ...createdEvents.map((event) => ({
      hash: event.transactionHash,
      type: 'strategy' as const,
      actor: event.args.leader ?? 'leader',
      amount: '0 USDC',
      detail: `Strategy ${event.args.strategyId?.toString() ?? ''} created`,
      blockNumber: event.blockNumber,
    })),
    ...bondedEvents.map((event) => ({
      hash: event.transactionHash,
      type: 'bond' as const,
      actor: `Strategy ${event.args.strategyId?.toString() ?? ''}`,
      amount: `${formatUsdc(event.args.amount ?? 0n).toLocaleString()} USDC`,
      detail: 'Leader performance bond staked on Arc',
      blockNumber: event.blockNumber,
    })),
    ...subscribedEvents.map((event) => ({
      hash: event.transactionHash,
      type: 'subscription' as const,
      actor: event.args.follower ?? 'follower',
      amount: `weight ${event.args.weight?.toString() ?? '0'}`,
      detail: `Follower subscribed to strategy ${event.args.strategyId?.toString() ?? ''}`,
      blockNumber: event.blockNumber,
    })),
    ...attestedEvents.map((event) => ({
      hash: event.transactionHash,
      type: 'attestation' as const,
      actor: 'BondMirror risk agent',
      amount: `${Number(event.args.slashBps ?? 0) / 100}% slash`,
      detail: `Strategy ${event.args.strategyId?.toString() ?? ''}: ${summarizeEvidenceUri(event.args.evidenceURI ?? '', conditionLabel(event.args.condition ?? '0x0')).condition}`,
      blockNumber: event.blockNumber,
    })),
    ...slashedEvents.map((event) => ({
      hash: event.transactionHash,
      type: 'slash' as const,
      actor: 'BondMirror contract',
      amount: `${formatUsdc(event.args.amount ?? 0n).toLocaleString()} USDC`,
      detail: `Bond slashed for strategy ${event.args.strategyId?.toString() ?? ''}`,
      blockNumber: event.blockNumber,
    })),
    ...claimedEvents.map((event) => ({
      hash: event.transactionHash,
      type: 'claim' as const,
      actor: event.args.follower ?? 'follower',
      amount: `${formatUsdc(event.args.amount ?? 0n).toLocaleString()} USDC`,
      detail: `Follower compensation claimed for strategy ${event.args.strategyId?.toString() ?? ''}`,
      blockNumber: event.blockNumber,
    })),
  ]

  return rows.sort((a, b) => Number(b.blockNumber - a.blockNumber)).map((row) => ({ ...row, hash: shortHash(row.hash) }))
}

export async function loadBondMirrorState(): Promise<BondMirrorState> {
  const errors = setupProblems()
  const contract = appConfig.bondContract
  if (!contract) {
    return {
      strategies: [],
      attestations: [],
      transactions: [],
      errors,
    }
  }

  const chainId = await publicClient.getChainId()
  if (chainId !== appConfig.arcChainId) {
    errors.push(`Connected RPC reports chain ${chainId}, expected ${appConfig.arcChainId}.`)
  }

  const latestBlock = await publicClient.getBlockNumber()
  const fromBlock = appConfig.eventFromBlock ?? (latestBlock > 100_000n ? latestBlock - 100_000n : 0n)
  const nextStrategyId = await publicClient.readContract({
    address: contract,
    abi: bondMirrorBondAbi,
    functionName: 'nextStrategyId',
  }) as bigint

  const ids = Array.from({ length: Number(nextStrategyId - 1n) }, (_, index) => BigInt(index + 1))

  const strategies = (
    await Promise.all(
      ids.map(async (id) =>
        loadStrategy(id).catch((error) => {
          errors.push(`Strategy ${id.toString()} read failed: ${errorMessage(error)}`)
          return undefined
        }),
      ),
    )
  ).filter((strategy): strategy is StrategyView => Boolean(strategy))

  const transactions = await loadTransactions(fromBlock, latestBlock).catch((error) => {
    errors.push(`Arc transaction tape unavailable: ${errorMessage(error)}`)
    return [] as ArcTransactionView[]
  })

  const attestations = (
    await Promise.all(
      ids.map(async (id) =>
        loadAttestations(id).catch((error) => {
          errors.push(`Attestations for strategy ${id.toString()} unavailable: ${errorMessage(error)}`)
          return [] as AttestationView[]
        }),
      ),
    )
  )
    .flat()
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())

  return {
    strategies,
    attestations,
    transactions,
    latestBlock,
    errors,
  }
}
