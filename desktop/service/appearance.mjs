// Shared by the app, settings validation and isolated report documents.
// Keep reading colours here so previews, terminals and reports agree.
export const themes = [
  { id: 'codex', name: 'Codex / ChatGPT', description: 'Neutral graphite, layered grey panels, light text and restrained blue accents.', scheme: 'dark', bg: '#181818', deep: '#1e1e20', panel: '#242424', raised: '#333333', text: '#eeeeee', muted: '#b4b4b4', accent: '#8ab4f8', secondary: '#c5c5ca' },
  { id: 'antigravity', name: 'Antigravity', description: 'Graphite with the logo\'s blue, violet, green and warm spectrum.', scheme: 'dark', bg: '#141518', deep: '#0e1012', panel: '#1d1f23', raised: '#292c32', text: '#e9edf3', muted: '#acb5c3', accent: '#91b9ff', secondary: '#c6a2e9' },
  { id: 'claude-code', name: 'Claude Code', description: 'Very dark grey, charcoal panels, orange accents and white text.', scheme: 'dark', bg: '#161616', deep: '#0e0e0e', panel: '#242424', raised: '#333333', text: '#ffffff', muted: '#b8b8b8', accent: '#ef9c6b', secondary: '#f0b58a' },
  // Existing family IDs select option A so saved preferences remain valid.
  { id: 'nordic', name: 'Nordic · Fjord', description: 'Porcelain panels over cool mist, with steel-blue actions and a restrained green-grey secondary accent.', scheme: 'light', bg: '#e9eff3', deep: '#d9e3eb', panel: '#f8fafc', raised: '#dde6ed', text: '#253747', muted: '#506475', accent: '#315e83', secondary: '#3d6864', onAccent: '#ffffff' },
  { id: 'nordic-polar-night', name: 'Nordic · Polar Night', description: 'Blue-grey slate, frosted blue controls and a small mist-green counterpoint.', scheme: 'dark', bg: '#202936', deep: '#18212d', panel: '#2a3545', raised: '#354356', text: '#edf2f7', muted: '#b7c7d7', accent: '#a7cce5', secondary: '#a8cbbd', onAccent: '#17212b' },
  { id: 'forest', name: 'Forest · Moss & Brass', description: 'Deep woodland neutrals, pale moss highlights and a touch of muted brass.', scheme: 'dark', bg: '#19211c', deep: '#121a15', panel: '#252f26', raised: '#334037', text: '#edf1e7', muted: '#b8c6b2', accent: '#b9cf96', secondary: '#dfc28f', onAccent: '#172015' },
  { id: 'forest-botanical', name: 'Forest · Botanical', description: 'Leaf-tinted ivory, deep pine ink, botanical green controls and a small clay accent.', scheme: 'light', bg: '#eef1e8', deep: '#dfe5d8', panel: '#fbfcf6', raised: '#e2e8db', text: '#2b3d31', muted: '#546651', accent: '#426c47', secondary: '#82542f', onAccent: '#ffffff' },
  { id: 'sandstone', name: 'Sandstone · Clay', description: 'Warm paper and limestone panels, dark brown ink, terracotta actions and quiet olive details.', scheme: 'light', bg: '#f3eee5', deep: '#e5dccc', panel: '#fffbf4', raised: '#e8dece', text: '#49392c', muted: '#705b48', accent: '#8d4b32', secondary: '#4f623d', onAccent: '#ffffff' },
  { id: 'sandstone-desert-night', name: 'Sandstone · Desert Night', description: 'Warm charcoal, pale sandstone text, amber controls and a small sage-green contrast.', scheme: 'dark', bg: '#27221c', deep: '#1f1b16', panel: '#342d25', raised: '#44392d', text: '#f4eadb', muted: '#cabb9f', accent: '#e8c17e', secondary: '#b9c9a3', onAccent: '#251e16' },
  { id: 'ocean', name: 'Ocean · Harbor', description: 'Deep petrol blue, steel-blue panels, sea-glass actions and pale silver-blue details.', scheme: 'dark', bg: '#15232c', deep: '#101b23', panel: '#1e313d', raised: '#2d4350', text: '#e7f0f2', muted: '#b1c6d0', accent: '#94cfd6', secondary: '#aec0e5', onAccent: '#10232a' },
  { id: 'ocean-sea-glass', name: 'Ocean · Sea Glass', description: 'Pale water-grey, clean light panels, deep teal ink and actions, with a muted coral counterpoint.', scheme: 'light', bg: '#eaf2f1', deep: '#d9e7e5', panel: '#f9fdfc', raised: '#dce9e7', text: '#243e42', muted: '#4c6568', accent: '#286e78', secondary: '#914f43', onAccent: '#ffffff' },
  { id: 'plum', name: 'Plum · Velvet', description: 'Aubergine charcoal, soft lilac controls, warm white text and a small champagne accent.', scheme: 'dark', bg: '#251f2b', deep: '#1c1722', panel: '#322a3a', raised: '#44384d', text: '#f6edf8', muted: '#cdbbd2', accent: '#d8afe5', secondary: '#dfbd92', onAccent: '#251a2e' },
  { id: 'plum-orchid-paper', name: 'Plum · Orchid Paper', description: 'Barely lilac paper, almost-white panels, plum ink and controls, with a muted blue-green secondary accent.', scheme: 'light', bg: '#f3edf4', deep: '#e6dce8', panel: '#fffaff', raised: '#eadfec', text: '#432e4a', muted: '#725a7a', accent: '#7e4f86', secondary: '#44636b', onAccent: '#ffffff' },
];

