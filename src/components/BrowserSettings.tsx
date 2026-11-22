import ThemePicker from './ThemePicker'
import type { ThemeTarget } from '../lib/workspace-theme'
import { t } from '../lib/i18n'

export default function BrowserSettings({ target = 'workspace' }: { target?: ThemeTarget }) {
  return <details className="browser-settings" onKeyDown={event => { if (event.key === 'Escape') { event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus() } }}>
    <summary role="button" aria-label={target === 'chat' ? t('Chat appearance') : t('Workspace settings')} title={target === 'chat' ? t('Appearance') : t('Settings')}>{target === 'chat' ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16M8 3v6M16 9v6M10 15v6" /></svg> : 'Settings'}</summary>
    <div className="browser-settings-panel"><h2>{t('Appearance')}</h2><ThemePicker target={target} /></div>
  </details>
}
