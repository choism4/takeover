import {pointerInVideo,shotAt,outputTimeForSource,timecode,clamp,sourcePointer,SOURCE} from '/lib/director.mjs';
import {CueCapture,StrokeCapture,explicitTimecode} from '/lib/capture.mjs';
const $=s=>document.querySelector(s),source=$('#source'),result=$('#result'),camera=$('#camera'),stage=$('#stage');
const canvas=$('#composite'),ctx=canvas.getContext('2d'),capture=new CueCapture(),strokes=new StrokeCapture();
let pendingSourceTime=SOURCE.start+.8;
let state,mode='original',pointer=null,displayPointer=null,stream=null,listening=false,recognition=null,recorder=null,chunks=[],recordStart=0,sessionStart=performance.now(),speechRestart=0,rendering=false;
const cameraLive=()=>!!stream?.getVideoTracks().some(t=>t.readyState==='live');
let directing=false,lastPointerTime=-Infinity,sessionCueIds=new Set();
let cues=[],events=[],queue=[],processing=false,latestTranscript='',lastFrame=0,recordResolve;
const elapsed=()=>Math.max(0,(performance.now()-sessionStart)/1000);
const clock=s=>`${String(Math.floor(s/60)).padStart(2,'0')}:${String(Math.floor(s%60)).padStart(2,'0')}`;
const activeVideo=()=>mode==='original'?source:result;
function sourceTime(){
  if(mode==='edited'&&result.readyState<1)return pendingSourceTime;
  if(mode==='original')return clamp(source.currentTime,SOURCE.start,SOURCE.end);
  let offset=0;
  for(const s of state.shots){const len=Math.round((s.trimEnd-s.start)/s.look.speed*SOURCE.fps)/SOURCE.fps;if(result.currentTime<=offset+len)return s.start+(result.currentTime-offset)*s.look.speed;offset+=len;}
  return SOURCE.end;
}
const sample=()=>({sourceTime:sourceTime(),sessionTime:elapsed(),pointer:pointer?{...pointer}:null,displayPointer,signals:[{camera:cameraLive(),display:mode},{strokes:strokes.recent(sourceTime()).map(s=>({sourceTime:s.sourceTime,points:s.points.slice(-80).map(p=>({x:p.pointer.x,y:p.pointer.y,sessionTime:p.sessionTime}))}))}]});
function event(type,extra={}){if(events.length<20000)events.push({type,...sample(),...extra});}
function notice(text){$('#notice').textContent=text;$('#notice').hidden=!text;}
async function api(route,data){const r=await fetch(route,data===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});const d=await r.json();if(!r.ok)throw new Error(d.error??`Request failed (${r.status})`);return d;}
function setStatus(title,detail='',busy=false){$('#status').textContent=title;$('#detail').textContent=detail;$('.edit-status').classList.toggle('busy',busy);}
function updateState(next){
  const previousTime=state?sourceTime():SOURCE.start+.8;state=next;pendingSourceTime=previousTime;paintDirections(next.directions??[]);
  $('#scrub').min=SOURCE.start;$('#scrub').max=SOURCE.end-1/SOURCE.fps;
  $('.transport .muted').textContent=clock(SOURCE.end-SOURCE.start)+'.00';
  if(state.exportUrl&&!result.src.endsWith(state.exportUrl)){result.src=state.exportUrl;result.load();result.addEventListener('loadedmetadata',()=>{result.currentTime=outputTimeForSource(state,pendingSourceTime);},{once:true});}

}
function seek(t){
  pendingSourceTime=t;
  if(mode==='original')source.currentTime=t;
  else if(result.readyState>=1)result.currentTime=outputTimeForSource(state,t);
  else result.addEventListener('loadedmetadata',()=>{result.currentTime=outputTimeForSource(state,pendingSourceTime);},{once:true});
  event('seek',{toSourceTime:t});
}
function view(next){
  if(next===mode)return;const t=sourceTime(),wasPlaying=!activeVideo().paused;activeVideo().pause();mode=next;
  source.hidden=mode!=='original';result.hidden=mode!=='edited';
  if(mode==='edited'&&result.readyState<1)result.addEventListener('loadedmetadata',()=>{seek(t);if(wasPlaying)result.play().catch(()=>{});},{once:true});
  else{seek(t);if(wasPlaying)activeVideo().play().catch(()=>{});}event('view',{view:mode});
}
function togglePlay(){const v=activeVideo();if(v.paused){if(sourceTime()>=SOURCE.end-.05)seek(SOURCE.start);v.play().catch(e=>notice(e.message));}else v.pause();event('playback',{playing:!v.paused});}
$('#play').onclick=togglePlay;$('#big-play').onclick=e=>{e.stopPropagation();togglePlay();};
$('#scrub').oninput=e=>seek(Number(e.target.value));

