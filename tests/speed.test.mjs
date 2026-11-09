import test from 'node:test';
import assert from 'node:assert/strict';
import { makeProject, normaliseProject } from '../site/core.js';
import { SamplerAudio } from '../site/audio.js';

test('legacy projects default speed to 1 and preserve pitch metadata', () => {
  const project = normaliseProject({pads:[{pitch:7}]});
  assert.equal(project.pads[0].speed, 1);
  assert.equal(project.pads[0].pitch, 7);
  assert.equal(normaliseProject({pads:[{speed:4}]}).pads[0].speed, 2);
  assert.equal(normaliseProject({pads:[{speed:0.1}]}).pads[0].speed, 0.5);
  assert.equal(makeProject().pads[0].speed, 1);
});

test('speed alone sets media playbackRate while pitch metadata is ignored', async () => {
  const listeners=new Map();
  const element = {
    duration:10,currentTime:0,playbackRate:1,preservesPitch:false,pauseCount:0,
    addEventListener(type,listener){listeners.set(type,listener);},
    removeEventListener(type,listener){if(listeners.get(type)===listener)listeners.delete(type);},
    pause(){this.pauseCount++;},
    play(){setTimeout(()=>{this.currentTime=.05;listeners.get('timeupdate')?.();},1);return Promise.resolve();}
  };
  const sampler = Object.create(SamplerAudio.prototype);
  sampler.context = {currentTime:0};
  sampler.sources = new Map([[0,{file:{},element,gain:{gain:{value:1}}}]]);
  sampler.demoEnabled = false;
  assert.equal(sampler.trigger(0,{kind:'video',start:0,end:0.05,speed:1.5,pitch:7,volume:1},()=>{},0),true);
  await new Promise(resolve=>setTimeout(resolve,15));
  assert.equal(element.playbackRate,1.5);
  assert.equal(element.preservesPitch,true);
  assert.equal(element.pauseCount,2,'the selected end should pause the media element after playback starts');
});

test('video playback reaches the selected end after delayed media startup', async () => {
  const listeners=new Map();let playbackTimer=null;
  const element={
    duration:10,currentTime:0,playbackRate:1,preservesPitch:false,paused:true,lastPausedAt:null,
    addEventListener(type,listener){listeners.set(type,listener);},
    removeEventListener(type,listener){if(listeners.get(type)===listener)listeners.delete(type);},
    pause(){
      if(!this.paused)this.lastPausedAt=this.currentTime;
      this.paused=true;clearInterval(playbackTimer);
    },
    play(){return new Promise(resolve=>setTimeout(()=>{
      this.paused=false;
      playbackTimer=setInterval(()=>{
        this.currentTime+=.015*this.playbackRate;
        listeners.get('timeupdate')?.();
      },10);
      resolve();
    },100));}
  };
  const sampler=Object.create(SamplerAudio.prototype);
  sampler.context={currentTime:0};
  sampler.sources=new Map([[0,{file:{},element,gain:{gain:{value:1}}}]]);
  sampler.demoEnabled=false;
  sampler.trigger(0,{kind:'video',start:0,end:.12,speed:1.5,pitch:0,volume:1},()=>{},0);
  await new Promise(resolve=>setTimeout(resolve,350));
  assert.equal(element.paused,true,'the video should stop at its selected end');
  assert.ok(element.lastPausedAt>=.1,`stop should follow media playback time, got ${element.lastPausedAt}`);
});

test('short trimmed media stops on media time without waiting for sparse timeupdate events', async () => {
  const listeners=new Map();let startedAt=0,position=0,updates=null;
  const element={
    duration:10,playbackRate:1,preservesPitch:false,paused:true,
    get currentTime(){return this.paused?position:position+(Date.now()-startedAt)/1000*this.playbackRate;},
    set currentTime(value){position=value;startedAt=Date.now();},
    addEventListener(type,listener){listeners.set(type,listener);},
    removeEventListener(type,listener){if(listeners.get(type)===listener)listeners.delete(type);},
    pause(){if(!this.paused)position=this.currentTime;this.paused=true;clearInterval(updates);},
    play(){this.paused=false;startedAt=Date.now();updates=setInterval(()=>listeners.get('timeupdate')?.(),250);return Promise.resolve();}
  };
  const sampler=Object.create(SamplerAudio.prototype);
  sampler.context={currentTime:0};
  sampler.sources=new Map([[0,{file:{},element,gain:{gain:{value:1}}}]]);
  sampler.demoEnabled=false;
  sampler.trigger(0,{kind:'video',start:0,end:.05,speed:1,pitch:0,volume:1},()=>{},0);
  await new Promise(resolve=>setTimeout(resolve,180));
  assert.equal(element.paused,true,'the short selection should stop without a 250 ms timeupdate');
  assert.ok(position>=.035&&position<=.12,`stop should stay close to the 50 ms trim boundary, got ${position}`);
});

test('decodable audio keeps low-latency polyphonic buffer playback at Speed only', () => {
  const nodes=[];
  const param=()=>({
    events:[],
    setValueAtTime(value,time){this.events.push(['set',value,time]);},
    linearRampToValueAtTime(value,time){this.events.push(['ramp',value,time]);}
  });
  const sampler=Object.create(SamplerAudio.prototype);
  sampler.context={
    currentTime:0,
    createBufferSource(){
      const node={playbackRate:param(),connect(){return this;},start(...args){this.startArgs=args;}};
      nodes.push(node);
      return node;
    },
    createGain(){return {gain:param(),connect(){return this;}};}
  };
  sampler.master={};
  sampler.demoEnabled=false;
  const mediaElement={pauseCount:0,pause(){this.pauseCount++;}};
  sampler.sources=new Map([[0,{file:{},buffer:{duration:4},element:mediaElement}]]);
  const pad={kind:'audio',start:0,end:2,speed:1.5,pitch:7,volume:1};

  sampler.trigger(0,pad,()=>{},0);
  sampler.trigger(0,pad,()=>{},0);

  assert.equal(nodes.length,2,'retriggering should create overlapping buffer voices');
  assert.deepEqual(nodes.map(node=>node.playbackRate.events[0][1]),[1.5,1.5],
    'legacy pitch must not alter the Speed rate');
  assert.deepEqual(nodes.map(node=>node.startArgs),[[0,0,2],[0,0,2]]);
  assert.equal(mediaElement.pauseCount,0,'buffer voices should not be replaced by media-element playback');
});
