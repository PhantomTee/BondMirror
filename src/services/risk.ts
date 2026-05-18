import type { HyperliquidSummary, PolymarketSummary, RiskDecision, RiskMandate } from '../types'

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

export function scoreStrategy(input: {
  bondUsdc: number
  mandate?: RiskMandate
  hyperliquid?: HyperliquidSummary
  polymarket?: PolymarketSummary
}): RiskDecision {
  const violations: string[] = []
  let score = 80
  const { bondUsdc, mandate, hyperliquid, polymarket } = input

  if (!mandate) {
    score -= 45
    violations.push('mandate_unavailable')
  }

  if (bondUsdc <= 0) {
    score -= 35
    violations.push('bond_not_staked')
  } else if (bondUsdc < 1) {
    score -= 15
    violations.push('bond_below_minimum')
  }

  if (mandate && hyperliquid) {
    if (hyperliquid.maxObservedLeverage > mandate.maxLeverage) {
      score -= 35
      violations.push('leverage_above_max')
    } else if (hyperliquid.maxObservedLeverage > mandate.maxLeverage * 0.85) {
      score -= 12
    }

    if (hyperliquid.maxDrawdownPercent !== null && Math.abs(hyperliquid.maxDrawdownPercent) > mandate.maxDrawdown * 100) {
      score -= 35
      violations.push('drawdown_above_max')
    }
  }

  if (hyperliquid?.sourceError) {
    score -= 8
  }

  if (polymarket?.sourceError) {
    score -= 8
  }

  if (polymarket && polymarket.nearResolutionMarkets > 0) {
    score -= 12
    violations.push('near_resolution_market_risk')
  }

  const riskScore = Math.round(clamp(score, 0, 100))
  const copyWeight = Math.round(clamp(riskScore / 4, 0, 30))
  const slashRisk = violations.some((item) => item !== 'mandate_unavailable')
    ? 'High'
    : riskScore >= 75
      ? 'Low'
      : 'Medium'
  const status = violations.some((item) => item === 'leverage_above_max' || item === 'drawdown_above_max')
    ? 'slash_pending'
    : riskScore >= 75
      ? 'healthy'
      : riskScore >= 45
        ? 'copy_with_limits'
        : 'paused'

  const reason = violations.length
    ? `Detected ${violations.join(', ')} from live mandate and market data.`
    : 'Live bond, mandate, and market data are inside declared risk limits.'

  const action =
    status === 'slash_pending'
      ? 'Record an attestation and slash after the configured challenge path.'
      : status === 'paused'
        ? 'Pause new copies until the missing data or mandate breach is resolved.'
        : status === 'copy_with_limits'
          ? `Copy at ${copyWeight}% weight with follower caps enforced.`
          : `Allow copying up to ${copyWeight}% weight.`

  return {
    riskScore,
    copyWeight,
    status,
    slashRisk,
    reason,
    action,
    violations,
  }
}