source.addEventListener('loadedmetadata',()=>{source.currentTime=SOURCE.start+.8;});
source.addEventListener('timeupdate',()=>{if(source.currentTime>=SOURCE.end){source.pause();source.currentTime=SOURCE.end-.01;}});
source.addEventListener('error',()=>notice('Source footage is missing. Run the source setup instructions in README.'));
stage.onpointermove=e=>{
  const r=stage.getBoundingClientRect(),v=activeVideo();pointer=pointerInVideo({x:e.clientX-r.left,y:e.clientY-r.top,width:r.width,height:r.height,videoWidth:v.videoWidth,videoHeight:v.videoHeight});
  displayPointer=pointer;
  if(pointer&&mode==='edited'){const shot=shotAt(state,sourceTime());if(shot)pointer=sourcePointer(pointer,shot.look);}
  $('#reticle').hidden=!pointer;
  if(pointer){$('#reticle').style.left=`${e.clientX-r.left}px`;$('#reticle').style.top=`${e.clientY-r.top}px`;}
  strokes.move(sample());
  if(elapsed()-lastPointerTime>.1){event('pointer');lastPointerTime=elapsed();}
};
stage.onpointerdown=e=>{if(e.button!==0||e.target.closest('button'))return;if(directing){activeVideo().pause();stage.setPointerCapture(e.pointerId);strokes.begin(sample(),true);event('stroke-start');}};
stage.onpointerup=e=>{if(strokes.active){strokes.end();event('stroke-end');}if(stage.hasPointerCapture(e.pointerId))stage.releasePointerCapture(e.pointerId);};
stage.onpointercancel=()=>strokes.end();
// Keep the last pointed subject when moving into the transcript or controls.
stage.onpointerleave=()=>{$('#reticle').hidden=true;};
stage.onclick=e=>{if(e.target.tagName==='BUTTON')return;activeVideo().pause();event('point');};
document.addEventListener('keydown',e=>{if(/INPUT|TEXTAREA|SELECT/.test(e.target.tagName))return;if(e.code==='Space'){e.preventDefault();togglePlay();}});

