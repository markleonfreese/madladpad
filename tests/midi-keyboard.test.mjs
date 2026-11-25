import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeMidiMessage, midiInputTarget, createMidiKeyboard, appendMidiStepNote } from '../site/midi-keyboard.js';

test('note on, note off, velocity-zero note on and all-notes-off decode on each channel',()=>{
  assert.deepEqual(decodeMidiMessage([0x93,60,101]),{type:'on',channel:3,midi:60,velocity:101});
  assert.deepEqual(decodeMidiMessage([0x83,60,44]),{type:'off',channel:3,midi:60,velocity:44});
  assert.deepEqual(decodeMidiMessage([0x90,64,0]),{type:'off',channel:0,midi:64,velocity:0});
  assert.deepEqual(decodeMidiMessage([0xb2,123,0]),{type:'allOff',channel:2});
  assert.equal(decodeMidiMessage([0xb0,64,127]),null);
  assert.equal(decodeMidiMessage([0xf8]),null);
  assert.equal(decodeMidiMessage([0x90,60]),null);
  assert.equal(decodeMidiMessage([0x90,128,90]),null);
});
test('the melody editor takes priority over pad mappings; hidden screens and dialogs ignore MIDI',()=>{
  assert.equal(midiInputTarget('voice','melody-title',false,false),'melody');
  assert.equal(midiInputTarget('sounds','melody-title',false,false),'pads');
  assert.equal(midiInputTarget('beats','transcript-title',false,false),'pads');
  assert.equal(midiInputTarget('voice','rap-title',false,false),null);
  assert.equal(midiInputTarget('voice','melody-title',true,false),null);
  assert.equal(midiInputTarget('voice','melody-title',false,true),null);
});
test('held notes are polyphonic, velocity-sensitive and independent by device and channel',()=>{
  const starts=[],releases=[],keyboard=createMidiKeyboard({start:(note)=>{starts.push(note);return ()=>releases.push(note);}});
  keyboard.handle('a',[0x90,60,100]);keyboard.handle('a',[0x90,64,70]);
  keyboard.handle('b',[0x91,60,40]);keyboard.handle('a',[0x90,60,127]);
  assert.equal(starts.length,3);assert.equal(starts[0].velocity,100);
  keyboard.handle('a',[0x90,60,0]);assert.equal(releases.length,1);
  keyboard.handle('a',[0xb0,123,0]);assert.equal(releases.length,2);
  keyboard.stopAll();assert.equal(releases.length,3);
});
test('keyboard rejects pitches outside editable range and caps simultaneously held voices',()=>{
  let count=0;const keyboard=createMidiKeyboard({start:()=>{count++;return ()=>{};},maxVoices:2});
  keyboard.handle('a',[0x90,23,80]);keyboard.handle('a',[0x90,109,80]);
  keyboard.handle('a',[0x90,60,80]);keyboard.handle('a',[0x90,61,80]);keyboard.handle('a',[0x90,62,80]);
  assert.equal(count,2);
  keyboard.handle('a',[0x80,60,0]);keyboard.handle('a',[0x90,62,80]);assert.equal(count,3);
});
test('step entry writes played pitch and velocity, advances by the selected duration and bounds notes to the clip',()=>{
  const notes=[];
  const first=appendMidiStepNote(notes,0,16,60,101,2);
  assert.equal(first.nextStep,2);
  assert.deepEqual(notes,[{midi:60,step:0,duration:2,velocity:101,word:'',layer:'lead'}]);
  const last=appendMidiStepNote(notes,14,16,64,43,8);
  assert.equal(last.nextStep,16);assert.equal(notes[1].duration,2);assert.equal(notes[1].velocity,43);
  assert.equal(appendMidiStepNote(notes,16,16,60,100,4),null);
  assert.equal(notes.length,2);
});
test('step entry preserves existing notes and rejects invalid pitch, velocity and full lane',()=>{
  const original={midi:60,step:0,duration:4,velocity:90,word:'test',layer:'lead'};
  const notes=[original];
  assert.equal(appendMidiStepNote(notes,0,16,109,100,4),null);
  assert.equal(appendMidiStepNote(notes,0,16,60,0,4),null);
  assert.deepEqual(notes,[original]);
  const full=Array.from({length:128},()=>({...original}));
  assert.equal(appendMidiStepNote(full,0,16,60,100,4),null);
  assert.equal(full.length,128);
});
