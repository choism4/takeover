import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {createApp} from '../src/server.mjs';
import {createState} from '../src/director.mjs';
import {readFile,writeFile,mkdtemp,symlink,rm,stat} from 'node:fs/promises';
const initial=JSON.parse(await readFile('.runtime/original-state.json','utf8'));
const requests=[],errors=[];let savedManifest;
const fixtureRoot=await mkdtemp(path.join(os.tmpdir(),'takeover-browser-'));for(const name of ['public','src','media'])await symlink(path.join(process.cwd(),name),path.join(fixtureRoot,name));
const server=createApp({root:fixtureRoot,initialState:initial,
  plan:async input=>{requests.push(input);return {status:'edit',message:'Closer on the face.',evidence:'Speech-start source clock and pointed subject.',edits:[{action:'zoom',shotId:initial.shots[0].id,value:1.2,target:input.cue.pointer??{x:.5,y:.5}}]};},
  apply:async()=>({exportUrl:initial.exportUrl})});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const url=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
try{
  const context=await browser.newContext({viewport:{width:1280,height:900},permissions:['camera','microphone']});
  await context.addInitScript(()=>{
    // Deterministic speech events exercise the app, not a real transcription service.
    window.SpeechRecognition=class{constructor(){window.qaSpeech=this;}start(){}stop(){this.onend?.();}};
  });
  const page=await context.newPage();page.on('request',r=>{if(r.url().endsWith('/api/sessions'))savedManifest=r.postDataJSON();});page.on('pageerror',e=>{errors.push(e.message);console.log('page error',e.message);});page.setDefaultTimeout(12000);await page.goto(url);
  await page.waitForFunction(()=>document.querySelector('#source').readyState>=2);
  assert.equal(await page.locator('#direction-form,#record,#undo,#original,#edited,#shots').count(),0);
  await page.getByRole('button',{name:'Start directing'}).click();
  await page.waitForFunction(()=>document.querySelector('#camera').readyState>=2);
  const stage=await page.locator('#stage').boundingBox();await page.mouse.move(stage.x+stage.width*.4,stage.y+stage.height*.4);
  await page.mouse.down();await page.mouse.move(stage.x+stage.width*.55,stage.y+stage.height*.55,{steps:8});await page.mouse.up();
  await page.waitForTimeout(1200);
  assert.ok(await page.locator('#strokes').evaluate(c=>c.getContext('2d').getImageData(0,0,c.width,c.height).data.some((v,i)=>i%4===3&&v>0)));
  await page.evaluate(t=>{document.querySelector('#source').currentTime=t;},initial.source.start+.8);
  await page.waitForTimeout(200);
  await page.evaluate(t=>{window.qaSpeech.onspeechstart();document.querySelector('#source').currentTime=t;},initial.shots[1].start+.5);
  await page.evaluate(()=>window.qaSpeech.onresult({resultIndex:0,results:[Object.assign([{transcript:'Push in on his face.'}],{isFinal:true})]}));
  await page.waitForFunction(()=>document.querySelector('.cue-meta')?.textContent.includes('Applied'));
  assert.equal(requests.length,1);console.log('captured source',requests[0].cue.sourceTime);assert.ok(Math.abs(requests[0].cue.sourceTime-(initial.source.start+.8))<.05);assert.ok(requests[0].frames.length>0);
  assert.ok(requests[0].cue.pointer);assert.equal(await page.locator('#source').isHidden(),true);assert.equal(await page.locator('#result').isVisible(),true);
  assert.equal(await page.locator('.cue').evaluate(e=>e.open),false);await page.locator('.cue summary').click();assert.equal(await page.locator('.cue').evaluate(e=>e.open),true);
  console.log('card inspection passed');
  const recordingResponse=page.waitForResponse(r=>r.url().includes('/api/recordings/'));
  await page.getByRole('button',{name:'Stop directing'}).click();
  console.log('stop clicked');const upload=await recordingResponse;console.log('recording uploaded');assert.equal(upload.status(),201);const saved={id:upload.url().split('/').at(-1)};const recording={size:(await stat(path.join(fixtureRoot,'.runtime','sessions',saved.id+'.webm'))).size,type:upload.request().headers()['content-type']};assert.ok(recording.size>1000);
  console.log('record bytes verified');const manifest=savedManifest;assert.equal(manifest.cues.length,1);assert.ok(manifest.pointerEvents.some(e=>e.type==='stroke-start'));assert.equal(await page.locator('#camera').isVisible(),true);
  console.log('camera retained');await page.locator('.webcam').hover();await page.getByRole('button',{name:'Turn camera off'}).click();assert.equal(await page.locator('#cam-state').textContent(),'Off');
  console.log('camera off verified');await page.screenshot({path:'.runtime/browser-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:'.runtime/browser-mobile.png',fullPage:true});
  console.log('mobile verified');const blocked=await context.newPage();blocked.setDefaultTimeout(10000);await blocked.addInitScript(()=>{navigator.mediaDevices.getUserMedia=async()=>{throw new DOMException('Permission denied','NotAllowedError');};});await blocked.goto(url);await blocked.getByRole('button',{name:'Start directing'}).click();await blocked.waitForFunction(()=>!document.querySelector('#notice').hidden,{},{timeout:10000});
  assert.match(await blocked.locator('#notice').textContent(),/Permission denied/);assert.deepEqual(errors,[]);
  await writeFile('.runtime/browser-verification.json',JSON.stringify({checkedAt:new Date().toISOString(),speech:'simulated final events',camera:'Chromium fake capture device',requests:requests.map(r=>({cue:r.cue,frames:r.frames.length})),recording,manifestCues:manifest.cues.length,mobileOverflow:false,pageErrors:errors},null,2));
  console.log('BROWSER CAPTURE VERIFIED (simulated speech and camera; real MediaRecorder)');
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));await rm(fixtureRoot,{recursive:true,force:true});}
