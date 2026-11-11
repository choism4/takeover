import {SHOTS,SOURCE} from './footage.mjs';
export {SHOTS,SOURCE};
export const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

export function makeCue({text='',sourceTime=0,sessionTime=0,pointer=null,frame=null,signals=[]}) {
  if (![sourceTime,sessionTime].every(Number.isFinite)) throw new Error('Invalid cue time');
  return {id:globalThis.crypto.randomUUID(),text:String(text).trim(),sourceTime:Math.max(0,sourceTime),sessionTime:Math.max(0,sessionTime),pointer:pointer?{x:clamp(pointer.x,0,1),y:clamp(pointer.y,0,1)}:null,frame,signals};
}

export function pointerInVideo({x,y,width,height,videoWidth,videoHeight}) {
  if (![x,y,width,height,videoWidth,videoHeight].every(Number.isFinite)||Math.min(width,height,videoWidth,videoHeight)<=0) return null;
  const s=Math.min(width/videoWidth,height/videoHeight),w=videoWidth*s,h=videoHeight*s;
  const px=(x-(width-w)/2)/w,py=(y-(height-h)/2)/h;
  return px>=0&&px<=1&&py>=0&&py<=1?{x:px,y:py}:null;
}

const bounds={zoom:[1,1.8],exposure:[-1.5,1.5],contrast:[.5,1.6],saturation:[0,1.8],temperature:[-2000,2000],speed:[.5,2]};
export function normalizeEdit(edit,duration) {
  if(!Number.isFinite(duration)||duration<=0) throw new Error('Invalid media duration');
  if(!bounds[edit.action]&&!['hold','trim','reset','undo','clarify','caption'].includes(edit.action)) throw new Error('Unsupported edit action');
  const start=clamp(Number(edit.start??0),0,duration),end=clamp(Number(edit.end??duration),0,duration);
  if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start) throw new Error('Edit range must contain video');
  const result={...edit,start,end};
  if(bounds[edit.action]) {
    if(!Number.isFinite(edit.value)) throw new Error('Edit value must be finite');
    result.value=clamp(edit.value,...bounds[edit.action]);
  }
  if(edit.target) {
    if(!Number.isFinite(edit.target.x)||!Number.isFinite(edit.target.y)) throw new Error('Invalid target');
    result.target={x:clamp(edit.target.x,0,1),y:clamp(edit.target.y,0,1)};
  }
  return result;
}

export function parseDirection(cue,duration=8) {
  const text=String(cue.text??'').toLowerCase();
  const base={start:0,end:duration,cueId:cue.id,label:cue.text,target:cue.pointer??{x:.5,y:.5}};
  let action='clarify',value=0;
  if(/undo|되돌|취소/.test(text)) action='undo';
  else if(/reset|원래|초기화/.test(text)) action='reset';
  else if(/push in|closer|zoom in|가까|확대|당겨/.test(text)) {action='zoom';value=/more|더/.test(text)?1.3:1.18;}
  else if(/zoom out|넓게|축소/.test(text)) {action='zoom';value=1;}
  else if(/colder|cooler|차갑|차가운|시원/.test(text)) {action='temperature';value=-850;}
  else if(/warm|따뜻/.test(text)) {action='temperature';value=600;}
  else if(/less saturation|desaturat|채도.*낮|채도.*줄/.test(text)) {action='saturation';value=.72;}
  else if(/saturat|채도/.test(text)) {action='saturation';value=1.25;}
  else if(/contrast|대비/.test(text)) {action='contrast';value=/less|낮|줄/.test(text)? .9:1.22;}
  else if(/bright|밝게|밝아/.test(text)) {action='exposure';value=.35;}
  else if(/dark|어둡/.test(text)) {action='exposure';value=-.3;}
  else if(/faster|빠르|빠르게/.test(text)) {action='speed';value=1.3;}
  else if(/slower|느리|천천히/.test(text)) {action='speed';value=.75;}
  else if(/hold|stay|잠깐|멈춰|정지/.test(text)) action='hold';
  return normalizeEdit({...base,action,value},duration);
}

export function initialLook(){return {zoom:1,exposure:0,contrast:1,saturation:1,temperature:0,speed:1,target:{x:.5,y:.5}};}
export function applyLook(look,edit){
  if(edit.action==='reset') return initialLook();
  if(!Object.hasOwn(look,edit.action)) return {...look};
  return {...look,[edit.action]:edit.value,...(edit.action==='zoom'?{target:edit.target??look.target}:{})};
}

export function cssLook(look){
  const t=look.temperature/2000;
  return {filter:`brightness(${2**look.exposure}) contrast(${look.contrast}) saturate(${look.saturation}) sepia(${Math.abs(t)*.18}) hue-rotate(${t<0?180:0}deg)`,transform:`scale(${look.zoom})`,transformOrigin:`${look.target.x*100}% ${look.target.y*100}%`};
}

