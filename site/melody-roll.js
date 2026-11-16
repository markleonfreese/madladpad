import { clamp, MAX_MELODY_NOTES, MAX_MELODY_STEPS, melodyPositionLabel, midiNoteName } from './core.js';

const AXIS=84,TOP=22,ROW=16,ROWS=24,HEIGHT=TOP+ROW*ROWS,STEP=16;
const view={firstBar:1,bars:2,lowestMidi:48};
const svgElement=(name,attrs={})=>{
  const node=document.createElementNS('http://www.w3.org/2000/svg',name);
  for(const [key,value] of Object.entries(attrs))node.setAttribute(key,String(value));
  return node;
};

export function renderMelodyRoll(host,notes,onChange,onAudition,focusIndex){
  host.replaceChildren();
  const toolbar=document.createElement('div');toolbar.className='melody-roll-toolbar';toolbar.setAttribute('role','group');toolbar.setAttribute('aria-label','Melody piano roll view');
  const barLabel=document.createElement('label');barLabel.textContent='FIRST BAR';
  const firstBar=document.createElement('input');firstBar.type='number';firstBar.min='1';firstBar.max=String(257-view.bars);firstBar.value=String(view.firstBar);firstBar.inputMode='numeric';firstBar.setAttribute('aria-label','Piano roll first bar');barLabel.append(firstBar);
  const rangeLabel=document.createElement('label');rangeLabel.textContent='LOW NOTE';
  const range=document.createElement('select');range.setAttribute('aria-label','Piano roll lowest pitch');
  for(const midi of [24,36,48,60,72,84]){const option=document.createElement('option');option.value=String(midi);option.textContent=`${midiNoteName(midi)} · MIDI ${midi}`;range.append(option);}
  range.value=String(view.lowestMidi);rangeLabel.append(range);
  const barsLabel=document.createElement('label');barsLabel.textContent='VIEW';
  const bars=document.createElement('select');bars.setAttribute('aria-label','Piano roll bars in view');
  for(const count of [1,2,4]){const option=document.createElement('option');option.value=String(count);option.textContent=`${count} ${count===1?'bar':'bars'}`;bars.append(option);}
  bars.value=String(view.bars);barsLabel.append(bars);
  const back=document.createElement('button');back.type='button';back.className='pill-button';back.textContent='‹';back.setAttribute('aria-label','Show earlier piano roll bars');
  const forward=document.createElement('button');forward.type='button';forward.className='pill-button';forward.textContent='›';forward.setAttribute('aria-label','Show later piano roll bars');
  const rangeText=document.createElement('output');rangeText.className='melody-roll-range';
  const render=focusIndex=>{
    view.firstBar=clamp(Math.round(view.firstBar),1,257-view.bars);
    const lastBar=view.firstBar+view.bars-1,start=(view.firstBar-1)*16,end=start+view.bars*16,width=AXIS+view.bars*16*STEP;
    firstBar.value=String(view.firstBar);firstBar.max=String(257-view.bars);range.value=String(view.lowestMidi);bars.value=String(view.bars);
    back.disabled=view.firstBar===1;forward.disabled=lastBar===256;
    rangeText.textContent=`Bars ${view.firstBar}–${lastBar}`;
    const svg=svgElement('svg',{class:'melody-roll-svg',viewBox:`0 0 ${width} ${HEIGHT}`,preserveAspectRatio:'none',role:'group','aria-label':`Melody piano roll, bars ${view.firstBar} through ${lastBar}, pitches ${midiNoteName(view.lowestMidi)} to ${midiNoteName(view.lowestMidi+ROWS-1)}`});
    svg.append(svgElement('rect',{x:AXIS,y:TOP,width:width-AXIS,height:HEIGHT-TOP,fill:'#111812','data-roll-grid':'true'}));
    const high=view.lowestMidi+ROWS-1;
    for(let row=0;row<ROWS;row++){
      const midi=high-row,y=TOP+row*ROW;
      if([1,3,6,8,10].includes(midi%12))svg.append(svgElement('rect',{x:AXIS,y,width:width-AXIS,height:ROW,fill:'#18211b','pointer-events':'none'}));
      if(midi%12===0){const label=svgElement('text',{x:AXIS-7,y:y+12,'text-anchor':'end',class:'melody-roll-key'});label.textContent=midiNoteName(midi);svg.append(label);}
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
      const handle=svgElement('rect',{x:x+w-5,y:y+1,width:8,height:ROW-2,rx:2,class:'melody-roll-handle',role:'slider',tabindex:0,'data-resize-index':index,'aria-label':`Resize ${midiNoteName(note.midi)} note at ${melodyPositionLabel(note.step)}`,'aria-valuemin':'.125','aria-valuenow':note.duration,'aria-valuemax':MAX_MELODY_STEPS-note.step,'aria-keyshortcuts':'ArrowLeft ArrowRight'});
      group.append(handle);svg.append(group);
    }
    host.querySelector('.melody-roll-scroll')?.replaceChildren(svg);
    const status=host.querySelector('.melody-roll-status');
    status.textContent=shown.length?`${shown.length} note${shown.length===1?'':'s'} in this view. Tap an empty row to add a note. Drag a note to move it and its right handle to resize it.`:'No notes in this view. Tap an empty row to add a note.';
    status.setAttribute('aria-label',status.textContent);
    if(Number.isInteger(focusIndex))host.querySelector(`[data-note-index="${focusIndex}"]`)?.focus();
    attachInteractions(svg,{notes,start,end,visibleSteps,width,high,onChange,onAudition});
  };
  toolbar.append(barLabel,rangeLabel,barsLabel,back,forward,rangeText);
  const scroll=document.createElement('div');scroll.className='melody-roll-scroll';
  const status=document.createElement('p');status.className='melody-roll-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  host.append(toolbar,scroll,status);
  firstBar.addEventListener('change',()=>{view.firstBar=Number(firstBar.value);render();});
  range.addEventListener('change',()=>{view.lowestMidi=Number(range.value);render();});
  bars.addEventListener('change',()=>{view.bars=Number(bars.value);render();});
  back.addEventListener('click',()=>{view.firstBar-=view.bars;render();});
  forward.addEventListener('click',()=>{view.firstBar+=view.bars;render();});
  render(focusIndex);
}

