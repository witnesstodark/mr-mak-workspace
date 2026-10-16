import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ProjectAdapterRegistry } from '../project-adapters/registry.mjs';

test('generic detection is always available and Godot wins when project.godot is present', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mrmak-project-'));
  await mkdir(path.join(root, 'scenes'));
  await writeFile(path.join(root, 'project.godot'), '[application]\nconfig/name="Sky Islands"\nrun/main_scene="res://scenes/main.tscn"\n[application]\nconfig/features=PackedStringArray("4.3")\n');
  await writeFile(path.join(root, 'scenes', 'main.tscn'), '[gd_scene format=3]\n');
  const registry = new ProjectAdapterRegistry();
  const matches = await registry.detect(root);
  assert.equal(matches[0].adapterId, 'godot');
  assert.equal(matches.at(-1).adapterId, 'generic');
  const details = await registry.capabilities(matches[0]);
  assert.equal(details.project.name, 'Sky Islands');
  assert.equal(details.project.metadata.mainScene, 'res://scenes/main.tscn');
  assert.ok(details.files.some(item => item.label === 'scenes/main.tscn'));
  assert.ok(details.commands.every(command => command.id.startsWith('godot-')));
});

test('Godot commands use the app bundle on a Mac without a godot command on PATH', { skip: process.platform !== 'darwin' && 'macOS app bundles only' }, async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'mrmak-godot-home-'));
  const binary = path.join(home, 'Applications', 'Godot.app', 'Contents', 'MacOS', 'Godot');
  await mkdir(path.dirname(binary), { recursive: true });
  await writeFile(binary, '', { mode: 0o755 });
  const root = await mkdtemp(path.join(os.tmpdir(), 'mrmak-godot-app-'));
  await writeFile(path.join(root, 'project.godot'), '[application]\nconfig/name="Bundle"\n');
  const previous = { HOME: process.env.HOME, PATH: process.env.PATH };
  process.env.HOME = home; process.env.PATH = '';
  try {
    const registry = new ProjectAdapterRegistry();
    const [match] = await registry.detect(root);
    const { commands } = await registry.capabilities(match);
    assert.deepEqual(commands.map(command => command.id), ['godot-editor', 'godot-run']);
    // /Applications/Godot.app wins when it is installed; otherwise ~/Applications.
    assert.ok([binary, '/Applications/Godot.app/Contents/MacOS/Godot'].includes(commands[0].executable));
  } finally { for (const [name, value] of Object.entries(previous)) if (value === undefined) delete process.env[name]; else process.env[name] = value; }
});

test('generic fallback describes an ordinary folder without launching anything', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mrmak-generic-'));
  const registry = new ProjectAdapterRegistry();
  const [match] = await registry.detect(root);
  assert.equal(match.adapterId, 'generic');
  assert.equal((await registry.describe(match)).metadata.source, 'filesystem');
});
