import { open, realpath, stat, lstat, unlink, link, copyFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { within } from './util.mjs';
import { invalidFilename, samePath } from './platform.mjs';

export const MAX_FILE_BYTES = 1024 * 1024 * 1024;
const invalid = message => Object.assign(new Error(message), { status: 400 });

export async function importFile(source, folder, name, maxBytes = MAX_FILE_BYTES) {
  if (typeof folder !== 'string' || !folder) throw invalid('Choose a destination folder.');
  if (invalidFilename(name)) {
    throw invalid('This file name cannot be used on Windows.');
  }
  const destination = await realpath(path.resolve(folder));
  if (!(await stat(destination)).isDirectory()) throw invalid('Choose a folder to copy files into.');
  const extension = path.extname(name), stem = name.slice(0, name.length - extension.length);
  let handle, target;
  for (let copy = 1; copy <= 9999; copy++) {
    target = path.join(destination, copy === 1 ? name : `${stem} (${copy})${extension}`);
    try { handle = await open(target, 'wx'); break; }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  if (!handle) throw invalid('Too many copies with this name. Rename the file and try again.');
  let size = 0;
  try {
    // Stream directly to the new file; large assets never accumulate in memory.
    for await (const chunk of source) {
      size += chunk.length;
      if (size > maxBytes) throw Object.assign(new Error('Choose files of 1 GB or less.'), { status: 413 });
      await handle.writeFile(chunk);
    }
    await handle.close();
    return { path: target, name: path.basename(target), size, renamed: path.basename(target) !== name };
  } catch (error) {
    await handle.close().catch(() => {});
    await unlink(target).catch(() => {});
    throw error;
  }
}

export async function dragFiles(paths) {
  if (!Array.isArray(paths) || !paths.length || paths.length > 100 || paths.some(file => typeof file !== 'string' || !file)) {
    throw invalid('Choose between 1 and 100 files or folders to drag.');
  }
  return Promise.all(paths.map(async file => {
    const actual = await realpath(path.resolve(file));
    const info = await stat(actual);
    if (!info.isFile() && !info.isDirectory()) throw invalid('Drag a regular file or folder from the tree.');
    return actual;
  }));
}

export async function entryPath(value) {
  if (typeof value !== 'string' || !value.trim()) throw invalid('Choose a file or folder.');
  const absolute = path.resolve(value);
  if (path.dirname(absolute) === absolute) throw invalid('A drive root cannot be changed here.');
  // Resolve the parent, never the last link: recycling a junction must not delete its target.
  const actual = path.join(await realpath(path.dirname(absolute)), path.basename(absolute));
  await lstat(actual);
  return actual;
}

export async function recyclePath(value, repo) {
  const actual = await entryPath(value);
  if (within(actual, repo)) throw invalid('The MR-MAK repository and its parent folders cannot be deleted here.');
  return actual;
}

export async function moveFile(value, folder) {
  const source = await entryPath(value);
  if (typeof folder !== 'string' || !folder) throw invalid('Choose a destination folder.');
  const destination = await realpath(path.resolve(folder));
  if (!(await stat(destination)).isDirectory()) throw invalid('Choose a destination folder.');
  const target = path.join(destination, path.basename(source));
  if (samePath(source, target)) return { path: source, moved: false };
  const before = await lstat(source);
  if (!before.isFile() || before.isSymbolicLink()) throw invalid('Move individual files here. Use Explorer for folder or link moves.');
  try {
    // A same-volume hard link is an exclusive, constant-time move reservation.
    // Neither this path nor the cross-volume fallback can overwrite another file.
    try { await link(source, target); }
    catch (error) {
      if (!['EXDEV', 'EPERM', 'ENOTSUP', 'EACCES'].includes(error.code)) throw error;
      await copyFile(source, target, constants.COPYFILE_EXCL);
    }
  } catch (error) {
    if (error.code === 'EEXIST') throw Object.assign(new Error('A file with this name already exists in that folder. Nothing was moved.'), { status: 409 });
    throw error;
  }
  try {
    const current = await lstat(source);
    if (current.ino !== before.ino || current.size !== before.size || current.mtimeMs !== before.mtimeMs) throw invalid('The source changed during the move. Try again after it finishes saving.');
    await unlink(source);
  } catch (error) { await unlink(target).catch(() => {}); throw error; }
  return { path: target, moved: true };
}
