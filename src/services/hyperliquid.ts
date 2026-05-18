import type { Address } from 'viem'
import type { HyperliquidSummary } from '../types'

const HYPERLIQUID_INFO_URL = 'https://api.hyperliquid.xyz/info'

type HyperliquidPosition = {
  position?: {
    coin?: string
    szi?: string
    positionValue?: string
    leverage?: {
      value?: number
    }
  }
}

type HyperliquidClearinghouseState = {
  marginSummary?: {
    accountValue?: string
    totalNtlPos?: string
  }
  assetPositions?: HyperliquidPosition[]
}

type HyperliquidFill = {
  closedPnl?: string
  time?: number
}

async function postInfo<T>(body: Record<string, unknown>) {
  const response = await fetch(HYPERLIQUID_INFO_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    throw new Error(`Hyperliquid info API ${response.status}`)
  }

  return (await response.json()) as T
}

function numeric(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

export async function fetchHyperliquidSummary(user: Address): Promise<HyperliquidSummary> {
  try {
    const [state, fills] = await Promise.all([
      postInfo<HyperliquidClearinghouseState>({ type: 'clearinghouseState', user }),
      postInfo<HyperliquidFill[]>({ type: 'userFills', user }),
    ])

    const positions = state.assetPositions ?? []
    const leverages = positions.map((item) => item.position?.leverage?.value ?? 0)
    const maxObservedLeverage = leverages.length ? Math.max(...leverages) : 0
    const totalPnl = fills.reduce((sum, fill) => sum + numeric(fill.closedPnl), 0)
    const wins = fills.filter((fill) => numeric(fill.closedPnl) > 0).length
    const accountValue = state.marginSummary?.accountValue ? numeric(state.marginSummary.accountValue) : null

    return {
      accountValue,
      currentLeverage: maxObservedLeverage,
      maxObservedLeverage,
      openPositions: positions.length,
      totalNotional: numeric(state.marginSummary?.totalNtlPos),
      fillsAnalyzed: fills.length,
      winRate: fills.length ? Math.round((wins / fills.length) * 100) : null,
      averageHoldHours: null,
      returnWindowPercent: accountValue ? (totalPnl / accountValue) * 100 : null,
      maxDrawdownPercent: null,
    }
  } catch (error) {
    return {
      accountValue: null,
      currentLeverage: 0,
      maxObservedLeverage: 0,
      openPositions: 0,
      totalNotional: 0,
      fillsAnalyzed: 0,
      winRate: null,
      averageHoldHours: null,
      returnWindowPercent: null,
      maxDrawdownPercent: null,
      sourceError: error instanceof Error ? error.message : 'Hyperliquid fetch failed',
    }
  }
}
