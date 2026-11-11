import test from 'node:test';
import assert from 'node:assert/strict';
const api = await import('../src/director.mjs').catch(() => ({}));

function fixtureState(){return {source:{start:33,end:39,fps:30},shots:[{id:'closeup',name:'Close-up',start:33,end:34.7},{id:'family',name:'Family',start:34.7,end:36.7},{id:'courtroom',name:'Courtroom',start:36.7,end:39}].map(s=>({...s,trimEnd:s.end,look:api.initialLook()})),lastEdit:null,revision:0};}

test('captures a cue with distinct source time and wall time', () => {
  assert.equal(typeof api.makeCue, 'function');
  const cue = api.makeCue({text:'여기 조금 밝게',sourceTime:14.5,sessionTime:3.2,pointer:{x:.3,y:.4}});
  assert.equal(cue.sourceTime,14.5);
  assert.equal(cue.sessionTime,3.2);
  assert.deepEqual(cue.pointer,{x:.3,y:.4});
});
test('letterboxing maps pointer positions to the actual video rather than its frame',()=>{
  assert.equal(typeof api.pointerInVideo,'function');
  assert.deepEqual(api.pointerInVideo({x:500,y:250,width:1000,height:600,videoWidth:1920,videoHeight:1080}),{x:.5,y:37/90});
  assert.equal(api.pointerInVideo({x:500,y:5,width:1000,height:600,videoWidth:1920,videoHeight:1080}),null);
});
test('spoken zoom uses the pointed subject as its center',()=>{
  assert.equal(typeof api.parseDirection,'function');
  const p=api.parseDirection({text:'Push in, just a little',sourceTime:5,pointer:{x:.3,y:.45}},20);
  assert.equal(p.action,'zoom');assert.equal(p.value,1.18);assert.deepEqual(p.target,{x:.3,y:.45});
});
test('Korean warmth direction maps to bounded color adjustment',()=>{
  assert.equal(typeof api.parseDirection,'function');
  const p=api.parseDirection({text:'여기 조금 더 따뜻하게 해줘',sourceTime:5},20);
  assert.equal(p.action,'temperature');assert.equal(p.value,600);
});
test('unrecognized requests remain unresolved rather than applying arbitrary changes',()=>{
  assert.equal(typeof api.parseDirection,'function');
  assert.equal(api.parseDirection({text:'Make it a spaceship',sourceTime:3},20).action,'clarify');
});
test('requested ranges clamp to the actual media duration',()=>{
  assert.equal(typeof api.normalizeEdit,'function');
  const e=api.normalizeEdit({action:'exposure',value:2,start:-4,end:120},20);
  assert.equal(e.start,0);assert.equal(e.end,20);assert.equal(e.value,1.5);
});
test('invalid numeric values and zero-length edits are rejected',()=>{
  assert.equal(typeof api.normalizeEdit,'function');
  assert.throws(()=>api.normalizeEdit({action:'zoom',value:NaN,start:3,end:3},20));
});
test('cue grouping preserves independent targets when source is scrubbed backward',()=>{
  assert.equal(typeof api.makeCue,'function');
  const a=api.makeCue({text:'brighter',sourceTime:12,sessionTime:1});
  const b=api.makeCue({text:'colder',sourceTime:4,sessionTime:4});
  assert.equal(a.sourceTime,12);assert.equal(b.sourceTime,4);assert.ok(b.sessionTime>a.sessionTime);
});

test('source time selects one shot and preserves the other shots',()=>{
  assert.equal(typeof api.createState,'function');
  const before=fixtureState();
  const after=api.reduceEdits(before,[{action:'zoom',value:1.3,shotId:'closeup',target:{x:.3,y:.4}}],{sourceTime:33.8});
  assert.equal(after.shots[0].look.zoom,1.3);
  assert.equal(after.shots[1].look.zoom,1);
  assert.equal(before.shots[0].look.zoom,1);
});
test('follow-up more and back off are relative to the last successful setting',()=>{
  assert.equal(typeof api.resolveFollowup,'function');
  const state=fixtureState();state.lastEdit={action:'zoom',shotId:'closeup',value:1.3};state.shots[0].look.zoom=1.3;
  assert.equal(api.resolveFollowup('조금 더',state,{sourceTime:33.5}).value,1.4);
  assert.equal(api.resolveFollowup('back off a bit',state,{sourceTime:33.5}).value,1.2);
  assert.equal(api.resolveFollowup('조금 더',state,{sourceTime:35.5}).action,'clarify');
});
test('edits cannot reference invented shots or mutate outside the shot boundary',()=>{
  assert.equal(typeof api.reduceEdits,'function');
  assert.throws(()=>api.reduceEdits(fixtureState(),[{action:'zoom',shotId:'invented',value:1.2}],{sourceTime:34}));
  const next=api.reduceEdits(fixtureState(),[{action:'trim',shotId:'closeup',value:999}],{sourceTime:34});
  assert.equal(next.shots[0].trimEnd,34.7);
});
test('output mapping accounts for prior shot speed and trimming',()=>{
  assert.equal(typeof api.outputTimeForSource,'function');
  const state=fixtureState();state.shots[0].look.speed=2;
  assert.ok(Math.abs(api.outputTimeForSource(state,35.7)-1.85)<.001);
});
test('pointing on a zoomed result maps back to the source subject',()=>{
  assert.equal(typeof api.sourcePointer,'function');
  assert.deepEqual(api.sourcePointer({x:.6,y:.4},{zoom:2,target:{x:.4,y:.4}}),{x:.5,y:.4});
});
test('the original Nike source is complete and has continuous editing regions',()=>{
  const state=api.createState();assert.equal(state.source.fileName,'nike-air-max-2017.mp4');assert.equal(state.source.start,0);assert.equal(state.source.end,30);assert.equal(state.source.fps,25);
  assert.equal(api.shotAt(state,0).id,'opening');assert.equal(api.shotAt(state,5.4).id,'water');assert.equal(api.shotAt(state,25).id,'hero');assert.equal(api.shotAt(state,30).id,'brand');
  state.shots.slice(1).forEach((s,i)=>assert.equal(s.start,state.shots[i].end));
});
