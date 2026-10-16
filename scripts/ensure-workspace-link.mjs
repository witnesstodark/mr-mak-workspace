// Ensures public/workspace points at ../workspace so the dev server can
// serve workspace.json and report files. The link is a junction on Windows
// (no admin rights needed) and a relative directory symlink elsewhere, so it
// survives moving or renaming the clone.
// Runs automatically before `npm run dev` (see "predev" in package.json).
import { existsSync, lstatSync, mkdirSync, realpathSync, symlinkSync, unlinkSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const target = resolve(root, 'workspace')
const link = resolve(root, 'public', 'workspace')

if (!existsSync(target)) mkdirSync(target, { recursive: true })

// A link left dangling by a moved clone, or pointing into another clone after a
// copy, is replaced. A real directory at public/workspace is never removed.
const stat = lstatSync(link, { throwIfNoEntry: false })
if (stat?.isSymbolicLink()) {
  let current = false
  try { current = realpathSync(link) === realpathSync(target) } catch { /* Dangling link. */ }
  if (!current) {
    try { unlinkSync(link) } catch (err) { console.warn(`[mak] could not replace stale public/workspace link: ${err.message}`) }
  }
}

if (!lstatSync(link, { throwIfNoEntry: false })) {
  try {
    const windows = process.platform === 'win32'
    symlinkSync(windows ? target : relative(dirname(link), target), link, windows ? 'junction' : 'dir')
    console.log('[mak] linked public/workspace -> workspace')
  } catch (err) {
    console.warn(`[mak] could not create public/workspace link: ${err.message}`)
    console.warn('[mak] reports will 404 until the link exists')
  }
}
