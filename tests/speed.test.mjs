import test from 'node:test';
import assert from 'node:assert/strict';
import { makeProject, normaliseProject, copyPadSound } from '../site/core.js';
import { SamplerAudio } from '../site/audio.js';

test('legacy projects default speed to 1 and preserve pitch metadata', () => {
  const project = normaliseProject({pads:[{pitch:7}]});
  assert.equal(project.pads[0].speed, 1);
  assert.equal(project.pads[0].pitch, 7);
  assert.equal(normaliseProject({pads:[{speed:4}]}).pads[0].speed, 2);
  assert.equal(normaliseProject({pads:[{speed:0.1}]}).pads[0].speed, 0.5);
  assert.equal(makeProject().pads[0].speed, 1);
});

test('copying a clip preserves independent pad identity, patterns and mute state', () => {
  const project=makeProject();
  const source=project.pads[0],destination=project.pads[4];
  Object.assign(source,{name:'Kitchen rhythm',fileName:'take.webm',kind:'video',start:1.2,end:2.4,speed:1.3,pitch:5,volume:.7});
  source.steps[0]=true;source.muted=true;
  destination.steps[8]=true;destination.solo=true;
  const copied=copyPadSound(source,destination);
  assert.equal(copied.id,4);
  assert.equal(copied.name,'Kitchen rhythm copy');
  assert.deepEqual([copied.fileName,copied.kind,copied.start,copied.end,copied.speed,copied.pitch,copied.volume],['take.webm','video',1.2,2.4,1.3,5,.7]);
  assert.equal(copied.steps[0],false);
  assert.equal(copied.steps[8],true);
  assert.equal(copied.muted,false);
  assert.equal(copied.solo,true);
  assert.equal(source.name,'Kitchen rhythm','the original pad must not be changed');
  assert.throws(()=>copyPadSound(makeProject().pads[0],destination),/source media/i);
});

test('a held buffer sample stops on release, while a one-shot remains independent', () => {
  const nodes=[];
  const param=()=>({setValueAtTime(){},linearRampToValueAtTime(){}});
  const sampler=Object.create(SamplerAudio.prototype);
  sampler.context={currentTime:0,createBufferSource(){const node={playbackRate:param(),connect(){return this;},start(){},stop(){this.stopped=true;},disconnect(){}};nodes.push(node);return node;},createGain(){return {gain:param(),connect(){return this;},disconnect(){}};}};
  sampler.master={};sampler.sources=new Map([[0,{file:{},buffer:{duration:3}}]]);
  sampler.momentaryPlayback=new Map();sampler.demoEnabled=false;
  const pad={kind:'audio',start:0,end:2,speed:1,pitch:0,volume:.8};
  assert.equal(sampler.trigger(0,pad,()=>{},0),true);
  assert.equal(sampler.trigger(0,pad,()=>{},0,{momentary:true}),true);
  sampler.stopPadMomentary(0);
  assert.equal(nodes[0].stopped,undefined,'the tap one-shot should finish naturally');
  assert.equal(nodes[1].stopped,true,'a held sample should be gated on release');
  assert.equal(sampler.momentaryPlayback.size,0,'releasing a pad clears its gesture handle');
  sampler.stopPadMomentary(0);
});

test('speed alone sets media playbackRate while pitch metadata is ignored', async () => {
  const listeners=new Map();
  let resolveBoundaryPause;
  const boundaryPaused=new Promise(resolve=>{resolveBoundaryPause=resolve;});
  const element = {
    duration:10,currentTime:0,playbackRate:1,preservesPitch:false,pauseCount:0,
    addEventListener(type,listener){listeners.set(type,listener);},
    removeEventListener(type,listener){if(listeners.get(type)===listener)listeners.delete(type);},
    pause(){this.pauseCount++;if(this.pauseCount>=2)resolveBoundaryPause();},
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
  await Promise.race([boundaryPaused,new Promise(resolve=>setTimeout(resolve,500))]);
  assert.equal(element.pauseCount,2,'the selected end should pause the media element after playback starts');
});

test('pitched media fades at the selected boundary and resets its gain on retrigger',async()=>{
  const listeners=new Map();
  const gain={
    value:1,events:[],
    cancelScheduledValues(time){this.events.push(['cancel',time]);},
    setValueAtTime(value,time){this.value=value;this.events.push(['set',value,time]);},
    linearRampToValueAtTime(value,time){this.value=value;this.events.push(['ramp',value,time]);}
  };
  const element={
    duration:1,currentTime:0,playbackRate:1,preservesPitch:false,paused:true,
    addEventListener(type,listener){listeners.set(type,listener);},
    removeEventListener(type,listener){if(listeners.get(type)===listener)listeners.delete(type);},
    pause(){this.paused=true;},
    play(){this.paused=false;this.currentTime=1;listeners.get('timeupdate')?.();return Promise.resolve();}
  };
  const source={file:{},element,gain:{gain}};
  const sampler=Object.create(SamplerAudio.prototype);
  sampler.context={currentTime:3};sampler.sources=new Map([[0,source]]);sampler.demoEnabled=false;
  const pad={kind:'video',start:0,end:.5,speed:1,pitch:7,volume:.8};

  sampler.trigger(0,pad,()=>{},0);
  await new Promise(resolve=>setTimeout(resolve,10));
  sampler.trigger(0,pad,()=>{},0);
  await new Promise(resolve=>setTimeout(resolve,10));

  assert.deepEqual(gain.events.filter(event=>event[0]==='ramp').map(event=>event[1]),[.8,0,.8,0],
    'each media hit should fade to its pad level and fade out at the selected end');
  assert.equal(element.paused,true,'each ended media hit should leave the element stopped');
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
