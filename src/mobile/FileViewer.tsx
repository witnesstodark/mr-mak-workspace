import ReactMarkdown, { defaultUrlTransform } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Icon } from '../desktop/Icons'
import ReportFrame from '../components/ReportFrame'
import type { LinkedFile } from './useMessageLinks'
import './file-viewer.css'

// A local file opened from a chat link, over the conversation.
export default function FileViewer({ file, error, close }: { file: LinkedFile | null; error: string; close: () => void }) {
  return <>
    {error && <p className="mobile-error" role="alert">{error}</p>}
    {file && <div className="mobile-file-viewer" role="dialog" aria-label={file.name}>
      <header><strong title={file.name}>{file.name}</strong><button type="button" className="mobile-icon" aria-label="Close file" onClick={close}><Icon name="close" /></button></header>
      {file.kind === 'html' && <ReportFrame title={file.name} url={file.url} sandbox="allow-scripts allow-downloads allow-popups allow-popups-to-escape-sandbox" referrerPolicy="no-referrer" />}
      {file.kind === 'markdown' && <article className="mobile-message mobile-report-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} urlTransform={url => { const safe = defaultUrlTransform(url); return safe ? new URL(safe, new URL(file.url, location.origin)).href : safe }}>{file.text || ''}</ReactMarkdown></article>}
      {file.kind === 'image' && <div className="mobile-file-media"><img src={file.url} alt={file.name} /></div>}
      {file.kind === 'video' && <div className="mobile-file-media"><video src={file.url} controls playsInline /></div>}
    </div>}
  </>
}
