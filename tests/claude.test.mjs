import test from 'node:test';
import assert from 'node:assert/strict';
import {createState,makeCue} from '../src/director.mjs';
const api=await import('../src/anthropic-planner.mjs').catch(()=>({}));
test('Claude receives synchronized images and returns a bounded interpretation',async()=>{
  assert.equal(typeof api.createClaudePlanner,'function');let request;
  const client={messages:{stream:r=>{request=r;return {finalMessage:async()=>({stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify({status:'edit',message:'Closer.',evidence:'Pointed subject.',edits:[{action:'zoom',shotId:'shot-1',value:1.2,target:{x:.4,y:.5}}]})}]})};}}};
  const plan=await api.createClaudePlanner({client})({cue:makeCue({text:'closer',sourceTime:34}),state:createState(),frames:['data:image/jpeg;base64,YQ==']});
  assert.equal(plan.status,'edit');assert.equal(request.messages[0].content[0].type,'image');assert.equal(request.output_config.format.type,'json_schema');
});
test('a truncated response cannot enter native editing',async()=>{
  assert.equal(typeof api.createClaudePlanner,'function');const client={messages:{stream:()=>({finalMessage:async()=>({stop_reason:'max_tokens',content:[]})})}};
  await assert.rejects(api.createClaudePlanner({client})({cue:makeCue({text:'closer',sourceTime:34}),state:createState()}),/incomplete/);
});
