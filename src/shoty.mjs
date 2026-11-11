import {readFile,writeFile,mkdir,stat} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {run} from './process.mjs';
import {timecode} from './director.mjs';
import {captionSegments,captionGraphic} from './captions.mjs';
export function createEngine(root){
  const configPath=path.join(root,'.runtime','shoty.json');
  async function call(tool,args={}){
    const config=JSON.parse(await readFile(configPath,'utf8'));
    const result=JSON.parse(await run('shoty',['--session',config.sessionId,'call',tool,JSON.stringify(args)]));
    if(!result.ok)throw new Error(result.error??'Shoty refused the operation');
    return result.result;
  }
  async function render(state,{base=false,onProgress=()=>{}}={}){
    const cfg=JSON.parse(await readFile(configPath,'utf8'));
    const previous=cfg.sequenceId,fps=state.source?.fps??30;let seq;
    try{
      onProgress('editing');
      seq=await call('create_sequence',{name:`Takeover · ${base?'Original':`Revision ${state.revision}`} · ${new Date().toLocaleTimeString()}`,width:1280,height:720,fps});
      const track=seq.tracks.find(t=>t.type==='video');let offset=0;const clips=[];
      for(const s of state.shots){
        const clip=await call('add_clip_from_media',{media_id:cfg.mediaId,track_id:track.track_id,start_tc:timecode(offset,fps),source_in_tc:timecode(s.start,fps),source_out_tc:timecode(s.trimEnd,fps)});
        const l=s.look;clips.push({...s,clipId:clip.clip_id,audioId:clip.linked_audio_clip_id,outputStart:offset});
        if(l.zoom!==1)await call('set_clip_transform',{clip_id:clip.clip_id,scale_percent:l.zoom*100,position_x_percent:50+(0.5-l.target.x)*100*(l.zoom-1),position_y_percent:50+(0.5-l.target.y)*100*(l.zoom-1)});
        if(l.exposure!==0||l.contrast!==1||l.saturation!==1||l.temperature!==0)await call('set_color_grade',{clip_id:clip.clip_id,exposure:l.exposure,contrast:(l.contrast-1)*100,saturation:l.saturation*100,temperature:l.temperature/20});
        if(l.speed!==1){
          await call('set_clip_speed',{clip_id:clip.clip_id,speed:l.speed,ripple:false});
          if(clip.linked_audio_clip_id)await call('set_clip_speed',{clip_id:clip.linked_audio_clip_id,speed:l.speed,ripple:false});
        }
        offset+=Math.round((s.trimEnd-s.start)/l.speed*fps)/fps;
      }
      const captionRenders=[];
      for(const caption of captionSegments(state)){
        const duration=caption.end-caption.start;
        const graphic=await call('create_graphic',{name:`Caption · ${caption.text.slice(0,45)}`,html:captionGraphic(caption,duration),track_id:seq.tracks.filter(t=>t.type==='video')[1].track_id,start_tc:timecode(caption.start,fps)});
        captionRenders.push({captionId:caption.id,mediaId:graphic.media_id,clipId:graphic.clip_id,start:caption.start,end:caption.end});
      }
      await call('remove_empty_tracks');
      const id=randomUUID(),name=base?`original-${id.slice(0,8)}.mp4`:`revision-${state.revision}-${id.slice(0,8)}.mp4`;
      const output=path.join(root,'media',name);await mkdir(path.dirname(output),{recursive:true});
      onProgress('rendering');
      const receipt=await call('export_sequence',{sequence_id:seq.sequence_id,request_id:id,output_path:output,settings:{video_codec:'H264',audio_codec:'Aac',width:1280,height:720,fps,quality_mode:'crf',crf:22,video_bitrate_kbps:4000,audio_bitrate_kbps:128,range:{type:'full_sequence'}}});
      const deadline=Date.now()+120000;let status;
      do{
        status=await call('get_export_status',{job_id:receipt.job_id});
        const kind=status.status?.type??status.status;
        if(kind==='completed')break;
        if(['failed','cancelled'].includes(kind))throw new Error(`Native export ${kind}: ${JSON.stringify(status)}`);
        await new Promise(r=>setTimeout(r,400));
      }while(Date.now()<deadline);
      if((status.status?.type??status.status)!=='completed')throw new Error('Native export timed out');
      if((await stat(output)).size<1000)throw new Error('Native export produced an empty file');
      await writeFile(configPath,JSON.stringify({...cfg,sequenceId:seq.sequence_id},null,2));
      return {exportUrl:`/media/${name}`,sequenceId:seq.sequence_id,jobId:receipt.job_id,clips,captionRenders,duration:offset};
    }catch(e){
      // Every edit uses a fresh sequence: a failed attempt cannot damage the last successful one.
      if(previous)await call('open_sequence',{sequence_id:previous}).catch(()=>{});
      throw e;
    }
  }
  async function restore(state){
    await call('open_sequence',{sequence_id:state.sequenceId});
    const cfg=JSON.parse(await readFile(configPath,'utf8'));
    await writeFile(configPath,JSON.stringify({...cfg,sequenceId:state.sequenceId},null,2));
  }
  return {call,render,restore};
}