export function timecode(seconds,fps=30){
  if(!Number.isFinite(seconds)||seconds<0||!Number.isFinite(fps)||fps<=0) throw new Error('Invalid timecode');
  const n=Math.round(seconds*fps),rate=Math.round(fps),f=n%rate,s=Math.floor(n/rate);
  return [Math.floor(s/3600),Math.floor(s/60)%60,s%60,f].map(n=>String(n).padStart(2,'0')).join(':');
}

export function createState(){return {source:SOURCE,shots:SHOTS.map(s=>({...s,trimEnd:s.end,look:initialLook()})),captions:[],lastEdit:null,revision:0};}
export function shotAt(state,sourceTime){return state.shots.find(s=>sourceTime>=s.start&&sourceTime<s.end)??(sourceTime===state.shots.at(-1).end?state.shots.at(-1):null);}
export function reduceEdits(state,edits,cue={sourceTime:state.source.start}){
  if(!Array.isArray(edits)||!edits.length||edits.length>8) throw new Error('Provide one to eight edits');
  const next=structuredClone(state);
  for(const raw of edits){
    if(raw.action==='caption'){
      const captions=next.captions??=[],existing=raw.captionId?captions.find(c=>c.id===raw.captionId):null;
      if(raw.captionId&&!existing)throw new Error('Unknown caption');
      const text=raw.text,start=raw.start??existing?.start,end=raw.end??existing?.end;
      if(typeof text!=='string'||!text.trim()||text.length>300)throw new Error('Provide caption text between 1 and 300 characters');
      if(!Number.isFinite(start)||!Number.isFinite(end)||start<next.source.start||end>next.source.end||end-start<1/(next.source.fps??30))throw new Error('Caption interval must be within the source');
      const caption={id:existing?.id??globalThis.crypto.randomUUID(),text:text.trim(),start,end,fontSize:raw.fontSize??existing?.fontSize??48,x:raw.x??existing?.x??50,y:raw.y??existing?.y??85};
      if(!Number.isFinite(caption.fontSize)||caption.fontSize<16||caption.fontSize>96||![caption.x,caption.y].every(n=>Number.isFinite(n)&&n>=5&&n<=95))throw new Error('Invalid caption style');
      next.captions=existing?captions.map(c=>c.id===existing.id?caption:c):[...captions,caption];
      next.lastEdit={action:'caption',captionId:caption.id};continue;
    }
    const shot=raw.shotId?next.shots.find(s=>s.id===raw.shotId):shotAt(next,cue.sourceTime);
    if(!shot) throw new Error('Unknown shot or source time');
    const edit=normalizeEdit(raw,next.shots.at(-1).end-next.shots[0].start);
    if(['clarify','hold','undo'].includes(edit.action)) throw new Error('This action does not change an edit');
    if(edit.action==='trim'){
      if(!Number.isFinite(edit.value)) throw new Error('Invalid trim endpoint');
      shot.trimEnd=clamp(Math.round(edit.value*(state.source?.fps??30))/(state.source?.fps??30),shot.start+.2,shot.end);
    }else if(edit.action==='reset'){shot.look=initialLook();shot.trimEnd=shot.end;}
    else shot.look=applyLook(shot.look,edit);
    next.lastEdit={...edit,shotId:shot.id};
  }
  next.revision=state.revision+1;
  return next;
}
export function resolveFollowup(text,state,cue){
  const last=state.lastEdit,shot=shotAt(state,cue.sourceTime);
  if(!last||last.shotId!==shot?.id||!bounds[last.action]) return {action:'clarify'};
  const less=/back off|less|줄여|줄여줘|덜|너무|약하게/.test(text);
  if(!less&&!/more|더/.test(text)) return null;
  const neutral=initialLook()[last.action],current=shot.look[last.action];
  const steps={zoom:.1,exposure:.2,contrast:.1,saturation:.1,temperature:300,speed:.15};
  const delta=(current<neutral?-1:1)*steps[last.action]*(less?-1:1);
  return normalizeEdit({...last,value:Number((current+delta).toFixed(3))},6);
}
export function outputTimeForSource(state,sourceTime){
  let offset=0;
  for(const s of state.shots){
    if(sourceTime<=s.end) return offset+clamp(sourceTime-s.start,0,s.trimEnd-s.start)/s.look.speed;
    offset+=(s.trimEnd-s.start)/s.look.speed;
  }
  return offset;
}
export function sourcePointer(point,look){
  return {x:clamp((point.x-look.target.x)/look.zoom+look.target.x,0,1),y:clamp((point.y-look.target.y)/look.zoom+look.target.y,0,1)};
}
