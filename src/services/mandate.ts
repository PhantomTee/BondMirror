import { getAddress, isAddress, type Address } from 'viem'
import { appConfig } from '../config'
import type { RiskMandate, SlashRule } from '../types'

function normalizeUri(uri: string) {
  if (uri.startsWith('ipfs://')) {
    return `${appConfig.ipfsGateway}${uri.slice('ipfs://'.length)}`
  }
  return uri
}

function normalizeAddress(value: unknown): Address | undefined {
  if (typeof value === 'string' && isAddress(value)) {
    return getAddress(value)
  }
  return undefined
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

export async function loadMandate(uri: string, benchmark: string): Promise<RiskMandate | undefined> {
  if (!uri) {
    return undefined
  }

  let raw: unknown
  if (uri.startsWith('data:application/json,')) {
    raw = JSON.parse(decodeURIComponent(uri.slice('data:application/json,'.length)))
  } else {
    const response = await fetch(normalizeUri(uri))
    if (!response.ok) {
      throw new Error(`Mandate fetch failed (${response.status}) for ${uri}`)
    }
    raw = await response.json()
  }

  if (!raw || typeof raw !== 'object') {
    throw new Error(`Mandate at ${uri} is not a JSON object`)
  }

  const data = raw as Record<string, unknown>
  const rules = slashRules(data.slashRules)

  return {
    displayName: typeof data.displayName === 'string' ? data.displayName : undefined,
    strategy: typeof data.strategy === 'string' ? data.strategy : undefined,
    hyperliquidUser: normalizeAddress(data.hyperliquidUser),
    polymarketProxy: normalizeAddress(data.polymarketProxy),
    markets: stringArray(data.markets),
    maxLeverage: numberFrom(data.maxLeverage, 1),
    maxDrawdown: numberFrom(data.maxDrawdown, 0.12),
    maxPositionSize: numberFrom(data.maxPositionSize, 0.2),
    cooldownHours: numberFrom(data.cooldownHours, 24),
    benchmark: typeof data.benchmark === 'string' ? data.benchmark : benchmark,
    slashRules: rules,
  }
}
