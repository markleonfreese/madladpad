import { clamp, MAX_MELODY_NOTES, MAX_MELODY_STEPS, MELODY_SCALES, melodyPositionLabel, midiNoteName } from './core.js';

const AXIS=84,TOP=22,ROW=16,ROWS=24,HEIGHT=TOP+ROW*ROWS,STEP=16;
const view={firstBar:1,bars:2,lowestMidi:48,drawLength:4,scaleGuide:true};
const PITCH_RANGES=[24,36,48,60,72,84,85];
export function scalePitchRole(midi,key=0,scale='major'){
  const root=clamp(Math.round(key),0,11),interval=(midi-root+12)%12;
  return interval===0?'root':(MELODY_SCALES[scale]||MELODY_SCALES.major).includes(interval)?'scale':'chromatic';
}
export function revealNote(current,note,maxBars){
  const next={...current},bar=Math.floor(note.step/16)+1;
  if(note.step+note.duration<=(next.firstBar-1)*16||note.step>=(next.firstBar-1+next.bars)*16)next.firstBar=clamp(bar,1,Math.max(1,maxBars-next.bars+1));
  if(note.midi<next.lowestMidi||note.midi>=next.lowestMidi+ROWS)next.lowestMidi=PITCH_RANGES.filter(low=>low<=note.midi&&note.midi<low+ROWS).sort((a,b)=>Math.abs(a-next.lowestMidi)-Math.abs(b-next.lowestMidi))[0]??next.lowestMidi;
  return next;
}
const svgElement=(name,attrs={})=>{
  const node=document.createElementNS('http://www.w3.org/2000/svg',name);
  for(const [key,value] of Object.entries(attrs))node.setAttribute(key,String(value));
  return node;
};

