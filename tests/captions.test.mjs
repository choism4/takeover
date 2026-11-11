import test from 'node:test';
import assert from 'node:assert/strict';
import {createState,reduceEdits,initialLook} from '../src/director.mjs';
import {captionGraphic,captionSegments} from '../src/captions.mjs';

function state(){return {...createState(),source:{start:0,end:12,fps:24},shots:[{id:'detail',name:'Detail',start:0,end:6,trimEnd:6,look:initialLook()},{id:'run',name:'Run',start:6,end:12,trimEnd:12,look:initialLook()}],captions:[]};}

test('authored captions preserve exact text, source timing and existing shot edits',()=>{
  const before=state();before.shots[0].look.zoom=1.3;
  const next=reduceEdits(before,[{action:'caption',text:'MOVE YOUR WAY',start:7,end:11}],{sourceTime:8});
  assert.equal(next.captions.length,1);assert.equal(next.captions[0].text,'MOVE YOUR WAY');
  assert.equal(next.captions[0].start,7);assert.equal(next.captions[0].end,11);
  assert.equal(next.shots[0].look.zoom,1.3);assert.equal(before.captions.length,0);
});

test('caption revisions replace a known caption and reject invented identities',()=>{
  const first=reduceEdits(state(),[{action:'caption',text:'MOVE YOUR WAY',start:7,end:11}],{sourceTime:8});
  const id=first.captions[0].id;
  const next=reduceEdits(first,[{action:'caption',captionId:id,text:'MAKE YOUR MOVE',start:7,end:11,fontSize:54}],{sourceTime:8});
  assert.equal(next.captions.length,1);assert.equal(next.captions[0].id,id);assert.equal(next.captions[0].text,'MAKE YOUR MOVE');assert.equal(next.captions[0].fontSize,54);
  assert.throws(()=>reduceEdits(first,[{action:'caption',captionId:'missing',text:'Wrong',start:7,end:11}],{sourceTime:8}),/caption/i);
});

test('caption intervals remain tied to the footage after speed changes and trims',()=>{
  const s=state();s.shots[0].look.speed=2;s.shots[1].trimEnd=10;
  s.captions=[{id:'a',text:'MOVE',start:4,end:11,fontSize:48,x:50,y:85}];
  const segments=captionSegments(s);
  assert.deepEqual(segments.map(c=>[c.start,c.end]),[[2,3],[3,7]]);
  assert.equal(segments.every(c=>c.text==='MOVE'),true);
});

test('caption input rejects blank text, out-of-source intervals and invalid styles',()=>{
  for(const e of [{text:' ',start:1,end:2},{text:'Move',start:-1,end:2},{text:'Move',start:1,end:13},{text:'Move',start:1,end:2,fontSize:NaN}])assert.throws(()=>reduceEdits(state(),[{action:'caption',...e}],{sourceTime:1}));
});

test('caption graphics safely escape text and expose a transparent deterministic composition',()=>{
  const html=captionGraphic({text:'<script> & "MOVE"',fontSize:48,x:50,y:85},2);
  assert.ok(html.includes('&lt;script&gt; &amp; &quot;MOVE&quot;'));
  assert.ok(html.includes('data-duration="2"'));assert.ok(html.includes('data-var="caption"'));
  assert.ok(html.includes('transparent'));assert.ok(!html.includes('<script> &'));
});
