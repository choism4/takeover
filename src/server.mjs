import http from 'node:http';
import {readFile,writeFile,mkdir,stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {createState,reduceEdits,makeCue,parseDirection,resolveFollowup,SOURCE} from './director.mjs';
import {explicitTimecode} from './capture.mjs';
import {createEngine} from './shoty.mjs';
import {createClaudePlanner} from './anthropic-planner.mjs';
import {createPlanner} from './planner.mjs';
const mime={'.html':'text/html; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.mp4':'video/mp4','.webm':'video/webm','.json':'application/json','.jpg':'image/jpeg','.png':'image/png','.woff2':'font/woff2','.mov':'video/quicktime'};
const fail=(code,message)=>Object.assign(new Error(message),{status:code});
async function body(req,limit=8e6){let length=0;const chunks=[];for await(const c of req){length+=c.length;if(length>limit)throw fail(413,'Request too large');chunks.push(c);}return Buffer.concat(chunks);}
export function createApp({root,apply,plan,initialState,restore,initialHistory=[],initialDirections=[],sourceFile=SOURCE.fileName}={}){
  const engine=createEngine(root);if(!apply)restore??=s=>engine.restore(s);apply??=(s,options)=>engine.render(s,options);plan??=process.env.CLAUDE_DZ_DEV_API_KEY?createClaudePlanner():createPlanner(root);
  let state=initialState??createState(),busy=false,phase='Ready',history=initialHistory,directions=initialDirections,currentDirection=null,lastPlan=null;
  const track=(status,extra={})=>{if(currentDirection)Object.assign(currentDirection,{status,updatedAt:new Date().toISOString(),...extra});phase={understanding:'Understanding direction',editing:'Editing video',rendering:'Rendering video'}[status]??status;};
  const snapshot=()=>({...state,directions,look:state.shots[0].look,busy,phase,history:history.map(h=>({revision:h.state.revision,message:h.message})),lastPlan});
  const persist=async()=>{await mkdir(path.join(root,'.runtime'),{recursive:true});await writeFile(path.join(root,'.runtime','state.json'),JSON.stringify({...state,_history:history,_directions:directions},null,2));};
  const commit=async(edits,cue,message)=>{
    let next;try{next=reduceEdits(state,edits,cue);}catch(e){throw fail(400,e.message);}
    track('editing');let result;try{result=await apply(next,{onProgress:status=>track(status)});}catch(e){throw fail(502,e.message);}
    history.push({state:structuredClone(state),message});state={...next,...result};await persist();
  };
  const undo=async()=>{
    if(!history.length)throw fail(400,'No successful edit to undo');
    const prev=history.at(-1).state;phase='Restoring previous revision';
    // Immutable native exports can be restored immediately; custom adapters may reapply.
    if(prev.exportUrl){try{await restore?.(prev);}catch(e){throw fail(502,e.message);}state=structuredClone(prev);}else{let r;try{r=await apply(prev);}catch(e){throw fail(502,e.message);}state={...prev,...r};}
    history.pop();await persist();
  };
  return http.createServer(async(req,res)=>{
    const json=(code,value)=>{res.writeHead(code,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(value));};
    try{
      if(!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host??''))throw fail(403,'Local connections only');
      const url=new URL(req.url,`http://${req.headers.host}`),route=url.pathname;
      if(req.method!=='GET'&&req.method!=='HEAD'){
        if(req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`)throw fail(403,'Cross-origin desktop control is blocked');
        if(req.headers['sec-fetch-site']==='cross-site')throw fail(403,'Cross-site request blocked');
      }
      if(route.startsWith('/api/')&&req.headers['sec-fetch-site']==='cross-site')throw fail(403,'Cross-site request blocked');
      if(req.method==='GET'&&route==='/api/state')return json(200,snapshot());
      if(req.method==='GET'&&route==='/api/demo')return json(200,JSON.parse(await readFile(path.join(root,'demo','sneaker-scenario.json'),'utf8')));
      if(req.method==='POST'&&route==='/api/demo/reset'){
        if(busy)throw fail(409,'Finish the current direction before resetting the demo');
        busy=true;
        try{
          const config=JSON.parse(await readFile(path.join(root,'.runtime','shoty.json'),'utf8'));
          if(!config.baselineSequenceId)throw fail(400,'Prepare the Nike demo baseline first');
          const original={...createState(),sequenceId:config.baselineSequenceId,exportUrl:'/media/source.mp4',duration:SOURCE.end-SOURCE.start};
          await restore?.(original);state=original;history=[];directions=[];lastPlan=null;await persist();return json(200,{...snapshot(),busy:false});
        }finally{busy=false;phase='Ready';}
      }
      if(req.method==='POST'&&['/api/direct','/api/apply','/api/undo'].includes(route)){
        if(busy)throw fail(409,'Another direction is still being applied');
        let data;try{data=JSON.parse((await body(req)).toString());}catch(e){throw e.status?e:fail(400,'Invalid JSON');}
        if(busy)throw fail(409,'Another direction is still being applied');
        busy=true;phase='Understanding direction';
        try{
          if(route==='/api/undo')await undo();
          else if(route==='/api/apply')await commit(data.edits,data.cue??{sourceTime:state.source.start+.8},'Manual adjustment');
          else{
            let cue;try{cue=makeCue(data.cue??{});}catch(e){throw fail(400,e.message);}
            cue.explicitTime=explicitTimecode(cue.text);
            if(!cue.text||cue.text.length>3000)throw fail(400,'Provide a short direction');
            if(!Array.isArray(data.frames??[])||(data.frames??[]).length>4)throw fail(400,'Provide up to four context frames');
            if(typeof data.cue?.id==='string'&&/^[a-f0-9-]{36}$/.test(data.cue.id))cue.id=data.cue.id;
            currentDirection={id:cue.id,text:cue.text,sourceTime:cue.sourceTime,explicitTime:cue.explicitTime,sessionTime:cue.sessionTime,pointer:cue.pointer,signals:cue.signals,frameUrls:[],status:'understanding',startedAt:new Date().toISOString()};directions.push(currentDirection);directions=directions.slice(-500);
            const frames=data.frames??[];
            const frameDir=path.join(root,'.runtime','directions',cue.id);await mkdir(frameDir,{recursive:true});
            for(const [i,frame]of frames.entries()){if(typeof frame!=='string'||!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(frame)||frame.length>1.5e6)throw fail(400,'Invalid context frame');await writeFile(path.join(frameDir,`${i}.jpg`),Buffer.from(frame.split(',')[1],'base64'));currentDirection.frameUrls.push(`/api/directions/${cue.id}/frames/${i}.jpg`);}
            if(data.mode==='text-fallback'){
              const edit=resolveFollowup(cue.text,state,cue)??parseDirection(cue,6);
              lastPlan={status:edit.action==='clarify'?'clarify':edit.action==='hold'?'hold':edit.action==='undo'?'undo':'edit',message:edit.action==='clarify'?'Try a specific zoom, color or speed instruction.':cue.text,edits:[edit],evidence:'Text-only fallback; no gesture interpretation.',provider:'Text fallback'};
            }else{try{lastPlan=await plan({cue,frames,state});}catch(e){throw fail(502,`AI interpreter unavailable. ${e.message}`);}}
            if(lastPlan.status==='undo')await undo();
            else if(lastPlan.status==='edit')await commit(lastPlan.edits,cue,lastPlan.message);
            else if(!['clarify','hold','replay'].includes(lastPlan.status))throw fail(400,'Invalid planner status');
          }
          if(currentDirection){track({edit:'applied',clarify:'clarify',hold:'held',undo:'undone',replay:'replaying'}[lastPlan?.status]??'applied',{message:lastPlan?.message,evidence:lastPlan?.evidence,finishedAt:new Date().toISOString(),revision:state.revision});await persist();}
          busy=false;phase='Ready';return json(200,{...snapshot(),status:lastPlan?.status??'edit'});
        }catch(e){track('failed',{error:e.message,finishedAt:new Date().toISOString()});await persist().catch(()=>{});throw e;}finally{busy=false;phase='Ready';currentDirection=null;}
      }
      if(req.method==='POST'&&route==='/api/sessions'){
        const data=JSON.parse((await body(req,16e6)).toString());
        if(!Array.isArray(data.cues)||data.cues.length>1000)throw fail(400,'Invalid session cues');
        const id=randomUUID();await mkdir(path.join(root,'.runtime','sessions'),{recursive:true});
        await writeFile(path.join(root,'.runtime','sessions',`${id}.json`),JSON.stringify({...data,id,savedAt:new Date().toISOString()},null,2));return json(201,{id,cues:data.cues.length});
      }
      if(req.method==='POST'&&route.startsWith('/api/recordings/')){
        const id=route.split('/').at(-1);if(!/^[a-f0-9-]{36}$/.test(id))throw fail(400,'Invalid recording ID');
        await stat(path.join(root,'.runtime','sessions',`${id}.json`));
        await writeFile(path.join(root,'.runtime','sessions',`${id}.${req.headers['content-type']?.includes('mp4')?'mp4':'webm'}`),await body(req,180e6));return json(201,{id});
      }
      if(!['GET','HEAD'].includes(req.method))throw fail(404,'Not found');
      let file;
      if(route==='/media/source.mp4')file=path.join(root,'media',sourceFile);
      else if(/^\/media\/(original(?:-[a-z0-9-]+)?|revision-[a-z0-9-]+)\.mp4$/.test(route))file=path.join(root,route.slice(1));
      else if(/^\/api\/directions\/[a-f0-9-]{36}\/frames\/[0-3]\.jpg$/.test(route)){const parts=route.split('/');file=path.join(root,'.runtime','directions',parts[3],parts[5]);}
      else if(/^\/fonts\/[a-z0-9-]+\.woff2$/.test(route))file=path.join(root,'public',route.slice(1));
      else if(route==='/brand/takeover-overline.png')file=path.join(root,'public','brand','takeover-overline.png');
      else if(/^\/demo\/(hero|water)\.png$/.test(route))file=path.join(root,'public',route.slice(1));
      else if(/^\/lib\/(director|capture|footage)\.mjs$/.test(route))file=path.join(root,'src',path.basename(route));
      else if(/^\/(?:index\.html|app\.mjs|demo-guide\.mjs|style\.css)?$/.test(route))file=path.join(root,'public',route==='/'?'index.html':route.slice(1));
      else throw fail(404,'Not found');
      const info=await stat(file);let start=0,end=info.size-1,status=200;
      if(req.headers.range){
        const m=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range);if(!m)throw fail(416,'Invalid byte range');
        if(!m[1]){start=Math.max(0,info.size-Number(m[2]));}else{start=Number(m[1]);end=m[2]?Math.min(end,Number(m[2])):end;}
        if(start>end||start>=info.size){res.setHeader('content-range',`bytes */${info.size}`);throw fail(416,'Range outside file');}status=206;
      }
      const headers={'content-type':mime[path.extname(file)]??'application/octet-stream','content-length':end-start+1,'accept-ranges':'bytes','cache-control':'no-store','x-content-type-options':'nosniff'};
      if(status===206)headers['content-range']=`bytes ${start}-${end}/${info.size}`;
      res.writeHead(status,headers);if(req.method==='HEAD')res.end();else createReadStream(file,{start,end}).pipe(res);
    }catch(e){if(!res.headersSent)json(e.status??(e.code==='ENOENT'?404:500),{error:e.message});else res.destroy();}
  });
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1])){
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');let initialState,initialHistory=[],initialDirections=[];
  try{const saved=JSON.parse(await readFile(path.join(root,'.runtime','state.json'),'utf8'));const {_history=[],_directions=[],...rest}=saved;if(rest.source?.fileName===SOURCE.fileName){initialState=rest;initialHistory=_history;initialDirections=_directions;}}catch{}
  const port=Number(process.env.PORT??4310);createApp({root,initialState,initialHistory,initialDirections}).listen(port,'127.0.0.1',()=>console.log(`Takeover → http://127.0.0.1:${port}`));
}
