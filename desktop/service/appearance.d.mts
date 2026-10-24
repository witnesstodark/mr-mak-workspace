export type PaletteId = 'dark' | 'light' | 'codex' | 'antigravity' | 'claude-code' | 'nordic' | 'nordic-polar-night' | 'forest' | 'forest-botanical' | 'sandstone' | 'sandstone-desert-night' | 'ocean' | 'ocean-sea-glass' | 'plum' | 'plum-orchid-paper'
export type ThemePreference = PaletteId | 'system'
export interface ThemePalette { id: PaletteId; name: string; description: string; scheme: 'dark' | 'light'; bg: string; deep: string; panel: string; raised: string; text: string; muted: string; accent: string; secondary: string; onAccent?: string }
export const themes: ThemePalette[]
export const palettes: ThemePalette[]
export function isThemePreference(value: unknown): value is ThemePreference
export function resolveTheme(value: unknown, dark?: boolean): PaletteId
export function themePalette(value: unknown): ThemePalette
export function themeVariables(value: unknown): Record<string, string>