async function enableCamera(){
  if(cameraLive())return stream;
  if(!navigator.mediaDevices?.getUserMedia)throw new Error('Camera capture is unavailable in this browser. Open Takeover in Chrome on localhost.');
  const acquired=await navigator.mediaDevices.getUserMedia({video:{width:{ideal:640},height:{ideal:480},facingMode:'user'},audio:stream?false:{echoCancellation:true,noiseSuppression:true}});
  if(stream)acquired.getVideoTracks().forEach(t=>stream.addTrack(t));else stream=acquired;
  camera.srcObject=stream;camera.hidden=false;$('#cam-empty').hidden=true;$('#cam-live').hidden=false;$('#cam-state').textContent='Live';$('#cam-state').classList.add('live');$('#stop-camera').hidden=false;
  stream.getVideoTracks()[0]?.addEventListener('ended',()=>{notice('Camera disconnected. Re-enable camera to capture gestures.');stream=null;$('#cam-state').textContent='Off';$('#cam-state').classList.remove('live');});
  await camera.play();event('camera-enabled');return stream;
}
$('#stop-camera').onclick=()=>{for(const track of stream?.getVideoTracks()??[]){track.stop();stream.removeTrack(track);}camera.srcObject=null;camera.hidden=true;$('#cam-empty').hidden=false;$('#cam-live').hidden=true;$('#cam-state').textContent='Off';$('#cam-state').classList.remove('live');$('#stop-camera').hidden=true;$('.webcam').classList.remove('directing');if(!directing){stream?.getTracks().forEach(t=>t.stop());stream=null;}};
$('#enable-cam').onclick=async()=>{try{await enableCamera();notice('');}catch(e){notice(`Camera/microphone: ${e.message}. Use Chrome if this embedded browser blocks access.`);}};
function setDirectingButton(active){
  const icon=active?'<rect x="5" y="5" width="14" height="14" rx="2"/>':'<path d="M20 4 8 9H4v6h4l12 5V4ZM8 15l2 6h4l-2-4M8 9v6"/>';
  $('#start').innerHTML=`<svg viewBox="0 0 24 24" aria-hidden="true">${icon}</svg><span>${active?'Stop directing':'Start directing'}</span>`;
  $('#start').classList.toggle('listening',active);$('.webcam').classList.toggle('directing',active);
}
function stopListening(){listening=false;clearTimeout(speechRestart);recognition?.stop();setDirectingButton(directing);$('#interim').textContent='';}
function startSpeech(){
  const Speech=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!Speech)throw new Error('Speech recognition is unavailable here. Open Takeover in Chrome.');
  recognition=new Speech();recognition.continuous=true;recognition.interimResults=true;recognition.lang=navigator.language||'en-US';
  recognition.onspeechstart=()=>capture.begin(sample());
  recognition.onresult=e=>{
    let interim='';
    for(let i=e.resultIndex;i<e.results.length;i++){
      const text=e.results[i][0].transcript.trim();
      if(e.results[i].isFinal&&text){const cue=capture.finish(text,sample());enqueue(cue);}
      else interim+=text;
    }
    $('#interim').textContent=interim?`“${interim}”`:'';
  };
  recognition.onerror=e=>{
    if(['not-allowed','service-not-allowed','audio-capture'].includes(e.error)){stopListening();notice(`Speech service: ${e.error}. Use Chrome if this embedded browser blocks speech.`);}
    else if(e.error!=='no-speech'&&e.error!=='aborted')notice(`Speech recognition: ${e.error}. Try restarting directing or use Chrome.`);
  };
  recognition.onend=()=>{if(listening)speechRestart=setTimeout(()=>{try{capture.anchor=null;recognition.start();}catch{}},400);};
  recognition.start();listening=true;setDirectingButton(true);event('listening-start');
}
$('#start').onclick=async()=>{
  if(directing){
    directing=false;stopListening();$('#start').disabled=true;
    try{
      if(processing||queue.length){setStatus('Finishing the current edit…','The session will save when rendering finishes.',true);while(processing||queue.length)await new Promise(r=>setTimeout(r,200));}
      if(recorder)await stopRecording();

    }catch(e){notice(e.message);}finally{$('#start').disabled=false;}
    return;
  }
  try{
    notice('');await enableCamera();
    try{await startRecording();}catch(e){notice(`Session recording: ${e.message}`);}
    directing=true;
    try{startSpeech();}catch(e){notice(e.message);}
    setDirectingButton(true);$('.edit-status').hidden=true;
  }catch(e){notice(e.message);}
};
const STATUS_ICONS={queued:'<circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/>',understanding:'<path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/>',editing:'<path d="m4 16 11-11 4 4L8 20H4v-4ZM13 7l4 4"/>',rendering:'<path d="M20 12a8 8 0 1 1-8-8"/>',applied:'<path d="m5 12 4 4L19 6"/>',clarify:'<circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 1 1 4 3v2M12 17h.01"/>',failed:'<circle cx="12" cy="12" r="9"/><path d="m8 8 8 8M16 8l-8 8"/>',held:'<path d="M8 5v14M16 5v14"/>',undone:'<path d="M8 4 3 9l5 5M3 9h10a7 7 0 0 1 7 7v3"/>'};
function statusBadge(row,status,label){
  const previous=row.dataset.status;row.dataset.status=status;const badge=row.querySelector('.cue-meta span:last-child');
  if(previous!==status||!badge.querySelector('svg')){badge.replaceChildren();const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');svg.innerHTML=STATUS_ICONS[status]??STATUS_ICONS.queued;const text=document.createElement('span');text.textContent=label;badge.append(svg,text);
    if(previous&&previous!==status&&!matchMedia('(prefers-reduced-motion: reduce)').matches){badge.animate([{transform:'translateY(0)'},{transform:'translateY(-5px) scale(1.04)',offset:.25},{transform:'translateX(-2px) rotate(-1deg)',offset:.5},{transform:'translateX(2px) rotate(1deg)',offset:.7},{transform:'none'}],{duration:390,easing:'ease-out'});navigator.vibrate?.(18);}
  }else badge.querySelector('span').textContent=label;
}
function cueRow(cue,frames=[],animate=false){
  $('#log-empty')?.remove();const row=document.createElement('details');row.className='cue pending';row.dataset.cue=cue.id;row.dataset.status='queued';
  const meta=document.createElement('div');meta.className='cue-meta';const time=document.createElement('button');time.className='cue-time';time.type='button';const targetTime=cue.explicitTime??cue.sourceTime;time.textContent=timecode(targetTime,SOURCE.fps);time.setAttribute('aria-label',`Seek to ${time.textContent}`);time.onclick=e=>{e.preventDefault();e.stopPropagation();seek(clamp(targetTime,SOURCE.start,SOURCE.end));};const tag=document.createElement('span');tag.textContent='QUEUED';meta.append(time,tag);
  const text=document.createElement('p');text.className='cue-text';text.setAttribute('aria-label',cue.text);if(animate&&!matchMedia('(prefers-reduced-motion: reduce)').matches){for(const [i,char]of [...cue.text].entries()){const span=document.createElement('span');span.textContent=char;span.setAttribute('aria-hidden','true');span.style.animationDelay=`${Math.min(i*8,450)}ms`;text.append(span);}}else text.textContent=cue.text;const response=document.createElement('small');response.textContent='';const evidence=document.createElement('small');evidence.className='evidence';const summary=document.createElement('summary');summary.append(text,meta);summary.addEventListener('click',()=>seek(clamp(targetTime,SOURCE.start,SOURCE.end)));const details=document.createElement('div');details.className='cue-details';details.append(response,evidence);for(const frame of frames.slice(-3)){const img=document.createElement('img');img.src=frame;img.alt='Captured source, pointer and director camera';details.append(img);}const raw=document.createElement('pre');raw.textContent=JSON.stringify({sourceTime:cue.sourceTime,sessionTime:cue.sessionTime,pointer:cue.pointer,signals:cue.signals},null,2);details.append(raw);row.append(summary,details);statusBadge(row,'queued','Queued');$('#log').append(row);$('#log').scrollTop=$('#log').scrollHeight;return row;
}
const statusLabels={queued:'Queued',understanding:'Understanding',editing:'Editing',rendering:'Rendering',applied:'Applied',clarify:'Needs clarification',held:'Holding',undone:'Undone',failed:'Failed'};
function paintDirections(items){
  for(const item of items){
    let row=document.querySelector(`[data-cue="${item.id}"]`);
    if(!row){row=cueRow(item,item.frameUrls??[]);if(!cues.some(c=>c.id===item.id))cues.push(item);}
    statusBadge(row,item.status,statusLabels[item.status]??item.status);
    row.classList.toggle('pending',['queued','understanding','editing','rendering'].includes(item.status));row.classList.toggle('error',item.status==='failed');
    row.querySelector('small').textContent=item.error??item.message??'';row.querySelector('.evidence').textContent=item.evidence??'';
  }
  $('#cue-count').textContent=String($('#log').children.length);
}
function enqueue(cue){
  cue.explicitTime=explicitTimecode(cue.text);
  const frames=capture.context(elapsed()).slice(stream?-3:-1).map(f=>f.data);cues.push({...cue,input:'speech'});sessionCueIds.add(cue.id);latestTranscript=cue.text;
  queue.push({cue,frames,row:cueRow(cue,frames,true),mode:'multimodal'});$('#cue-count').textContent=String(cues.length);pump();
}
async function pump(){
  if(processing)return;processing=true;
  while(queue.length){
    const {cue,frames,row,mode:interpretMode}=queue.shift();const tag=row.querySelector('.cue-meta span:last-child'),response=row.querySelector('small'),evidence=row.querySelector('.evidence');
    statusBadge(row,'understanding','Understanding');$('#queue-count').textContent=queue.length?`${queue.length} queued`:'';
    setStatus('Reading your direction…','Voice + source time + pointer + recent webcam frames',true);const start=performance.now();
    try{
      const next=await api('/api/direct',{cue,frames,mode:interpretMode});updateState(next);row.classList.remove('pending');
      const finalStatus={edit:'applied',clarify:'clarify',hold:'held',undo:'undone'}[next.status];statusBadge(row,finalStatus,statusLabels[finalStatus]??next.status);response.textContent=next.lastPlan?.message??'Applied';evidence.textContent=next.lastPlan?.evidence??'';
      const saved=cues.find(c=>c.id===cue.id);Object.assign(saved,{result:next.lastPlan,revision:next.revision,appliedAt:elapsed()});
      if(next.status==='edit'){setStatus('Direction applied.',next.lastPlan.message);view('edited');seek(cue.sourceTime);}
      else if(next.status==='hold'){activeVideo().pause();setStatus('Holding this moment.',next.lastPlan.message);}
      else if(next.status==='clarify')setStatus('One thing to clarify.',next.lastPlan.message);
      else setStatus('Previous edit restored.','Continue directing from here.');
    }catch(e){row.classList.remove('pending');row.classList.add('error');statusBadge(row,'failed','Failed');response.textContent=e.message;setStatus('Direction was not applied.',e.message);const saved=cues.find(c=>c.id===cue.id);saved.error=e.message;}
    $('#log').scrollTop=$('#log').scrollHeight;
  }
  processing=false;$('#queue-count').textContent='';
}


