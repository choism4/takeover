export function captionSegments(state){
  const fps=state.source.fps,frame=n=>Math.round(n*fps)/fps,segments=[];
  for(const caption of state.captions??[]){
    let offset=0;
    for(const shot of state.shots){
      const a=Math.max(caption.start,shot.start),b=Math.min(caption.end,shot.trimEnd);
      if(b>a)segments.push({...caption,start:frame(offset+(a-shot.start)/shot.look.speed),end:frame(offset+(b-shot.start)/shot.look.speed)});
      offset+=frame((shot.trimEnd-shot.start)/shot.look.speed);
    }
  }
  return segments.filter(c=>c.end>c.start);
}

export function captionGraphic(caption,duration){
  const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;width:1280px;height:720px;background:transparent;overflow:hidden}
  #stage{width:1280px;height:720px;position:relative}
  #caption{position:absolute;left:${caption.x??50}%;top:${caption.y??85}%;transform:translate(-50%,-50%);max-width:88%;margin:0;text-align:center;font-family:Arial,Helvetica,sans-serif;font-size:${caption.fontSize??48}px;font-weight:750;letter-spacing:-1.2px;line-height:1.12;color:white;white-space:pre-wrap;overflow-wrap:anywhere;text-shadow:0 1px 5px #000,0 0 2px #000}
  </style></head><body><div id="stage" data-composition-id="caption" data-width="1280" data-height="720" data-duration="${duration}"><p id="caption" data-var="caption" data-label="Caption text">${escape(caption.text)}</p></div></body></html>`;
}
