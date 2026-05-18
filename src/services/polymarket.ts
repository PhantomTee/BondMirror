import type { Address } from 'viem'
import type { PolymarketSummary } from '../types'

const POLYMARKET_DATA_API = 'https://data-api.polymarket.com'
const POLYMARKET_CLOB_API = 'https://clob.polymarket.com'

type PolymarketTrade = {
  size?: number | string
  price?: number | string
  timestamp?: number
  proxyWallet?: string
  outcome?: string
  realizedPnl?: number | string
}

type BuilderTradeResponse = {
  data?: unknown[]
  trades?: unknown[]
  count?: number
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

async function fetchJson<T>(url: string) {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Polymarket API ${response.status}`)
  }
  return (await response.json()) as T
}

async function fetchBuilderTradeCount(builderCode: string | undefined) {
  if (!builderCode) {
    return null
  }

  const params = new URLSearchParams({
    builder_code: builderCode,
    limit: '100',
  })
  const payload = await fetchJson<BuilderTradeResponse>(`${POLYMARKET_CLOB_API}/builder/trades?${params}`)
  return payload.count ?? payload.data?.length ?? payload.trades?.length ?? 0
}

export async function fetchPolymarketSummary(proxyWallet: Address, builderCode?: string): Promise<PolymarketSummary> {
  try {
    const params = new URLSearchParams({
      user: proxyWallet,
      limit: '100',
    })
    const [trades, builderTrades] = await Promise.all([
      fetchJson<PolymarketTrade[]>(`${POLYMARKET_DATA_API}/trades?${params}`),
      fetchBuilderTradeCount(builderCode).catch(() => null),
    ])
    const tradeValues = trades.map((trade) => numeric(trade.size) * numeric(trade.price))
    const totalValue = tradeValues.reduce((sum, value) => sum + value, 0)
    const pnlValues = trades.map((trade) => numeric(trade.realizedPnl)).filter((value) => value !== 0)
    const profitable = pnlValues.filter((value) => value > 0).length

    return {
      tradesAnalyzed: trades.length,
      openMarkets: new Set(trades.map((trade) => trade.outcome).filter(Boolean)).size,
      averageTradeSize: trades.length ? totalValue / trades.length : null,
      realizedPnl: pnlValues.length ? pnlValues.reduce((sum, value) => sum + value, 0) : null,
      predictionAccuracy: pnlValues.length ? Math.round((profitable / pnlValues.length) * 100) : null,
      builderCode,
      builderTrades,
      nearResolutionMarkets: 0,
    }
  } catch (error) {
    return {
      tradesAnalyzed: 0,
      openMarkets: 0,
      averageTradeSize: null,
      realizedPnl: null,
      predictionAccuracy: null,
      builderCode,
      builderTrades: null,
      nearResolutionMarkets: 0,
      sourceError: error instanceof Error ? error.message : 'Polymarket fetch failed',
    }
  }
}
