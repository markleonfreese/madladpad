import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_SONG_BARS,
  makeProject,
  normaliseProject,
  normaliseSong,
  sampleNoteAtStep,
  songSectionAtStep,
  songTotalBars,
  songVideoPositionAtStep,
  localRecordingBudget,
  createBoundedRecordingCapture
} from '../site/core.js';
import { SamplerAudio } from '../site/audio.js';

class FakeParam {
  constructor(){this.value=0;this.events=[];}
  setValueAtTime(value,time){this.value=value;this.events.push({type:'set',value,time});}
  setTargetAtTime(value,time,constant){this.value=value;this.events.push({type:'target',value,time,constant});}
  cancelScheduledValues(time){this.events.push({type:'cancel',time});}
}
class FakeNode {
  constructor(){this.connections=[];this.gain=new FakeParam();this.threshold=new FakeParam();this.knee=new FakeParam();this.ratio=new FakeParam();this.attack=new FakeParam();this.release=new FakeParam();this.parameters=new Map();}
  connect(node){this.connections.push(node);return node;}
  disconnect(){this.connections=[];}
  start(...args){this.started=args;}
  stop(){this.stopped=true;}
}
class FakeAudioContext {
  constructor(){this.currentTime=4;this.destination=new FakeNode();this.nodes=[];}
  createGain(){const node=new FakeNode();this.nodes.push(node);return node;}
  createDynamicsCompressor(){const node=new FakeNode();this.nodes.push(node);return node;}
  createMediaStreamDestination(){return {stream:{getAudioTracks:()=>[]}};}
  createBufferSource(){const node=new FakeNode();this.nodes.push(node);return node;}
}

function scene(id,name,step){
  const pads=Array.from({length:16},()=>({steps:Array(16).fill(false),stepOffsets:Array(16).fill(0)}));
  pads[0].steps[step]=true;
  if(name==='A'){pads[0].sequenceMode='notes';pads[0].sampleNotes=[{step:0,length:4,semitones:0}];}
  if(name==='B'){pads[0].sequenceMode='notes';pads[0].sampleNotes=[{step:3,length:1,semitones:0},{step:4,length:1,semitones:0}];}
  return {id,name,gridDivision:'1/16',pads};
}

function makeJourney(){
  const base=makeProject();
  return normaliseProject({
    ...base,
    title:'Synthetic A-B-C-A acceptance',
    bpm:90,
    scenes:[scene('scene-a','A',0),scene('scene-b','B',4),scene('scene-c','C',8)],
    song:normaliseSong({clips:[
      {id:'a-intro',sceneId:'scene-a',bars:8},
      {id:'b-verse',sceneId:'scene-b',bars:16},
      {id:'c-bridge',sceneId:'scene-c',bars:4},
      {id:'a-return',sceneId:'scene-a',bars:8}
    ]}),
    voice:{
      ...base.voice,
      layers:[{id:'continuous-vocal',name:'Synthetic long vocal',origin:'import',startStep:5,trimStartSec:1,trimEndSec:83,gain:.75,muted:false,solo:false}],
      videoLayers:[{id:'continuous-video',name:'Synthetic camera clip',origin:'import',startStep:5,trimStartSec:1,trimEndSec:83,durationSec:90,includeAudio:true,audioGain:.8}]
    }
  });
}

