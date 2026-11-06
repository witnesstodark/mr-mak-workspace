import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createService} from '../server.mjs';

async function fixture(settings, sessions) {
  await mkdir('.cache', {recursive:true});
  const repo=await mkdtemp(path.resolve('.cache/project-groups-'));
  await mkdir(path.join(repo,'workspace'));
  await mkdir(path.join(repo,'.mrmak'));
  await writeFile(path.join(repo,'workspace/workspace.json'),'{"entities":[]}');
  await writeFile(path.join(repo,'.mrmak/settings.json'),JSON.stringify(settings));
  await writeFile(path.join(repo,'.mrmak/sessions.json'),JSON.stringify(sessions));
  return repo;
}
const tab=(id,cwd,tabOrder,extra={})=>({id,cwd,tabOrder,name:id,agent:'shell',open:true,pinned:false,status:'stopped',createdAt:'2026-10-20T12:00:00Z',...extra});
const service=repo=>createService({repo,mcpOptions:{home:repo,env:{}}});

test('legacy project groups retain saved project order, chat IDs, preferences and native group edits after restart',async()=>{
  const tools=path.resolve('.cache/Tools'),game=path.resolve('.cache/Game');
  const repo=await fixture({groupTabsByProject:true,projectOrder:[tools,game],workspaceTheme:'antigravity',chatTheme:'plum',usageDirection:'remaining',selectedId:'Game one'},[
    tab('Game one',game,0),tab('Tools one',tools,1),tab('Game two',game,2),tab('Tools two',tools,3),
  ]);
  let app=await service(repo);
  try {
    assert.deepEqual(app.sessions.active().map(x=>x.id),['Tools one','Tools two','Game one','Game two']);
    assert.deepEqual(app.sessions.active().map(x=>x.group),['Tools','Tools','Game','Game']);
    const saved=JSON.parse(await readFile(path.join(repo,'.mrmak/settings.json'),'utf8'));
    assert.equal(saved.groupTabsByProject,false);
    assert.equal(saved.workspaceTheme,'antigravity');assert.equal(saved.chatTheme,'plum');
    assert.equal(saved.usageDirection,'remaining');assert.equal(saved.selectedId,'Game one');
    await app.sessions.renameGroup('Tools','Work');
    await app.sessions.moveGroup('Work',false,'Game one','after');
    await app.close();app=await service(repo);
    assert.deepEqual(app.sessions.active().map(x=>x.id),['Game one','Game two','Tools one','Tools two']);
    assert.deepEqual(app.sessions.active().map(x=>x.group),['Game','Game','Work','Work']);
  } finally {await app.close();}
});

test('project grouping separates same-named folders, preserves closed chats and pinning, and requires authentication',async()=>{
  const a=path.resolve('.cache/A/Game'),b=path.resolve('.cache/B/Game');
  const repo=await fixture({},[tab('One',a,0),tab('Two',b,1),tab('Three',a,2),tab('Pinned',b,3,{pinned:true}),tab('History',path.resolve('.cache/C/Game'),4,{open:false,group:'Archive'})]);
  const app=await service(repo);
  try {
    const request=headers=>fetch(app.origin+'/api/groups/by-project',{method:'POST',headers});
    assert.equal((await request({})).status,401);
    const headers={Authorization:`Bearer ${app.token}`};
    assert.equal((await request(headers)).status,200);
    const ids=app.sessions.active().map(x=>x.id);
    assert.deepEqual(ids,['Pinned','One','Three','Two']);
    const first=app.sessions.get('One').group,second=app.sessions.get('Two').group;
    assert.ok(first&&second);assert.notEqual(first,second);
    assert.equal(app.sessions.get('Three').group,first);
    assert.equal(app.sessions.get('Pinned').group,second);
    assert.equal(app.sessions.get('History').group,'Archive');
    assert.equal(app.sessions.get('History').tabOrder,4);
    assert.equal(app.sessions.projectGrouped(),true);
    await request(headers);
    assert.deepEqual(app.sessions.active().map(x=>x.id),ids);
    assert.deepEqual(app.sessions.active().map(x=>x.group),[null,null,null,null]);
    assert.equal(app.sessions.get('History').group,'Archive');
    await request(headers);
    assert.deepEqual(app.sessions.active().map(x=>x.id),ids);
    assert.equal(app.sessions.get('One').group,first);assert.equal(app.sessions.get('Two').group,second);
  } finally {await app.close();}
});
