import { createPublicClient, createWalletClient, defineChain, http, keccak256, parseUnits, toBytes, type Address } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { bondMirrorBondAbi } from '../src/abi/bondMirrorBond'
import { erc20Abi } from '../src/abi/erc20'

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

function parseSlashRules() {
  const raw = process.env.SLASH_RULES_JSON
  if (!raw) {
    return [
      { condition: 'leverage_above_max', slashBps: 1_000 },
      { condition: 'drawdown_above_max', slashBps: 2_000 },
      { condition: 'unannounced_strategy_shift', slashBps: 1_500 },
    ]
  }
  return JSON.parse(raw) as Array<{ condition: string; slashBps: number }>
}

const account = privateKeyToAccount(requireEnv('LEADER_PRIVATE_KEY') as `0x${string}`)
const rpcUrl = process.env.ARC_RPC_URL ?? 'https://rpc.testnet.arc.network'
const contract = requireEnv('BONDMIRROR_CONTRACT_ADDRESS') as Address
const usdc = (process.env.ARC_USDC_ADDRESS ?? '0x3600000000000000000000000000000000000000') as Address
const mandateUri = requireEnv('MANDATE_URI')
const benchmark = process.env.BENCHMARK ?? 'USDC'
const slashRules = parseSlashRules()
const stakeAmount = Number(process.env.STAKE_USDC_AMOUNT ?? '0')

const walletClient = createWalletClient({
  account,
  chain: arcTestnet,
  transport: http(rpcUrl),
})
const publicClient = createPublicClient({
  chain: arcTestnet,
  transport: http(rpcUrl),
})

const conditions = slashRules.map((rule) => keccak256(toBytes(rule.condition)))
const slashBps = slashRules.map((rule) => rule.slashBps)

console.log(`Creating strategy from ${account.address}`)
const createHash = await walletClient.writeContract({
  address: contract,
  abi: bondMirrorBondAbi,
  functionName: 'createStrategy',
  args: [mandateUri, benchmark, conditions, slashBps],
})
console.log(`createStrategy tx: ${createHash}`)
const createReceipt = await publicClient.waitForTransactionReceipt({ hash: createHash })
console.log(`createStrategy finalized in block ${createReceipt.blockNumber.toString()}`)

if (stakeAmount > 0) {
  const strategyId = await publicClient.readContract({
    address: contract,
    abi: bondMirrorBondAbi,
    functionName: 'nextStrategyId',
  })
  const createdStrategyId = BigInt(strategyId.toString()) - 1n
  const amount = parseUnits(stakeAmount.toString(), 6)
  const approveHash = await walletClient.writeContract({
    address: usdc,
    abi: erc20Abi,
    functionName: 'approve',
    args: [contract, amount],
  })
  console.log(`approve tx: ${approveHash}`)
  await publicClient.waitForTransactionReceipt({ hash: approveHash })
  const stakeHash = await walletClient.writeContract({
    address: contract,
    abi: bondMirrorBondAbi,
    functionName: 'stakeBond',
    args: [createdStrategyId, amount],
  })
  console.log(`stakeBond tx: ${stakeHash}`)
  await publicClient.waitForTransactionReceipt({ hash: stakeHash })
  console.log(`Strategy ${createdStrategyId.toString()} staked ${stakeAmount} USDC`)
}
