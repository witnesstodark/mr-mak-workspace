import { useRef, useState } from 'react'
import { api, uploadImage, transcribeDesktopAudio } from './client'
import { Icon } from './Icons'
import { ZoomImage } from '../components/ImagePreview'
import type { Preview } from './types'

import VoiceInput from '../mobile/VoiceInput'
import { useDictation } from './useDictation'

const maxImages = 12

export default function MakComposer({ connected, sending, onSend }: {
  connected: boolean
  sending: boolean
  onSend: (text: string, images: string[]) => Promise<void>
}) {
  const [voiceBusy, setVoiceBusy] = useState(false)
  const { info: dictation } = useDictation()
  const [draft, setDraft] = useState('')
  const [images, setImages] = useState<Preview[]>([])
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const voiceIds = useRef(new Set<string>())
  const busy = useRef(false)
  const picker = useRef<HTMLInputElement>(null)
  const disabled = sending || uploading || !connected

  async function attach(files: File[]) {
    if (!files.length || disabled || busy.current) return
    if (images.length + files.length > maxImages) { setError(`Attach up to ${maxImages} images per message.`); return }
    busy.current = true; setUploading(true); setError('')
    try {
      for (const file of files) {
        const saved = await uploadImage(file)
        const preview = await api<Preview>(`/preview?path=${encodeURIComponent(saved.path)}`)
        setImages(previous => [...previous, preview])
      }
    } catch (error) { setError(error instanceof Error ? error.message : String(error)) }
    finally { busy.current = false; setUploading(false) }
  }

  async function send(event: React.FormEvent) {
    event.preventDefault()
    if (disabled || voiceBusy || busy.current || (!draft.trim() && !images.length)) return
    busy.current = true; setError('')
    try {
      await onSend(draft.trim() || 'Please review the attached images.', images.map(image => image.path))
      setDraft(''); setImages([])
    } catch (error) { setError(error instanceof Error ? error.message : String(error)) }
    finally { busy.current = false }
  }

  return <div className="mak-composer">
    {error && <div className="voice-error" role="alert"><span>{error}</span><button className="desk-icon" aria-label="Dismiss message error" onClick={() => setError('')}><Icon name="close" size={14} /></button></div>}
    {images.length > 0 && <div className="voice-attachments" aria-label="Attached images">{images.map(image => <div className="voice-attachment" key={image.path}>
      <ZoomImage src={image.url} alt={image.name} />
      <button className="desk-icon" title={`Remove ${image.name}`} aria-label={`Remove ${image.name}`} disabled={disabled} onClick={() => setImages(previous => previous.filter(item => item.path !== image.path))}><Icon name="close" size={12} /></button>
    </div>)}</div>}
    <form className="voice-compose" onSubmit={send}>
      <input ref={picker} type="file" hidden multiple accept="image/png,image/jpeg,image/webp,image/gif,image/bmp" aria-label="Choose images for Mr. Mak" onChange={event => { const files = Array.from(event.target.files || []); event.target.value = ''; void attach(files) }} />
      <button type="button" title="Attach images" aria-label="Attach images" disabled={disabled} onClick={() => picker.current?.click()}><Icon name="attach" size={17} /></button>
      <textarea value={draft} rows={2} onChange={event => setDraft(event.target.value)} placeholder="Or tell Mak here…" aria-label="Message Mr. Mak" aria-describedby="mak-compose-hint" disabled={disabled}
        onPaste={event => { const files = Array.from(event.clipboardData.files).filter(file => file.type.startsWith('image/')); if (files.length) { event.preventDefault(); void attach(files) } }}
        onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) { event.preventDefault(); event.currentTarget.form?.requestSubmit() } }} />
      <VoiceInput id="desktop-mak" connected={connected} disabled={disabled} config={dictation} transcriber={transcribeDesktopAudio} onBusy={setVoiceBusy} onText={(text, recordingId) => { if (voiceIds.current.has(recordingId)) return; voiceIds.current.add(recordingId); setDraft(current => current ? `${current}\n${text}` : text) }} />
      <button type="submit" title="Send to Mr. Mak" aria-label="Send to Mr. Mak" disabled={disabled || voiceBusy || (!draft.trim() && !images.length)}><Icon name="send" size={17} /></button>
    </form>
    <div className="voice-compose-hint" id="mak-compose-hint" role="status">{uploading ? 'Saving images in inbox…' : 'Enter to send · Shift+Enter for a new line · Paste images'}</div>
  </div>
}
