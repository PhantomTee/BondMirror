import { createPublicClient, createWalletClient, custom, getAddress, http, keccak256, parseUnits, toBytes, type Address, type EIP1193Provider } from 'viem'
import { bondMirrorBondAbi } from '../abi/bondMirrorBond'
import { erc20Abi } from '../abi/erc20'
import { appConfig, arcTestnet } from '../config'

type CreateLeaderStrategyInput = {
  mandateURI: string
  benchmark: string
  slashRules: Array<{
    condition: string
    slashPercent: number
  }>
  stakeAmountUsdc?: number
}

function provider() {
  const ethereum = window.ethereum as EIP1193Provider | undefined
  if (!ethereum) {
    throw new Error('No injected wallet found. Install a wallet that supports Arc Testnet.')
  }
  return ethereum
}

async function ensureArcChain(ethereum: EIP1193Provider) {
  const chainIdHex = `0x${appConfig.arcChainId.toString(16)}`
  try {
    await ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: chainIdHex }],
    })
  } catch {
    await ethereum.request({
      method: 'wallet_addEthereumChain',
      params: [
        {
          chainId: chainIdHex,
          chainName: arcTestnet.name,
          nativeCurrency: arcTestnet.nativeCurrency,
          rpcUrls: [appConfig.arcRpcUrl],
        },
      ],
    })
  }
}

export async function connectWallet() {
  const ethereum = provider()
  await ensureArcChain(ethereum)
  const accounts = (await ethereum.request({ method: 'eth_requestAccounts' })) as string[]
  if (!accounts[0]) {
    throw new Error('Wallet did not return an account.')
  }
  return getAddress(accounts[0])
}

function walletClient(account: Address) {
  return createWalletClient({
    account,
    chain: arcTestnet,
    transport: custom(provider()),
  })
}

const publicClient = createPublicClient({
  chain: arcTestnet,
  transport: http(appConfig.arcRpcUrl),
})

export async function createLeaderStrategy(account: Address, input: CreateLeaderStrategyInput) {
  if (!appConfig.bondContract) {
    throw new Error('BondMirror contract address is not configured.')
  }
  if (!input.mandateURI.trim()) {
    throw new Error('A mandate URI is required.')
  }
  if (!input.slashRules.length) {
    throw new Error('At least one slash rule is required.')
  }

  const strategyId = (await publicClient.readContract({
    address: appConfig.bondContract,
    abi: bondMirrorBondAbi,
    functionName: 'nextStrategyId',
  })) as bigint

  const client = walletClient(account)
  const conditions = input.slashRules.map((rule) => keccak256(toBytes(rule.condition)))
  const slashBps = input.slashRules.map((rule) => {
    const bps = Math.round(rule.slashPercent * 10_000)
    if (bps <= 0 || bps > 5_000) {
      throw new Error(`Slash rule ${rule.condition} must be above 0% and at most 50%.`)
    }
    return bps
  })

  const createHash = await client.writeContract({
    address: appConfig.bondContract,
    abi: bondMirrorBondAbi,
    functionName: 'createStrategy',
    args: [input.mandateURI, input.benchmark, conditions, slashBps],
  })
  await publicClient.waitForTransactionReceipt({ hash: createHash })

  let approveHash: `0x${string}` | undefined
  let stakeHash: `0x${string}` | undefined
  if (input.stakeAmountUsdc && input.stakeAmountUsdc > 0) {
    const amount = parseUnits(input.stakeAmountUsdc.toString(), 6)
    approveHash = await client.writeContract({
      address: appConfig.usdc,
      abi: erc20Abi,
      functionName: 'approve',
      args: [appConfig.bondContract, amount],
    })
    await publicClient.waitForTransactionReceipt({ hash: approveHash })

    stakeHash = await client.writeContract({
      address: appConfig.bondContract,
      abi: bondMirrorBondAbi,
      functionName: 'stakeBond',
      args: [strategyId, amount],
    })
    await publicClient.waitForTransactionReceipt({ hash: stakeHash })
  }

  return {
    strategyId,
    createHash,
    approveHash,
    stakeHash,
  }
}

export async function subscribeFollower(account: Address, strategyId: bigint, weight: bigint) {
  if (!appConfig.bondContract) {
    throw new Error('BondMirror contract address is not configured.')
  }
  return walletClient(account).writeContract({
    address: appConfig.bondContract,
    abi: bondMirrorBondAbi,
    functionName: 'subscribeFollower',
    args: [strategyId, weight],
  })
}

export async function claimCompensation(account: Address, strategyId: bigint) {
  if (!appConfig.bondContract) {
    throw new Error('BondMirror contract address is not configured.')
  }
  return walletClient(account).writeContract({
    address: appConfig.bondContract,
    abi: bondMirrorBondAbi,
    functionName: 'claimCompensation',
    args: [strategyId],
  })
}

export async function stakeBond(account: Address, strategyId: bigint, amountUsdc: number) {
  if (!appConfig.bondContract) {
    throw new Error('BondMirror contract address is not configured.')
  }
  const client = walletClient(account)
  const amount = parseUnits(amountUsdc.toString(), 6)
  const approveHash = await client.writeContract({
    address: appConfig.usdc,
    abi: erc20Abi,
    functionName: 'approve',
    args: [appConfig.bondContract, amount],
  })
  const stakeHash = await client.writeContract({
    address: appConfig.bondContract,
    abi: bondMirrorBondAbi,
    functionName: 'stakeBond',
    args: [strategyId, amount],
  })
  return { approveHash, stakeHash }
}