function contain(video,x,y,w,h,mirror=false){
  if(video.readyState<2||!video.videoWidth)return;const scale=Math.min(w/video.videoWidth,h/video.videoHeight),dw=video.videoWidth*scale,dh=video.videoHeight*scale;
  ctx.save();if(mirror){ctx.translate(x+w,y);ctx.scale(-1,1);ctx.drawImage(video,(w-dw)/2,(h-dh)/2,dw,dh);}else ctx.drawImage(video,x+(w-dw)/2,y+(h-dh)/2,dw,dh);ctx.restore();
}
function wrap(text,x,y,maxWidth,lineHeight,maxLines=3){
  let line='',n=0;for(const word of text.split(/(?<=\s)|(?=[\uac00-\ud7af])/)){if(ctx.measureText(line+word).width>maxWidth&&line){ctx.fillText(line,x,y+n*lineHeight);line='';if(++n>=maxLines)return;}line+=word;}ctx.fillText(line,x,y+n*lineHeight);
}
function drawStrokes(context,x,y,w,h){
  const v=activeVideo();if(!v.videoWidth)return;const scale=Math.min(w/v.videoWidth,h/v.videoHeight),dw=v.videoWidth*scale,dh=v.videoHeight*scale,ox=x+(w-dw)/2,oy=y+(h-dh)/2;
  context.save();context.strokeStyle='#ee6d5a';context.lineWidth=3;context.lineCap='round';context.lineJoin='round';
  for(const stroke of strokes.recent(sourceTime())){context.beginPath();for(const [i,p]of stroke.points.entries()){const q=p.displayPointer??p.pointer;if(i===0)context.moveTo(ox+q.x*dw,oy+q.y*dh);else context.lineTo(ox+q.x*dw,oy+q.y*dh);}context.stroke();}context.restore();
}
function drawComposite(){
  ctx.fillStyle='#111710';ctx.fillRect(0,0,1280,720);ctx.fillStyle='#d1f56a';ctx.font='bold 26px sans-serif';ctx.fillText('TAKEOVER / DIRECTING SESSION',28,40);
  ctx.font='12px monospace';ctx.fillStyle='#c0cbb4';ctx.fillText(`SOURCE ${timecode(sourceTime())}    SESSION +${clock(elapsed())}    ${mode.toUpperCase()}`,28,68);
  ctx.fillStyle='#050805';ctx.fillRect(20,90,890,501);contain(activeVideo(),20,90,890,501);drawStrokes(ctx,20,90,890,501);
  if(displayPointer){const v=activeVideo(),scale=Math.min(890/v.videoWidth,501/v.videoHeight),w=v.videoWidth*scale,h=v.videoHeight*scale,x=20+(890-w)/2+displayPointer.x*w,y=90+(501-h)/2+displayPointer.y*h;if(Number.isFinite(x)){ctx.strokeStyle='#d1f56a';ctx.lineWidth=2;ctx.beginPath();ctx.arc(x,y,15,0,Math.PI*2);ctx.stroke();ctx.fillStyle='#d1f56a';ctx.fillRect(x-2,y-2,4,4);}}
  ctx.fillStyle='#252e20';ctx.fillRect(930,90,330,248);contain(camera,930,90,330,248,true);
  ctx.font='11px monospace';ctx.fillStyle='#d1f56a';ctx.fillText(stream?'REAL DIRECTOR / LIVE':'CAMERA OFF',944,362);
  ctx.fillStyle='#edf2e7';ctx.font='20px sans-serif';wrap(latestTranscript||'Point to the moment. Say what you see.',944,402,296,29,6);
  ctx.fillStyle='#c0cbb4';ctx.font='18px sans-serif';wrap($('#status').textContent,28,635,1200,26,1);ctx.fillStyle='#899c79';ctx.font='14px sans-serif';wrap($('#detail').textContent,28,668,1200,20,2);
}
async function startRecording(){
  await enableCamera();if(!canvas.captureStream||!window.MediaRecorder)throw new Error('Recording is unavailable here. Open Takeover in Chrome.');
  if(processing||queue.length)throw new Error('Finish the current direction before starting a new take.');
  chunks=[];lastPointerTime=-Infinity;capture.anchor=null;sessionCueIds=new Set();sessionStart=performance.now();recordStart=performance.now();events=[];capture.frames=[];
  const tracks=[...canvas.captureStream(24).getVideoTracks(),...stream.getAudioTracks()];
  const type=['video/webm;codecs=vp8,opus','video/webm','video/mp4'].find(t=>MediaRecorder.isTypeSupported(t));
  recorder=new MediaRecorder(new MediaStream(tracks),type?{mimeType:type}:{});recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
  recorder.start(1000);$('#record-clock').hidden=false;event('record-start');
}
async function stopRecording(){
  event('record-stop');const r=recorder;const blob=await new Promise(resolve=>{r.onstop=()=>resolve(new Blob(chunks,{type:r.mimeType}));r.stop();});recorder=null;
  r.stream.getVideoTracks().forEach(t=>t.stop());$('#record-clock').hidden=true;
  const manifest={version:1,source:SOURCE,duration:elapsed(),cues:cues.filter(c=>sessionCueIds.has(c.id)),pointerEvents:events,state,recordingMime:blob.type,recordingAudio:'director microphone'};
  try{const saved=await api('/api/sessions',manifest);const upload=await fetch(`/api/recordings/${saved.id}`,{method:'POST',body:blob});if(!upload.ok)throw new Error('Recording upload failed');}catch(e){notice(`Server save failed: ${e.message}. The recording remains in memory until this page closes.`);}
}
setInterval(async()=>{if(processing)try{const s=await api('/api/state');paintDirections(s.directions??[]);if(s.busy)setStatus(s.phase,'Applying this sentence to the selected shot…',true);}catch{}},1000);
function tick(now){
  if(state){const t=sourceTime(),s=shotAt(state,t),v=activeVideo();$('#scrub').value=t;$('#play-time').textContent=`${clock(t-SOURCE.start)}.${String(Math.floor((t-SOURCE.start)%1*100)).padStart(2,'0')}`;
    const overlay=$('#strokes'),r=stage.getBoundingClientRect();if(overlay.width!==Math.round(r.width)||overlay.height!==Math.round(r.height)){overlay.width=Math.round(r.width);overlay.height=Math.round(r.height);}const oc=overlay.getContext('2d');oc.clearRect(0,0,overlay.width,overlay.height);drawStrokes(oc,0,0,overlay.width,overlay.height);
    stage.classList.toggle('playing',!v.paused);$('#play').textContent=v.paused?'▶':'Ⅱ';$('#session-clock').textContent=clock(elapsed());
    if(recorder)$('#record-clock').textContent=`● ${clock((now-recordStart)/1000)}`;
    if(recorder||now-lastFrame>900){drawComposite();if(now-lastFrame>900){capture.frame(canvas.toDataURL('image/jpeg',.6),elapsed());lastFrame=now;}}
  }requestAnimationFrame(tick);
}
try{updateState(await api('/api/state'));if(state.revision>0)view('edited');requestAnimationFrame(tick);}catch(e){notice(e.message);}
window.addEventListener('beforeunload',()=>{stopListening();stream?.getTracks().forEach(t=>t.stop());});
