import type { Address } from 'viem'

export type Platform = 'Hyperliquid' | 'Polymarket' | 'Arc'

export type StrategyStatus = 'active' | 'paused' | 'slashed' | 'withdrawn' | 'unknown'

export type SlashRisk = 'Low' | 'Medium' | 'High'

export type SlashRule = {
  condition: string
  slashPercent: number
}

export type RiskMandate = {
  displayName?: string
  strategy?: string
  hyperliquidUser?: Address
  polymarketProxy?: Address
  markets: string[]
  maxLeverage: number
  maxDrawdown: number
  maxPositionSize?: number
  cooldownHours?: number
  benchmark: string
  slashRules: SlashRule[]
}

export type HyperliquidSummary = {
  accountValue: number | null
  currentLeverage: number
  maxObservedLeverage: number
  openPositions: number
  totalNotional: number
  fillsAnalyzed: number
  winRate: number | null
  averageHoldHours: number | null
  returnWindowPercent: number | null
  maxDrawdownPercent: number | null
  sourceError?: string
}

export type PolymarketSummary = {
  tradesAnalyzed: number
  openMarkets: number
  averageTradeSize: number | null
  realizedPnl: number | null
  predictionAccuracy: number | null
  builderCode?: string
  builderTrades: number | null
  nearResolutionMarkets: number
  sourceError?: string
}

export type RiskDecision = {
  riskScore: number
  copyWeight: number
  status: 'copy_with_limits' | 'healthy' | 'paused' | 'slash_pending'
  slashRisk: SlashRisk
  reason: string
  action: string
  violations: string[]
}

export type StrategyView = {
  id: bigint
  leader: Address
  bond: bigint
  bondUsdc: number
  cooldownEndsAt: bigint
  mandateURI: string
  benchmark: string
  status: StrategyStatus
  followerCount: bigint
  totalFollowerWeight: bigint
  totalClaimable: bigint
  performanceFeeBps: number
  subscriptionFeeUsdc: bigint
  totalFeesEarned: bigint
  mandate?: RiskMandate
  hyperliquid?: HyperliquidSummary
  polymarket?: PolymarketSummary
  risk: RiskDecision
}

export type AttestationView = {
  strategyId: bigint
  condition: string
  evidenceURI: string
  slashPercent: number
  agent: Address
  createdAt: Date
}

export type ArcTransactionView = {
  hash: string
  type: 'bond' | 'subscription' | 'attestation' | 'slash' | 'claim' | 'strategy'
  actor: string
  amount: string
  detail: string
  blockNumber: bigint
}

export type BondMirrorState = {
  strategies: StrategyView[]
  attestations: AttestationView[]
  transactions: ArcTransactionView[]
  latestBlock?: bigint
  errors: string[]
}

export type WalletSession = {
  address?: Address
  status: 'disconnected' | 'connecting' | 'connected' | 'error'
  message?: string
}

// ── Hyperliquid leaderboard discovery ────────────────────────────────────────

export type HlLeaderboardEntry = {
  rank: number
  ethAddress: Address
  windowPnl: number   // 30-day PnL in USD
  pnl: number         // all-time PnL
  volume: number      // 30-day volume
  accountValue: number
  /** Linked BondMirror strategy if this trader has registered */
  bondMirrorStrategy?: StrategyView
}

// ── Mirror signals ────────────────────────────────────────────────────────────

export type MirrorSignal = {
  id: string
  strategyId: string
  contractStrategyId: number
  coin: string
  action: 'open_long' | 'open_short' | 'close_long' | 'close_short' | 'size_change'
  size: number
  priceEstimate: number | null
  leverage: number | null
  createdAt: Date
}

// ── Decay warning ─────────────────────────────────────────────────────────────

export type DecayWarning = {
  decaying: boolean
  slope: number           // points per check; negative = declining
  scores: number[]        // recent scores, oldest first
  warningLevel: 'none' | 'watch' | 'warn' | 'critical'
}
