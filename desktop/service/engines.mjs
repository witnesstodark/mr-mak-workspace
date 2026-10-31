import { execFile } from 'node:child_process';
import path from 'node:path';
import { isWindows, processSpawnOptions } from './platform.mjs';

// Game engines and 3D tools the agents reach through MCP. A server belongs to an
// engine by its name or plugin; whether the editor is open comes from the process list.
export const ENGINES = [
  { id: 'unity', name: 'Unity', server: /unity/i, process: /^unity(?:\.exe)?$/i },
  { id: 'godot', name: 'Godot', server: /godot/i, process: /^godot[\w.-]*(?:\.exe)?$/i },
  { id: 'blender', name: 'Blender', server: /blender/i, process: /^blender(?:\.exe)?$/i },
  { id: 'unreal', name: 'Unreal', server: /unreal/i, process: /^(?:unrealeditor|ue4editor)(?:-[\w-]+)?(?:\.exe)?$/i },
];

let cache = { at: 0, names: null };
async function processNames() {
  if (cache.names && Date.now() - cache.at < 5000) return cache.names;
  const [file, args] = isWindows ? ['tasklist.exe', ['/FO', 'CSV', '/NH']] : ['ps', ['-A', '-o', 'comm=']];
  const stdout = await new Promise(resolve => execFile(file, args, { ...processSpawnOptions(), timeout: 10000, maxBuffer: 4 * 1024 * 1024 }, (error, output) => resolve(error ? '' : output)));
  const names = new Set(stdout.split(/\r?\n/).map(line => isWindows ? /^"([^"]+)"/.exec(line)?.[1] : path.basename(line.trim())).filter(Boolean));
  cache = { at: Date.now(), names };
  return names;
}

export function engineServers(engine, servers) {
  return servers.filter(server => engine.server.test(`${server.name} ${server.plugin || ''}`)).map(server => server.id);
}

export async function engineStatus(servers, names) {
  names ??= await processNames();
  return ENGINES.map(engine => ({ id: engine.id, name: engine.name, running: [...names].some(name => engine.process.test(name)), servers: engineServers(engine, servers) }));
}
