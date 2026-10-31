// Display settings saved on the desktop and shared with paired phones.
const fail = message => { throw Object.assign(new Error(message), { status: 400 }); };

// Terminal colour overrides laid over the Original and Iaar Focus palettes.
// `attention` is the CLI's yellow, which agents use for warnings and prompts.
export const ANSI_COLOR_KEYS = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white', 'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite'];
export const TERMINAL_COLOR_KEYS = ['background', 'foreground', 'cursor', 'selection', 'user', 'agent', 'detail', 'attention', ...ANSI_COLOR_KEYS];

// Only known keys and #rrggbb values are kept; null or '' removes an override.
export function terminalColors(value) {
  if (value === null || value === undefined) return {};
  if (typeof value !== 'object' || Array.isArray(value)) fail('Terminal colors must be an object of colors.');
  const result = {};
  for (const [key, color] of Object.entries(value)) {
    if (!TERMINAL_COLOR_KEYS.includes(key)) fail(`Unknown terminal color: ${String(key).slice(0, 40)}.`);
    if (color === null || color === '') continue;
    if (typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color)) fail(`Use a #rrggbb color for ${key}.`);
    result[key] = color.toLowerCase();
  }
  return result;
}

// The name a phone shows under the Home Screen icon and in its title.
export const DEFAULT_PHONE_NAME = 'Iaar';
export function phoneName(value) {
  if (value === null || value === undefined) return DEFAULT_PHONE_NAME;
  if (typeof value !== 'string') fail('The phone name must be text.');
  const name = value.replace(/[\x00-\x1f\x7f]/g, ' ').replace(/[<>"]/g, '').replace(/\s+/g, ' ').trim();
  if ([...name].length > 30) fail('Keep the phone name to 30 characters or fewer.');
  return name || DEFAULT_PHONE_NAME;
}
// A hand-edited settings file can hold anything; the manifest must still load.
export function phoneAppNames(value) {
  let short;
  try { short = phoneName(value); } catch { short = DEFAULT_PHONE_NAME; }
  return { short, name: short === DEFAULT_PHONE_NAME ? 'Iaar Mobile' : `${short} · Iaar` };
}
