import test from 'node:test';
import assert from 'node:assert/strict';
import {SamplerAudio} from '../site/audio.js';
import {effectivePitchSemitones,GranularPitchShifter} from '../site/pitch-dsp.js';

test('speed compensation keeps pitch independent for decoded audio',()=>{
  assert.equal(effectivePitchSemitones(0,1),0);
  assert.ok(Math.abs(effectivePitchSemitones(0,2)+12)<1e-9);
  assert.ok(Math.abs(effectivePitchSemitones(0,.5)-12)<1e-9);
  assert.ok(Math.abs(effectivePitchSemitones(-5,1.5)-(-12*Math.log2(1.5)-5))<1e-9);
});

test('Pitch is enabled only for empty pads or sources that can reach the processor',()=>{
  const sampler=Object.create(SamplerAudio.prototype);
  sampler.pitchReady=true;
  sampler.sources=new Map([
    [0,{file:null}],
    [1,{file:{type:'audio/wav'},buffer:{}}],
    [2,{file:{type:'video/webm'},mediaNode:{}}],
    [3,{file:{type:'video/webm'},element:{}}],
    [4,{file:{type:'image/png'}}],
    [5,{file:{type:'audio/wav'},buffer:{},pitchAvailable:false}]
  ]);
  assert.equal(sampler.canPitch(0),true);
  assert.equal(sampler.canPitch(1),true);
  assert.equal(sampler.canPitch(2),true);
  assert.equal(sampler.canPitch(3),false);
  assert.equal(sampler.canPitch(4),false);
  assert.equal(sampler.canPitch(5),false,'a failed per-source processor must disable Pitch');
  sampler.pitchReady=false;
  assert.equal(sampler.canPitch(1),false);
});

test('granular processor shifts frequency while preserving output duration',()=>{
  const rate=8000,total=rate*2,shifter=new GranularPitchShifter(rate,1),output=new Float32Array(total),block=128;
  for(let offset=0;offset<total;offset+=block){
    const count=Math.min(block,total-offset),input=[new Float32Array(count)],out=[new Float32Array(count)];
    for(let i=0;i<count;i++)input[0][i]=Math.sin(2*Math.PI*440*(offset+i)/rate);
    shifter.process(input,out,4);output.set(out[0],offset);
  }
  const first=rate,stop=total,segment=output.subarray(first,stop);let crossings=0;
  for(let i=1;i<segment.length;i++)if(segment[i-1]<=0&&segment[i]>0)crossings++;
  const measured=crossings/((stop-first)/rate);
  assert.ok(Math.abs(measured-440*2**(4/12))<35,`expected about 554 Hz; measured ${measured}`);
  assert.equal(output.length,total);
});

test('zero semitone mode is a sample-accurate bypass',()=>{
  const shifter=new GranularPitchShifter(8000,1),input=[Float32Array.from([-.5,-.25,0,.25,.5])],output=[new Float32Array(5)];
  shifter.process(input,output,0);assert.deepEqual([...output[0]],[...input[0]]);
});

test('buffer playback compensates Speed pitch and drains the processor after the trim',()=>{
  const param=()=>({events:[],setValueAtTime(value,time){this.events.push([value,time]);},linearRampToValueAtTime(){}});
  let voice;
  const sampler=Object.create(SamplerAudio.prototype);
  sampler.context={currentTime:0,sampleRate:8000,createBufferSource(){return voice={playbackRate:param(),connect(){return this;},start(...args){this.args=args;},disconnect(){}};},createGain(){return {gain:param(),connect(){return this;},disconnect(){}};}};
  sampler.master={};sampler.demoEnabled=false;sampler.pitchReady=true;
  let pitchParam;
  sampler.createPitchNode=()=>({parameters:new Map([['semitones',pitchParam=param()]]),connect(){return this;},disconnect(){}});
  sampler.sources=new Map([[0,{file:{},buffer:{duration:4},pitch:0}]]);
  sampler.trigger(0,{kind:'audio',start:0,end:2,speed:2,pitch:0,volume:1},()=>{},0);
  assert.equal(voice.playbackRate.events[0][0],2);
  assert.equal(pitchParam.events[0][0],-12,'one octave down offsets the doubled playback rate');
  assert.deepEqual(voice.args,[0,0,2.08],'processor gets 40 ms of input tail after the selected two-second region');
});

test('media-element Pitch remains independent of Speed with native or worklet compensation',()=>{
  const makeSampler=(element)=>{
    const events=[];
    const node={parameters:new Map([['semitones',{setValueAtTime(value,time){events.push([value,time]);}}]]),connect(){return this;},disconnect(){}};
    const source={file:{type:'video/webm'},element,mediaNode:{connect(){return this;},disconnect(){}},gain:{},pitchNode:null,pitch:0,speed:1,mediaRoute:'direct',pitchAvailable:true};
    const sampler=Object.create(SamplerAudio.prototype);
    sampler.context={currentTime:1};sampler.pitchReady=true;sampler.sources=new Map([[0,source]]);sampler.createPitchNode=()=>node;
    return {sampler,source,events};
  };

  const fallback=makeSampler({});
  assert.equal(fallback.sampler.setPadPitch(0,0,2,7),true);
  assert.equal(fallback.source.mediaRoute,'pitch');
  assert.deepEqual(fallback.events,[[-12,7]],'double Speed is compensated by one octave down');

  const preserved=makeSampler({webkitPreservesPitch:false});
  assert.equal(preserved.sampler.setPadPitch(0,4,2,9),true);
  assert.equal(preserved.source.element.webkitPreservesPitch,true);
  assert.deepEqual(preserved.events,[[4,9]],'native pitch preservation means only the requested Pitch is applied');

  const unavailable=makeSampler({});
  unavailable.sampler.createPitchNode=()=>null;
  assert.equal(unavailable.sampler.setPadPitch(0,0,2,11),false);
  assert.equal(unavailable.source.pitchAvailable,false);
  assert.equal(unavailable.sampler.canPitch(0),false,'Pitch is disabled after media routing fails');

  unavailable.source.element=null;
  unavailable.sampler.unload(0);
  assert.equal(unavailable.sampler.canPitch(0),true,'clearing the failed source restores Pitch capability for the empty pad');
});
