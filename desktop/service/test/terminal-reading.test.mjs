import test from 'node:test';
import assert from 'node:assert/strict';
import { fixedRow, readingBlocks } from '../../../src/mobile/terminal-reading.ts';

const kinds = lines => readingBlocks(lines).map(block => [block.fixed ? 'fixed' : 'prose', block.text]);

test('prose wraps; framed, tabular and drawn rows keep their shape', () => {
  for (const row of [
    '⏺ I updated the mobile reader so long replies wrap to the screen, which keeps them readable.',
    '  The second row of a reply the CLI hard-wrapped at the desktop width; it ends with a semicolon;',
    'Here are the options (pick one):', '- a list item', '  1. A numbered step', '> a long prompt typed by the user',
    '  ⎿  Read 50 lines (ctrl+r to expand)', '⏺ Update(src/mobile/Terminal.tsx)', '`--verbose` prints more output',
    'Done.  Two spaces after a sentence.  Still prose.', 'Line 1: live agent output', '✻ Thinking… (esc to interrupt)',
  ]) assert.equal(fixedRow(row), false, row);
  for (const row of [
    '╭──────────────╮', '│ Do you want to proceed? │', '├── src', '└── mobile', '┌────┬────┐',
    '| Name | Size |', '|------|------|', '+------+------+', 'a | b | c', '|-- src', '`-- index.ts', '▐▛███▜▌ Claude Code',
    'diff --git a/x b/x', 'index 1a2b3c..4d5e6f 100644', '--- a/x', '+++ b/x', '       12 -  const b = 2', '       13    const c = 4',
    'Name      Size    Modified', '-rw-r--r--  1 user  staff  1234 Oct 28 file.txt', '  __  __      _', ' |  \\/  | __ _| | __',
    '  }', '  console.log(value);', '  const total = items.reduce((sum, item) => sum + item.size, 0);', '<div class="row">',
  ]) assert.equal(fixedRow(row), true, row);
});

test('a frame stays whole and scrolls as its own block between prose', () => {
  const frame = ['╭' + '─'.repeat(60) + '╮', '│ Bash command' + ' '.repeat(40) + '│', '│   rm -rf build' + ' '.repeat(37) + '│', '╰' + '─'.repeat(60) + '╯'];
  assert.deepEqual(kinds(['Before the dialog.', '', ...frame, '', 'After the dialog.', '', '']), [
    ['prose', 'Before the dialog.'], ['fixed', '\n' + frame.join('\n')], ['prose', '\nAfter the dialog.'],
  ]);
});

test('a lone or titled rule is drawn short among the prose', () => {
  assert.deepEqual(kinds(['Above', '─'.repeat(120), '─ Worked for 2m 05s ' + '─'.repeat(90), 'Below']), [
    ['prose', 'Above\n──────\n─ Worked for 2m 05s ──────\nBelow'],
  ]);
  // Column underlines stay aligned with their header.
  assert.deepEqual(kinds(['Name        Status      Updated', '──────────  ──────────  ───────']).map(([kind]) => kind), ['fixed']);
});

test('code blocks stay fixed, fenced or nested under an opening bracket', () => {
  assert.deepEqual(kinds(['Use this:', '```js', 'const a = 1', '', 'export default a', '```', 'That is all.']), [
    ['prose', 'Use this:'], ['fixed', '```js\nconst a = 1\n\nexport default a\n```'], ['prose', 'That is all.'],
  ]);
  const code = ['  function add(a, b) {', '    if (a === undefined) throw new Error("a long message that would otherwise wrap")', '    return a + b', '  }'];
  assert.deepEqual(kinds(['⏺ Here is the function:', '', ...code, '', '  It adds two numbers.']), [
    ['prose', '⏺ Here is the function:'], ['fixed', '\n' + code.join('\n')], ['prose', '\n  It adds two numbers.'],
  ]);
  const json = ['{', '  "name": "mobile",', '  "scripts": {', '    "test": "node --test"', '  }', '}'];
  assert.deepEqual(kinds(json), [['fixed', json.join('\n')]]);
});

test('a unified diff hunk stays fixed for exactly its counted rows', () => {
  const diff = ['diff --git a/a.txt b/a.txt', 'index 1a2b3c..4d5e6f 100644', '--- a/a.txt', '+++ b/a.txt', '@@ -1,4 +1,4 @@ intro', ' first line', '-second line', '+second line, changed', '', ' fourth line'];
  assert.deepEqual(kinds([...diff, 'The diff ends here and this prose wraps again.']), [
    ['fixed', diff.join('\n')], ['prose', 'The diff ends here and this prose wraps again.'],
  ]);
  // An indented single-line hunk ends after its own row; the rows after it are classified alone.
  assert.deepEqual(kinds(['  @@ -3 +3 @@', '  -old', '  +new', '  Context the hunk does not count.']).map(([kind]) => kind), ['fixed', 'prose']);
});

test('tables, trees, columns and ASCII art group into separate blocks', () => {
  const table = ['┌──────┬──────┐', '│ Name │ Size │', '├──────┼──────┤', '│ a    │ 1    │', '└──────┴──────┘'];
  const tree = ['src', '├── mobile', '│   └── Terminal.tsx', '└── lib'];
  assert.deepEqual(kinds(['Table:', ...table, '', 'Tree:', ...tree]), [
    ['prose', 'Table:'], ['fixed', table.join('\n')], ['prose', '\nTree:\nsrc'], ['fixed', tree.slice(1).join('\n')],
  ]);
  const listing = ['PID   NAME        MEMORY', '120   node        333 MB', '988   powershell  41 MB'];
  assert.deepEqual(kinds(listing), [['fixed', listing.join('\n')]]);
});

test('trailing padding and trailing blank rows are dropped', () => {
  assert.deepEqual(readingBlocks(['A reply.   ', '   ', '']), [{ fixed: false, text: 'A reply.' }]);
  assert.deepEqual(readingBlocks([]), []);
});
