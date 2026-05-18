import { useState } from 'react'
import { connectWallet } from '../services/wallet'
import type { WalletSession } from '../types'

export function useWalletSession() {
  const [wallet, setWallet] = useState<WalletSession>({ status: 'disconnected' })

  async function connect() {
    setWallet({ status: 'connecting', message: 'Waiting for wallet approval...' })
    try {
      const address = await connectWallet()
      setWallet({ status: 'connected', address, message: 'Wallet connected on Arc Testnet.' })
      return address
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Wallet connection failed'
      setWallet({ status: 'error', message })
      throw error
    }
  }

  function disconnect() {
    setWallet({ status: 'disconnected' })
  }

  return {
    wallet,
    connect,
    disconnect,
  }
}