test('A-B-C-A arrangement keeps stable scene links and exact transition boundaries',()=>{
  const project=makeJourney();
  assert.deepEqual(project.song.clips.map(clip=>[clip.id,clip.sceneId,clip.bars]),[
    ['a-intro','scene-a',8],['b-verse','scene-b',16],['c-bridge','scene-c',4],['a-return','scene-a',8]
  ]);
  assert.equal(project.scenes[0].id,'scene-a');
  assert.equal(project.scenes[1].gridDivision,'1/16','all saved scenes share the Song\'s sixteenth-note timing resolution');
  assert.equal(sampleNoteAtStep(project.scenes[0].pads[0].sampleNotes,0).length,4,'the A pattern keeps one joined note');
  assert.equal(sampleNoteAtStep(project.scenes[0].pads[0].sampleNotes,2),null,'a joined note does not add a second onset mid-gate');
  assert.ok(sampleNoteAtStep(project.scenes[1].pads[0].sampleNotes,3));
  assert.ok(sampleNoteAtStep(project.scenes[1].pads[0].sampleNotes,4),'adjacent separate notes retain a retrigger');
  assert.equal(songTotalBars(project.song),36);
  for(const [step,expectedScene,localStep,startBar,endBar] of [
    [0,'scene-a',0,1,9],[127,'scene-a',15,1,9],
    [128,'scene-b',0,9,25],[383,'scene-b',15,9,25],
    [384,'scene-c',0,25,29],[447,'scene-c',15,25,29],
    [448,'scene-a',0,29,37],[575,'scene-a',15,29,37]
  ]){
    const section=songSectionAtStep(project.song,project.scenes,step);
    assert.equal(section?.scene?.id,expectedScene,`scene at step ${step}`);
    assert.equal(section?.localStep,localStep,`local pattern step at ${step}`);
    assert.equal(section?.startBar,startBar,`start bar at ${step}`);
    assert.equal(section?.endBar,endBar,`exclusive end bar at ${step}`);
  }
  assert.equal(songSectionAtStep(project.song,project.scenes,576),null,'the 36-bar Song ends at step 576');
  const restored=normaliseProject(JSON.parse(JSON.stringify(project)));
  assert.deepEqual(restored.song.clips,project.song.clips,'serialised project recovery keeps the repeated stable scene link');
  assert.deepEqual(restored.voice.layers,project.voice.layers,'serialised recovery retains audio placement and trim');
  assert.deepEqual(restored.voice.videoLayers,project.voice.videoLayers,'serialised recovery retains video trim and opt-in gain');
});

test('one continuous trimmed audio take crosses every arrangement boundary without being split',()=>{
  const project=makeJourney();
  globalThis.window={AudioContext:FakeAudioContext};
  try{
    const audio=new SamplerAudio();
    const context=audio.context;
    const raw={duration:90,marker:'immutable synthetic source'};
    audio.vocalSources.set('continuous-vocal',{file:{name:'synthetic-long-vocal.wav'},buffer:raw});
    project.voice.layers.push({id:'muted-vocal',name:'Muted synthetic lane',startStep:0,trimStartSec:0,trimEndSec:null,gain:1,muted:true,solo:false,pitch:0});
    audio.vocalSources.set('muted-vocal',{file:{name:'muted.wav'},buffer:{duration:90}});
    audio.playVocalLayers(project.voice.layers,10,project.bpm);
    const starts=context.nodes.filter(node=>node.started);
    assert.equal(starts.length,1,'one Song track must create one continuous audio source, not one per section');
    assert.deepEqual(starts[0].started,[10+5*(60/90/4),1,82]);
    assert.equal(starts[0].buffer,raw,'the original decoded source remains the playback source');
    assert.equal(starts[0].connections.length,1);
    const scheduledGain=starts[0].connections[0].gain;
    assert.deepEqual(scheduledGain.events[0],{type:'set',value:.75,time:10+5*(60/90/4)});
    const endStep=5+82/(60/90/4);
    for(const boundary of [128,384,448])assert.ok(boundary<endStep,`audio remains continuous through section boundary ${boundary}`);
    project.voice.layers.push({id:'other-vocal',name:'Other synthetic lane',startStep:0,trimStartSec:0,trimEndSec:4,gain:.4,muted:false,solo:false,pitch:0});
    audio.vocalSources.set('other-vocal',{file:{name:'other.wav'},buffer:{duration:4}});
    project.voice.layers[0].solo=true;
    audio.playVocalLayers(project.voice.layers,10,project.bpm);
    assert.deepEqual([...audio.vocalPlayback.keys()],['continuous-vocal'],'solo playback excludes other tracks without splitting the chosen continuous take');
    project.voice.layers[0].muted=true;
    audio.updateVocalLayerStates(project.voice.layers);
    const activePlayback=audio.vocalPlayback.get('continuous-vocal');
    assert.equal(activePlayback.gain.gain.events.at(-1).value,0,'mute ramps the active take out of the master mix');
    audio.stopVocalLayers();
    assert.equal(starts[0].stopped,true,'Song transport stop releases the continuous take');
    assert.equal(audio.vocalSources.get('continuous-vocal').file.name,'synthetic-long-vocal.wav','the raw local file reference remains unchanged');
  } finally { delete globalThis.window; }
});

