import test from 'node:test';
import assert from 'node:assert/strict';
const api=await import('../src/capture.mjs').catch(()=>({}));
test('speech finalization uses the speech-start source clock, not the current playhead',()=>{
  assert.equal(typeof api.CueCapture,'function');
  const c=new api.CueCapture();c.begin({sourceTime:33.5,sessionTime:2,pointer:{x:.2,y:.3}});
  const cue=c.finish('closer',{sourceTime:38,sessionTime:4,pointer:{x:.9,y:.8}});
  assert.equal(cue.sourceTime,33.5);assert.equal(cue.sessionTime,2);assert.deepEqual(cue.pointer,{x:.2,y:.3});assert.equal(cue.endSessionTime,4);
});
test('capture keeps only recent ordered context frames',()=>{
  assert.equal(typeof api.CueCapture,'function');const c=new api.CueCapture();
  for(let i=0;i<10;i++)c.frame('jpeg-'+i,i);
  assert.deepEqual(c.context(9).map(f=>f.data),['jpeg-6','jpeg-7','jpeg-8','jpeg-9']);
});
test('drawn gestures begin only while directing and retain source-relative coordinates',()=>{
  assert.equal(typeof api.StrokeCapture,'function');const strokes=new api.StrokeCapture();
  const sample={sourceTime:12,sessionTime:1,pointer:{x:.2,y:.3},displayPointer:{x:.2,y:.3}};
  strokes.begin(sample,false);strokes.move({...sample,pointer:{x:.4,y:.5}});assert.equal(strokes.strokes.length,0);
  strokes.begin(sample,true);strokes.move({...sample,sessionTime:2,pointer:{x:.4,y:.5}});strokes.end();
  assert.equal(strokes.strokes.length,1);assert.equal(strokes.strokes[0].points.length,2);assert.equal(strokes.strokes[0].sourceTime,12);assert.equal(strokes.active,null);
});
test('an explicit spoken timecode is recognized without replacing speech-start time',()=>{
  assert.equal(typeof api.explicitTimecode,'function');
  assert.equal(api.explicitTimecode('Make the shot at 00:12 warmer.'),12);
  assert.equal(api.explicitTimecode('At 01:02:03, slow down.'),3723);
  assert.equal(api.explicitTimecode('Make this warmer.'),null);
});
