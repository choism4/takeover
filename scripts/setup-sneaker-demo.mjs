import path from 'node:path';
import {readFile,writeFile,stat} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {createEngine} from '../src/shoty.mjs';

const root=process.cwd(),engine=createEngine(root);
for(const file of ['sneaker-laces.mp4','sneaker-run.mp4'])await stat(path.join(root,'media',file));
const imported=await engine.call('import_media',{paths:['sneaker-laces.mp4','sneaker-run.mp4'].map(f=>path.join(root,'media',f))});
if(imported.failures.length)throw new Error(JSON.stringify(imported.failures));
const laces=imported.imported.find(m=>m.file_name==='sneaker-laces.mp4'),run=imported.imported.find(m=>m.file_name==='sneaker-run.mp4');
const seq=await engine.call('create_sequence',{name:'Takeover · Sneaker rough cut',width:1280,height:720,fps:24});
const video=seq.tracks.find(t=>t.type==='video');
for(const [media,start,sourceIn,sourceOut] of [[laces,0,0,8],[run,8,0,12],[laces,20,8,12]]){
  const tc=n=>`00:00:${String(n).padStart(2,'0')}:00`;
  const clip=await engine.call('add_clip_from_media',{media_id:media.media_id,track_id:video.track_id,start_tc:tc(start),source_in_tc:tc(sourceIn),source_out_tc:tc(sourceOut)});
  if(media===run)await engine.call('set_clip_transform',{clip_id:clip.clip_id,scale_percent:137});
}
await engine.call('remove_empty_tracks');
await engine.call('save_project');
const loudness=await engine.call('measure_loudness');
const frames=await engine.call('look_at_sequence',{times_tc:['00:00:04:00','00:00:12:00','00:00:21:00']});
const receipt=await engine.call('export_sequence',{sequence_id:seq.sequence_id,request_id:randomUUID(),output_path:path.join(root,'media','sneaker-source.mp4'),settings:{video_codec:'H264',audio_codec:'Aac',width:1280,height:720,fps:24,quality_mode:'crf',crf:20,audio_bitrate_kbps:128,range:{type:'full_sequence'}}});
let status;
for(let i=0;i<240;i++){
  status=await engine.call('get_export_status',{job_id:receipt.job_id});
  const kind=status.status?.type??status.status;
  if(kind==='completed')break;
  if(['failed','cancelled'].includes(kind))throw new Error(JSON.stringify(status));
  await new Promise(r=>setTimeout(r,500));
}
if((status.status?.type??status.status)!=='completed')throw new Error('Source export timed out');
const sourceImport=await engine.call('import_media',{paths:[path.join(root,'media','sneaker-source.mp4')]});
const mediaId=sourceImport.imported[0].media_id;
const configPath=path.join(root,'.runtime','shoty.json'),config=JSON.parse(await readFile(configPath,'utf8'));
await writeFile(path.join(root,'.runtime','pre-sneaker-shoty.json'),JSON.stringify(config,null,2));
await writeFile(configPath,JSON.stringify({...config,mediaId,sequenceId:seq.sequence_id},null,2));
const evidence={sequence:seq,imported,source:sourceImport,loudness,frames,export:receipt,status};
await writeFile(path.join(root,'.runtime','sneaker-source-evidence.json'),JSON.stringify(evidence,null,2));
console.log(JSON.stringify({source:sourceImport,frames,loudness}));
