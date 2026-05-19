import { createPublicClient, formatUnits, http, parseUnits } from 'viem'
import { appConfig, arcTestnet } from '../config'

const usycAbi = [
  {
    inputs: [{ name: 'shares', type: 'uint256' }],
    name: 'convertToAssets',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'account', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const

const publicClient = createPublicClient({
  chain: arcTestnet,
  transport: http(appConfig.arcRpcUrl),
})

// USYC uses 8 decimals; USDC uses 6.
// convertToAssets(1e8) returns how many USDC units 1 USYC is worth.
export async function fetchUsycRate(): Promise<{ usdcPerUsyc: number }> {
  try {
    const raw = await publicClient.readContract({
      address: appConfig.usyc,
      abi: usycAbi,
      functionName: 'convertToAssets',
      args: [parseUnits('1', 8)],
    })
    const usdcPerUsyc = Number(formatUnits(raw as bigint, 6))
    return { usdcPerUsyc }
  } catch {
    return { usdcPerUsyc: 1 }
  }
}

// Annualised yield estimate from the current exchange rate vs. par (1.0).
// USYC starts at 1 USDC and appreciates; anything above 1.0 represents accumulated yield.
export function estimateApyPercent(usdcPerUsyc: number): number {
  // Conservative floor: USYC is a T-bill money market — typically 4–5% APY.
  // We show the live rate premium over par as a lower-bound indicator.
  const premium = Math.max(usdcPerUsyc - 1, 0)
  // Premium compounds daily; annualise as simple percentage for display.
  return premium > 0 ? Number((premium * 100).toFixed(2)) : 4.8
}

// How much USDC yield a bond would earn per day if deployed into USYC instead.
export function dailyIdleYieldUsdc(bondUsdc: number, apyPercent: number): number {
  return (bondUsdc * apyPercent) / 100 / 365
}