function attachInteractions(svg,{notes,start,end,visibleSteps,width,high,onChange,onAudition}){
  const position=event=>{const rect=svg.getBoundingClientRect();return {x:clamp((event.clientX-rect.left)/rect.width*width,AXIS,width),y:clamp((event.clientY-rect.top)/rect.height*HEIGHT,TOP,HEIGHT-1)};};
  let gesture=null;
  svg.addEventListener('pointerdown',event=>{
    const handle=event.target.closest('[data-resize-index]'),shape=event.target.closest('[data-note-index]');
    if(handle||shape){
      const index=Number((handle||shape).getAttribute(handle?'data-resize-index':'data-note-index')),note=notes[index],point=position(event);
      if(!note)return;
      gesture={kind:handle?'resize':'move',index,note,x:point.x,y:point.y,step:note.step,midi:note.midi,duration:note.duration};
      svg.setPointerCapture(event.pointerId);event.preventDefault();return;
    }
    if(!event.target.closest('[data-roll-grid]'))return;
    const point=position(event),row=clamp(Math.floor((point.y-TOP)/ROW),0,ROWS-1),step=clamp(start+Math.floor((point.x-AXIS)/STEP),start,end-1);
    if(notes.length>=MAX_MELODY_NOTES){const status=svg.parentElement.parentElement.querySelector('.melody-roll-status');status.textContent=`The melody has reached its ${MAX_MELODY_NOTES}-note limit.`;return;}
    notes.push({midi:high-row,step,duration:Math.min(4,MAX_MELODY_STEPS-step),velocity:96,word:'',layer:'lead'});
    onChange(notes.length-1);
  });
  svg.addEventListener('pointermove',event=>{
    if(!gesture)return;const point=position(event),deltaStep=Math.round((point.x-gesture.x)/width*visibleSteps);
    if(gesture.kind==='resize')gesture.note.duration=clamp(gesture.duration+deltaStep,.125,MAX_MELODY_STEPS-gesture.note.step);
    else {gesture.note.step=clamp(gesture.step+deltaStep,0,MAX_MELODY_STEPS-1);gesture.note.midi=clamp(gesture.midi-Math.round((point.y-gesture.y)/HEIGHT*HEIGHT/ROW),24,108);gesture.note.duration=clamp(gesture.duration,.125,MAX_MELODY_STEPS-gesture.note.step);}
    const group=svg.querySelector(`[data-note-group="${gesture.index}"]`);if(!group)return;
    const note=gesture.note,clippedStart=Math.max(start,note.step),clippedEnd=Math.min(end,note.step+note.duration),x=AXIS+(clippedStart-start)*STEP,y=TOP+(high-note.midi)*ROW,w=Math.max(3,(clippedEnd-clippedStart)*STEP-2);
    const shape=group.querySelector('[data-note-index]'),handle=group.querySelector('[data-resize-index]');
    shape.setAttribute('x',x);shape.setAttribute('y',y+1);shape.setAttribute('width',w);shape.setAttribute('aria-label',`${note.layer==='harmony'?'Harmony':'Lead'} ${midiNoteName(note.midi)} at ${melodyPositionLabel(note.step)}, length ${note.duration} sixteenth steps, velocity ${note.velocity??96} of 127. Arrow keys move; Shift plus left or right resizes; Enter auditions; Delete removes.`);
    handle.setAttribute('x',x+w-5);handle.setAttribute('y',y+1);handle.setAttribute('aria-valuenow',note.duration);
  });
  const finish=event=>{if(!gesture)return;const index=gesture.index;gesture=null;if(svg.hasPointerCapture(event.pointerId))svg.releasePointerCapture(event.pointerId);onChange(index);};
  svg.addEventListener('pointerup',finish);svg.addEventListener('pointercancel',finish);
  svg.addEventListener('keydown',event=>{
    const handle=event.target.closest('[data-resize-index]'),shape=event.target.closest('[data-note-index]');if(!handle&&!shape)return;
    const index=Number((handle||shape).getAttribute(handle?'data-resize-index':'data-note-index')),note=notes[index];if(!note)return;
    if(event.key==='Enter'||event.key===' '){event.preventDefault();onAudition?.(note);return;}
    if(event.key==='Delete'||event.key==='Backspace'){event.preventDefault();notes.splice(index,1);onChange(Math.min(index,notes.length-1));return;}
    const resize=handle||event.shiftKey;
    if(event.key==='ArrowLeft'||event.key==='ArrowRight'){
      event.preventDefault();const delta=event.key==='ArrowLeft'?-1:1;
      if(resize)note.duration=clamp(note.duration+delta,.125,MAX_MELODY_STEPS-note.step);else note.step=clamp(note.step+delta,0,MAX_MELODY_STEPS-1);
    }else if(!handle&&(event.key==='ArrowUp'||event.key==='ArrowDown')){
      event.preventDefault();note.midi=clamp(note.midi+(event.key==='ArrowUp'?1:-1),24,108);
    }else return;
    onChange(index);
  });
}
