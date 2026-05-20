import { supabase } from './supabase'
import type { MirrorSignal } from '../types'

export async function fetchMirrorSignals(
  contractStrategyId: number,
  limit = 20,
): Promise<MirrorSignal[]> {
  if (!supabase) return []

  const { data, error } = await (supabase as unknown as SupabaseAny)
    .from('mirror_signals')
    .select('*')
    .eq('contract_strategy_id', contractStrategyId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error || !data) return []

  return (data as RawSignal[]).map((row) => ({
    id: row.id,
    strategyId: row.strategy_id,
    contractStrategyId: row.contract_strategy_id,
    coin: row.coin,
    action: row.action as MirrorSignal['action'],
    size: Number(row.size),
    priceEstimate: row.price_estimate != null ? Number(row.price_estimate) : null,
    leverage: row.leverage != null ? Number(row.leverage) : null,
    createdAt: new Date(row.created_at),
  }))
}

export async function fetchDecayWarning(
  strategyDbId: string,
): Promise<{ decaying: boolean; slope: number; scores: number[]; warningLevel: 'none' | 'watch' | 'warn' | 'critical' }> {
  if (!supabase) return { decaying: false, slope: 0, scores: [], warningLevel: 'none' }

  const { data } = await (supabase as unknown as SupabaseAny)
    .from('agent_runs')
    .select('output_payload, created_at')
    .eq('strategy_id', strategyDbId)
    .order('created_at', { ascending: false })
    .limit(10)

  if (!data || !Array.isArray(data) || data.length < 3) {
    return { decaying: false, slope: 0, scores: [], warningLevel: 'none' }
  }

  const scores: number[] = (data as { output_payload?: { risk?: { riskScore?: unknown } } }[])
    .map((r) => {
      const s = r.output_payload?.risk?.riskScore
      return typeof s === 'number' ? s : null
    })
    .filter((s): s is number => s !== null)
    .reverse() // oldest first

  if (scores.length < 3) return { decaying: false, slope: 0, scores, warningLevel: 'none' }

  const slope = (scores[scores.length - 1] - scores[0]) / (scores.length - 1)
  const warningLevel =
    slope < -8 ? 'critical' : slope < -5 ? 'warn' : slope < -3 ? 'watch' : 'none'

  return { decaying: slope < -3, slope, scores, warningLevel }
}

// ── internal types ───────────────────────────────────────────────────────────

type SupabaseAny = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, val: unknown) => {
        order: (col: string, opts: { ascending: boolean }) => {
          limit: (n: number) => Promise<{ data: unknown; error: unknown }>
        }
      }
    }
  }
}

type RawSignal = {
  id: string
  strategy_id: string
  contract_strategy_id: number
  coin: string
  action: string
  size: string | number
  price_estimate: string | number | null
  leverage: string | number | null
  created_at: string
}
