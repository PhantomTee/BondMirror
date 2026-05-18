import { createPublicClient, createWalletClient, defineChain, formatUnits, http, keccak256, toBytes, type Address } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { bondMirrorBondAbi } from '../src/abi/bondMirrorBond'

type Mandate = {
  displayName?: string
  hyperliquidUser?: Address
  polymarketProxy?: Address
  maxLeverage?: number
  maxDrawdown?: number
  slashRules?: Array<{ condition: string; slashPercent: number }>
}

type StrategyTuple = readonly [Address, bigint, bigint, string, string, number, bigint, bigint, bigint]

type HyperliquidState = {
  marginSummary?: {
    accountValue?: string
    totalNtlPos?: string
  }
  assetPositions?: Array<{
    position?: {
      coin?: string
      positionValue?: string
      leverage?: {
        value?: number
      }
    }
  }>
}

const arcTestnet = defineChain({
  id: Number(process.env.ARC_CHAIN_ID ?? 5_042_002),
  name: 'Arc Testnet',
  nativeCurrency: {
    name: 'Arc Testnet Gas',
    symbol: 'USDC',
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: [process.env.ARC_RPC_URL ?? 'https://rpc.testnet.arc.network'],
    },
  },
})

function requireEnv(name: string) {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing ${name}`)
  }
  return value
}

async function fetchJson<T>(uri: string) {
  if (uri.startsWith('data:application/json,')) {
    return JSON.parse(decodeURIComponent(uri.slice('data:application/json,'.length))) as T
  }
  const response = await fetch(uri.startsWith('ipfs://') ? `https://ipfs.io/ipfs/${uri.slice('ipfs://'.length)}` : uri)
  if (!response.ok) {
    throw new Error(`Fetch failed ${response.status}: ${uri}`)
  }
  return (await response.json()) as T
}

async function fetchHyperliquid(user: Address) {
  const response = await fetch('https://api.hyperliquid.xyz/info', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'clearinghouseState', user }),
  })
  if (!response.ok) {
    throw new Error(`Hyperliquid info API ${response.status}`)
  }
  return (await response.json()) as HyperliquidState
}

function slashBpsFor(mandate: Mandate, condition: string) {
  const rule = mandate.slashRules?.find((item) => item.condition === condition)
  return Math.round((rule?.slashPercent ?? 0.1) * 10_000)
}

const account = privateKeyToAccount(requireEnv('RISK_AGENT_PRIVATE_KEY') as `0x${string}`)
const rpcUrl = process.env.ARC_RPC_URL ?? 'https://rpc.testnet.arc.network'
const contract = requireEnv('BONDMIRROR_CONTRACT_ADDRESS') as Address
const executeAttestation = process.env.EXECUTE_ATTESTATION === 'true'
const executeSlash = process.env.EXECUTE_SLASH === 'true'
const affectedFollowers = (process.env.AFFECTED_FOLLOWERS ?? '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean) as Address[]

const publicClient = createPublicClient({
  chain: arcTestnet,
  transport: http(rpcUrl),
})
const walletClient = createWalletClient({
  account,
  chain: arcTestnet,
  transport: http(rpcUrl),
})

const nextStrategyId = (await publicClient.readContract({
  address: contract,
  abi: bondMirrorBondAbi,
  functionName: 'nextStrategyId',
})) as bigint

console.log(`Risk agent ${account.address} scanning ${nextStrategyId - 1n} strategies`)

for (let id = 1n; id < nextStrategyId; id++) {
  const strategy = (await publicClient.readContract({
    address: contract,
    abi: bondMirrorBondAbi,
    functionName: 'strategies',
    args: [id],
  })) as StrategyTuple
  const [leader, bond, , mandateURI, benchmark] = strategy
  const mandate = await fetchJson<Mandate>(mandateURI)
  const hyperliquid = mandate.hyperliquidUser ? await fetchHyperliquid(mandate.hyperliquidUser) : undefined
  const maxLeverage = Math.max(...(hyperliquid?.assetPositions ?? []).map((item) => item.position?.leverage?.value ?? 0), 0)
  const condition = mandate.maxLeverage && maxLeverage > mandate.maxLeverage ? 'leverage_above_max' : undefined
  const evidence = {
    strategyId: id.toString(),
    leader,
    displayName: mandate.displayName,
    benchmark,
    bondUsdc: formatUnits(bond, 6),
    condition,
    maxObservedLeverage: maxLeverage,
    mandateMaxLeverage: mandate.maxLeverage,
    hyperliquidUser: mandate.hyperliquidUser,
    observedAt: new Date().toISOString(),
  }

  console.log(JSON.stringify(evidence, null, 2))

  if (!condition) {
    continue
  }

  const slashBps = slashBpsFor(mandate, condition)
  const evidenceURI = `data:application/json,${encodeURIComponent(JSON.stringify(evidence))}`

  if (executeAttestation) {
    const hash = await walletClient.writeContract({
      address: contract,
      abi: bondMirrorBondAbi,
      functionName: 'recordAttestation',
      args: [id, keccak256(toBytes(condition)), evidenceURI, slashBps],
    })
    console.log(`recordAttestation tx: ${hash}`)
    await publicClient.waitForTransactionReceipt({ hash })
  }

  if (executeSlash) {
    if (!affectedFollowers.length) {
      throw new Error('EXECUTE_SLASH=true requires AFFECTED_FOLLOWERS=0x...,0x...')
    }
    const hash = await walletClient.writeContract({
      address: contract,
      abi: bondMirrorBondAbi,
      functionName: 'slashBond',
      args: [id, affectedFollowers],
    })
    console.log(`slashBond tx: ${hash}`)
    await publicClient.waitForTransactionReceipt({ hash })
  }
}
