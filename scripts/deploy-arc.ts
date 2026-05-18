import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPublicClient, createWalletClient, defineChain, http, type Address } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const artifactPath = resolve(root, 'artifacts', 'BondMirrorBond.json')

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

if (!existsSync(artifactPath)) {
  throw new Error('Missing artifacts/BondMirrorBond.json. Run npm run contract:compile first.')
}

const artifact = JSON.parse(readFileSync(artifactPath, 'utf8')) as {
  abi: unknown[]
  bytecode: `0x${string}`
}
const account = privateKeyToAccount(requireEnv('DEPLOYER_PRIVATE_KEY') as `0x${string}`)
const rpcUrl = process.env.ARC_RPC_URL ?? 'https://rpc.testnet.arc.network'
const usdc = (process.env.ARC_USDC_ADDRESS ?? '0x3600000000000000000000000000000000000000') as Address
const riskAgent = (process.env.RISK_AGENT_ADDRESS ?? account.address) as Address

const walletClient = createWalletClient({
  account,
  chain: arcTestnet,
  transport: http(rpcUrl),
})
const publicClient = createPublicClient({
  chain: arcTestnet,
  transport: http(rpcUrl),
})

console.log(`Deploying BondMirrorBond from ${account.address}`)
console.log(`USDC: ${usdc}`)
console.log(`Risk agent: ${riskAgent}`)

const hash = await walletClient.deployContract({
  abi: artifact.abi,
  bytecode: artifact.bytecode,
  args: [usdc, riskAgent],
})

console.log(`Deployment tx: ${hash}`)
const receipt = await publicClient.waitForTransactionReceipt({ hash })
console.log(`BondMirrorBond deployed: ${receipt.contractAddress}`)
console.log(`VITE_BONDMIRROR_CONTRACT_ADDRESS=${receipt.contractAddress}`)
console.log(`VITE_BONDMIRROR_FROM_BLOCK=${receipt.blockNumber.toString()}`)
