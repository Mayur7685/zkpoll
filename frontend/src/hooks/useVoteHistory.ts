// Step 29 — reads past Vote records from the connected wallet.
// These are private records owned by the voter; only visible to the record owner.

import { useState, useEffect, useCallback } from 'react'
import { useAleoWallet } from './useAleoWallet'
import type { VoteRecord } from '../types'

export function useVoteHistory() {
  const { requestVoteRecords, connected } = useAleoWallet()
  const [records, setRecords] = useState<VoteRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!connected) { setRecords([]); return }
    setLoading(true)
    setError(null)
    try {
      const recs = await requestVoteRecords()
      // Most recent cast_at first
      setRecords(recs.sort((a, b) => b.cast_at - a.cast_at))
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [requestVoteRecords, connected])

  // Auto-fetch when wallet connects
  useEffect(() => { void refresh() }, [refresh])

  /** Records that belong to a specific poll */
  function forPoll(pollId: string): VoteRecord[] {
    return records.filter(r => r.poll_id === pollId)
  }

  return { records, loading, error, refresh, forPoll }
}