test('video placement and source audio trim are continuous across A-B-C-A and exclusive at trim-out',()=>{
  const project=makeJourney(),clip=project.voice.videoLayers[0];
  assert.equal(clip.includeAudio,true);
  assert.equal(clip.audioGain,.8);
  assert.equal(songVideoPositionAtStep(clip,4,project.bpm),null,'video waits until its Song placement step');
  assert.equal(songVideoPositionAtStep(clip,5,project.bpm),1,'placed video begins at its non-destructive source trim');
  for(const boundary of [128,384,448]){
    const expected=1+(boundary-5)*(60/90/4);
    assert.equal(songVideoPositionAtStep(clip,boundary,project.bpm),expected,`video source time remains continuous at Song step ${boundary}`);
  }
  const trimOutStep=5+(83-1)/(60/90/4);
  assert.equal(trimOutStep,497);
  assert.ok(songVideoPositionAtStep(clip,496,project.bpm)<83);
  assert.equal(songVideoPositionAtStep(clip,497,project.bpm),null,'trim-out is exclusive');
  assert.equal(project.voice.videoLayers[0].trimStartSec,1,'timeline playback does not rewrite source trim metadata');
  assert.equal(project.voice.videoLayers[0].durationSec,90,'raw video duration remains intact');
  const mutedDefault=normaliseProject({...project,voice:{...project.voice,videoLayers:[{id:'default-muted',durationSec:10}]}}).voice.videoLayers[0];
  assert.equal(mutedDefault.includeAudio,false,'new video track audio stays muted until a user opts in');
});

test('eighty bars at 80 BPM fit the project cap and represent a four-minute take',()=>{
  const song=normaliseSong({clips:[{id:'long-a',sceneId:'scene-a',bars:64},{id:'long-b',sceneId:'scene-b',bars:16}]});
  assert.equal(songTotalBars(song),80);
  assert.ok(songTotalBars(song)<=MAX_SONG_BARS);
  assert.equal(songTotalBars(song)*4*60/80,240);
  assert.equal(songTotalBars(song)*4*60/80/60,4);
});

test('the Song audio scheduler accepts one four-minute source without section-loop restarts',()=>{
  globalThis.window={AudioContext:FakeAudioContext};
  try{
    const audio=new SamplerAudio(),epoch=audio.context.currentTime;
    const source={duration:240,marker:'generated 80-bar test tone'};
    audio.vocalSources.set('four-minute-source',{file:{name:'synthetic-four-minute.wav'},buffer:source});
    audio.playVocalLayers([{id:'four-minute-source',startStep:0,trimStartSec:0,trimEndSec:240,gain:1,muted:false,solo:false}],epoch,80);
    const started=audio.context.nodes.filter(node=>node.started);
    assert.equal(started.length,1,'the complete arrangement uses one source node, not a section-by-section loop');
    assert.deepEqual(started[0].started,[epoch+.005,0,240],'the full take begins at the first safe sample after the transport epoch');
    assert.equal(started[0].buffer,source);
    audio.stopVocalLayers();
    assert.equal(started[0].stopped,true,'the full take can be released by the arrangement transport');
  } finally { delete globalThis.window; }
});

test('storage headroom bounds a long take and preserves only accepted complete chunks',()=>{
  const cap=localRecordingBudget(4*1024*1024,{usage:98*1024*1024,quota:100*1024*1024});
  assert.equal(cap,2*1024*1024-256*1024);
  const capture=createBoundedRecordingCapture(cap,cap);
  const accepted={size:cap-100};
  const rejected={size:200};
  assert.equal(capture.add(accepted),true);
  assert.equal(capture.add(rejected),false);
  assert.equal(capture.stoppedForStorage,true);
  assert.equal(capture.bytes,accepted.size);
  assert.deepEqual(capture.chunks,[accepted]);
});
