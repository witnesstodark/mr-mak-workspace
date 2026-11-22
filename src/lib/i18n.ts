import { useSyncExternalStore } from 'react'
import cs from '../locales/cs'
import en from '../locales/en'

// Interface translations. The English text is the key, so a string without a
// translation (or a new string nobody has translated yet) stays in English.
// A translation can be plural forms chosen by the `count` variable.
export type Plural = Partial<Record<Intl.LDMLPluralRule, string>> & { other: string }
export type Dictionary = Record<string, string | Plural>

export const languages = [
  { code: 'en', label: 'English' },
  { code: 'cs', label: 'Čeština' },
] as const
export type Language = (typeof languages)[number]['code']
export type LanguageSetting = Language | 'auto'

const dictionaries: Record<Language, Dictionary> = { en, cs }
const storageKey = 'mak.language'
const listeners = new Set<() => void>()

const isLanguage = (value: unknown): value is Language => languages.some(item => item.code === value)
const readSetting = (): LanguageSetting => {
  try { const value = localStorage.getItem(storageKey); return isLanguage(value) ? value : 'auto' } catch { return 'auto' }
}
const resolve = (value: LanguageSetting): Language => {
  if (value !== 'auto') return value
  const preferred = typeof navigator === 'undefined' ? [] : navigator.languages?.length ? navigator.languages : [navigator.language]
  for (const tag of preferred) { const code = String(tag || '').toLowerCase().split('-')[0]; if (isLanguage(code)) return code }
  return 'en'
}

let setting = readSetting()
let current = resolve(setting)
const apply = () => {
  current = resolve(setting)
  if (typeof document !== 'undefined') document.documentElement.lang = current
  listeners.forEach(listener => listener())
}
if (typeof document !== 'undefined') document.documentElement.lang = current
// Other Mr. Mak windows share localStorage, so a change in Settings reaches them too.
if (typeof window !== 'undefined') window.addEventListener('storage', event => {
  if (event.key !== storageKey) return
  setting = readSetting(); apply()
})

export const language = () => current
export const languageSetting = () => setting
export function setLanguage(value: LanguageSetting) {
  setting = value
  try { if (value === 'auto') localStorage.removeItem(storageKey); else localStorage.setItem(storageKey, value) } catch { /* private mode */ }
  apply()
}
export function subscribeLanguage(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
/** Re-renders the caller when the interface language changes. */
export const useLanguage = () => useSyncExternalStore(subscribeLanguage, language, language)

const format = (text: string, vars?: Record<string, string | number>) =>
  vars ? text.replace(/\{(\w+)\}/g, (match, name: string) => name in vars ? String(vars[name]) : match) : text

/** Translates English interface text. `{name}` placeholders are filled from `vars`. */
export function t(text: string, vars?: Record<string, string | number>) {
  if (!text) return text
  const entry = dictionaries[current][text]
  if (entry === undefined) return format(text, vars)
  if (typeof entry === 'string') return format(entry, vars)
  const count = Number(vars?.count ?? 0)
  return format(entry[new Intl.PluralRules(current).select(count)] ?? entry.other, vars)
}

