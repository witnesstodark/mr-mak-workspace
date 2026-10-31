// Reusable proposal validation, reviewed plans and guarded multi-file application.
// Mod adapters own source mapping and verification; exported paths are never trusted.
import {createHash, randomUUID} from 'node:crypto';
import {closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync,
        renameSync, unlinkSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {indiceCampos, validarAjustes, validarCatalogo} from '../workspace/_shared/engine/catalogo-dados.mjs';

export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export function ownedFile(root, relative) {
  if(typeof relative !== 'string' || path.isAbsolute(relative) || /^[A-Za-z]:/.test(relative)
     || relative.split(/[\\/]/).some(p=>!p || p==='..' || p==='.') ) throw new Error(`Unsafe source path: ${relative}`);
  let current=root;
  for(const part of relative.split(/[\\/]/)) {
    current=path.join(current,part);
    if(lstatSync(current).isSymbolicLink()) throw new Error(`Symlink source refused: ${relative}`);
  }
  if(!lstatSync(current).isFile()) throw new Error(`Not a source file: ${relative}`);
  return current;
}

export function readAdjustments(filename) {
  const bytes=readFileSync(filename);
  if(bytes.length>2*1024*1024) throw new Error('Adjustment export exceeds 2 MB');
  return JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,''));
}

export async function prepareAdjustments({root,project,catalogPath,adjustments,guards=[],resolve,derive}) {
  root=realpathSync(root);
  const snapshots=new Map();
  const read=relative=>{
    if(!snapshots.has(relative)) snapshots.set(relative,readFileSync(ownedFile(root,relative)));
    return snapshots.get(relative).toString('utf8');
  };
  const catalog=JSON.parse(read(catalogPath).replace(/^\uFEFF/,''));
  const errors=validarCatalogo(catalog);
  if(errors.length) throw new Error(`Invalid current catalog: ${errors.join('; ')}`);
  validarAjustes(adjustments,{...catalog,projeto:project});
  if(!adjustments.alteracoes.length) throw new Error('No proposed changes');
  for(const relative of guards) read(relative);
  const updated=structuredClone(catalog),index=indiceCampos(catalog),updatedIndex=indiceCampos(updated);
  const patches=new Map(),changes=[];
  for(const a of adjustments.alteracoes) {
    const key=`${a.item}/${a.campo}`,entry=index.get(key);
    if(a.tipo!==undefined && a.tipo!==entry.campo.tipo) throw new Error(`Type mismatch: ${key}`);
    const edit=resolve(a,entry,read);
    const source=read(edit.path);
    if(edit.current!==a.atual) throw new Error(`Source conflict: ${key}; exported ${a.atual}, code ${edit.current}`);
    if(a.proposto===a.atual) continue;
    if(!Number.isInteger(edit.from)||!Number.isInteger(edit.to)||edit.from<0||edit.to<=edit.from||edit.to>source.length)
      throw new Error(`Invalid source span: ${key}`);
    const list=patches.get(edit.path)??[];
    if(list.some(p=>edit.from<p.to && p.from<edit.to)) throw new Error(`Overlapping source edits: ${key}`);
    list.push(edit);patches.set(edit.path,list);
    updatedIndex.get(key).campo.atual=a.proposto;
    changes.push({item:a.item,campo:a.campo,atual:a.atual,proposto:a.proposto,path:edit.path,
                  line:source.slice(0,edit.from).split('\n').length});
  }
  if(!changes.length) throw new Error('All proposed values already match');
  const outputs=new Map();
  for(const [relative,list] of patches) {
    let text=read(relative);
    for(const edit of list.sort((a,b)=>b.from-a.from)) text=text.slice(0,edit.from)+edit.replacement+text.slice(edit.to);
    outputs.set(relative,Buffer.from(text));
  }
  outputs.set(catalogPath,Buffer.from(JSON.stringify(updated,null,2)+'\n'));
  if(derive) for(const [relative,text] of await derive(updated,read)) {
    read(relative);
    if(outputs.has(relative)) throw new Error(`Duplicate derived output: ${relative}`);
    outputs.set(relative,Buffer.from(text));
  }
  const operations=[...outputs].filter(([relative,after])=>!snapshots.get(relative).equals(after))
    .map(([relative,after])=>({path:relative,before:snapshots.get(relative),after}));
  const fingerprint=JSON.stringify({root,project,changes,
    guards:[...snapshots].map(([name,bytes])=>[name,digest(bytes)]).sort(),
    outputs:operations.map(op=>[op.path,digest(op.after)]).sort()});
  return {root,project,hash:digest(fingerprint),changes,operations,snapshots};
}