export function renderMelodyRoll(host,notes,onChange,onAudition,focusIndex,maxSteps=MAX_MELODY_STEPS,{key=0,scale='major'}={}){
  host.replaceChildren();
  const maxBars=Math.max(1,Math.ceil(maxSteps/STEP));view.bars=Math.min(view.bars,maxBars);view.firstBar=Math.min(view.firstBar,maxBars-view.bars+1);
  if(Number.isInteger(focusIndex)&&notes[focusIndex])Object.assign(view,revealNote(view,notes[focusIndex],maxBars));
  const toolbar=document.createElement('div');toolbar.className='melody-roll-toolbar';toolbar.setAttribute('role','group');toolbar.setAttribute('aria-label','Melody piano roll view');
  const barLabel=document.createElement('label');barLabel.textContent='FIRST BAR';
  const firstBar=document.createElement('input');firstBar.type='number';firstBar.min='1';firstBar.max=String(maxBars-view.bars+1);firstBar.value=String(view.firstBar);firstBar.inputMode='numeric';firstBar.setAttribute('aria-label','Piano roll first bar');barLabel.append(firstBar);
  const rangeLabel=document.createElement('label');rangeLabel.textContent='LOW NOTE';
  const range=document.createElement('select');range.setAttribute('aria-label','Piano roll lowest pitch');
  for(const midi of PITCH_RANGES){const option=document.createElement('option');option.value=String(midi);option.textContent=`${midiNoteName(midi)} · MIDI ${midi}`;range.append(option);}
  range.value=String(view.lowestMidi);rangeLabel.append(range);
  const barsLabel=document.createElement('label');barsLabel.textContent='VIEW';
  const bars=document.createElement('select');bars.setAttribute('aria-label','Piano roll bars in view');
  for(const count of [1,2,3,4].filter(count=>count<=maxBars)){const option=document.createElement('option');option.value=String(count);option.textContent=`${count} ${count===1?'bar':'bars'}`;bars.append(option);}
  bars.value=String(view.bars);barsLabel.append(bars);
  const durationLabel=document.createElement('label');durationLabel.textContent='TAP LENGTH';
  const duration=document.createElement('select');duration.setAttribute('aria-label','Piano roll tap note length');
  for(const [steps,label] of [[1,'1/16 note'],[2,'1/8 note'],[4,'1/4 note'],[8,'1/2 note'],[16,'Whole note']]){const option=document.createElement('option');option.value=String(steps);option.textContent=label;duration.append(option);}
  duration.value=String(view.drawLength);durationLabel.append(duration);
  const guide=document.createElement('button');guide.type='button';guide.className='pill-button';guide.textContent='Scale guide';guide.setAttribute('aria-pressed',String(view.scaleGuide));guide.setAttribute('aria-label','Show scale guidance in piano roll');
  const back=document.createElement('button');back.type='button';back.className='pill-button';back.textContent='‹';back.setAttribute('aria-label','Show earlier piano roll bars');
  const forward=document.createElement('button');forward.type='button';forward.className='pill-button';forward.textContent='›';forward.setAttribute('aria-label','Show later piano roll bars');
  const rangeText=document.createElement('output');rangeText.className='melody-roll-range';
  const render=focusIndex=>{
    view.firstBar=clamp(Math.round(view.firstBar),1,maxBars-view.bars+1);
    const lastBar=view.firstBar+view.bars-1,start=(view.firstBar-1)*16,end=start+view.bars*16,width=AXIS+view.bars*16*STEP;
    firstBar.value=String(view.firstBar);firstBar.max=String(maxBars-view.bars+1);range.value=String(view.lowestMidi);bars.value=String(view.bars);
    back.disabled=view.firstBar===1;forward.disabled=lastBar===maxBars;
    rangeText.textContent=`Bars ${view.firstBar}–${lastBar}`;
    const svg=svgElement('svg',{class:'melody-roll-svg',viewBox:`0 0 ${width} ${HEIGHT}`,preserveAspectRatio:'none',role:'group','aria-label':`Melody piano roll, bars ${view.firstBar} through ${lastBar}, pitches ${midiNoteName(view.lowestMidi)} to ${midiNoteName(view.lowestMidi+ROWS-1)}`});
    svg.append(svgElement('rect',{x:AXIS,y:TOP,width:width-AXIS,height:HEIGHT-TOP,fill:'#111812','data-roll-grid':'true'}));
    const high=view.lowestMidi+ROWS-1;
    guide.setAttribute('aria-pressed',String(view.scaleGuide));
    for(let row=0;row<ROWS;row++){
      const midi=high-row,y=TOP+row*ROW;
      const accidental=[1,3,6,8,10].includes(midi%12),role=view.scaleGuide?scalePitchRole(midi,key,scale):'off';
      const fill=role==='root'?'#2a3b25':role==='scale'?'#1d2a20':accidental?'#18211b':'#111812';
      svg.append(svgElement('rect',{x:AXIS,y,width:width-AXIS,height:ROW,fill,'pointer-events':'none','data-scale-role':role}));
      const pianoKey=svgElement('rect',{x:4,y:y+1,width:AXIS-8,height:ROW-2,rx:2,class:accidental?'melody-piano-key accidental':'melody-piano-key',role:'button',tabindex:row===0?0:-1,'data-piano-midi':midi,'aria-label':'Audition '+midiNoteName(midi),'aria-keyshortcuts':'ArrowUp ArrowDown Enter Space'});svg.append(pianoKey);
      const label=svgElement('text',{x:AXIS-10,y:y+12,'text-anchor':'end',class:accidental?'melody-piano-label accidental':'melody-piano-label','pointer-events':'none'});label.textContent=midiNoteName(midi)+(role==='root'?' · root':'');svg.append(label);
      svg.append(svgElement('line',{x1:AXIS,y1:y+ROW,x2:width,y2:y+ROW,class:'melody-roll-row'}));
    }
    const visibleSteps=view.bars*16;
    for(let step=0;step<=visibleSteps;step++){
      const x=AXIS+step*STEP,absolute=start+step;
      svg.append(svgElement('line',{x1:x,y1:TOP-2,x2:x,y2:HEIGHT,class:absolute%16===0?'melody-roll-bar':absolute%4===0?'melody-roll-beat':'melody-roll-step'}));
      if(step%16===0&&step<visibleSteps){const label=svgElement('text',{x:x+5,y:15,class:'melody-roll-bar-label'});label.textContent=`BAR ${Math.floor(absolute/16)+1}`;svg.append(label);}
    }
    const shown=notes.map((note,index)=>({note,index})).filter(({note})=>note.step<end&&note.step+note.duration>start&&note.midi>=view.lowestMidi&&note.midi<=high);
    for(const {note,index} of shown){
      const clippedStart=Math.max(start,note.step),clippedEnd=Math.min(end,note.step+note.duration),x=AXIS+(clippedStart-start)*STEP,y=TOP+(high-note.midi)*ROW,w=Math.max(3,(clippedEnd-clippedStart)*STEP-2);
      const group=svgElement('g',{'data-note-group':index});
      const noteRect=svgElement('rect',{x,y:y+1,width:w,height:ROW-2,rx:3,opacity:.3+.7*clamp(note.velocity??96,1,127)/127,class:note.layer==='harmony'?'melody-roll-note harmony':'melody-roll-note',role:'button',tabindex:0,'data-note-index':index,'aria-label':`${note.layer==='harmony'?'Harmony':'Lead'} ${midiNoteName(note.midi)} at ${melodyPositionLabel(note.step)}, length ${note.duration} sixteenth steps, velocity ${note.velocity??96} of 127. Arrow keys move; Shift plus left or right resizes; Enter auditions; Delete removes.`,'aria-keyshortcuts':'ArrowLeft ArrowRight ArrowUp ArrowDown Shift+ArrowLeft Shift+ArrowRight Enter Delete'});
      group.append(noteRect);
      const handle=svgElement('rect',{x:x+w-5,y:y+1,width:8,height:ROW-2,rx:2,class:'melody-roll-handle',role:'slider',tabindex:0,'data-resize-index':index,'aria-label':`Resize ${midiNoteName(note.midi)} note at ${melodyPositionLabel(note.step)}`,'aria-valuemin':'.125','aria-valuenow':note.duration,'aria-valuemax':maxSteps-note.step,'aria-keyshortcuts':'ArrowLeft ArrowRight'});
      group.append(handle);svg.append(group);
    }
    host.querySelector('.melody-roll-scroll')?.replaceChildren(svg);
    const status=host.querySelector('.melody-roll-status');
    status.textContent=shown.length?`${shown.length} note${shown.length===1?'':'s'} in this view. Tap to add a note, or drag across an empty row to choose its length. Tap a note to audition; drag to move or resize.`:'No notes in this view. Tap to add a note, or drag across an empty row to choose its length.';
    status.setAttribute('aria-label',status.textContent);
    if(Number.isInteger(focusIndex))host.querySelector(`[data-note-index="${focusIndex}"]`)?.focus();
    attachInteractions(svg,{notes,start,end,visibleSteps,width,high,onChange,onAudition,maxSteps,drawLength:view.drawLength});
  };
  toolbar.append(barLabel,rangeLabel,barsLabel,durationLabel,guide,back,forward,rangeText);
  const scroll=document.createElement('div');scroll.className='melody-roll-scroll';
  const status=document.createElement('p');status.className='melody-roll-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  host.append(toolbar,scroll,status);
  duration.addEventListener('change',()=>{view.drawLength=Number(duration.value);render();});
  guide.addEventListener('click',()=>{view.scaleGuide=!view.scaleGuide;render();});
  firstBar.addEventListener('change',()=>{view.firstBar=Number(firstBar.value);render();});
  range.addEventListener('change',()=>{view.lowestMidi=Number(range.value);render();});
  bars.addEventListener('change',()=>{view.bars=Number(bars.value);render();});
  back.addEventListener('click',()=>{view.firstBar-=view.bars;render();});
  forward.addEventListener('click',()=>{view.firstBar+=view.bars;render();});
  render(focusIndex);
}

