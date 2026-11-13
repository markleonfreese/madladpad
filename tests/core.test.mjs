import test from 'node:test';
import assert from 'node:assert/strict';
import { withModelReferrerPolicy } from '../site/voice-model-fetch.js';
import { makeProject, normaliseProject, normaliseVideoDirection, directedPads, VIDEO_ASPECTS, nextQuantizedTime, nextBarTime, findRecorderMime, extensionForMime, findAudioRecorderMime, extensionForAudioMime, audioBufferToWav, PAD_COUNT, MAX_SCENES, supportedMediaFile, isPadAudible, captureStepPosition, stepTriggerTime, stepGateDuration, stepLoopGateDuration, midiFrequency, midiNoteName, midiFile, estimateSyllables, MAX_TRANSCRIPT_WORDS, RAP_BAR_COUNT, videoVisualDurationMs, boundTranscriptWordTimes } from '../site/core.js';

test('Whisper model fetch omits the app referrer only for Hugging Face assets', async () => {
  const calls = [];
  const fetchModel = withModelReferrerPolicy(async (input, init) => {
    calls.push({ input, init });
    return new Response('ok');
  });
  await fetchModel('https://huggingface.co/Xenova/whisper-tiny.en/resolve/main/config.json', { cache: 'no-store' });
  await fetchModel('https://example.test/asset.json', { cache: 'no-store' });
  assert.deepEqual(calls[0].init, { cache: 'no-store', referrerPolicy: 'no-referrer' });
  assert.deepEqual(calls[1].init, { cache: 'no-store' });
});

test('transcript word timestamps stay inside the source clip and invalid words are discarded', () => {
  const words = boundTranscriptWordTimes([
    {text:'start',start:-.2,end:.4},
    {text:'middle',start:3.6,end:6.86},
    {text:'outside',start:5,end:7},
    {text:'zero span',start:1,end:1},
    {text:'bad time',start:NaN,end:2},
    {text:'   ',start:0,end:.5}
  ], 4.12);
  assert.deepEqual(words, [
    {text:'start',start:0,end:.4},
    {text:'middle',start:3.6,end:4.12}
  ]);
  assert.deepEqual(boundTranscriptWordTimes([{text:'word',start:0,end:1}], 0), []);
});

