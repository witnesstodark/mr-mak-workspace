import { useState } from 'react'
import type { DictationInfo } from '../mobile/client'
import './dictation-settings.css'

export default function DictationSettings({ info, onChange, disabled = false }: { info?: DictationInfo; onChange: (provider: string) => Promise<DictationInfo>; disabled?: boolean }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  async function change(provider: string) {
    setBusy(true); setError('')
    try { await onChange(provider) } catch (error) { setError(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false) }
  }
  const selected = info?.providers?.find(item => item.id === info.provider)
  return <section className="dictation-settings" aria-label="Speech-to-text settings">
    <h3>Speech-to-text</h3>
    <label>Dictation provider<select aria-label="Dictation provider" value={info?.provider || 'local'} disabled={disabled || busy || !info} onChange={event => void change(event.target.value)}>
      {(info?.providers || [{ id: 'local', label: 'Local Whisper · Free' }, { id: 'openai', label: 'OpenAI · Paid' }, { id: 'openrouter', label: 'OpenRouter · Paid' }, { id: 'off', label: 'Off' }]).map(provider => <option key={provider.id} value={provider.id}>{provider.label}</option>)}
    </select></label>
    <p>{selected?.detail} Shared by desktop and all paired phones. Changes apply to the next transcription; text stays a draft.</p>
    {selected && !selected.available && <p role="status">{selected.id === 'local' ? 'Local Whisper needs setup on your computer.' : `${selected.id === 'openai' ? 'OPENAI_API_KEY' : 'OPENROUTER_API_KEY'} is missing. Add it to the computer workspace .env.`} No automatic switch to another provider.</p>}
    {error && <p role="alert">{error}</p>}
  </section>
}
