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
  assert.equal(makeProject().pads[0].stepPlaybackMode,'full');
  assert.equal(normaliseProject({pads:[{stepPlaybackMode:'one-step'}]}).pads[0].stepPlaybackMode,'one-step');
  assert.equal(normaliseProject({pads:[{stepPlaybackMode:'loop'}]}).pads[0].stepPlaybackMode,'full');
});

test('a selected local demo plays with the global demo toggle off',()=>{
  const sampler=Object.create(SamplerAudio.prototype);
  Object.assign(sampler,{context:{currentTime:1},sources:new Map(),demoEnabled:false,momentaryPlayback:new Map()});
  const calls=[];sampler.playDemoSound=(...args)=>calls.push(args);sampler.playDemo=()=>assert.fail('global fallback must not replace a per-pad selection');
  assert.equal(sampler.trigger(3,{demoSound:'sub-bass',volume:.7},()=>{},1.1,{momentary:true}),true);
  assert.deepEqual(calls,[['sub-bass',1.1,.7,null,3]]);
  assert.equal(sampler.momentaryPlayback.has(3),false,'a one-shot demo should not leave a hold gesture behind');
  assert.equal(sampler.trigger(4,{volume:.7},()=>{},1.1),false);
});

test('one-step buffer playback is capped by the remaining 16th-note window',()=>{
  const nodes=[];
  const param=()=>({value:1,events:[],cancelScheduledValues(time){this.events.push(['cancel',time]);},setValueAtTime(value,time){this.value=value;this.events.push(['set',value,time]);},linearRampToValueAtTime(value,time){this.value=value;this.events.push(['ramp',value,time]);}});
  const sampler=Object.create(SamplerAudio.prototype);
  sampler.context={currentTime:1,createBufferSource(){const node={playbackRate:param(),connect(){return this;},start(...args){this.startArgs=args;},stop(time){this.stopTime=time;},disconnect(){}};nodes.push(node);return node;},createGain(){return {gain:param(),connect(){return this;},disconnect(){}};}};
  sampler.master={};sampler.sources=new Map([[0,{file:{},buffer:{duration:3}}]]);sampler.demoEnabled=false;
  sampler.trigger(0,{kind:'audio',start:0,end:3,speed:2,pitch:0,volume:1},()=>{},1,{maxDuration:.125});
  assert.equal(nodes.length,1);
  assert.equal(nodes[0].startArgs[2],.25,'Web Audio source duration scales by Speed');
});

