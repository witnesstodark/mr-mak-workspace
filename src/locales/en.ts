import type { Dictionary } from '../lib/i18n'

// English needs entries only where a count changes the wording.
const en: Dictionary = {
  '{count} matches for': { one: '{count} match for', other: '{count} matches for' },
  'Copied {count} files to {folder}.': { one: 'Copied {count} file to {folder}.', other: 'Copied {count} files to {folder}.' },
  '{count} images saved in inbox · path inserted': { one: 'Image saved in inbox · path inserted', other: '{count} images saved in inbox · path inserted' },
  '{count} paths inserted': { one: 'Path inserted', other: '{count} paths inserted' },
  'Ungroup {count} tabs': { one: 'Ungroup {count} tab', other: 'Ungroup {count} tabs' },
  '{count} open tabs': { one: '{count} open tab', other: '{count} open tabs' },
  '{count} chats': { one: '{count} chat', other: '{count} chats' },
}

export default en
