import test from 'node:test';
import assert from 'node:assert/strict';
import { transcriptActivity } from '../mobile-transcript.mjs';

test('tool activity reports status without arguments, output, or reasoning', () => {
  const records = [
    { type: 'assistant', timestamp: 'first', message: { content: [{type:'thinking',thinking:'private reasoning'}, {type:'tool_use',id:'a',name:'Bash',input:{command:'secret command'}}] } },
    { type: 'user', timestamp: 'second', message: { content: [{type:'tool_result',tool_use_id:'a',content:'private output'}] } },
    { type: 'assistant', isSidechain:true, message:{content:[{type:'tool_use',id:'b',name:'Hidden'}]} },
  ];
  const activity = transcriptActivity(records,'claude');
  assert.deepEqual(activity,[{id:'a',name:'Bash',status:'completed',at:'second'}]);
  assert.deepEqual(transcriptActivity([{type:'response_item',payload:{type:'function_call',call_id:'c',name:'exec',arguments:'secret'}},{type:'response_item',payload:{type:'function_call_output',call_id:'c',output:'secret'}}],'codex'),[{id:'c',name:'exec',status:'completed',at:''}]);
});

