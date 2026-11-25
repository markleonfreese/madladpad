import { clamp, MAX_MELODY_NOTES } from './core.js';

// Channel-voice messages only; no SysEx, MIDI output or implicit recording.
export function decodeMidiMessage(data){
  if(!data||data.length<3)return null;
  const [status,midi,velocity]=data;
  if(![status,midi,velocity].every(Number.isInteger)||status<128||status>239||midi<0||midi>127||velocity<0||velocity>127)return null;
  const kind=status&0xf0,channel=status&15;
  if(kind===0x90||kind===0x80)return {type:kind===0x90&&velocity>0?'on':'off',channel,midi,velocity};
  if(kind===0xb0&&(midi===120||midi===123))return {type:'allOff',channel};
  return null;
}
export function midiInputTarget(screen,tool,hidden,dialogOpen){
  if(hidden||dialogOpen)return null;
  if(screen==='voice'&&tool==='melody-title')return 'melody';
  return screen==='sounds'||screen==='beats'?'pads':null;
}
export function createMidiKeyboard({start,maxVoices=24}){
  const held=new Map();
  const release=key=>{const voice=held.get(key);if(voice){held.delete(key);voice.stop?.();}};
  return {
    handle(source,data){
      const msg=decodeMidiMessage(data);if(!msg)return;
      const device=String(source),key=JSON.stringify([device,msg.channel,msg.midi]);
      if(msg.type==='allOff'){
        for(const [id,voice] of held)if(voice.device===device&&voice.channel===msg.channel)release(id);
        return;
      }
      if(msg.type==='off'){release(key);return;}
      if(msg.midi<24||msg.midi>108||held.has(key)||held.size>=maxVoices)return;
      held.set(key,{device,channel:msg.channel,stop:start(msg)});
    },
    stopAll(){for(const key of held.keys())release(key);}
  };
}
export function appendMidiStepNote(notes,step,limit,midi,velocity,length){
  if(!Array.isArray(notes)||notes.length>=MAX_MELODY_NOTES||!Number.isInteger(step)||step<0||step>=limit||
    !Number.isInteger(midi)||midi<24||midi>108||!Number.isInteger(velocity)||velocity<1||velocity>127)return null;
  const duration=Math.min(clamp(Math.round(length)||4,1,16),limit-step);
  const note={midi,step,duration,velocity,word:'',layer:'lead'};
  notes.push(note);return {index:notes.length-1,nextStep:step+duration};
}
