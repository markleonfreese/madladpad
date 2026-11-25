import assert from 'node:assert/strict';
import test from 'node:test';
import { attachInteractions, scalePitchRole, revealNote } from '../site/melody-roll.js';

function makeNode(attrs={}) {
  return {
    attrs:{...attrs},children:[],
    setAttribute(key,value){this.attrs[key]=String(value);},
    getAttribute(key){return this.attrs[key]??null;},
    closest(selector){return selector.slice(1,-1) in this.attrs?this:null;},
    append(node){this.children.push(node);node.parent=this;},
    remove(){if(this.parent)this.parent.children=this.parent.children.filter(node=>node!==this);}
  };
}
function harness(notes=[],{bars=2,maxSteps=4096,start=0,drawLength=4}={}) {
  const width=84+bars*256,listeners={},changes=[],auditions=[],captures=new Set();
  const grid=makeNode({'data-roll-grid':'true'}),shape=makeNode({'data-note-index':'0'}),handle=makeNode({'data-resize-index':'0'});
  const group={querySelector:selector=>selector==='[data-note-index]'?shape:handle};
  const svg=Object.assign(makeNode(),{
    ownerDocument:{createElementNS:()=>makeNode()},
    parentElement:{parentElement:{querySelector:()=>({textContent:''})}},
    getBoundingClientRect:()=>({left:0,top:0,width:width/2,height:406}),
    addEventListener:(name,fn)=>{listeners[name]=fn;},
    querySelector:()=>group,
    setPointerCapture:id=>captures.add(id),
    hasPointerCapture:id=>captures.has(id),
    releasePointerCapture:id=>captures.delete(id)
  });
  attachInteractions(svg,{notes,start,end:start+bars*16,visibleSteps:bars*16,width,high:71,maxSteps,drawLength,onChange:index=>changes.push(index),onAudition:note=>auditions.push({...note})});
  const send=(name,step,target=grid,options={})=>{
    listeners[name]?.({pointerId:1,button:0,isPrimary:true,target,
      clientX:(84+(step+.5)*16)/2,clientY:22+16*4+8,preventDefault(){},...options});
  };
  return {send,grid,shape,handle,svg,changes,captures,auditions};
}
const lead=(step=4,duration=4)=>({midi:67,step,duration,velocity:96,word:'',layer:'lead'});

test('tap previews a default note and commits only on pointer release',()=>{
  const notes=[],h=harness(notes);
  h.send('pointerdown',4);
  assert.equal(notes.length,0);
  assert.equal(h.svg.children.length,1);
  assert.equal(h.changes.length,0);
  h.send('pointerup',4);
  assert.deepEqual(notes,[lead()]);
  assert.deepEqual(h.changes,[0]);
  assert.equal(h.svg.children.length,0);
  assert.equal(h.captures.size,0);
});

test('drag draws a snapped note of the chosen length in either direction',()=>{
  for(const [first,last] of [[4,9],[9,4]]){
    const notes=[],h=harness(notes);
    h.send('pointerdown',first);
    h.send('pointermove',last);
    assert.equal(notes.length,0);
    h.send('pointerup',last);
    assert.deepEqual(notes,[lead(4,6)]);
    assert.deepEqual(h.changes,[0]);
  }
});

test('cancelled drawing leaves the project unchanged',()=>{
  const notes=[],h=harness(notes);
  h.send('pointerdown',4);
  h.send('pointermove',8);
  h.send('pointercancel',8);
  assert.deepEqual(notes,[]);
  assert.deepEqual(h.changes,[]);
  assert.equal(h.svg.children.length,0);
  assert.equal(h.captures.size,0);
});

test('a four-cell drag moves exactly four steps at every zoom and commits once',()=>{
  for(const bars of [1,2,4]){
    const notes=[lead()],h=harness(notes,{bars});
    h.send('pointerdown',4,h.shape);
    h.send('pointermove',8,h.shape);
    assert.equal(notes[0].step,4);
    h.send('pointerup',8,h.shape);
    assert.equal(notes[0].step,8);
    assert.deepEqual(h.changes,[0]);
  }
});