export function attachInteractions(svg,{notes,start,end,width,high,onChange,onAudition,maxSteps,drawLength=4}){
  const position=event=>{const rect=svg.getBoundingClientRect();return {x:clamp((event.clientX-rect.left)/rect.width*width,AXIS,width),y:clamp((event.clientY-rect.top)/rect.height*HEIGHT,TOP,HEIGHT-1)};};
  const stepAt=point=>clamp(start+Math.floor((point.x-AXIS)/STEP),start,Math.min(end,maxSteps)-1);
  const pitchAt=point=>clamp(high-Math.floor((point.y-TOP)/ROW),24,108);
  let gesture=null;
  const paintNote=(index,note)=>{
    const group=svg.querySelector('[data-note-group="'+index+'"]');if(!group)return;
    const clippedStart=Math.max(start,note.step),clippedEnd=Math.min(end,note.step+note.duration),x=AXIS+(clippedStart-start)*STEP,y=TOP+(high-note.midi)*ROW,w=Math.max(3,(clippedEnd-clippedStart)*STEP-2);
    const shape=group.querySelector('[data-note-index]'),handle=group.querySelector('[data-resize-index]');
    shape.setAttribute('x',x);shape.setAttribute('y',y+1);shape.setAttribute('width',w);
    shape.setAttribute('aria-label',(note.layer==='harmony'?'Harmony':'Lead')+' '+midiNoteName(note.midi)+' at '+melodyPositionLabel(note.step)+', length '+note.duration+' sixteenth steps, velocity '+(note.velocity??96)+' of 127. Arrow keys move; Shift plus left or right resizes; Enter auditions; Delete removes.');
    handle.setAttribute('x',x+w-5);handle.setAttribute('y',y+1);handle.setAttribute('aria-valuenow',note.duration);
  };
  const paintDraw=g=>{
    const note=g.preview;
    for(const [key,value] of Object.entries({x:AXIS+(note.step-start)*STEP,y:TOP+(high-note.midi)*ROW+1,width:Math.max(3,(Math.min(end,note.step+note.duration)-note.step)*STEP-2),height:ROW-2,rx:3,class:'melody-roll-note',opacity:.45,'pointer-events':'none','aria-hidden':'true','data-draw-preview':'true'}))g.ghost.setAttribute(key,String(value));
  };
  const update=event=>{
    const g=gesture,point=position(event);
    if(g.kind==='draw'){
      const step=stepAt(point);
      if(step!==g.anchor)g.dragged=true;
      const first=g.dragged?Math.min(step,g.anchor):g.anchor;
      const duration=g.dragged?Math.abs(step-g.anchor)+1:drawLength;
      g.preview.step=first;g.preview.duration=Math.min(duration,maxSteps-first);
      paintDraw(g);return;
    }
    // The time axis starts after the piano keys: one grid STEP is one sixteenth.
    const deltaStep=Math.round((point.x-g.x)/STEP);
    const deltaPitch=Math.round((point.y-g.y)/ROW);
    const preview={...g.original};
    if(g.kind==='resize')preview.duration=clamp(g.original.duration+deltaStep,.125,maxSteps-g.original.step);
    else{
      preview.step=clamp(g.original.step+deltaStep,0,maxSteps-1);
      preview.midi=clamp(g.original.midi-deltaPitch,24,108);
      preview.duration=clamp(g.original.duration,.125,maxSteps-preview.step);
    }
    g.preview=preview;paintNote(g.index,preview);
  };
  svg.addEventListener('pointerdown',event=>{
    if(gesture||event.button!==0||event.isPrimary===false)return;
    const handle=event.target.closest('[data-resize-index]'),shape=event.target.closest('[data-note-index]');
    if(handle||shape){
      const index=Number((handle||shape).getAttribute(handle?'data-resize-index':'data-note-index')),note=notes[index],point=position(event);
      if(!note)return;
      gesture={kind:handle?'resize':'move',index,original:{...note},preview:{...note},x:point.x,y:point.y,pointerId:event.pointerId};
    }else{
      if(!event.target.closest('[data-roll-grid]'))return;
      if(notes.length>=MAX_MELODY_NOTES){const status=svg.parentElement.parentElement.querySelector('.melody-roll-status');status.textContent='The melody has reached its '+MAX_MELODY_NOTES+'-note limit.';return;}
      const point=position(event),step=stepAt(point);
      const ghost=svg.ownerDocument.createElementNS('http://www.w3.org/2000/svg','rect');
      gesture={kind:'draw',anchor:step,dragged:false,pointerId:event.pointerId,ghost,preview:{midi:pitchAt(point),step,duration:Math.min(drawLength,maxSteps-step),velocity:96,word:'',layer:'lead'}};
      svg.append(ghost);paintDraw(gesture);
    }
    svg.setPointerCapture(event.pointerId);event.preventDefault();
  });
  svg.addEventListener('pointermove',event=>{if(gesture&&gesture.pointerId===event.pointerId)update(event);});
  const finish=(event,commit)=>{
    if(!gesture||gesture.pointerId!==event.pointerId)return;
    if(commit)update(event);
    const g=gesture;gesture=null;
    if(g.kind==='draw')g.ghost.remove();
    else if(!commit)paintNote(g.index,g.original);
    if(svg.hasPointerCapture(event.pointerId))svg.releasePointerCapture(event.pointerId);
    if(!commit)return;
    if(g.kind==='draw'){notes.push(g.preview);onChange(notes.length-1);onAudition?.({...g.preview,duration:Math.min(4,g.preview.duration)});}
    else if(g.preview.step!==g.original.step||g.preview.midi!==g.original.midi||g.preview.duration!==g.original.duration){
      Object.assign(notes[g.index],g.preview);onChange(g.index);
    }else if(g.kind==='move')onAudition?.(notes[g.index]);
  };
  svg.addEventListener('pointerup',event=>finish(event,true));
  svg.addEventListener('pointercancel',event=>finish(event,false));
  svg.addEventListener('lostpointercapture',event=>finish(event,false));
  const auditionKey=key=>onAudition?.({midi:Number(key.getAttribute('data-piano-midi')),step:0,duration:2,velocity:96,word:'',layer:'lead'});
  svg.addEventListener('click',event=>{const key=event.target.closest('[data-piano-midi]');if(key)auditionKey(key);});
  svg.addEventListener('keydown',event=>{
    const key=event.target.closest('[data-piano-midi]');
    if(key){
      if(event.key==='Enter'||event.key===' '){event.preventDefault();auditionKey(key);}
      else if(event.key==='ArrowUp'||event.key==='ArrowDown'){
        event.preventDefault();const midi=Number(key.getAttribute('data-piano-midi'))+(event.key==='ArrowUp'?1:-1),next=svg.querySelector('[data-piano-midi="'+midi+'"]');
        if(next){key.setAttribute('tabindex','-1');next.setAttribute('tabindex','0');next.focus();}
      }
      return;
    }
    const handle=event.target.closest('[data-resize-index]'),shape=event.target.closest('[data-note-index]');if(!handle&&!shape)return;
    const index=Number((handle||shape).getAttribute(handle?'data-resize-index':'data-note-index')),note=notes[index];if(!note)return;
    if(event.key==='Enter'||event.key===' '){event.preventDefault();onAudition?.(note);return;}
    if(event.key==='Delete'||event.key==='Backspace'){event.preventDefault();notes.splice(index,1);onChange(Math.min(index,notes.length-1));return;}
    const resize=handle||event.shiftKey;
    if(event.key==='ArrowLeft'||event.key==='ArrowRight'){
      event.preventDefault();const delta=event.key==='ArrowLeft'?-1:1;
      if(resize)note.duration=clamp(note.duration+delta,.125,maxSteps-note.step);else {note.step=clamp(note.step+delta,0,maxSteps-1);note.duration=clamp(note.duration,.125,maxSteps-note.step);}
    }else if(!handle&&(event.key==='ArrowUp'||event.key==='ArrowDown')){
      event.preventDefault();note.midi=clamp(note.midi+(event.key==='ArrowUp'?1:-1),24,108);
    }else return;
    onChange(index);
  });
}
