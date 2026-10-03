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

test('generic fallback describes an ordinary folder without launching anything', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mrmak-generic-'));
  const registry = new ProjectAdapterRegistry();
  const [match] = await registry.detect(root);
  assert.equal(match.adapterId, 'generic');
  assert.equal((await registry.describe(match)).metadata.source, 'filesystem');
});
