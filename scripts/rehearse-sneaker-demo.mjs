import assert from 'node:assert/strict';
import path from 'node:path';
import {readFile,writeFile,copyFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {createState} from '../src/director.mjs';
import {createApp} from '../src/server.mjs';
import {createEngine} from '../src/shoty.mjs';

const root=process.cwd(),scenario=JSON.parse(await readFile('demo/sneaker-scenario.json','utf8')),engine=createEngine(root);
const config=JSON.parse(await readFile('.runtime/shoty.json','utf8'));
const initial={...createState(),exportUrl:'/media/source.mp4',sequenceId:config.sequenceId,duration:24};
await copyFile('.runtime/state.json','.runtime/pre-sneaker-state.json',0).catch(()=>{});
await writeFile('.runtime/original-state.json',JSON.stringify(initial,null,2));
const script=`# ${scenario.title}\n\n${scenario.premise}\n\n${scenario.rehearsal}\n\n${scenario.steps.map((s,i)=>`## ${i+1}. Source ${s.sourceTime}s — ${s.id}\n\nSay: "${s.direction}"\n\n${s.gesture}\n\nExpected: ${s.expected}`).join('\n\n')}\n\n## Finish\n\n${scenario.finish}\n\n## Source credits\n\n- Ketut Subiyanto: https://www.pexels.com/video/a-woman-tying-her-shoes-4922551/\n- KoolShooters: https://www.pexels.com/video/close-up-of-a-person-running-8520623/\n\n${scenario.generationExtension}\n`;
const document=await engine.call('create_local_document',{name:'Takeover sneaker editing demo',text:script});
await writeFile('.runtime/sneaker-scenario-document.json',JSON.stringify(document,null,2));
const server=createApp({root,initialState:initial});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const url=`http://127.0.0.1:${server.address().port}`,browser=await chromium.launch({channel:'chrome',headless:true});
const evidence={startedAt:new Date().toISOString(),input:'Scripted rehearsal with actual Codex interpretation and Shoty edits; no live microphone or webcam',document,steps:[]};
try{
  const page=await browser.newPage();await page.goto(url);await page.waitForFunction(()=>document.querySelector('#source').readyState>=2);
  for(const step of scenario.steps){
    console.log(`Rehearsing ${step.id}: ${step.direction}`);
    const frames=await page.evaluate(async time=>{
      const v=document.querySelector('#source');if(Math.abs(v.currentTime-time)>.01){const seeked=new Promise(r=>v.addEventListener('seeked',r,{once:true}));v.currentTime=time;await seeked;}
      const c=document.createElement('canvas');c.width=960;c.height=540;c.getContext('2d').drawImage(v,0,0,960,540);return [c.toDataURL('image/jpeg',.8)];
    },step.sourceTime);
    const started=Date.now();
    const response=await fetch(url+'/api/direct',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({cue:{text:step.direction,sourceTime:step.sourceTime,sessionTime:(Date.now()-Date.parse(evidence.startedAt))/1000,pointer:step.id==='frame'?{x:.57,y:.58}:null},frames})});
    const state=await response.json();assert.equal(response.status,200,JSON.stringify(state));
    assert.equal(state.status,step.operation==='undo'?'undo':'edit',JSON.stringify(state.lastPlan));
    evidence.steps.push({id:step.id,seconds:(Date.now()-started)/1000,plan:state.lastPlan,state});
    await writeFile('.runtime/sneaker-rehearsal.json',JSON.stringify(evidence,null,2));
    console.log(`${step.id}: ${state.status}, revision ${state.revision}, ${(Date.now()-started)/1000}s`);
  }
  const final=evidence.steps.at(-1).state;
  assert.equal(final.captions.length,1);assert.equal(final.captions[0].text,'MOVE YOUR WAY');
  assert.ok(final.shots[0].look.zoom>1);assert.ok(final.shots[1].look.speed<1);
  await engine.call('save_project');
  evidence.finishedAt=new Date().toISOString();evidence.finalExport=path.join(root,final.exportUrl);
  await copyFile(evidence.finalExport,path.join(root,'media','sneaker-demo-edited.mp4'));
  await writeFile('.runtime/sneaker-rehearsal.json',JSON.stringify(evidence,null,2));
  console.log(`SNEAKER REHEARSAL COMPLETE ${evidence.finalExport}`);
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
