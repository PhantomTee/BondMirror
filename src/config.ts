import { defineChain, getAddress, isAddress, type Address } from 'viem'

export const arcTestnet = defineChain({
  id: 5_042_002,
  name: 'Arc Testnet',
  nativeCurrency: {
    name: 'Arc Testnet Gas',
    symbol: 'USDC',
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: ['https://rpc.testnet.arc.network'],
    },
  },
})

function optionalAddress(value: string | undefined): Address | undefined {
  if (!value || !isAddress(value)) {
    return undefined
  }
  return getAddress(value)
}

function bigintFromEnv(value: string | undefined): bigint | undefined {
  if (!value) {
    return undefined
  }
  try {
    return BigInt(value)
  } catch {
    return undefined
  }
}

export const appConfig = {
  arcRpcUrl: import.meta.env.VITE_ARC_RPC_URL ?? 'https://rpc.testnet.arc.network',
  arcChainId: Number(import.meta.env.VITE_ARC_CHAIN_ID ?? arcTestnet.id),
  bondContract: optionalAddress(import.meta.env.VITE_BONDMIRROR_CONTRACT_ADDRESS),
  usdc: optionalAddress(import.meta.env.VITE_ARC_USDC_ADDRESS) ?? '0x3600000000000000000000000000000000000000',
  usyc: '0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C' as Address,
  eventFromBlock: bigintFromEnv(import.meta.env.VITE_BONDMIRROR_FROM_BLOCK),
  polymarketBuilderCode: import.meta.env.VITE_POLYMARKET_BUILDER_CODE,
  ipfsGateway: import.meta.env.VITE_IPFS_GATEWAY ?? 'https://ipfs.io/ipfs/',
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
  supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
} as const

export function setupProblems() {
  const problems: string[] = []

  if (!appConfig.bondContract) {
    problems.push('Set VITE_BONDMIRROR_CONTRACT_ADDRESS after deploying BondMirrorBond on Arc Testnet.')
  }

  if (!isAddress(appConfig.usdc)) {
    problems.push('Set VITE_ARC_USDC_ADDRESS to a valid Arc Testnet USDC contract.')
  }

  if (appConfig.arcChainId !== arcTestnet.id) {
    problems.push(`VITE_ARC_CHAIN_ID is ${appConfig.arcChainId}; expected Arc Testnet ${arcTestnet.id}.`)
  }

  return problems
}
