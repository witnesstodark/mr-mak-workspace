#!/usr/bin/env node
// Optional, offline file-integrity receipts for Workspace asset deliveries.
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep, win32 } from 'node:path';
import { pathToFileURL } from 'node:url';

export const PLAN_SCHEMA = 'mrmak.asset-delivery-plan/v1';
export const MANIFEST_SCHEMA = 'mrmak.asset-delivery/v1';

const ID = /^[a-z0-9][a-z0-9-]{0,62}$/;
const PROVIDER_NAME = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/;
const RECEIPT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const HASH = /^[0-9a-f]{64}$/;
const SECRET_PREFIX = /^(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{12,}|github_pat_|AKIA[0-9A-Z]{12,}|AIza[0-9A-Za-z_-]{12,})/i;

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function knownKeys(value, allowed, where, errors) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) errors.push(`${where}: unexpected field ${key}`);
  }
}

function portablePath(value) {
  return typeof value === 'string' && value.length > 0
    && !value.includes('\\') && !value.includes(':') && !value.includes('\0')
    && !isAbsolute(value) && !win32.isAbsolute(value)
    && value.split('/').every((part) => part !== '' && part !== '.' && part !== '..');
}

function allowedName(value, pattern) {
  return typeof value === 'string' && pattern.test(value) && !SECRET_PREFIX.test(value);
}

export function validateDocument(document, kind) {
  const errors = [];
  if (!object(document)) return ['document: object required'];
  const manifest = kind === 'manifest';
  const expected = manifest ? MANIFEST_SCHEMA : PLAN_SCHEMA;
  const fields = ['schema', 'card_id', 'step', 'files', 'provider', 'model', 'receipt_id'];
  knownKeys(document, fields, 'document', errors);
  if (document.schema !== expected) errors.push(`schema: expected ${expected}`);
  for (const name of ['card_id', 'step']) {
    if (typeof document[name] !== 'string' || !ID.test(document[name])) {
      errors.push(`${name}: lowercase slug required`);
    }
  }
  for (const name of ['provider', 'model']) {
    if (document[name] !== undefined && !allowedName(document[name], PROVIDER_NAME)) {
      errors.push(`${name}: provider/model name required, without a URL or credential`);
    }
  }
  if (document.receipt_id !== undefined && !allowedName(document.receipt_id, RECEIPT_ID)) {
    errors.push('receipt_id: non-secret ID required; URLs and credentials are forbidden');
  }
  if (!Array.isArray(document.files) || document.files.length === 0) {
    errors.push('files: non-empty array required');
    return errors;
  }
  let outputs = 0;
  const seen = new Set();
  document.files.forEach((file, index) => {
    const where = `files[${index}]`;
    if (!object(file)) {
      errors.push(`${where}: object required`);
      return;
    }
    knownKeys(file, manifest
      ? ['path', 'role', 'kind', 'sha256', 'bytes']
      : ['path', 'role', 'kind'], where, errors);
    if (!portablePath(file.path)) errors.push(`${where}.path: relative forward-slash path required`);
    if (seen.has(file.path)) errors.push(`${where}.path: duplicate file path`);
    seen.add(file.path);
    if (typeof file.role !== 'string' || !ID.test(file.role)) {
      errors.push(`${where}.role: lowercase slug required`);
    }
    if (!['input', 'output'].includes(file.kind)) {
      errors.push(`${where}.kind: input or output required`);
    } else if (file.kind === 'output') {
      outputs += 1;
    }
    if (manifest) {
      if (typeof file.sha256 !== 'string' || !HASH.test(file.sha256)) {
        errors.push(`${where}.sha256: SHA-256 required`);
      }
      if (!Number.isSafeInteger(file.bytes) || file.bytes < 0) {
        errors.push(`${where}.bytes: non-negative integer required`);
      }
    }
  });
  if (outputs === 0) errors.push('files: at least one output required');
  return errors;
}

function inside(root, target) {
  const rel = relative(root, target);
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel));
}

async function canonicalRoot(root) {
  const base = await realpath(resolve(root));
  if (!(await stat(base)).isDirectory()) throw new Error('selected root is not a directory');
  return base;
}

async function fingerprint(root, relativePath) {
  const logical = resolve(root, ...relativePath.split('/'));
  if (!inside(root, logical)) throw new Error('path escapes selected root');
  // realpath resolves file symlinks and directory junctions before any bytes are read.
  const actual = await realpath(logical);
  if (!inside(root, actual)) throw new Error('link resolves outside selected root');
  if (!(await stat(actual)).isFile()) throw new Error('regular file required');
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(actual)) {
    hash.update(chunk);
    bytes += chunk.length;
  }
  return { sha256: hash.digest('hex'), bytes };
}

export async function buildManifest(plan, root) {
  const errors = validateDocument(plan, 'plan');
  if (errors.length) throw new Error(errors.join('; '));
  const base = await canonicalRoot(root);
  const files = [];
  for (const file of plan.files) {
    const measured = await fingerprint(base, file.path);
    files.push({ ...file, ...measured });
  }
  return {
    schema: MANIFEST_SCHEMA,
    card_id: plan.card_id,
    step: plan.step,
    ...(plan.provider === undefined ? {} : { provider: plan.provider }),
    ...(plan.model === undefined ? {} : { model: plan.model }),
    ...(plan.receipt_id === undefined ? {} : { receipt_id: plan.receipt_id }),
    files,
  };
}

export async function verifyManifest(manifest, root) {
  const errors = validateDocument(manifest, 'manifest');
  if (errors.length) return errors;
  const base = await canonicalRoot(root);
  for (const [index, file] of manifest.files.entries()) {
    try {
      const measured = await fingerprint(base, file.path);
      if (measured.sha256 !== file.sha256 || measured.bytes !== file.bytes) {
        errors.push(`files[${index}]: content or size changed (${file.path})`);
      }
    } catch (error) {
      errors.push(`files[${index}]: ${error.message} (${file.path})`);
    }
  }
  return errors;
}

function options(argv) {
  const [command, ...rest] = argv;
  if (!['build', 'verify'].includes(command)) throw new Error('command must be build or verify');
  const result = { command };
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i];
    if (!['--plan', '--manifest', '--root', '--out'].includes(key)
        || !rest[i + 1] || result[key.slice(2)] !== undefined) {
      throw new Error(`invalid or repeated option: ${key}`);
    }
    result[key.slice(2)] = rest[i + 1];
  }
  if (!result.root) throw new Error('--root is required');
  if (command === 'build' && (!result.plan || result.manifest)) {
    throw new Error('build requires --plan and accepts no --manifest');
  }
  if (command === 'verify' && (!result.manifest || result.plan || result.out)) {
    throw new Error('verify requires --manifest and never writes an output');
  }
  return result;
}

async function main(argv) {
  const args = options(argv);
  if (args.command === 'build') {
    const plan = JSON.parse(await readFile(args.plan, 'utf8'));
    const manifest = await buildManifest(plan, args.root);
    const json = JSON.stringify(manifest, null, 2) + '\n';
    if (args.out) {
      await writeFile(args.out, json, { encoding: 'utf8', flag: 'wx' });
      process.stdout.write(`Manifest created: ${args.out}\n`);
    } else {
      process.stdout.write(json);
    }
    return 0;
  }
  const manifest = JSON.parse(await readFile(args.manifest, 'utf8'));
  const errors = await verifyManifest(manifest, args.root);
  if (errors.length) {
    for (const error of errors) process.stderr.write(`${error}\n`);
    return 1;
  }
  process.stdout.write('File integrity verified. Visual approval and engine readiness are separate.\n');
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