test('initial layout has 12 visible pads and 16 backing slots', () => {
  const project = makeProject();
  assert.equal(PAD_COUNT[project.layout], 12);
  assert.equal(project.pads.length, 16);
  assert.equal(project.pads[0].steps.length, 16);
  assert.equal(project.gridDivision,'1/16');
  assert.equal(project.demoEnabled,false);
});
test('demo sound mode survives project normalisation and older projects default it off',()=>{
  assert.equal(normaliseProject({demoEnabled:true}).demoEnabled,true);
  assert.equal(normaliseProject({}).demoEnabled,false);
});
test('per-pad demo choices persist only for sounds in the local bank',()=>{
  assert.equal(normaliseProject({pads:[{demoSound:'sub-bass'}]}).pads[0].demoSound,'sub-bass');
  assert.equal(normaliseProject({pads:[{demoSound:'https://example.test/sample.wav'}]}).pads[0].demoSound,'');
  assert.equal(normaliseProject({pads:[{}]}).pads[0].demoSound,'');
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
test('video composition holds each pad for the speed-adjusted playback duration',()=>{
  assert.equal(videoVisualDurationMs(0,2,1),2000);
  assert.equal(videoVisualDurationMs(0,2,2),1000);
  assert.equal(videoVisualDurationMs(.5,1.5,.5),2000);
  assert.equal(videoVisualDurationMs(1,1,1),180,'a zero-length sample still gets a brief visual flash');
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
  assert.equal(p.scenes[0].gridDivision,'1/16','legacy scenes should default to the full 16th-note grid');
  assert.equal(p.scenes[0].pads[0].stepPlaybackMode,'full','legacy scenes should preserve full-sample one-shot playback');
  const modeProject=normaliseProject({pads:[{stepPlaybackMode:'one-step'}],scenes:[{pads:[{stepPlaybackMode:'one-step'}]}]});
  assert.equal(modeProject.pads[0].stepPlaybackMode,'one-step');
  assert.equal(modeProject.scenes[0].pads[0].stepPlaybackMode,'one-step');
  assert.equal(normaliseProject({pads:[{stepPlaybackMode:'loop'}],scenes:[{pads:[{stepPlaybackMode:'loop'}]}]}).pads[0].stepPlaybackMode,'loop');
  assert.equal(normaliseProject({scenes:[{pads:[{stepPlaybackMode:'loop'}]}]}).scenes[0].pads[0].stepPlaybackMode,'loop');
  assert.equal(normaliseProject({gridDivision:'1/4',scenes:[{gridDivision:'1/8'}]}).gridDivision,'1/4');
  assert.equal(normaliseProject({gridDivision:'triplet'}).gridDivision,'1/16');
  assert.equal(normaliseProject({scenes:[{gridDivision:'1/8'}]}).scenes[0].gridDivision,'1/8');
  assert.equal(p.scenes[0].videoShots,null,'legacy scenes without a director keep using the project-level video direction');
  const directed=normaliseProject({scenes:[{videoShots:[{mode:'grid',pads:[0,1,99]},{mode:'invalid',pads:[2]}]}]}).scenes[0].videoShots;
  assert.equal(directed.length,16);
  assert.deepEqual(directed[0],{mode:'grid',pads:[0,1]});
  assert.deepEqual(directed[1],{mode:'auto',pads:[2]});
});

test('loop-held gate spans contiguous cells and the 15-to-0 bar wrap',()=>{
  const steps=Array(16).fill(false);steps[14]=steps[15]=steps[0]=steps[1]=true;
  assert.equal(stepLoopGateDuration(steps,14,120),.5);
  assert.equal(stepLoopGateDuration(steps,15,120),null,'a held run never restarts at step 15 after its step-14 start');
  assert.equal(stepLoopGateDuration(steps,0,120),null,'the same run does not retrigger at step 0 after wrapping');
  assert.equal(stepLoopGateDuration(steps,14,120,.5),.4375,'only the first-cell offset shortens the run');
  assert.equal(stepLoopGateDuration(steps,2,120),null,'a gap ends the held gate');
});

test('loop-held all-on patterns start once and remain held across bar wrap',()=>{
  const steps=Array(16).fill(true);
  assert.equal(stepLoopGateDuration(steps,0,120),null,'later bar wraps do not restart the sustained gate');
  assert.equal(stepLoopGateDuration(steps,1,120),null,'an all-on held pattern does not restart each step');
  assert.equal(stepLoopGateDuration(steps,0,120,0,true),Infinity,'transport starts the all-on gate at step zero');
  assert.equal(stepLoopGateDuration(steps,0,120,0,false),null);
});
test('pattern capture can snap or retain timing offsets within a step',()=>{
  assert.deepEqual(captureStepPosition(.1,120,'nearest'),{step:1,offset:0});
  assert.deepEqual(captureStepPosition(.1,120,'off'),{step:0,offset:.8});
  assert.deepEqual(captureStepPosition(2.125,120,'off'),{step:1,offset:0});
  assert.deepEqual(captureStepPosition(-1,120,'off'),{step:0,offset:0});
  assert.deepEqual(captureStepPosition(.24,120,'nearest',4),{step:0,offset:0});
  assert.deepEqual(captureStepPosition(.26,120,'nearest',4),{step:4,offset:0});
  assert.deepEqual(captureStepPosition(.13,120,'nearest',2),{step:2,offset:0});
  assert.deepEqual(captureStepPosition(1.99,120,'nearest',4),{step:0,offset:0},'coarse quantization wraps cleanly to the next bar');
  assert.deepEqual(captureStepPosition(.1,120,'off',4),{step:0,offset:.8},'free timing stays at sixteenth-note resolution');
  assert.equal(stepTriggerTime(5,120,.8),5.1);
  assert.equal(stepTriggerTime(5,120,2),5+.9999*.125);
  assert.equal(stepGateDuration(120),.125);
  assert.equal(stepGateDuration(120,.25),.09375);
  assert.equal(stepGateDuration(240),.0625);
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
test('voice projects add bounded transcripts, phrases, vocal layers, melody, tuning and rap data while old packs still load',()=>{
  const legacy=normaliseProject({});
  assert.equal(legacy.voice.melody.tuning,440);
  assert.equal(legacy.voice.rap.bars.length,RAP_BAR_COUNT);
  assert.equal(legacy.voice.rap.flow.length,RAP_BAR_COUNT);
  assert.equal(legacy.voice.rap.flow.every(bar=>bar.length===16&&bar.every(step=>step===false)),true);
  const voice=normaliseProject({voice:{transcripts:[{sourcePad:90,words:Array.from({length:MAX_TRANSCRIPT_WORDS+2},(_,i)=>({text:`w${i}`,start:i,end:i+.2,score:9}))}],phrases:[{gapMs:100,crossfadeMs:999,words:[{text:'Hi',sourcePad:-2,start:0,end:1}]}],melody:{tuning:900,notes:[{midi:200,step:-1,duration:99}]},rap:{scheme:'NOPE',bars:['A'.repeat(600)],flow:[[true,1,0],Array(20).fill(true)]}}}).voice;
  assert.equal(voice.transcripts[0].sourcePad,15);
  assert.equal(voice.transcripts[0].words.length,MAX_TRANSCRIPT_WORDS);
  assert.equal(voice.transcripts[0].words[0].score,1);
  assert.equal(voice.phrases[0].words[0].sourcePad,0);
  assert.equal(voice.phrases[0].gapMs,0);
  assert.equal(voice.phrases[0].crossfadeMs,250);
  const defaultPhrase=normaliseProject({voice:{phrases:[{words:[{text:'Hi',start:0,end:1}]}]}}).voice.phrases[0];
  assert.deepEqual([defaultPhrase.gapMs,defaultPhrase.crossfadeMs],[35,0]);
  assert.equal(voice.melody.tuning,480);
  assert.equal(voice.melody.harmonyInterval,3);
  assert.deepEqual(voice.melody.notes[0],{midi:108,step:0,duration:16,word:'',layer:'lead'});
  const harmony=normaliseProject({voice:{melody:{harmonyInterval:7,notes:[{midi:67,layer:'harmony'}]}}}).voice.melody;
  assert.equal(harmony.harmonyInterval,7);
  assert.equal(harmony.notes[0].layer,'harmony');
  const vocal=normaliseProject({voice:{layers:[{id:'vocal/one',name:'Lead',startStep:-2,gain:2,muted:true}]}}).voice.layers[0];
  assert.deepEqual(vocal,{id:'vocalone',name:'Lead',startStep:0,gain:1.5,muted:true,solo:false,sourceId:'vocalone',pitch:0});
  assert.equal(voice.rap.scheme,'AABB');
  assert.equal(voice.rap.bars[0].length,500);
  assert.equal(voice.rap.flow.length,RAP_BAR_COUNT);
  assert.equal(voice.rap.flow.every(bar=>bar.length===16),true);
  assert.deepEqual(voice.rap.flow[0].slice(0,4),[true,true,false,false]);
  assert.equal(voice.rap.flow[1].every(Boolean),true);
  assert.equal(voice.rap.flow[2].every(Boolean),false);
});
test('beat-directed video layout and aspect ratios are stored, bounded and backwards compatible',()=>{
  const p=makeProject();
  assert.equal(p.video.shots.length,16);
  assert.deepEqual(VIDEO_ASPECTS['9:16'],[540,960]);
  assert.deepEqual(directedPads({mode:'auto'},[2,3,2,-1],4),[2,3]);
  assert.deepEqual(directedPads({mode:'solo',pads:[3,1]},[1],4),[3]);
  assert.deepEqual(directedPads({mode:'grid',pads:[2,1,2,12]},[],4),[2,1]);
  assert.deepEqual(directedPads({mode:'black'},[1],4),[]);
  const sanitised=normaliseVideoDirection({aspect:'bad',shots:[{mode:'grid',pads:[2,2,17,-4,'5',0]}]});
  assert.equal(sanitised.aspect,'4:3');
  assert.deepEqual(sanitised.shots[0],{mode:'grid',pads:[2,0]});
  assert.equal(sanitised.shots.length,16);
  assert.equal(normaliseProject({video:{aspect:'16:9'}}).video.aspect,'16:9');
});
test('melody follow-beat and pitched vocal layers remain editable after normalisation',()=>{
  const p=normaliseProject({voice:{melody:{followBeat:true},layers:[{id:'harmony/1',sourceId:'vocal/1',pitch:16},{id:'raw',pitch:-5.5}]}});
  assert.equal(p.voice.melody.followBeat,true);
  assert.equal(p.voice.layers[0].pitch,12);
  assert.equal(p.voice.layers[0].sourceId,'vocal1');
  assert.equal(p.voice.layers[1].pitch,-5.5);
  assert.equal(normaliseProject({}).voice.melody.followBeat,false);
});
test('melody uses A4 tuning and exports a MIDI track; rap syllable counts remain a rough local heuristic',async()=>{
  assert.equal(midiFrequency(69),440);
  assert.equal(midiFrequency(69,432),432);
  assert.equal(midiNoteName(60),'C4');
  assert.equal(midiNoteName(69),'A4');
  assert.equal(midiNoteName(61),'C♯4');
  assert.equal(estimateSyllables('Hello little music maker'),8);
  assert.equal(estimateSyllables('wishes boxes dances'),6,'common sibilant -es endings should keep their pronounced syllable');
  assert.equal(estimateSyllables('wanted needed'),4,'-ed should add a syllable after t or d');
  assert.equal(estimateSyllables('played waved'),2,'-ed should remain silent after other consonants');
  const file=midiFile([{midi:69,step:0,duration:4}],120,440);
  assert.equal(file.type,'audio/midi');
  const bytes=new Uint8Array(await file.arrayBuffer());
  assert.equal(new TextDecoder().decode(bytes.slice(0,4)),'MThd');
  assert.ok(new TextDecoder().decode(bytes).includes('MTrk'));
  assert.ok(bytes.includes(0x90)&&bytes.includes(0x80));
});
test('MIDI ends an adjacent repeated pitch before retriggering it at the same tick',async()=>{
  const bytes=new Uint8Array(await midiFile([
    {midi:69,step:4,duration:4},
    {midi:69,step:0,duration:4}
  ],120).arrayBuffer());
  let offset=22,tick=0;
  const events=[];
  while(offset<bytes.length){
    let delta=0,byte;
    do{byte=bytes[offset++];delta=(delta<<7)|(byte&0x7f);}while(byte&0x80);
    tick+=delta;
    const status=bytes[offset++];
    if(status===0xff){
      const type=bytes[offset++];
      let length=0,next;
      do{next=bytes[offset++];length=(length<<7)|(next&0x7f);}while(next&0x80);
      if(type===0x2f)break;
      offset+=length;
      continue;
    }
    const pitch=bytes[offset++],velocity=bytes[offset++];
    events.push({tick,status,pitch,velocity});
  }
  assert.deepEqual(events.filter(event=>event.tick===480&&event.pitch===69).map(event=>event.status),[0x80,0x90]);
});
test('WAV encoder writes bounded little-endian 16-bit PCM for mono and stereo buffers',async()=>{
  const stereo={sampleRate:44100,numberOfChannels:2,length:2,getChannelData:channel=>channel===0?Float32Array.from([-1,.5]):Float32Array.from([1,-.5])};
  const file=audioBufferToWav(stereo),bytes=new Uint8Array(await file.arrayBuffer()),view=new DataView(bytes.buffer);
  assert.equal(file.type,'audio/wav');
  assert.equal(new TextDecoder().decode(bytes.slice(0,4)),'RIFF');
  assert.equal(new TextDecoder().decode(bytes.slice(8,12)),'WAVE');
  assert.equal(view.getUint32(4,true),bytes.length-8);
  assert.equal(view.getUint16(20,true),1);
  assert.equal(view.getUint16(22,true),2);
  assert.equal(view.getUint32(24,true),44100);
  assert.equal(view.getUint16(34,true),16);
  assert.deepEqual([view.getInt16(44,true),view.getInt16(46,true),view.getInt16(48,true),view.getInt16(50,true)],[-32768,32767,16384,-16384]);
  const mono=audioBufferToWav({sampleRate:16000,numberOfChannels:1,length:1,getChannelData:()=>Float32Array.from([.25])});
  const monoBytes=new Uint8Array(await mono.arrayBuffer());
  assert.equal(new DataView(monoBytes.buffer).getUint16(22,true),1);
  assert.equal(new DataView(monoBytes.buffer).getInt16(44,true),8192);
});
