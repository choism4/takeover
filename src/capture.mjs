import {makeCue} from './director.mjs';
export class CueCapture{
  anchor=null;frames=[];
  begin(sample){this.anchor=structuredClone(sample);}
  finish(text,current){const cue={...makeCue({...this.anchor??current,text}),endSessionTime:current.sessionTime};this.anchor=null;return cue;}
  frame(data,sessionTime){this.frames.push({data,sessionTime});this.frames=this.frames.filter(f=>f.sessionTime>=sessionTime-5).slice(-10);}
  context(now){return this.frames.filter(f=>f.sessionTime>=now-4).slice(-4);}
}
export class StrokeCapture{
  strokes=[];active=null;
  begin(sample,enabled){if(!enabled||!sample.pointer)return;this.active={sourceTime:sample.sourceTime,sessionTime:sample.sessionTime,points:[structuredClone(sample)]};this.strokes.push(this.active);this.strokes=this.strokes.slice(-30);}
  move(sample){if(this.active&&sample.pointer&&this.active.points.length<250)this.active.points.push(structuredClone(sample));}
  end(){this.active=null;}
  recent(sourceTime){return this.strokes.filter(s=>Math.abs(s.sourceTime-sourceTime)<.6);}
}
export function explicitTimecode(text){
  const m=String(text).match(/\b(\d{1,2}):(\d{2})(?::(\d{2}))?\b/);if(!m)return null;
  const parts=m.slice(1).filter(v=>v!==undefined).map(Number);if(parts.slice(1).some(v=>v>=60))return null;
  return parts.reduce((n,v)=>n*60+v,0);
}
