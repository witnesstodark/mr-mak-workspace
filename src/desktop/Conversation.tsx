import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { api, pickFiles, reportError, speakDesktopText, transcribeDesktopAudio, uploadImage, useDesktop } from './client'
import type { ChatSession, SystemEventsMode } from './types'
import SystemEvent, { type SystemEventData } from '../mobile/SystemEvent'
import BackgroundWork, { type BackgroundCommand, type WorkingAgent } from '../mobile/BackgroundWork'
import { AgentLogo, Icon } from './Icons'
import { useDictation } from './useDictation'
import ConversationImages from '../mobile/ConversationImages'
import type { ConversationImage } from '../mobile/ImageViewer'
import VoiceInput from '../mobile/VoiceInput'
import { visibleUserMessage } from '../mobile/workspace-context'
import { spokenText, useReadAloud } from '../mobile/useReadAloud'
import { readingVoiceChanged, readingVoices, saveReadingVoice, savedReadingVoice } from '../mobile/readingVoices'
import { commandToken, completeCommand, matchingCommands, terminalCommand, type ChatCommand } from './commandSuggestions'
import TerminalPrompt, { type PromptChoice, type TerminalPromptData } from '../components/TerminalPrompt'
import SideQuestions, { type SideQuestion } from './SideQuestions'
import { isMac } from './platform'
import './conversation.css'
import { keepUrl, linkTarget } from '../components/messageLinks'

type Effort = NonNullable<ChatSession['effort']>
// A message held by effort advice: the level it needs and the chat's current one.
type EffortAdvice = { level: Effort; why: string; from: Effort | null; message: string }
type EffortChoice = { action: 'switch' | 'auto'; level: Effort } | { action: 'keep'; level?: Effort }
// A message held because the chat's prompt cache went cold (chat-cache.mjs ColdGuard).
type ColdOffer = { message: string; tokens: number; writeUsd: number | null }
const effortLabel = (effort: Effort) => effort === 'xhigh' ? 'Extra high' : effort[0].toUpperCase() + effort.slice(1)

interface ToolActivity { id: string; name: string; status: 'running' | 'completed' | 'failed'; at: string }
interface Message { id: string; role: 'user' | 'assistant' | 'system'; text: string; at: string; images?: ConversationImage[]; event?: SystemEventData }
interface Transcript { supported: boolean; messages: Message[]; activity?: ToolActivity[]; agents?: WorkingAgent[]; commands?: BackgroundCommand[]; truncated?: boolean; prompt?: TerminalPromptData | null; btw?: SideQuestion[] }
// A /btw that reached the transcript as an ordinary prompt, as with a CLI without side questions.
const isBtw = (message: Message) => message.role === 'user' && /^\s*\/btw\s/.test(message.text)
const btwKey = isMac ? '⌥Enter' : 'Alt+Enter'
const skipKey = isMac ? '⌘Enter' : 'Ctrl+Enter'
interface Draft { text: string; paths: string[] }

const time = (value: string) => new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
const draftKey = (id: string) => `mrmak.chatDraft.${id}`
const fileName = (file: string) => file.split(/[\\/]/).filter(Boolean).pop() || file
function savedDraft(id: string): Draft {
  try {
    const value = JSON.parse(localStorage.getItem(draftKey(id)) || '')
    return { text: typeof value.text === 'string' ? value.text : '', paths: Array.isArray(value.paths) ? value.paths.filter((item: unknown) => typeof item === 'string') : [] }
  } catch { return { text: '', paths: [] } }
}
function saveDraft(id: string, draft: Draft) {
  try { localStorage.setItem(draftKey(id), JSON.stringify(draft)) } catch { /* The draft stays in memory. */ }
}