const defaults = [
  { id: 'dark', name: 'Dark', description: 'The original Mr. Mak palette.', scheme: 'dark', bg: '#0a0a0c', deep: '#060608', panel: '#131316', raised: '#232329', text: '#ececf1', muted: '#a5a5b1', accent: '#f0a0b0', secondary: '#b794f4' },
  { id: 'light', name: 'Light', description: 'White surfaces with dark ink.', scheme: 'light', bg: '#f7f8fa', deep: '#eef0f4', panel: '#ffffff', raised: '#e8ebf1', text: '#232735', muted: '#505b70', accent: '#98445e', secondary: '#6b48a4' },
];
export const palettes = [...defaults, ...themes];
export const isThemePreference = value => value === 'system' || palettes.some(theme => theme.id === value);
export const resolveTheme = (value, dark = true) => value === 'system' ? dark ? 'dark' : 'light' : palettes.some(theme => theme.id === value) ? value : 'dark';
export const themePalette = value => palettes.find(theme => theme.id === resolveTheme(value)) || defaults[0];

export function themeVariables(value) {
  const p = themePalette(value), light = p.scheme === 'light';
  const mix = (color, amount) => `color-mix(in srgb, ${color} ${amount}%, transparent)`;
  const colors = p.id === 'antigravity'
    ? { green: '#93c6a0', amber: '#e4b86b', blue: p.accent, red: '#ed9a83' }
    : light
    ? { green: '#286644', amber: '#82551b', blue: '#285e98', red: '#ad3442' }
    : { green: '#94cbae', amber: '#dfbf87', blue: '#9abfec', red: '#ed9a9f' };
  return {
    '--bg': p.bg, '--bg-deep': p.deep, '--surface-solid': p.panel,
    '--surface-1': p.panel, '--surface-2': p.raised, '--surface-3': p.raised,
    '--sidebar-glass': p.deep, '--topbar-glass': p.bg,
    '--text': p.text, '--text-bright': p.id === 'light' ? '#111521' : light ? p.text : '#fafaf7', '--text-dim': p.muted, '--text-muted': p.muted,
    '--pink': p.accent, '--pink-bright': p.accent, '--purple': p.secondary,
    ...Object.fromEntries(Object.entries(colors).map(([key, color]) => [`--${key}`, color])),
    ...Object.fromEntries(Object.entries({ pink: p.accent, purple: p.secondary, ...colors }).map(([key, color]) => [`--${key}-dim`, mix(color, light ? 10 : 14)])),
    '--hairline': mix(p.text, 12), '--hairline-strong': mix(p.text, 24),
    '--edge': `linear-gradient(135deg, ${mix(p.accent, 38)}, ${mix(p.secondary, 24)} 50%, ${mix(p.text, 12)})`,
    '--edge-soft': `linear-gradient(135deg, ${mix(p.text, 22)}, ${mix(p.text, 8)})`,
    '--edge-amber': `linear-gradient(135deg, ${mix(colors.amber, 40)}, ${mix(p.accent, 20)})`,
    '--shadow-1': `0 2px 10px #000000${light ? '0a' : '35'}`, '--shadow-2': `0 8px 28px #000000${light ? '18' : '60'}`,
    '--glow-pink': `0 0 24px ${mix(p.accent, 7)}`, '--glow-pink-strong': `0 0 28px ${mix(p.accent, 12)}`,
    '--glow-amber': `0 0 24px ${mix(colors.amber, 8)}`, '--focus-ring': `0 0 0 2px ${mix(p.accent, 60)}`,
    '--on-accent': p.onAccent ?? (light ? '#ffffff' : p.deep),
    '--mak-bg': p.panel, '--mak-surface': p.raised, '--mak-border': mix(p.text, 18), '--mak-text': p.text, '--mak-muted': p.muted, '--mak-accent': p.accent,
  };
}
