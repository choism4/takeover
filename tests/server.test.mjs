import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const api=await import('../src/server.mjs').catch(()=>({}));

async function fixture(t,options={}){
  assert.equal(typeof api.createApp,'function');
  const root=await mkdtemp(path.join(os.tmpdir(),'cue-test-'));
  await mkdir(path.join(root,'media'));await mkdir(path.join(root,'public','brand'),{recursive:true});
  await writeFile(path.join(root,'public','index.html'),'<!doctype html><title>CUE</title>');
  await writeFile(path.join(root,'public','brand','takeover-overline.png'),Buffer.from('89504e470d0a1a0a','hex'));
  await writeFile(path.join(root,'public','brand','private.txt'),'Not a public asset');
  await writeFile(path.join(root,'media','taiwan-drama-trailer.mp4'),'0123456789');
  const server=api.createApp({root,sourceFile:'taiwan-drama-trailer.mp4',apply:async look=>({look,exportUrl:'/media/result.mp4'}),...options});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true});});
  return `http://127.0.0.1:${server.address().port}`;
}
test('serves the editor workspace',async t=>{const u=await fixture(t);const r=await fetch(u);assert.equal(r.status,200);assert.match(await r.text(),/CUE/);});
test('serves the selected logo as an image while keeping other brand files private',async t=>{
  const u=await fixture(t),route=u+'/brand/takeover-overline.png';
  const r=await fetch(route);assert.equal(r.status,200);assert.equal(r.headers.get('content-type'),'image/png');
  assert.deepEqual(Buffer.from(await r.arrayBuffer()),Buffer.from('89504e470d0a1a0a','hex'));
  const head=await fetch(route,{method:'HEAD'});assert.equal(head.status,200);assert.equal(head.headers.get('content-length'),'8');assert.equal((await head.arrayBuffer()).byteLength,0);
  assert.equal((await fetch(u+'/brand/private.txt')).status,404);
});
test('supports video range requests without loading an entire file',async t=>{const u=await fixture(t);const r=await fetch(u+'/media/source.mp4',{headers:{Range:'bytes=2-5'}});assert.equal(r.status,206);assert.equal(r.headers.get('content-range'),'bytes 2-5/10');assert.equal(await r.text(),'2345');});
test('rejects an unsupported operation before invoking the desktop engine',async t=>{let calls=0;const u=await fixture(t,{apply:async()=>{calls++;}});const r=await fetch(u+'/api/apply',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({edits:[{action:'run_shell',value:1}]})});assert.equal(r.status,400);assert.equal(calls,0);});
test('rejects cross-origin desktop control',async t=>{const u=await fixture(t);const r=await fetch(u+'/api/apply',{method:'POST',headers:{origin:'https://evil.example','content-type':'application/json'},body:'{}'});assert.equal(r.status,403);});
test('serializes desktop edits and reports a busy operation',async t=>{
  let release;const barrier=new Promise(r=>release=r);let started;const began=new Promise(r=>started=r);
  const u=await fixture(t,{apply:async look=>{started();await barrier;return {look};}});
  const body=JSON.stringify({edits:[{action:'exposure',value:.3,start:0,end:8}]});
  const first=fetch(u+'/api/apply',{method:'POST',body});await began;
  const second=await fetch(u+'/api/apply',{method:'POST',body});assert.equal(second.status,409);
  release();assert.equal((await first).status,200);
});
test('retains a previous successful state when the desktop engine fails',async t=>{
  const u=await fixture(t,{apply:async()=>{throw new Error('Shoty unavailable');}});
  const r=await fetch(u+'/api/apply',{method:'POST',body:JSON.stringify({edits:[{action:'exposure',value:.4,start:0,end:8}]})});
  assert.equal(r.status,502);const state=await (await fetch(u+'/api/state')).json();assert.equal(state.look.exposure,0);assert.equal(state.busy,false);
});
test('captures a directing session with source-relative cues',async t=>{
  const u=await fixture(t);const r=await fetch(u+'/api/sessions',{method:'POST',body:JSON.stringify({cues:[{text:'here',sourceTime:34,sessionTime:2,pointer:{x:.4,y:.3}}],pointerEvents:[{sessionTime:1,sourceTime:34,x:.4,y:.3}]})});
  assert.equal(r.status,201);const d=await r.json();assert.ok(d.id);assert.equal(d.cues,1);
});
test('undo restores a successful revision, without reinterpreting the instruction',async t=>{
  const u=await fixture(t);const post=(route,body)=>fetch(u+route,{method:'POST',body:JSON.stringify(body)});
  await post('/api/apply',{cue:{sourceTime:0.8},edits:[{action:'zoom',value:1.3}]});
  const r=await post('/api/undo',{});assert.equal(r.status,200);
  const s=await r.json();assert.equal(s.shots[0].look.zoom,1);assert.equal(s.history.length,0);
});
test('clarification keeps the native engine untouched and explains what is missing',async t=>{
  let calls=0;const u=await fixture(t,{apply:async()=>{calls++;},plan:async()=>({status:'clarify',message:'Which shot?',edits:[]})});
  const r=await fetch(u+'/api/direct',{method:'POST',body:JSON.stringify({cue:{text:'Make it a spaceship',sourceTime:0.8,sessionTime:1},frames:[]})});
  assert.equal(r.status,200);assert.equal((await r.json()).status,'clarify');assert.equal(calls,0);
});
test('validates multimodal plans before desktop execution',async t=>{
  let calls=0;const u=await fixture(t,{apply:async()=>{calls++;},plan:async()=>({status:'edit',message:'bad',edits:[{action:'run_shell'}]})});
  const r=await fetch(u+'/api/direct',{method:'POST',body:JSON.stringify({cue:{text:'test',sourceTime:0.8,sessionTime:1}})});
  assert.equal(r.status,400);assert.equal(calls,0);
});
test('failed second render retains the first successful native export and undo entry',async t=>{
  let n=0;const u=await fixture(t,{apply:async()=>{if(++n===2)throw new Error('render failed');return {exportUrl:'/media/revision-1-ok.mp4'};}});
  const post=body=>fetch(u+'/api/apply',{method:'POST',body:JSON.stringify(body)});
  await post({edits:[{action:'zoom',value:1.25}]});
  const r=await post({edits:[{action:'exposure',value:.8}]});assert.equal(r.status,502);
  const s=await (await fetch(u+'/api/state')).json();assert.equal(s.exportUrl,'/media/revision-1-ok.mp4');assert.equal(s.shots[0].look.zoom,1.25);assert.equal(s.shots[0].look.exposure,0);assert.equal(s.history.length,1);
});
test('restores the desktop sequence when undoing an immutable native export',async t=>{
  let restored;const u=await fixture(t,{initialState:{...((await import('../src/director.mjs')).createState()),exportUrl:'/media/original.mp4',sequenceId:'base'},restore:async state=>{restored=state.sequenceId;}});
  await fetch(u+'/api/apply',{method:'POST',body:JSON.stringify({edits:[{action:'zoom',value:1.2}]})});
  await fetch(u+'/api/undo',{method:'POST',body:'{}'});assert.equal(restored,'base');
});
test('tracks an individual direction through interpreting, native rendering and applied',async t=>{
  let release;const barrier=new Promise(r=>release=r);let began;const started=new Promise(r=>began=r);
  const id='e6e883c3-a1c1-4d37-bcf3-72758d20d5fb';
  const u=await fixture(t,{plan:async()=>({status:'edit',message:'Closer',edits:[{action:'zoom',value:1.2}]}),apply:async(s,{onProgress}={})=>{onProgress?.('rendering');began();await barrier;return {exportUrl:'/media/result.mp4'};}});
  const pending=fetch(u+'/api/direct',{method:'POST',body:JSON.stringify({cue:{id,text:'closer',sourceTime:0.8,sessionTime:1}})});
  await started;const during=await (await fetch(u+'/api/state')).json();release();const done=await (await pending).json();assert.equal(during.directions?.[0]?.id,id);assert.equal(during.directions[0].status,'rendering');assert.equal(done.directions[0].status,'applied');assert.ok(done.directions[0].finishedAt);
});

test('a caption direction reaches the native adapter and invalid text cannot mutate the last export',async t=>{
  let received,calls=0;
  const u=await fixture(t,{plan:async()=>({status:'edit',message:'Caption added.',edits:[{action:'caption',text:'MOVE YOUR WAY',start:20,end:24}]}),apply:async state=>{calls++;received=state;return {exportUrl:'/media/revision-1-caption.mp4'};}});
  const added=await fetch(u+'/api/direct',{method:'POST',body:JSON.stringify({cue:{text:'Add MOVE YOUR WAY over the final shot',sourceTime:21,sessionTime:1}})});
  assert.equal(added.status,200);assert.equal(received.captions[0].text,'MOVE YOUR WAY');
  const rejected=await fetch(u+'/api/apply',{method:'POST',body:JSON.stringify({edits:[{action:'caption',text:'',start:20,end:24}]})});
  assert.equal(rejected.status,400);assert.equal(calls,1);
  const state=await (await fetch(u+'/api/state')).json();assert.equal(state.exportUrl,'/media/revision-1-caption.mp4');assert.equal(state.captions.length,1);
});
