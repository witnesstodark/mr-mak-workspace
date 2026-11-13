// The phone's reading view of a live terminal. Prose wraps to the screen.
// Rows laid out by position (frames, tables, trees, diffs, code, aligned
// columns, ASCII art) keep their shape; each run of them is one block that
// scrolls sideways on its own.

export type ReadingBlock = { fixed: boolean; text: string }

const drawing = /[─-▟]|[⠀-⣿]{2}/ // Box drawing, block elements, braille art.
const rules = /[─━═]{6,}/g
const layout = [
  /^\s*\|.*\|$|^\s*\+[-=+:]+\+$|\s\|\s.*\s\|\s/, // Pipe tables and ASCII borders.
  /^[\s|`]*[|`+\\]--[- ]/, // ASCII file trees.
  /^(diff --git |index [0-9a-f]+\.\.|--- \S|\+\+\+ \S)/, // Diff headers.
  /^\s+\d+ +[-+]|^\s+\d+ {3,}\S/, // Numbered diff rows of an agent's edit view.
  /^\s*<\/?[a-z][\w-]*(\s[^>]*)?\/?>/i, // Markup.
  /^\s*[}\])]|[=(){}[\]<>].*;$/, // Code: a closing bracket or a statement.
]
const fence = /^\s*(```|~~~)/
const hunk = /^(\s*)@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/
const opener = /[{[(]$/

// Two or more gaps of two spaces between words, not after a sentence.
const columns = (row: string) => (row.match(/[^\s.!?]\s{2,}(?=\S)/g)?.length ?? 0) >= 2
// A full-width rule, perhaps titled, is drawn short among the prose.
const separator = (row: string) => /[─━═]{6}/.test(row) && !drawing.test(row.replace(/[─━═]/g, '')) && !columns(row)
function art(row: string) {
  const visible = row.replace(/\s+/g, '')
  return visible.length >= 4 && (visible.match(/[\p{L}\p{N}]/gu)?.length ?? 0) < visible.length * 0.4
}

export function fixedRow(row: string) {
  if (separator(row)) return false
  return drawing.test(row) || layout.some(pattern => pattern.test(row)) || columns(row) || art(row)
}

export function readingBlocks(lines: string[]): ReadingBlock[] {
  const rows = lines.map(line => line.trimEnd())
  while (rows.length && !rows[rows.length - 1]) rows.pop()
  // undefined: a blank row, which joins the block of the row after it.
  const kinds: (boolean | undefined)[] = []
  let fenced = false, scope = -1, pad = 0, old = 0, added = 0
  for (const row of rows) {
    if (fenced) { kinds.push(row ? true : undefined); if (fence.test(row)) fenced = false; continue }
    if (old > 0 || added > 0) {
      // Inside a counted diff hunk.
      const marker = row.slice(pad)[0]
      if (marker === '-') old--
      else if (marker === '+') added--
      else if (marker === ' ' || !row) { old--; added-- }
      if (marker === '\\' || '-+ '.includes(marker ?? ' ')) { kinds.push(row ? true : undefined); continue }
      old = added = 0
    }
    if (!row) { kinds.push(undefined); scope = -1; continue }
    const indent = row.length - row.trimStart().length
    // Rows nested deeper than an opening bracket belong to its code.
    if (scope >= 0 && indent > scope) { kinds.push(true); continue }
    scope = -1
    const header = hunk.exec(row)
    if (header) { pad = header[1].length; old = Number(header[2] ?? 1); added = Number(header[3] ?? 1) }
    else if (fence.test(row)) fenced = true
    else if (opener.test(row)) scope = indent
    kinds.push(Boolean(header) || fenced || scope >= 0 || fixedRow(row))
  }
  for (let index = kinds.length - 1, next = false; index >= 0; index--) kinds[index] = next = kinds[index] ?? next
  const blocks: ReadingBlock[] = []
  rows.forEach((row, index) => {
    const fixed = Boolean(kinds[index]), text = fixed ? row : row.replace(rules, '──────'), last = blocks[blocks.length - 1]
    if (last?.fixed === fixed) last.text += '\n' + text
    else blocks.push({ fixed, text })
  })
  return blocks
}
