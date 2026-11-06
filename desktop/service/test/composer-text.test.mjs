import test from 'node:test';
import assert from 'node:assert/strict';
import { composerText } from '../terminal-prompt.mjs';

const rule = '─'.repeat(40);

test('composerText reads what is left in the Claude Code composer', () => {
  assert.equal(composerText(['❯ an earlier message', '', '⏺ reply', '', rule, '❯ ', rule, '  ⏵⏵ bypass permissions on'].join('\n')), '');
  assert.equal(composerText(['⏺ reply', rule, '❯ reescreva esta frase', rule, '  ⏵⏵ bypass permissions on'].join('\n')), 'reescreva esta frase');
  assert.equal(composerText(['⏺ reply', rule, '❯ [Pasted text #1 +12 lines]', rule].join('\n')), '[Pasted text #1 +12 lines]');
});

test('composerText ignores an echoed message and an open menu', () => {
  assert.equal(composerText(['❯ an earlier message', '', '⏺ reply'].join('\n')), null);
  assert.equal(composerText(['Do you want to proceed?', rule, '❯ 1. Yes', '  2. No', '', 'Esc to cancel'].join('\n')), null);
});
