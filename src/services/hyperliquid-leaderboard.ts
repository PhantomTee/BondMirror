import type { Address } from 'viem'

const HYPERLIQUID_INFO_URL = 'https://api.hyperliquid.xyz/info'

export type HlLeaderboardEntry = {
  rank: number
  ethAddress: Address
  windowPnl: number   // 30-day PnL in USD
  pnl: number         // all-time PnL
  volume: number      // 30-day volume
  accountValue: number
}

type HlRawEntry = {
  ethAddress?: string
  windowPnl?: string | number
  pnl?: string | number
  vlm?: string | number
  accountValue?: string | number
}

type HlLeaderboardResponse =
  | HlRawEntry[]
  | { leaderboardRows?: HlRawEntry[] }

function num(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const n = Number(v)
    return Number.isFinite(n) ? n : 0
  }
  return 0
}

let cachedAt = 0
let cached: HlLeaderboardEntry[] = []

export async function fetchHlLeaderboard(
  window: '1d' | '7d' | '30d' | 'allTime' = '30d',
): Promise<HlLeaderboardEntry[]> {
  // 5-minute client cache — HL leaderboard updates slowly
  if (cached.length && Date.now() - cachedAt < 5 * 60 * 1000) {
    return cached
  }

  const resp = await fetch(HYPERLIQUID_INFO_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'leaderboard', leaderboardWindow: window }),
  })

  if (!resp.ok) {
    throw new Error(`Hyperliquid leaderboard ${resp.status}`)
  }

  const raw = (await resp.json()) as HlLeaderboardResponse

  const rows: HlRawEntry[] = Array.isArray(raw)
    ? raw
    : (raw.leaderboardRows ?? [])

  const entries = rows
    .filter((r): r is HlRawEntry & { ethAddress: string } => typeof r.ethAddress === 'string' && r.ethAddress.startsWith('0x'))
    .slice(0, 100)
    .map((r, i) => ({
      rank: i + 1,
      ethAddress: r.ethAddress as Address,
      windowPnl: num(r.windowPnl),
      pnl: num(r.pnl),
      volume: num(r.vlm),
      accountValue: num(r.accountValue),
    }))

  cached = entries
  cachedAt = Date.now()
  return entries
}

export function formatUsd(value: number): string {
  if (Math.abs(value) >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(2)}M`
  }
  if (Math.abs(value) >= 1_000) {
    return `$${(value / 1_000).toFixed(1)}K`
  }
  return `$${value.toFixed(0)}`
}