function MessageLink({ href, sessionId, children }: { href?: string; sessionId: string; children: React.ReactNode }) {
  const target = linkTarget(href)
  if (target.kind === 'web') return <a href={href} target="_blank" rel="noreferrer">{children}</a>
  if (target.kind === 'text') return <span className="conversation-link-text">{children}</span>
  return <a href={href} title={`Open ${target.path}`} onClick={event => { event.preventDefault(); api('/preview/show', { path: target.path, sessionId }).catch(reportError) }}>{children}</a>
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return <button type="button" className="conversation-copy" title="Copy message" aria-label={copied ? 'Copied' : 'Copy message'} onClick={() => navigator.clipboard.writeText(text).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1400) }).catch(reportError)}><Icon name="copy" size={14} />{copied && <span>Copied</span>}</button>
}

export default function Conversation({ session, connected, agentLabel, openTerminal, systemEvents = 'compact' }: { session: ChatSession; connected: boolean; agentLabel: string; openTerminal: () => void; systemEvents?: SystemEventsMode }) {
  const [transcript, setTranscript] = useState<Transcript | null>(null)
  const [readError, setReadError] = useState('')
  const [changedAt, setChangedAt] = useState(() => Date.now()), [now, setNow] = useState(() => Date.now())
  const fingerprint = useRef('')
  const scroller = useRef<HTMLDivElement>(null), area = useRef<HTMLDivElement>(null), input = useRef<HTMLTextAreaElement>(null)
  const follow = useRef(true), [showJump, setShowJump] = useState(false)
  const [draft, setDraft] = useState(() => savedDraft(session.id))
  const [pending, setPending] = useState<{ text: string, paths: string[], stage: 'checking' | 'held' | 'sent', after?: string | null } | null>(null)
  const [sending, setSending] = useState(false), [uploading, setUploading] = useState(false), [voiceBusy, setVoiceBusy] = useState(false), [status, setStatus] = useState('')
  const { settings } = useDesktop()
  const [advice, setAdvice] = useState<EffortAdvice | null>(null)
  const [coldOffer, setColdOffer] = useState<ColdOffer | null>(null), [coldBusy, setColdBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const { info: dictation } = useDictation()
  const running = session.status === 'running', working = running && session.activity === 'working'
  const reload = useRef<() => Promise<void>>(async () => {})
  const speech = useReadAloud(session.id, speakDesktopText), stopReading = speech.stop
  const [voice, setVoice] = useState(savedReadingVoice)
  const [answering, setAnswering] = useState(false)
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null), [rewinding, setRewinding] = useState(false), [editError, setEditError] = useState('')
  const [commands, setCommands] = useState<ChatCommand[]>([]), [caret, setCaret] = useState(0), [picked, setPicked] = useState(0), [dismissed, setDismissed] = useState('')
  useEffect(() => { api<{ commands: ChatCommand[] }>(`/sessions/${session.id}/commands`).then(value => setCommands(value.commands)).catch(() => setCommands([])) }, [session.id])
  const token = commandToken(draft.text, caret, session.agent === 'codex')
  const tokenKey = token ? `${token.start}:${token.trigger}${token.query}` : ''
  const suggestions = token && tokenKey !== dismissed ? matchingCommands(commands, token) : []
  const highlighted = suggestions[Math.min(picked, suggestions.length - 1)]
  function complete(command: ChatCommand) {
    if (!token) return
    const next = completeCommand(draft.text, token, command)
    setDraft(current => ({ ...current, text: next.text })); setCaret(next.caret); setPicked(0)
    requestAnimationFrame(() => { input.current?.focus(); input.current?.setSelectionRange(next.caret, next.caret) })
  }

  useEffect(() => { saveDraft(session.id, draft) }, [draft, session.id])
  useEffect(() => {
    let stopped = false, busy = false
    const load = async () => {
      if (busy || document.visibilityState === 'hidden') return
      busy = true
      try {
        const result = await api<Transcript>(`/sessions/${session.id}/messages`)
        if (stopped) return
        const at = Date.now(), next = JSON.stringify(result.messages)
        if (next !== fingerprint.current) { fingerprint.current = next; setChangedAt(at) }
        setTranscript(result); setReadError(''); setNow(at)
      } catch { if (!stopped) { setReadError('The conversation could not refresh. Earlier messages are still shown.'); setNow(Date.now()) } }
      finally { busy = false }
    }
    reload.current = load
    void load()
    const timer = window.setInterval(load, 2000)
    const visible = () => { if (document.visibilityState === 'visible') void load() }
    document.addEventListener('visibilitychange', visible)
    return () => { stopped = true; clearInterval(timer); document.removeEventListener('visibilitychange', visible) }
  }, [session.id, session.completionVersion, session.activity])
  const messages = transcript?.messages || []
  let readStart = 0
  for (let index = 0; index < messages.length; index++) if (messages[index].role === 'user') readStart = index
  const latestUserId = messages[readStart]?.role === 'user' ? messages[readStart].id : null
  useEffect(() => () => stopReading(), [latestUserId, session.id, stopReading])
  // A message sent through the effort check stays in the chat body until the transcript shows it.
  const held = pending && !(pending.stage === 'sent' && latestUserId !== pending.after) ? pending : null
  // A message rewound from the terminal no longer has an open editor.
  const openEdit = editing && (rewinding || messages.some(message => message.id === editing.id)) ? editing : null
  function readAloud(id: string) {
    if (speech.activeId) { speech.togglePause(); return }
    const parts = Array.from(scroller.current?.querySelectorAll<HTMLElement>('.conversation-message.assistant') || []).filter(node => Number(node.dataset.index) > readStart)
    speech.read(id, parts.map(node => spokenText(node.querySelector<HTMLElement>('.conversation-copy-text'))).filter(Boolean).join('\n\n'))
  }
  async function answer(prompt: TerminalPromptData, choice: PromptChoice) {
    if (answering) return
    setAnswering(true)
    try { await api(`/sessions/${session.id}/prompt`, { id: prompt.id, choice }); follow.current = true }
    catch (error) { reportError(error) }
    finally { setAnswering(false); void reload.current() }
  }
  useLayoutEffect(() => { const box = scroller.current; if (box && follow.current) box.scrollTop = box.scrollHeight }, [messages.length, transcript, working, held?.stage, coldOffer, advice])
  useEffect(() => { input.current?.focus() }, [session.id])
  useLayoutEffect(() => {
    const box = input.current
    if (!box) return
    box.style.height = 'auto'; box.style.height = `${Math.min(box.scrollHeight, 260)}px`
  }, [draft.text])

  function addPaths(paths: string[]) {
    if (!paths.length) return
    setDraft(current => ({ ...current, paths: [...new Set([...current.paths, ...paths])].slice(0, 100) }))
    input.current?.focus()
  }
  async function addImages(files: File[]) {
    if (!files.length || uploading) return
    if (files.length > 12) { setStatus('Attach up to 12 images at a time.'); return }
    setUploading(true); setStatus('Saving images to inbox…')
    try { const paths: string[] = []; for (const file of files) paths.push((await uploadImage(file)).path); addPaths(paths); setStatus('') }
    catch (error) { setStatus(error instanceof Error ? error.message : String(error)) }
    finally { setUploading(false) }
  }
  const addPathsRef = useRef(addPaths)
  useEffect(() => { addPathsRef.current = addPaths })
  useEffect(() => {
    let choosing = false
    const pick = async () => {
      if (choosing) return
      choosing = true
      try { addPathsRef.current(await pickFiles()) } catch (error) { reportError(error) } finally { choosing = false }
    }
    const nativeDrop = (event: Event) => {
      const detail = (event as CustomEvent<{ phase: string; paths?: string[]; x?: number; y?: number }>).detail
      if (!detail) return
      if (detail.phase === 'leave') { setDragging(false); return }
      if (!Number.isFinite(detail.x) || !Number.isFinite(detail.y)) return
      const target = document.elementFromPoint(detail.x!, detail.y!)
      const inside = !!target && !!area.current?.contains(target)
      setDragging(detail.phase !== 'drop' && inside)
      if (detail.phase === 'drop' && inside) addPathsRef.current(detail.paths || [])
    }
    window.addEventListener('mrmak-attach-file', pick)
    window.addEventListener('mrmak-file-drop', nativeDrop)
    return () => { window.removeEventListener('mrmak-attach-file', pick); window.removeEventListener('mrmak-file-drop', nativeDrop) }
  }, [])

  const advising = session.agent === 'claude' && !!settings.effortAdvice && settings.effortAdvice !== 'off'
  async function send(effort?: EffortChoice, resend = false) {
    // An answer to the effort or cold-cache offer sends the message held in the chat body.
    const source = (effort || resend) && held ? held : draft
    const text = source.text.trimEnd(), paths = source.paths
    // A typed /btw takes the btw button's path, so its answer is shown beside the conversation.
    if (session.agent === 'claude' && !paths.length && /^\s*\/btw\s+\S/.test(text)) { void askBtw(text.replace(/^\s*\/btw\s+/, '')); return }
    if (sending || uploading || voiceBusy || !connected || !running || (!text.trim() && !paths.length)) return
    setSending(true); setAdvice(null); setColdOffer(null); setStatus('')
    const advised = advising && !effort && !text.trimStart().startsWith('/')
    // While the effort is checked the message leaves the composer, so the send does not look stuck.
    const shown = advised || !!held
    if (shown) { setPending({ text, paths, stage: advised ? 'checking' : 'sent' }); setDraft({ text: '', paths: [] }); follow.current = true }
    try {
      await api(`/sessions/${session.id}/send`, { text, paths, ...(effort && { effort }) })
      // A picker command unmounts this view immediately, before its draft effect
      // can run. Clear the saved draft now so returning cannot resend it.
      saveDraft(session.id, { text: '', paths: [] })
      setDraft({ text: '', paths: [] }); setCaret(0); follow.current = true; setShowJump(false)
      if (terminalCommand(commands, text)) openTerminal()
      if (shown) setPending({ text, paths, stage: 'sent', after: latestUserId })
      void reload.current()
    } catch (error) {
      const data = (error as { data?: { effortAdvice?: EffortAdvice; coldCache?: { tokens: number; writeUsd: number | null } } }).data
      const offer = data?.effortAdvice
      if (offer) { setAdvice(offer); setPending({ text, paths, stage: 'held' }); return }
      if (data?.coldCache) { setColdOffer({ message: error instanceof Error ? error.message : String(error), tokens: data.coldCache.tokens, writeUsd: data.coldCache.writeUsd }); setPending({ text, paths, stage: 'held' }); setDraft({ text: '', paths: [] }); follow.current = true; return }
      setPending(null); setDraft({ text, paths })
      setStatus(`${error instanceof Error ? error.message : String(error)} Your draft is kept.`)
    } finally { setSending(false); input.current?.focus() }
  }
  // Compact first or Summarize and continue: the held message returns to the composer,
  // to send once the compacted chat (or the new one) is ready.
  async function coldInstead(action: 'compact' | 'handoff') {
    if (coldBusy) return
    setColdBusy(true)
    try {
      await api(`/sessions/${session.id}/${action}`, {})
      const back = held
      setColdOffer(null); setPending(null)
      if (back) setDraft(current => ({ text: current.text ? `${back.text}

${current.text}` : back.text, paths: [...back.paths, ...current.paths.filter(item => !back.paths.includes(item))] }))
      setStatus(action === 'compact' ? 'Compacting this chat. Your message is back in the composer; send it when the compact finishes.' : `${agentLabel} is writing a handoff for a new chat. Your message is back in the composer to copy there.`)
    } catch (error) { setStatus(error instanceof Error ? error.message : String(error)) }
    finally { setColdBusy(false) }
  }
  // /btw: a side question Claude Code answers without adding it to the conversation.
  // Attachments stay in the draft for the next message: a side question cannot read files.
  const canAsk = session.agent === 'claude' && connected && running
  async function askBtw(question = draft.text) {
    const text = question.replace(/\s+/g, ' ').trim()
    if (sending || uploading || voiceBusy || !canAsk || !text) return
    if (transcript?.prompt) { setStatus('Answer the question above before asking a side question.'); return }
    setSending(true); setStatus('')
    try {
      await api(`/sessions/${session.id}/btw`, { text })
      saveDraft(session.id, { text: '', paths: draft.paths })
      setDraft(current => ({ ...current, text: '' })); setCaret(0)
      void reload.current()
    } catch (error) { setStatus(`${error instanceof Error ? error.message : String(error)} Your draft is kept.`) }
    finally { setSending(false); input.current?.focus() }
  }
  // Pause with a summary: a handoff written before a break; HandoffOffer shows it on return.
  const canPause = (session.agent === 'claude' || session.agent === 'codex') && connected && running
  const [pausing, setPausing] = useState(false)
  async function pauseWithSummary() {
    if (pausing) return
    setPausing(true)
    try { await api(`/sessions/${session.id}/pause`, {}) } catch (error) { reportError(error) } finally { setPausing(false) }
  }
  const stop = () => api(`/sessions/${session.id}/input`, { text: '\x1b', paste: false, submit: false }).catch(reportError)
  // Claude Code rewinds to before the message (files stay as they are), then the edited text is sent.
  const canEdit = session.agent === 'claude' && connected && running && !working && !transcript?.prompt
  async function sendEdit() {
    const target = editing, text = target?.text.trimEnd() || ''
    if (!target || rewinding || !canEdit || !text.trim()) return
    setRewinding(true); setEditError('')
    try { await api(`/sessions/${session.id}/rewind`, { messageId: target.id }) }
    catch (error) { setEditError(error instanceof Error ? error.message : String(error)); setRewinding(false); return }
    try {
      // The rewind already happened, so an effort offer here would leave the conversation cut short.
      await api(`/sessions/${session.id}/send`, { text, paths: [], effort: { action: 'keep' } })
      follow.current = true; setShowJump(false)
    } catch (error) {
      // The conversation is already rewound, so keep the edited text in the composer.
      setDraft(current => ({ ...current, text: current.text ? `${text}\n\n${current.text}` : text }))
      setStatus(`${error instanceof Error ? error.message : String(error)} Your edited message is in the composer.`)
    } finally { setEditing(null); setRewinding(false); void reload.current() }
  }

  const stale = working && now - changedAt >= 45000
  const unreadable = transcript && !transcript.supported && session.hasConversation
  return <div ref={area} className="desk-conversation">
    <div className="conversation-scroll" ref={scroller} onScroll={() => { const box = scroller.current; if (!box) return; const nearEnd = box.scrollHeight - box.scrollTop - box.clientHeight < 120; follow.current = nearEnd; setShowJump(!nearEnd) }}>
      <div className="conversation-column">
        {transcript?.truncated && <p className="conversation-note">Showing the latest part of a long conversation. The terminal keeps the full history.</p>}
        {messages.map((message, index) => message.role === 'system' ? systemEvents !== 'hidden' && message.event && <SystemEvent key={`${message.id}:${systemEvents}`} event={message.event} time={message.at ? time(message.at) : undefined} expanded={systemEvents === 'full'}
          components={{ a: ({ href, children }) => <MessageLink href={href} sessionId={session.id}>{children}</MessageLink> }} fileLink={(file, label) => <MessageLink href={file} sessionId={session.id}>{label}</MessageLink>} />
        : <article key={message.id} data-index={index} className={`conversation-message ${message.role}${isBtw(message) ? ' btw' : ''}`}>
          <header>{message.role === 'user' ? <span>{isBtw(message) ? 'You · /btw side question' : 'You'}</span> : <span className="conversation-agent"><AgentLogo agent={session.agent} size={15} />{agentLabel}</span>}{message.at && <time>{time(message.at)}</time>}{message.role === 'assistant' && message.text.trim() && <CopyButton text={message.text} />}
            {message.role === 'user' && canEdit && !openEdit && message.text.trim() && <button type="button" className="conversation-copy" title="Edit and send again" aria-label="Edit message" onClick={() => { setEditError(''); setEditing({ id: message.id, text: visibleUserMessage(message.text) }) }}><Icon name="edit" size={14} /></button>}</header>
          {openEdit?.id === message.id ? <form className="conversation-edit" onSubmit={event => { event.preventDefault(); void sendEdit() }}>
            <textarea autoFocus aria-label="Edit message" value={openEdit.text} disabled={rewinding} rows={Math.min(12, openEdit.text.split('\n').length + 1)} onChange={event => setEditing({ id: message.id, text: event.target.value })}
              onKeyDown={event => {
                if (event.nativeEvent.isComposing) return
                if (event.key === 'Escape' && !rewinding) { event.preventDefault(); event.stopPropagation(); setEditing(null) }
                if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void sendEdit() }
              }} />
            {editError && <p role="alert">{editError}</p>}
            <footer><span>{rewinding ? 'Rewinding the conversation…' : 'Rewinds the conversation to before this message and sends the edited text. Files are not changed.'}</span>
              <button type="button" disabled={rewinding} onClick={() => setEditing(null)}>Cancel</button>
              <button type="submit" disabled={rewinding || !canEdit || !openEdit.text.trim()}>Send</button></footer>
          </form>
          : message.text.trim() && <div className="conversation-copy-text"><ReactMarkdown remarkPlugins={[remarkGfm]} urlTransform={keepUrl} components={{ img: () => null, a: ({ href, children }) => <MessageLink href={href} sessionId={session.id}>{children}</MessageLink> }}>{message.role === 'user' ? visibleUserMessage(message.text) : message.text}</ReactMarkdown></div>}
          <ConversationImages images={message.images} />
          {index === messages.length - 1 && message.role === 'assistant' && index > readStart && <div className="conversation-read-aloud">
            <button type="button" onClick={() => readAloud(message.id)} aria-label={speech.activeId ? speech.paused ? 'Resume reading' : 'Pause reading' : 'Read aloud'} title={speech.activeId ? speech.paused ? 'Resume reading' : 'Pause reading' : 'Read this reply aloud'}><Icon name={speech.activeId ? speech.paused ? 'play' : 'pause' : 'speaker'} size={15} />{speech.activeId ? speech.paused ? 'Resume' : 'Pause' : 'Read aloud'}</button>
            {speech.activeId && <button type="button" onClick={speech.stop} aria-label="Stop reading" title="Stop reading"><Icon name="stop" size={13} /></button>}
            <select aria-label="Reading voice" value={voice} onChange={event => { setVoice(event.target.value); saveReadingVoice(event.target.value); window.dispatchEvent(new Event(readingVoiceChanged)) }}>{readingVoices.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
            {speech.loading && <span role="status">Preparing audio…</span>}
            {speech.error && <span role="alert">{speech.error}</span>}
          </div>}
        </article>)}
        {!messages.length && <div className="conversation-empty">
          <AgentLogo agent={session.agent} size={34} />
          <h2>{!transcript ? 'Loading conversation…' : unreadable ? 'This conversation is in the terminal' : 'Ready when you are'}</h2>
          <p>{unreadable ? 'Its history could not be read here. The terminal shows everything.' : `Messages appear here as ${agentLabel} writes them. If the CLI asks a startup question, such as trusting this folder or signing in, answer it in the terminal.`}</p>
          <button type="button" onClick={openTerminal}><Icon name="terminal" size={15} />Open terminal</button>
        </div>}
        {!!transcript?.activity?.length && <details className="conversation-activity"><summary>Recent tool activity</summary>{transcript.activity.map(item => <div key={item.id}><Icon name={item.status === 'running' ? 'terminal' : item.status === 'failed' ? 'bell' : 'history'} size={13} /><span>{item.name}</span><small>{item.status === 'running' && !running ? 'interrupted' : item.status}{item.at && ` · ${time(item.at)}`}</small></div>)}</details>}
        {transcript?.prompt && <TerminalPrompt prompt={transcript.prompt} answering={answering} onAnswer={choice => void answer(transcript.prompt!, choice)} onOpenTerminal={openTerminal} />}
        {held && <article className="conversation-message user pending">
          <header><span>You</span></header>
          {held.text.trim() && <div className="conversation-copy-text">{held.text}</div>}
          {held.stage !== 'held' && <p className="conversation-checking" role="status">{held.stage === 'checking' ? 'Checking the effort level' : `Waiting for ${agentLabel}`}<span className="conversation-dots" aria-hidden="true"><i /><i /><i /></span></p>}
        </article>}
        {working && <p className="conversation-working"><i />{agentLabel} is working…</p>}
        {!transcript?.prompt && (session.activity === 'waiting' || stale || readError) && <div className="conversation-notice" role="status"><p>{readError || (session.activity === 'waiting' ? `${agentLabel} is waiting for you in the terminal.` : 'No new messages for a while. A permission prompt or question may be waiting in the terminal.')}</p><button type="button" onClick={openTerminal}><Icon name="terminal" size={14} />Open terminal</button></div>}
      </div>
    </div>
    {showJump && <button type="button" className="conversation-jump" onClick={() => { follow.current = true; setShowJump(false); const box = scroller.current; if (box) box.scrollTop = box.scrollHeight }}><Icon name="down" size={15} />Latest</button>}
    {dragging && <div className="terminal-drop"><Icon name="attach" size={30} /><strong>Drop to attach</strong><span>Files, folders and images</span></div>}
    <BackgroundWork agents={transcript?.agents} commands={transcript?.commands} now={now} />
    <SideQuestions key={session.id} items={transcript?.btw} openTerminal={openTerminal} />
    {advice && <div className="conversation-notice conversation-effort" role="alert"><p>{advice.message}{advice.from && ` This chat is on ${effortLabel(advice.from)}.`}</p>
      <button type="button" disabled={sending} onClick={() => void send({ action: 'switch', level: advice.level })}>Switch to {effortLabel(advice.level)}</button>
      <button type="button" disabled={sending} onClick={() => void send({ action: 'keep', level: advice.level })}>{advice.from ? `Keep ${effortLabel(advice.from)}` : 'Keep it as it is'}</button>
      <button type="button" disabled={sending} onClick={() => void send({ action: 'auto', level: advice.level })}>Switch, and auto-adjust from now</button>
      <button type="button" className="desk-icon" aria-label="Close the effort offer" onClick={() => { setAdvice(null); if (held) setDraft({ text: held.text, paths: held.paths }); setPending(null) }}><Icon name="close" size={13} /></button></div>}
    {coldOffer && <div className="conversation-notice conversation-effort conversation-cold" role="alert"><p>{coldOffer.message.replace(/ Send again to go ahead, or start a new chat from a summary\.$/, '')} Compacting or summarizing also reads the whole conversation once, but later turns then carry a short summary instead.</p>
      <button type="button" disabled={sending || coldBusy} onClick={() => void send(undefined, true)}>Send anyway</button>
      <button type="button" disabled={sending || coldBusy || working} title="Sends /compact first; your message comes back to the composer" onClick={() => void coldInstead('compact')}>Compact first</button>
      <button type="button" disabled={sending || coldBusy || working} title="Opens a new chat from a handoff summary" onClick={() => void coldInstead('handoff')}>Summarize and continue</button>
      <button type="button" className="desk-icon" aria-label="Close the cold cache offer" onClick={() => { setColdOffer(null); if (held) setDraft({ text: held.text, paths: held.paths }); setPending(null) }}><Icon name="close" size={13} /></button></div>}
    <form className="conversation-composer" onSubmit={event => { event.preventDefault(); void send() }}>
      {!!suggestions.length && <ul className="conversation-commands" id="conversation-commands" role="listbox" aria-label="Commands">{suggestions.map((command, index) => <li key={`${command.trigger}${command.name}`} id={`conversation-command-${index}`} role="option" aria-selected={command === highlighted}
        onMouseDown={event => { event.preventDefault(); complete(command) }} onMouseEnter={() => setPicked(index)}>
        <strong>{command.trigger}{command.name}</strong><span>{command.description}</span>{command.terminal && <Icon name="terminal" size={12} />}<small>{command.source}</small>
      </li>)}</ul>}
      {!!draft.paths.length && <div className="conversation-chips">{draft.paths.map(file => <span key={file} title={file}><Icon name="attach" size={12} /><span>{fileName(file)}</span><button type="button" aria-label={`Remove ${fileName(file)}`} onClick={() => setDraft(current => ({ ...current, paths: current.paths.filter(item => item !== file) }))}>×</button></span>)}</div>}
      <textarea ref={input} rows={1} value={draft.text} aria-label={`Message ${agentLabel}`} placeholder={running ? `Message ${agentLabel}…` : 'Reconnect this chat to send'} onChange={event => { setDraft(current => ({ ...current, text: event.target.value })); setCaret(event.target.selectionStart); setPicked(0) }}
        onSelect={event => setCaret(event.currentTarget.selectionStart)}
        role="combobox" aria-autocomplete="list" aria-expanded={!!suggestions.length} aria-controls="conversation-commands" aria-activedescendant={highlighted ? `conversation-command-${suggestions.indexOf(highlighted)}` : undefined}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing) return
          if (event.key === 'Enter' && event.altKey && session.agent === 'claude') { event.preventDefault(); void askBtw(); return }
          // Ctrl/⌘+Enter sends at the chat's current effort, skipping effort advice once.
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.shiftKey) { event.preventDefault(); void send({ action: 'keep' }); return }
          if (suggestions.length && highlighted) {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setPicked((suggestions.indexOf(highlighted) + (event.key === 'ArrowDown' ? 1 : suggestions.length - 1)) % suggestions.length); return }
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setDismissed(tokenKey); return }
            // Enter on a fully typed name sends it; otherwise Tab or Enter completes the highlighted one.
            if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey && token?.query !== highlighted.name.toLowerCase())) { event.preventDefault(); complete(highlighted); return }
          }
          if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send() }
        }}
        onPaste={event => { const files = Array.from(event.clipboardData.files).filter(file => file.type.startsWith('image/')); if (files.length) { event.preventDefault(); void addImages(files) } }} />
      <div className="conversation-actions">
        <button type="button" className="desk-icon" title="Attach files or folders" aria-label="Attach files" onClick={() => window.dispatchEvent(new Event('mrmak-attach-file'))}><Icon name="attach" size={16} /></button>
        <div className="terminal-dictation"><VoiceInput id={`desktop-conversation-${session.id}`} connected={connected} disabled={sending} config={dictation} hotkey transcriber={transcribeDesktopAudio} onBusy={setVoiceBusy} onText={text => setDraft(current => ({ ...current, text: current.text ? `${current.text}${/\s$/.test(current.text) ? '' : '\n'}${text}` : text }))} /></div>
        {canPause && <button type="button" className="desk-icon" disabled={pausing || working} onClick={() => void pauseWithSummary()} aria-label="Pause with a summary" title="Taking a break? The agent writes a handoff now, while the prompt cache is warm, and nothing else opens. When you are back, continue here or start a new chat from it."><Icon name="coffee" size={16} /></button>}
        <span className={`conversation-status ${status.length > 90 ? 'long' : ''}`} role="status">{status || (uploading ? 'Saving images…' : `Enter to send · Shift+Enter for a new line${session.agent === 'claude' ? ` · ${btwKey} for /btw` : ''}${advising ? ` · ${skipKey} skips the effort check` : ''}`)}</span>
        {working && <button type="button" className="conversation-stop" onClick={stop} title="Interrupt the agent (Esc)"><Icon name="stop" size={14} />Stop</button>}
        {session.agent === 'claude' && <button type="button" className="conversation-btw" title={`Ask a side question without adding it to the conversation (/btw · ${btwKey})`} aria-label="Ask as a /btw side question" disabled={!canAsk || sending || uploading || voiceBusy || !draft.text.trim()} onClick={() => void askBtw()}>btw</button>}
        <button type="submit" className="conversation-send" aria-label={sending ? 'Sending…' : 'Send'} title="Send" disabled={!connected || !running || sending || uploading || voiceBusy || (!draft.text.trim() && !draft.paths.length)}><Icon name="send" size={16} /></button>
      </div>
    </form>
  </div>
}
