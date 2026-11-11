import assert from 'node:assert/strict';
import {readFile,writeFile,stat} from 'node:fs/promises';
import {createEngine} from '../src/shoty.mjs';
import {createState,reduceEdits} from '../src/director.mjs';
const root=process.cwd(),engine=createEngine(root),previous=JSON.parse(await readFile('.runtime/state.json','utf8'));
const next=reduceEdits(createState(),[
  {action:'zoom',shotId:'closeup',value:1.25,target:{x:.4,y:.4}},
  {action:'temperature',shotId:'closeup',value:-600},
  {action:'speed',shotId:'family',value:.75},
  {action:'trim',shotId:'courtroom',value:38.5}
]);
let output;
try{
  output=await engine.render(next);assert.ok((await stat(root+output.exportUrl)).size>10000);
  const imported=await engine.call('import_media',{paths:[root+output.exportUrl]});
  const metadata=await engine.call('get_media',{query:imported.imported[0].media_id});
  const timeline=await engine.call('get_timeline_clips',{sequence_id:output.sequenceId});
  console.log(JSON.stringify({output,metadata,timeline}));
  await writeFile('.runtime/shoty-probe.json',JSON.stringify({output,metadata,timeline},null,2));
  assert.equal(metadata.fps,30);assert.equal(metadata.resolution,'1280x720');
  // 1.7 + round(2/.75*30)/30 + 1.8 = 6.1667 s at 30 fps.
  assert.equal(metadata.duration_tc,'00:00:06:05');
  const frames=await engine.call('look_at_sequence',{times_tc:['00:00:00:24','00:00:02:15','00:00:05:00']});
  const evidence={checkedAt:new Date().toISOString(),output,metadata,frames};
  await writeFile('.runtime/shoty-verification.json',JSON.stringify(evidence,null,2));
  console.log('SHOTY INTEGRATION VERIFIED');console.log(JSON.stringify(evidence));
}finally{await engine.restore(previous);}
