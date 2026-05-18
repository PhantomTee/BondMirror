import { useCallback, useEffect, useRef, useState } from 'react'
import { loadBondMirrorState } from '../services/arc'
import type { BondMirrorState } from '../types'

type LiveState =
  | { status: 'loading'; data?: BondMirrorState; error?: string }
  | { status: 'ready'; data: BondMirrorState; error?: string }
  | { status: 'error'; data?: BondMirrorState; error: string }

export function useBondMirrorState() {
  const [state, setState] = useState<LiveState>({ status: 'loading' })
  const loadingRef = useRef(false)

  const refresh = useCallback(async (options?: { silent?: boolean }) => {
    if (loadingRef.current) {
      return
    }

    loadingRef.current = true
    if (!options?.silent) {
      setState((current) => ({ status: 'loading', data: current.data }))
    }
    try {
      const data = await loadBondMirrorState()
      setState({ status: 'ready', data })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load BondMirror state'
      setState((current) => ({
        status: 'error',
        data: current.data,
        error: message,
      }))
    } finally {
      loadingRef.current = false
    }
  }, [])

  useEffect(() => {
    const initialLoad = window.setTimeout(() => {
      void refresh()
    }, 0)
    const interval = window.setInterval(() => {
      void refresh({ silent: true })
    }, 30_000)

    return () => {
      window.clearTimeout(initialLoad)
      window.clearInterval(interval)
    }
  }, [refresh])

  return {
    ...state,
    refresh,
  }
}