test('resizing is exact, and cancelled or lost-capture edits do not persist',()=>{
  const notes=[lead()],h=harness(notes,{bars:1,maxSteps:16});
  h.send('pointerdown',7,h.handle);
  h.send('pointermove',11,h.handle);
  assert.equal(notes[0].duration,4);
  h.send('pointercancel',11,h.handle);
  assert.equal(notes[0].duration,4);
  assert.deepEqual(h.changes,[]);
  h.send('pointerdown',7,h.handle);
  h.send('pointermove',11,h.handle);
  h.send('lostpointercapture',11,h.handle);
  assert.equal(notes[0].duration,4);
  assert.deepEqual(h.changes,[]);
  h.send('pointerdown',7,h.handle);
  h.send('pointerup',11,h.handle);
  assert.equal(notes[0].duration,8);
  assert.deepEqual(h.changes,[0]);
});

test('drawing and moving stay within a MIDI clip boundary',()=>{
  const notes=[],h=harness(notes,{bars:1,maxSteps:16});
  h.send('pointerdown',14);
  h.send('pointerup',14);
  assert.deepEqual(notes,[lead(14,2)]);
  const move=harness(notes,{bars:1,maxSteps:16});
  move.send('pointerdown',14,move.shape);
  move.send('pointerup',15,move.shape);
  assert.deepEqual(notes,[lead(15,1)]);
});

test('right-click and a second pointer cannot change the active gesture',()=>{
  const notes=[],h=harness(notes);
  h.send('pointerdown',2,h.grid,{button:2});
  assert.equal(h.svg.children.length,0);
  h.send('pointerdown',4);
  h.send('pointerdown',9,h.grid,{pointerId:2,isPrimary:false});
  h.send('pointerup',9,h.grid,{pointerId:2,isPrimary:false});
  assert.deepEqual(notes,[]);
  h.send('pointerup',4);
  assert.deepEqual(notes,[lead()]);
});

test('tap length is configurable without changing drag-drawn durations',()=>{
  for(const length of [1,2,4,8,16]){
    const notes=[],h=harness(notes,{drawLength:length});
    h.send('pointerdown',4);h.send('pointerup',4);
    assert.deepEqual(notes,[lead(4,length)]);
  }
  const notes=[],h=harness(notes,{drawLength:16});
  h.send('pointerdown',4);h.send('pointermove',6);h.send('pointerup',6);
  assert.deepEqual(notes,[lead(4,3)]);
});
test('tap length respects clip end and auditions only a committed note',()=>{
  const notes=[],h=harness(notes,{bars:1,maxSteps:16,drawLength:8});
  h.send('pointerdown',14);h.send('pointercancel',14);
  assert.equal(h.auditions.length,0);
  h.send('pointerdown',14);h.send('pointerup',14);
  assert.deepEqual(notes,[lead(14,2)]);
  assert.equal(h.auditions.length,1);
  assert.equal(h.auditions[0].midi,67);
  assert.equal(h.auditions[0].duration,2);
});
test('piano-key audition never creates notes or modifies the project',()=>{
  const notes=[],h=harness(notes);
  const key=makeNode({'data-piano-midi':'60'});
  h.send('click',4,key);
  assert.deepEqual(notes,[]);
  assert.deepEqual(h.changes,[]);
  assert.equal(h.auditions.length,1);
  assert.equal(h.auditions[0].midi,60);
  assert.equal(h.auditions[0].word,'');
  h.send('keydown',4,key,{key:'Enter'});
  assert.equal(h.auditions.length,2);
});
test('scale guide identifies the root, scale tones and chromatic notes without transposing',()=>{
  assert.equal(scalePitchRole(60,0,'major'),'root');
  assert.equal(scalePitchRole(64,0,'major'),'scale');
  assert.equal(scalePitchRole(63,0,'major'),'chromatic');
  assert.equal(scalePitchRole(62,2,'natural-minor'),'root');
  assert.equal(scalePitchRole(65,2,'natural-minor'),'scale');
  assert.equal(scalePitchRole(66,2,'natural-minor'),'chromatic');
});
test('editing a note outside the viewport reveals its bar and pitch without changing the note',()=>{
  const view={firstBar:1,bars:2,lowestMidi:48};
  const note={...lead(1024,4),midi:108};
  assert.deepEqual(revealNote(view,note,256),{firstBar:65,bars:2,lowestMidi:85});
  assert.deepEqual(view,{firstBar:1,bars:2,lowestMidi:48});
  assert.equal(note.step,1024);
  assert.equal(note.midi,108);
  assert.deepEqual(revealNote(view,{...lead(4,4),midi:67},256),view);
});
