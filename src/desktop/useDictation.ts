import { useCallback, useEffect, useState } from 'react'
import { api, onServiceEvent } from './client'
import type { DictationInfo } from '../mobile/client'

export function useDictation() {
  const [info, setInfo] = useState<DictationInfo>()
  useEffect(() => {
    let alive = true, generation = 0
    const refresh = () => { const current = ++generation; void api<DictationInfo>('/dictation').then(info => { if (alive && current === generation) setInfo(info) }).catch(() => {}) }
    refresh()
    const off = onServiceEvent(event => { if (event.type === 'dictation' || event.type === 'connected') refresh() })
    return () => { alive = false; off() }
  }, [])
  const choose = useCallback(async (provider: string) => { const info = await api<DictationInfo>('/dictation', { provider }); setInfo(info); return info }, [])
  return { info, choose }
}
