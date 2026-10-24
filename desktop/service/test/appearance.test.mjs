import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { palettes, themes, isThemePreference, resolveTheme, themePalette, themeVariables } from '../appearance.mjs';
import { createService } from '../server.mjs';
import { terminalTheme, terminalRoleColors, originalTheme, focusTheme } from '../../../src/desktop/terminalAppearance.ts';

function luminance(hex) {
  const channels = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4);
  return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
}
const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05);

test('the ten approved variants match the study and preserve saved family IDs', async () => {
  const families = JSON.parse(await readFile(new URL('./fixtures/approved-theme-variants.json', import.meta.url), 'utf8'));
  const variants = themes.slice(3);
  assert.equal(families.length, 5);
  assert.equal(variants.length, 10);
  assert.equal(new Set(palettes.map(p => p.id)).size, palettes.length);
  assert.equal(variants.filter(p => p.scheme === 'light').length, 5);
  for (const family of families) {
    for (const option of family.options) {
      const id = option.letter === 'A' ? family.id : `${family.id}-${option.name.toLowerCase().replaceAll(' ', '-')}`;
      assert.ok(isThemePreference(id), `Selectable approved variant: ${id}`);
      assert.equal(resolveTheme(id), id);
      assert.deepEqual(themePalette(id), {
        id, name: `${family.name} · ${option.name}`, description: option.idea,
        scheme: option.scheme, ...option.palette,
      });
      assert.equal(themeVariables(id)['--on-accent'], option.palette.onAccent);
    }
  }
});

test('all palettes keep reading text, muted labels and accents readable on their surfaces', () => {
  assert.equal(themes.length, 13);
  for (const palette of palettes) {
    for (const foreground of [palette.text, palette.muted, palette.accent, palette.secondary]) {
      for (const background of [palette.bg, palette.deep, palette.panel, palette.raised]) {
        assert.ok(contrast(foreground, background) >= 4.5, `${palette.id}: ${foreground} on ${background} = ${contrast(foreground, background).toFixed(2)}`);
      }
    }
    assert.ok(contrast(themeVariables(palette.id)['--on-accent'], palette.accent) >= 4.5, `${palette.id}: button label`);
    for (const appearance of ['original', 'focus']) {
      const terminal = terminalTheme(appearance, palette.id);
      assert.ok(contrast(terminal.foreground, terminal.background) >= 4.5);
      assert.ok(contrast(terminalRoleColors(palette.id).detail, terminal.background) >= 4.5);
    }
  }
  assert.equal(terminalTheme('original', 'dark'), originalTheme);
  assert.equal(terminalTheme('focus', 'dark'), focusTheme);
  assert.equal(resolveTheme('system', false), 'light');
  assert.equal(resolveTheme('system', true), 'dark');
  for (const value of ['invalid', '__proto__', null, {}, '<script>']) assert.equal(isThemePreference(value), false);
});

test('Workspace and Chat choices sync independently, reject invalid values and survive service restart', async () => {
  await mkdir('.cache', { recursive: true });
  const repo = await mkdtemp(path.resolve('.cache/appearance-'));
  await mkdir(path.join(repo, 'workspace'));
  await writeFile(path.join(repo, 'workspace/workspace.json'), '{"entities":[]}');
  let service = await createService({ repo, mcpOptions: { home: repo, env: {} } });
  const save = async patch => {
    const response = await fetch(service.origin + '/api/settings', { method: 'POST', headers: { Authorization: `Bearer ${service.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
    assert.ok(response.ok);
    return response.json();
  };
  try {
    await save({ workspaceTheme: 'dark', chatTheme: 'dark' });
    let previousChat = 'dark';
    for (const theme of themes) {
      const workspace = await save({ workspaceTheme: theme.id });
      assert.equal(workspace.workspaceTheme, theme.id);
      assert.equal(workspace.chatTheme, previousChat);
      const chat = await save({ chatTheme: theme.id });
      assert.equal(chat.workspaceTheme, theme.id);
      assert.equal(chat.chatTheme, theme.id);
      previousChat = theme.id;
    }
    await save({ workspaceTheme: 'forest-botanical', chatTheme: 'nordic-polar-night' });
    const invalid = await save({ workspaceTheme: 'bogus', chatTheme: '__proto__' });
    assert.equal(invalid.workspaceTheme, 'forest-botanical'); assert.equal(invalid.chatTheme, 'nordic-polar-night');
    await service.close();
    service = await createService({ repo, mcpOptions: { home: repo, env: {} } });
    const saved = await save({});
    assert.equal(saved.workspaceTheme, 'forest-botanical'); assert.equal(saved.chatTheme, 'nordic-polar-night');
  } finally { await service.close(); }
});