test('lookahead scheduling lets a same-pad hit sound until its scheduled retrigger',()=>{
  const nodes=[];
  const param=()=>({value:1,cancelScheduledValues(){},setValueAtTime(){},linearRampToValueAtTime(){}});
  const sampler=Object.create(SamplerAudio.prototype);
  sampler.context={currentTime:1,createBufferSource(){const node={playbackRate:param(),connect(){return this;},start(...args){this.startArgs=args;},stop(time){this.stopTime=time;},disconnect(){}};nodes.push(node);return node;},createGain(){return {gain:param(),connect(){return this;},disconnect(){}};}};
  sampler.master={};sampler.sources=new Map([[0,{file:{},buffer:{duration:3}}]]);sampler.demoEnabled=false;
  const pad={kind:'audio',start:0,end:3,speed:1,pitch:0,volume:1};
  sampler.trigger(0,pad,()=>{},1.1);
  sampler.trigger(0,pad,()=>{},1.2);
  assert.equal(nodes[0].stopTime,1.208,'a lookahead-scheduled retrigger should release the current hit at the new hit time, not silence it immediately');
  sampler.context.currentTime=1.15;
  sampler.stopAllPadVoices();
  assert.equal(nodes[0].stopTime,1.158,'Stop should shorten an active voice that was waiting for its scheduled retrigger');
  assert.equal(nodes[1].stopTime,1.15,'Stop should cancel the pending next hit immediately');
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

test('a held buffer sample stops on release and same-pad retriggers replace the previous hit', () => {
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
  assert.equal(nodes[0].stopped,true,'a new same-pad gesture should replace the previous voice');
  assert.equal(nodes[1].stopped,true,'a held sample should be gated on release');
  assert.equal(sampler.momentaryPlayback.size,0,'releasing a pad clears its gesture handle');
  sampler.stopPadMomentary(0);
});

test('buffer playback overlaps different pads but restarts the same pad with a short fade', () => {
  const nodes=[];
  const param=()=>({value:1,events:[],cancelScheduledValues(time){this.events.push(['cancel',time]);},setValueAtTime(value,time){this.value=value;this.events.push(['set',value,time]);},linearRampToValueAtTime(value,time){this.value=value;this.events.push(['ramp',value,time]);}});
  const sampler=Object.create(SamplerAudio.prototype);
  sampler.context={currentTime:1,createBufferSource(){const node={playbackRate:param(),connect(){return this;},start(...args){this.startArgs=args;},stop(time){this.stopTime=time;},disconnect(){}};nodes.push(node);return node;},createGain(){return {gain:param(),connect(){return this;},disconnect(){}};}};
  sampler.master={};sampler.sources=new Map([[0,{file:{},buffer:{duration:3}}],[1,{file:{},buffer:{duration:.5}}]]);sampler.demoEnabled=false;
  const pad=(end)=>({kind:'audio',start:0,end,speed:1,pitch:0,volume:1});

  sampler.trigger(0,pad(3),()=>{},1);
  sampler.trigger(1,pad(.5),()=>{},1.2);
  assert.equal(nodes[0].stopTime,undefined,'a different pad must not stop the three-second voice');
  sampler.context.currentTime=1.4;
  sampler.trigger(0,pad(3),()=>{},1.4);

  assert.equal(nodes.length,3,'each trigger should start one buffer voice');
  assert.equal(nodes[0].stopTime,1.408,'same-pad restart should allow a short fade before stopping');
  assert.equal(nodes[1].stopTime,undefined,'the other pad should remain polyphonic');
  assert.equal(typeof sampler.sources.get(0).stopPlayback,'function','the new voice remains independently stoppable');
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

test('media-element fallback keeps separate pad clips playing concurrently',async()=>{
  const makeElement=()=>{
    const listeners=new Map();
    return {duration:4,currentTime:0,playbackRate:1,preservesPitch:false,paused:true,playCount:0,pauseCount:0,
      addEventListener(type,listener){listeners.set(type,listener);},
      removeEventListener(type,listener){if(listeners.get(type)===listener)listeners.delete(type);},
      pause(){this.paused=true;this.pauseCount++;},
      play(){this.paused=false;this.playCount++;return Promise.resolve();}};
  };
  const first=makeElement(),second=makeElement();
  const sampler=Object.create(SamplerAudio.prototype);
  sampler.context={currentTime:1};sampler.sources=new Map([[0,{file:{},element:first,gain:{gain:{value:1}}}],[1,{file:{},element:second,gain:{gain:{value:1}}}]]);sampler.demoEnabled=false;
  const pad=end=>({kind:'video',start:0,end,speed:1,pitch:0,volume:1});

  sampler.trigger(0,pad(3),()=>{},1);
  sampler.trigger(1,pad(.5),()=>{},1);
  await new Promise(resolve=>setTimeout(resolve,10));

  assert.equal(first.playCount,1,'pad A should start its media element');
  assert.equal(second.playCount,1,'pad B should start without interrupting pad A');
  assert.equal(first.paused,false,'the long first clip should still be playing');
  assert.equal(second.paused,false,'the second clip should play at the same time');
  sampler.sources.get(0).stopPlayback?.();sampler.sources.get(1).stopPlayback?.();
});

test('one-step media fallback ends at the scheduled step boundary even at 2x speed',async()=>{
  const listeners=new Map();let position=0,startedAt=Date.now(),updates=null;
  const element={duration:5,playbackRate:1,preservesPitch:false,paused:true,lastPausedAt:null,
    get currentTime(){return this.paused?position:position+(Date.now()-startedAt)/1000*this.playbackRate;},
    set currentTime(value){position=value;startedAt=Date.now();},
    addEventListener(type,listener){listeners.set(type,listener);},removeEventListener(type,listener){if(listeners.get(type)===listener)listeners.delete(type);},
    pause(){if(!this.paused)position=this.currentTime;this.lastPausedAt=position;this.paused=true;clearInterval(updates);},
    play(){this.paused=false;startedAt=Date.now();updates=setInterval(()=>listeners.get('timeupdate')?.(),10);return Promise.resolve();}};
  const sampler=Object.create(SamplerAudio.prototype);sampler.context={currentTime:0};sampler.sources=new Map([[0,{file:{},element,gain:{gain:{value:1}}}]]);sampler.demoEnabled=false;
  sampler.trigger(0,{kind:'video',start:0,end:3,speed:2,pitch:0,volume:1},()=>{},0,{maxDuration:.125});
  await new Promise(resolve=>setTimeout(resolve,180));
  assert.equal(element.paused,true,'media fallback should stop at the one-step gate');
  assert.ok(element.lastPausedAt>=.2&&element.lastPausedAt<=.26,`2x media time should stay within the 250ms clip-time gate, got ${element.lastPausedAt}`);
});

test('stopping transport cancels a pending media-element start',async()=>{
  const element={duration:5,currentTime:0,playbackRate:1,preservesPitch:false,paused:true,playCount:0,addEventListener(){},removeEventListener(){},pause(){this.paused=true;},play(){this.paused=false;this.playCount++;return Promise.resolve();}};
  const sampler=Object.create(SamplerAudio.prototype);sampler.context={currentTime:1};sampler.sources=new Map([[0,{file:{},element,gain:{gain:{value:1}}}]]);sampler.demoEnabled=false;
  const visuals=[];
  sampler.trigger(0,{kind:'video',start:0,end:3,speed:1,pitch:0,volume:1},(...args)=>visuals.push(args),1.1);
  sampler.stopAllPadVoices();
  await new Promise(resolve=>setTimeout(resolve,120));
  assert.equal(element.playCount,0,'a stopped transport must not start a lookahead-scheduled media hit late');
  assert.deepEqual(visuals,[],'a stopped transport must not flash a pad after its scheduled hit was canceled');
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

test('decodable audio keeps low-latency buffer playback at Speed only and restarts the same pad', () => {
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
      const node={playbackRate:param(),connect(){return this;},start(...args){this.startArgs=args;},stop(time){this.stopTime=time;}};
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

  assert.equal(nodes.length,2,'each tap should create exactly one buffer voice');
  assert.equal(nodes[0].stopTime,.008,'same-pad retrigger should fade and stop the previous voice');
  assert.deepEqual(nodes.map(node=>node.playbackRate.events[0][1]),[1.5,1.5],
    'legacy pitch must not alter the Speed rate');
  assert.deepEqual(nodes.map(node=>node.startArgs),[[0,0,2],[0,0,2]]);
  assert.equal(mediaElement.pauseCount,0,'buffer voices should not be replaced by media-element playback');
});