function assertCurrent(plan,applied=false) {
  const outputs=applied?new Map(plan.operations.map(op=>[op.path,op.after])):new Map();
  for(const [relative,before] of plan.snapshots)
    if(!readFileSync(ownedFile(plan.root,relative)).equals(outputs.get(relative)??before)) throw new Error(`Changed since preview: ${relative}`);
}
function replace(root,relative,bytes) {
  const filename=ownedFile(root,relative),temp=filename+'.'+randomUUID()+'.tmp';
  try {writeFileSync(temp,bytes,{flag:'wx',mode:lstatSync(filename).mode});renameSync(temp,filename);}
  finally {if(existsSync(temp)) unlinkSync(temp);}
}

export async function applyAdjustments(plan,{expectedHash,receiptDirectory,verify}) {
  if(!expectedHash || expectedHash!==plan.hash) throw new Error('Preview hash mismatch; preview again before applying');
  if(typeof verify!=='function') throw new Error('A verification callback is required');
  // This path belongs to the calling adapter, never to the export.
  receiptDirectory=path.resolve(receiptDirectory);
  if(!receiptDirectory.startsWith(plan.root+path.sep)) throw new Error('Receipts must stay within the project root');
  let parent=plan.root;
  for(const part of path.relative(plan.root,receiptDirectory).split(path.sep)) {
    parent=path.join(parent,part);
    if(!existsSync(parent))mkdirSync(parent);
    if(lstatSync(parent).isSymbolicLink() || !lstatSync(parent).isDirectory()) throw new Error('Unsafe receipt directory');
  }
  const lock=path.join(receiptDirectory,'apply.lock');
  let fd;
  try {fd=openSync(lock,'wx');} catch(e) {if(e.code==='EEXIST')throw new Error('Another apply owns the lock; inspect its receipt before recovery');throw e;}
  const run=path.join(receiptDirectory,new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID());
  const receipt={version:1,project:plan.project,hash:plan.hash,state:'preparing',changes:plan.changes,files:[]};
  const written=[];
  const save=()=>writeFileSync(path.join(run,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');
  try {
    writeFileSync(fd,run);mkdirSync(run);
    assertCurrent(plan);
    plan.operations.forEach((op,i)=>{const backup=`before-${i}.bin`;writeFileSync(path.join(run,backup),op.before);
      receipt.files.push({path:op.path,backup,before:digest(op.before),after:digest(op.after)});});
    receipt.state='verifying';save();
    receipt.verification=await verify(plan,run);
    assertCurrent(plan);
    receipt.state='applying';save();
    for(const op of plan.operations) {
      if(!readFileSync(ownedFile(plan.root,op.path)).equals(op.before)) throw new Error(`Concurrent edit: ${op.path}`);
      replace(plan.root,op.path,op.after);written.push(op);
    }
    assertCurrent(plan,true);
    receipt.state='applied';save();
    return {receipt:path.join(run,'receipt.json'),verification:receipt.verification};
  } catch(error) {
    const conflicts=[];
    for(const op of written.reverse()) {
      try {
        if(readFileSync(ownedFile(plan.root,op.path)).equals(op.after)) replace(plan.root,op.path,op.before);
        else conflicts.push(op.path);
      } catch(e) {conflicts.push(`${op.path}: ${e.message}`);}
    }
    receipt.state=conflicts.length?'recovery-required':written.length?'rolled-back':'rejected';
    receipt.error=error.message;receipt.recoveryConflicts=conflicts;
    if(existsSync(run))save();
    throw new Error(`${error.message}; receipt: ${path.join(run,'receipt.json')}${conflicts.length?'; manual recovery required':''}`);
  } finally {closeSync(fd);unlinkSync(lock);}
}
