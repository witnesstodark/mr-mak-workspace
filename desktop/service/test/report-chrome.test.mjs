import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {reportChromeStream,serveReport} from '../report-chrome.mjs';
import {mkdtemp,writeFile,stat} from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';

async function rendered(chunks) {
  const result=[];
  for await(const chunk of Readable.from(chunks).pipe(reportChromeStream()))result.push(chunk);
  return Buffer.concat(result).toString('utf8');
}
const original = output => output.replace(/<meta name="color-scheme" content="dark"><style data-mrmak-chrome>[\s\S]*?<\/style><script data-mrmak-links>[\s\S]*?<\/script>/,'');
test('report chrome precedes document styles and preserves Unicode and original content across chunks', async()=>{
  const source='\uFEFF<!doctype html><html lang="en"><head><meta charset="utf-8"><style>body{background:#ddd}</style></head><body>Пример 🐽<pre>const head = "&lt;head&gt;";</pre></body></html>';
  const bytes=Buffer.from(source);
  const output=await rendered(Array.from(bytes,byte=>Buffer.from([byte])));
  assert.equal(original(output),source);
  assert.ok(output.indexOf('data-mrmak-chrome') < output.indexOf('body{background:#ddd}'));
  assert.ok(output.startsWith('\uFEFF<!doctype html>'));
  assert.match(output,/scrollbar-color:#514c59 #111217/);
});
test('unstyled fragments and large reports retain their content and receive one chrome layer',async()=>{
  for(const source of ['<h1>A plain report</h1>', '<!doctype html><h1>No explicit head</h1>', '<!doctype html><!--'+'x'.repeat(70000)+'--><html><body>Large report</body></html>']){
    const output=await rendered([Buffer.from(source.slice(0,65000)),Buffer.from(source.slice(65000))]);
    assert.equal(original(output),source); assert.equal(output.split('data-mrmak-chrome').length,2);
    if(source.startsWith('<!doctype'))assert.ok(output.startsWith('<!doctype html>'));
  }
});

test('HTML GET and HEAD agree on byte length while ranges remain full transformed documents',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'mrmak-report-'));
  const file=path.join(dir,'report.html'),source='<!doctype html><html><head></head><body>Пример 🐽</body></html>';
  await writeFile(file,source); const info=await stat(file);
  const server=http.createServer((request,response)=>{void serveReport(request,response,file,info,{});});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const url=`http://127.0.0.1:${server.address().port}/report.html`;
    const head=await fetch(url,{method:'HEAD'}),get=await fetch(url),body=Buffer.from(await get.arrayBuffer());
    assert.equal(Number(head.headers.get('content-length')),body.length);
    assert.equal(Number(get.headers.get('content-length')),body.length);
    assert.equal(original(body.toString('utf8')),source);
    assert.match(get.headers.get('content-type'),/^text\/html/);
    const range=await fetch(url,{headers:{Range:'bytes=0-10'}});
    assert.equal(range.status,200); assert.equal(original(await range.text()),source);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

test('reload accepts only the parent UI origin, saves route-specific scroll and restores after route layout', async () => {
  const output = [];
  for await (const chunk of Readable.from(['<html><head></head></html>']).pipe(reportChromeStream({ parentOrigin: 'http://127.0.0.1:1234' }))) output.push(chunk);
  const script = Buffer.concat(output).toString().match(/<script data-mrmak-links>([\s\S]*?)<\/script>/)[1];
  const listeners = {}, frames = [], saved = new Map(), scrolls = [], parent = {};
  let reloads = 0;
  const location = { pathname: '/view/grant/index.html', hash: '#doc~~intro', reload: () => reloads++ };
  const window = { scrollY: 765, addEventListener: (name, callback) => { listeners[name] = callback; }, scrollTo: options => scrolls.push(options.top) };
  const context = { window, parent, location, document: { documentElement: { dataset: {} }, addEventListener() {} }, requestAnimationFrame: callback => frames.push(callback), sessionStorage: { setItem: (key, value) => saved.set(key, value), getItem: key => saved.get(key) ?? null, removeItem: key => saved.delete(key) } };
  vm.runInNewContext(script, context);
  const message = (origin, source = parent, type = 'mrmak:reload') => listeners.message({ source, origin, data: { type, theme: 'light' } });
  message('https://attacker.example'); message('http://127.0.0.1:1234', {});
  assert.equal(reloads, 0); assert.equal(saved.size, 0);
  message('http://127.0.0.1:1234', parent, 'mrmak:theme');
  assert.equal(context.document.documentElement.dataset.mrmakTheme, 'light');
  message('http://127.0.0.1:1234'); assert.equal(reloads, 1);
  assert.equal(location.hash, '#doc~~intro'); assert.equal(saved.get('mrmak:scroll:/view/grant/index.html#doc~~intro'), '765');
  listeners.load(); assert.deepEqual(scrolls, []);
  frames.shift()(); assert.deepEqual(scrolls, []);
  frames.shift()(); assert.deepEqual(scrolls, [765]); assert.equal(saved.size, 0);
  message('http://127.0.0.1:1234'); location.hash = '#cat.items'; listeners.load(); frames.shift()(); frames.shift()();
  assert.equal(saved.size, 1); // a different route never consumes the saved scroll
  context.sessionStorage.setItem = () => { throw new Error('Storage disabled'); };
  message('http://127.0.0.1:1234'); assert.equal(reloads, 3);
});
