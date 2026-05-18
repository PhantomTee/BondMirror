type JsonRecord = Record<string, unknown>

export type EvidenceSummary = {
  condition: string
  detail: string
  displayName?: string
  source: string
  tags: string[]
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function stringFrom(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function numberFrom(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

function decodeBase64(value: string) {
  const binary = atob(value)
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

function parseJsonDataUri(uri: string): JsonRecord | undefined {
  const commaIndex = uri.indexOf(',')
  if (commaIndex === -1) {
    return undefined
  }

  const metadata = uri.slice(0, commaIndex).toLowerCase()
  if (!metadata.startsWith('data:application/json')) {
    return undefined
  }

  try {
    const payload = uri.slice(commaIndex + 1)
    const json = metadata.includes(';base64') ? decodeBase64(payload) : decodeURIComponent(payload)
    const parsed = JSON.parse(json)
    return isRecord(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

export function formatShortValue(value: string, head = 24, tail = 12) {
  if (value.length <= head + tail + 3) {
    return value
  }
  return `${value.slice(0, head)}...${value.slice(-tail)}`
}

export function humanizeCondition(value: string | undefined) {
  if (!value) {
    return 'Unknown condition'
  }

  const trimmed = value.trim()
  if (/^0x[0-9a-f]+$/i.test(trimmed)) {
    return `Condition ${formatShortValue(trimmed, 10, 8)}`
  }

  const words = trimmed.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Unknown condition'
}

export function formatReferenceUri(uri: string, label: string) {
  if (!uri.trim()) {
    return `${label.charAt(0).toUpperCase() + label.slice(1)} reference unavailable`
  }
  if (uri.startsWith('data:application/json')) {
    return `Decoded JSON ${label}`
  }
  if (uri.startsWith('ipfs://')) {
    return `IPFS ${label}: ${formatShortValue(uri)}`
  }

  try {
    const url = new URL(uri)
    return `${label.charAt(0).toUpperCase() + label.slice(1)}: ${formatShortValue(`${url.hostname}${url.pathname}`)}`
  } catch {
    return `${label.charAt(0).toUpperCase() + label.slice(1)}: ${formatShortValue(uri)}`
  }
}

function formatNumber(value: number) {
  return Number.isInteger(value) ? value.toString() : value.toFixed(2)
}

export function summarizeEvidenceUri(uri: string, fallbackCondition?: string): EvidenceSummary {
  const data = parseJsonDataUri(uri)
  if (!data) {
    return {
      condition: humanizeCondition(fallbackCondition),
      detail: 'Evidence is stored in an external reference.',
      source: formatReferenceUri(uri, 'evidence'),
      tags: [],
    }
  }

  const condition = stringFrom(data.condition) ?? fallbackCondition
  const maxObservedLeverage = numberFrom(data.maxObservedLeverage)
  const mandateMaxLeverage = numberFrom(data.mandateMaxLeverage)
  const bondUsdc = numberFrom(data.bondUsdc)
  const benchmark = stringFrom(data.benchmark)
  const observedAt = stringFrom(data.observedAt)
  const parts: string[] = []
  const tags: string[] = []

  if (maxObservedLeverage !== undefined && mandateMaxLeverage !== undefined) {
    parts.push(`${formatNumber(maxObservedLeverage)}x observed vs ${formatNumber(mandateMaxLeverage)}x mandate`)
  } else if (maxObservedLeverage !== undefined) {
    parts.push(`${formatNumber(maxObservedLeverage)}x observed leverage`)
  }
  if (bondUsdc !== undefined) {
    parts.push(`${formatNumber(bondUsdc)} USDC bond`)
  }
  if (benchmark) {
    parts.push(benchmark)
  }

  const leader = stringFrom(data.leader)
  const hyperliquidUser = stringFrom(data.hyperliquidUser)
  const polymarketProxy = stringFrom(data.polymarketProxy)
  if (leader) {
    tags.push(`Leader ${formatShortValue(leader, 8, 6)}`)
  }
  if (hyperliquidUser) {
    tags.push(`Hyperliquid ${formatShortValue(hyperliquidUser, 8, 6)}`)
  }
  if (polymarketProxy) {
    tags.push(`Polymarket ${formatShortValue(polymarketProxy, 8, 6)}`)
  }
  if (observedAt) {
    const observedDate = new Date(observedAt)
    if (!Number.isNaN(observedDate.getTime())) {
      tags.push(`Observed ${observedDate.toLocaleString()}`)
    }
  }

  return {
    condition: humanizeCondition(condition),
    detail: parts.join(' | ') || 'Structured evidence decoded from the onchain URI.',
    displayName: stringFrom(data.displayName),
    source: 'Decoded onchain JSON evidence',
    tags,
  }
}
