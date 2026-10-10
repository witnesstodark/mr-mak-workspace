import { useRef } from 'react'
import { api, transcribeDesktopAudio } from './client'
import VoiceInput from '../mobile/VoiceInput'
import { useDictation } from './useDictation'

export default function DictationComposer({ id, connected, running }: { id: string; connected: boolean; running: boolean }) {
  const voiceIds = useRef(new Set<string>())
  const { info: config } = useDictation()
  return <div className="terminal-dictation"><VoiceInput id={`desktop-chat-${id}`} connected={connected} disabled={!running} config={config} transcriber={transcribeDesktopAudio} onBusy={() => {}} onText={async (text, recordingId) => {
    if (voiceIds.current.has(recordingId)) return
    await api(`/sessions/${id}/input`, { text, paste: true, submit: false })
    voiceIds.current.add(recordingId)
    window.dispatchEvent(new CustomEvent('mrmak-dictation-inserted', { detail: { id } }))
  }} /></div>
}
