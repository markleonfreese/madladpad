import test from 'node:test';
import assert from 'node:assert/strict';
import { makeProject, normaliseProject, nextQuantizedTime, nextBarTime, findRecorderMime, extensionForMime, findAudioRecorderMime, extensionForAudioMime, PAD_COUNT, MAX_SCENES, supportedMediaFile, isPadAudible, captureStepPosition, stepTriggerTime, midiFrequency, midiFile, estimateSyllables, MAX_TRANSCRIPT_WORDS, RAP_BAR_COUNT } from '../site/core.js';

test('initial layout has 12 visible pads and 16 backing slots', () => {
  const project = makeProject();
  assert.equal(PAD_COUNT[project.layout], 12);
  assert.equal(project.pads.length, 16);
  assert.equal(project.pads[0].steps.length, 16);
});
test('malformed project metadata is bounded and cannot inject extra pads', () => {
  const project = normaliseProject({layout: '100x100', bpm: 999, pads: [{pitch: -500, volume: 9, steps: [1,0]}]});
  assert.equal(project.layout, '3x4');
  assert.equal(project.bpm, 240);
  assert.equal(project.pads[0].pitch, -12);
  assert.equal(project.pads[0].volume, 1.5);
  assert.deepEqual(project.pads[0].steps.slice(0, 3), [true,false,false]);
});
test('quantisation schedules forward on 16th-note grid', () => {
  assert.equal(nextQuantizedTime(1.07, 0, 120, '1/16'), 1.125);
  assert.equal(nextQuantizedTime(1.07, 0, 120, 'off'), 1.07);
});
test('scene launch schedules on the next bar and scenes normalize safely',()=>{
  assert.equal(nextBarTime(.5,0,120),2);
  assert.equal(nextBarTime(2,0,120),2);
  assert.equal(nextBarTime(2.01,0,120),4);
  assert.equal(nextBarTime(2.01,0,60),4);
  const p=normaliseProject({scenes:[{name:'A'.repeat(60),pads:[{steps:[true],stepOffsets:[.25,3]}]},...Array.from({length:12},()=>({}))]});
  assert.equal(p.scenes.length,MAX_SCENES);
  assert.equal(p.scenes[0].name.length,32);
  assert.equal(p.scenes[0].pads[0].steps[0],true);
  assert.deepEqual(p.scenes[0].pads[0].stepOffsets.slice(0,2),[.25,.9999]);
  assert.deepEqual(makeProject().scenes,[]);
});
test('pattern capture can snap or retain timing offsets within a step',()=>{
  assert.deepEqual(captureStepPosition(.1,120,'nearest'),{step:1,offset:0});
  assert.deepEqual(captureStepPosition(.1,120,'off'),{step:0,offset:.8});
  assert.deepEqual(captureStepPosition(2.125,120,'off'),{step:1,offset:0});
  assert.deepEqual(captureStepPosition(-1,120,'off'),{step:0,offset:0});
  assert.equal(stepTriggerTime(5,120,.8),5.1);
  assert.equal(stepTriggerTime(5,120,2),5+.9999*.125);
});
test('legacy pads receive safe per-step timing offsets',()=>{
  const pad=normaliseProject({pads:[{steps:[true],stepOffsets:[.25,4,-2,'bad']}] }).pads[0];
  assert.equal(pad.stepOffsets.length,16);
  assert.deepEqual(pad.stepOffsets.slice(0,5),[.25,.9999,0,0,0]);
  assert.deepEqual(makeProject().pads[0].stepOffsets,Array(16).fill(0));
});
test('recorder preserves true video container rather than relabelling WebM as MP4', () => {
  const supported = type => type === 'video/webm;codecs=vp8,opus';
  const mime = findRecorderMime(supported);
  assert.equal(extensionForMime(mime), 'webm');
});
test('audio recorder picks a supported audio container and matching extension',()=>{
  const mime=findAudioRecorderMime(type=>type==='audio/webm;codecs=opus');
  assert.equal(mime,'audio/webm;codecs=opus');
  assert.equal(findAudioRecorderMime(()=>false),'');
  assert.equal(extensionForAudioMime('audio/mp4;codecs=mp4a.40.2'),'m4a');
  assert.equal(extensionForAudioMime('audio/ogg;codecs=opus'),'ogg');
  assert.equal(extensionForAudioMime(mime),'webm');
});
test('picker only imports recognised media types', () => {
  assert.equal(supportedMediaFile({type:'video/mp4'}), true);
  assert.equal(supportedMediaFile({type:'text/html'}), false);
});
test('track mute and solo state defaults for old packs and gates lanes correctly', () => {
  const pads=normaliseProject({pads:[{solo:true},{muted:true}]}).pads;
  assert.equal(pads[0].solo,true);assert.equal(pads[1].muted,true);assert.equal(pads[2].muted,false);
  assert.equal(isPadAudible(pads,0),true);assert.equal(isPadAudible(pads,1),false);assert.equal(isPadAudible(pads,2),false);
  const withoutSolo=normaliseProject({}).pads;withoutSolo[1].muted=true;
  assert.equal(isPadAudible(withoutSolo,0),true);assert.equal(isPadAudible(withoutSolo,1),false);
});
test('voice projects add bounded transcript, phrase, melody, tuning and rap data while old packs still load',()=>{
  const legacy=normaliseProject({});
  assert.equal(legacy.voice.melody.tuning,440);
  assert.equal(legacy.voice.rap.bars.length,RAP_BAR_COUNT);
  const voice=normaliseProject({voice:{transcripts:[{sourcePad:90,words:Array.from({length:MAX_TRANSCRIPT_WORDS+2},(_,i)=>({text:`w${i}`,start:i,end:i+.2,score:9}))}],phrases:[{gapMs:-5,crossfadeMs:999,words:[{text:'Hi',sourcePad:-2,start:0,end:1}]}],melody:{tuning:900,notes:[{midi:200,step:-1,duration:99}]},rap:{scheme:'NOPE',bars:['A'.repeat(600)]}}}).voice;
  assert.equal(voice.transcripts[0].sourcePad,15);
  assert.equal(voice.transcripts[0].words.length,MAX_TRANSCRIPT_WORDS);
  assert.equal(voice.transcripts[0].words[0].score,1);
  assert.equal(voice.phrases[0].words[0].sourcePad,0);
  assert.equal(voice.phrases[0].gapMs,0);
  assert.equal(voice.phrases[0].crossfadeMs,250);
  const defaultPhrase=normaliseProject({voice:{phrases:[{words:[{text:'Hi',start:0,end:1}]}]}}).voice.phrases[0];
  assert.deepEqual([defaultPhrase.gapMs,defaultPhrase.crossfadeMs],[35,0]);
  assert.equal(voice.melody.tuning,480);
  assert.deepEqual(voice.melody.notes[0],{midi:108,step:0,duration:16,word:''});
  assert.equal(voice.rap.scheme,'AABB');
  assert.equal(voice.rap.bars[0].length,500);
});
test('melody uses A4 tuning and exports a MIDI track; rap syllable counts remain a rough local heuristic',async()=>{
  assert.equal(midiFrequency(69),440);
  assert.equal(midiFrequency(69,432),432);
  assert.equal(estimateSyllables('Hello little music maker'),8);
  const file=midiFile([{midi:69,step:0,duration:4}],120,440);
  assert.equal(file.type,'audio/midi');
  const bytes=new Uint8Array(await file.arrayBuffer());
  assert.equal(new TextDecoder().decode(bytes.slice(0,4)),'MThd');
  assert.ok(new TextDecoder().decode(bytes).includes('MTrk'));
  assert.ok(bytes.includes(0x90)&&bytes.includes(0x80));
});
