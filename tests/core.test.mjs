import test from 'node:test';
import assert from 'node:assert/strict';
import { withModelReferrerPolicy } from '../site/voice-model-fetch.js';
import { makeProject, normaliseProject, normaliseVideoDirection, directedPads, VIDEO_ASPECTS, nextQuantizedTime, nextBarTime, findRecorderMime, extensionForMime, findAudioRecorderMime, extensionForAudioMime, audioBufferToWav, PAD_COUNT, MAX_SCENES, supportedMediaFile, isPadAudible, captureStepPosition, stepTriggerTime, stepGateDuration, stepLoopGateDuration, midiFrequency, midiNoteName, melodyPositionLabel, snapMidiToScale, midiFile, estimateSyllables, MAX_TRANSCRIPT_WORDS, MAX_MELODY_STEPS, RAP_BAR_COUNT, videoVisualDurationMs, boundTranscriptWordTimes, vocalLayerClip, songVideoPositionAtStep, activeSongAudioVisuals, songLayerPlaybackEvents, normaliseSampleNotes, setSampleNote, sampleNoteAtStep, normaliseSong, songSectionAtStep, songTotalBars, reorderSongClips, resizeSongClipBars, editSongTrackOnTimeline, localRecordingBudget, localJournaledRecordingBudget, MAX_MEDIA_BYTES, RECORDING_STORAGE_RESERVE_BYTES, createBoundedRecordingCapture } from '../site/core.js';

test('long-form recording budget respects both project and browser storage with headroom', () => {
  assert.equal(localRecordingBudget(10 * 1024 * 1024, {usage:90 * 1024 * 1024,quota:100 * 1024 * 1024}), 10 * 1024 * 1024 - RECORDING_STORAGE_RESERVE_BYTES);
  assert.equal(localRecordingBudget(10 * 1024 * 1024, {usage:19 * 1024 * 1024,quota:20 * 1024 * 1024}), 1024 * 1024 - RECORDING_STORAGE_RESERVE_BYTES);
  assert.equal(localRecordingBudget(MAX_MEDIA_BYTES, {usage:0,quota:100 * 1024 * 1024}), 0);
  assert.equal(localRecordingBudget(0, {usage:1,quota:1}), 0);
});

test('journaled recording budget reserves space for both recovery chunks and the final saved source',()=>{
  const free=10*1024*1024;
  assert.equal(localJournaledRecordingBudget(0,{usage:90*1024*1024,quota:100*1024*1024}),free/2-RECORDING_STORAGE_RESERVE_BYTES);
  assert.equal(localJournaledRecordingBudget(MAX_MEDIA_BYTES-4*1024*1024,{usage:0,quota:100*1024*1024}),2*1024*1024-RECORDING_STORAGE_RESERVE_BYTES);
  assert.equal(localJournaledRecordingBudget(MAX_MEDIA_BYTES-RECORDING_STORAGE_RESERVE_BYTES,{usage:0,quota:100*1024*1024}),0);
});

test('Song video clips normalize stable identity, placement and source trim metadata',()=>{
  const video=normaliseProject({voice:{videoLayers:[{id:'clip_1',name:'Verse visual',startStep:384,trimStartSec:2,trimEndSec:8,durationSec:10,type:'video/mp4'}]}}).voice.videoLayers[0];
  assert.deepEqual(video,{id:'clip_1',name:'Verse visual',origin:'import',startStep:384,placementEndBar:null,repeatEnabled:false,repeatEveryBars:1,repeatPhaseBars:0,audibleLengthBars:null,trimStartSec:2,trimEndSec:8,durationSec:10,type:'video/mp4',includeAudio:false,audioGain:1},'video source sound is muted by default while its independent audio gain stays editable');
  assert.deepEqual(normaliseProject({voice:{videoLayers:[{id:'mix',includeAudio:true,audioGain:3}]}}).voice.videoLayers[0],{id:'mix',name:'Video track 1',origin:'import',startStep:0,placementEndBar:null,repeatEnabled:false,repeatEveryBars:1,repeatPhaseBars:0,audibleLengthBars:null,trimStartSec:0,trimEndSec:null,durationSec:0,type:'video/webm',includeAudio:true,audioGain:1.5},'video audio inclusion and gain should persist within safe bounds');
  assert.equal(normaliseProject({voice:{videoLayers:[{id:'take_1',origin:'recording'}]}}).voice.videoLayers[0].origin,'recording','camera take identity should survive project and pack normalization');
  assert.deepEqual(normaliseProject({}).voice.videoLayers,[],'older project packs default to no video tracks');
});

test('Song video track source time follows Song placement, tempo and trim bounds',()=>{
  const layer={startStep:32,trimStartSec:2,trimEndSec:8,durationSec:10};
  assert.equal(songVideoPositionAtStep(layer,31,120),null,'a placed clip must stay inactive before its Song step');
  assert.equal(songVideoPositionAtStep(layer,32,120),2,'a placed clip starts at its non-destructive source trim');
  assert.equal(songVideoPositionAtStep(layer,34,120),2.25,'two Song steps advance by the current tempo');
  assert.equal(songVideoPositionAtStep(layer,80,120),null,'the trim-out boundary is exclusive');
  assert.equal(songVideoPositionAtStep({...layer,startStep:0},8,240),2.5,'faster tempo advances through source time sooner');
  assert.equal(songVideoPositionAtStep({...layer,repeatEnabled:false,placementEndBar:4},63,90,8),2+31*(60/90/4),'a one-shot can play through its last placed bar');
  assert.equal(songVideoPositionAtStep({...layer,repeatEnabled:false,placementEndBar:4},64,90,8),null,'a one-shot stops at its exclusive placement end');
});

test('Song clip cycles keep phrase length separate from repeat period and phase',()=>{
  const layer={startStep:0,trimStartSec:1,trimEndSec:20,durationSec:20,repeatEnabled:true,repeatEveryBars:8,repeatPhaseBars:0,audibleLengthBars:2};
  const events=songLayerPlaybackEvents(layer,20,90,24);
  assert.deepEqual(events.map(event=>event.startStep),[0,128,256],'a two-bar phrase repeats at bars 1, 9 and 17');
  assert.ok(events.every(event=>Math.abs(event.durationSec-60/90*4*2)<1e-9),'each phrase plays for two bars without stretching the source');
  assert.deepEqual(songLayerPlaybackEvents({...layer,repeatPhaseBars:1},20,90,24).map(event=>event.startStep),[16,144,272],'the first-offset phase is independent from the repeat period');
  assert.equal(songVideoPositionAtStep(layer,31,90,24),1+31*(60/90/4),'the first two-bar phrase remains continuous');
  assert.equal(songVideoPositionAtStep(layer,32,90,24),null,'no source plays during bars 3 through 8');
  assert.equal(songVideoPositionAtStep(layer,127,90,24),null,'the rest gap continues until the independent cycle begins');
  assert.equal(songVideoPositionAtStep(layer,128,90,24),1,'the original source trim restarts at bar 9');
  assert.equal(songVideoPositionAtStep({...layer,repeatPhaseBars:1},0,90,24),null,'a positive phase delays the first onset');
  assert.equal(songVideoPositionAtStep({...layer,repeatPhaseBars:1},16,90,24),1,'the phase-shifted first onset preserves the source in-point');
  assert.equal(songVideoPositionAtStep(layer,384,90,24),null,'repeat instances stop at the end of the arranged Song');
  assert.deepEqual(songLayerPlaybackEvents({...layer,placementEndBar:18},20,90,24).map(event=>event.startStep),[0,128,256],'an explicit placement end clips cycles independently of Song section changes');
  assert.ok(Math.abs(songLayerPlaybackEvents({...layer,placementEndBar:17},20,90,24).at(-1).durationSec-60/90*4)<1e-9,'the final event is truncated at its placement boundary');
  assert.deepEqual(songLayerPlaybackEvents({...layer,startStep:128,placementEndBar:8},20,90,24),[],'a clip placed after its end boundary stays silent');
  assert.equal(songVideoPositionAtStep(layer,128,90),null,'a malformed repeat setting cannot loop video outside an arranged Song');
  const restored=normaliseProject({voice:{layers:[layer],videoLayers:[layer]}}).voice;
  assert.equal(restored.layers[0].repeatEveryBars,8);
  assert.equal(restored.layers[0].audibleLengthBars,2);
  assert.equal(restored.layers[0].placementEndBar,null,'legacy clips default to the Song end');
  assert.equal(restored.videoLayers[0].repeatPhaseBars,0);
  assert.equal(normaliseProject({voice:{layers:[{id:'legacy'}]}}).voice.layers[0].repeatEnabled,false,'older local projects remain one-shot by default');
});

test('live Song visuals include only audible audio clips at their independent cycle positions',()=>{
  const layers=[
    {id:'verse',name:'Verse vocal',startStep:0,trimStartSec:1,repeatEnabled:true,repeatEveryBars:8,repeatPhaseBars:0,audibleLengthBars:2,gain:1},
    {id:'adlib',name:'Ad-lib',startStep:16,trimStartSec:0,repeatEnabled:false,gain:1},
    {id:'muted',name:'Muted layer',startStep:0,gain:1,muted:true},
    {id:'silent',name:'Zero-gain layer',startStep:0,gain:0}
  ];
  const durations=new Map([['verse',20],['adlib',5],['muted',20],['silent',20]]);
  assert.deepEqual(activeSongAudioVisuals(layers,durations,0,90,24),[
    {id:'verse',name:'Verse vocal',positionSec:1,progress:0,reverse:false}
  ],'the first vocal image starts at its trim point while muted and silent parts stay hidden');
  assert.deepEqual(activeSongAudioVisuals(layers,durations,32,90,24),[
    {id:'adlib',name:'Ad-lib',positionSec:16*(60/90/4),progress:16*(60/90/4)/5,reverse:false}
  ],'audio visuals disappear in the repeated vocal gap but show a one-shot that is playing');
  assert.deepEqual(activeSongAudioVisuals(layers,durations,128,90,24),[
    {id:'verse',name:'Verse vocal',positionSec:1,progress:0,reverse:false}
  ],'a repeated phrase re-enters with its waveform playhead at the trimmed source start');
  assert.deepEqual(activeSongAudioVisuals([{...layers[0],solo:true},layers[1]],durations,32,90,24),[],'solo state hides non-solo tracks and the solo vocal is silent in its cycle gap');
  assert.deepEqual(activeSongAudioVisuals([{...layers[1],reverseEnabled:true}],durations,16,90,24),[
    {id:'adlib',name:'Ad-lib',positionSec:5,progress:1,reverse:true}
  ],'a reversed one-shot places its waveform playhead at the source end when playback begins');
});

test('storage-bounded recording keeps only chunks inside its limit and records the stop reason', () => {
  const capture = createBoundedRecordingCapture(10, 6);
  const accepted = {size:6};
  assert.equal(capture.add(accepted), true);
  assert.equal(capture.shouldStop, true,'the recorder should be asked to stop before spending its finalization reserve');
  assert.equal(capture.add({size:4}), true,'the final MediaRecorder chunk may use the reserved headroom');
  assert.equal(capture.add({size:1}), false);
  assert.deepEqual(capture.chunks, [accepted,{size:4}]);
  assert.equal(capture.bytes, 10);
  assert.equal(capture.stoppedForStorage, true);
});

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

test('melody scale snapping stays near the note and preserves valid legacy defaults', () => {
  const legacy = normaliseProject({voice:{melody:{notes:[{midi:63,step:12,word:'hello'}]}}}).voice.melody;
  assert.equal(legacy.key,0,'older projects default to C as the scale root');
  assert.equal(legacy.scale,'major','older projects default to major without changing their notes');
  assert.equal(legacy.notes[0].midi,63,'normalizing a project does not silently snap saved notes');
  const configured = normaliseProject({voice:{melody:{key:9,scale:'minor-pentatonic',notes:[]}}}).voice.melody;
  assert.equal(configured.key,9);
  assert.equal(configured.scale,'minor-pentatonic');
  assert.equal(snapMidiToScale(63,2,'major'),62,'a tie between D and E in D major resolves down to D');
  assert.equal(snapMidiToScale(66,9,'minor-pentatonic'),67,'F sharp moves to the closest G in A minor pentatonic');
  assert.equal(snapMidiToScale(60,0,'not-a-scale'),60,'unknown scales safely fall back to major');
  assert.equal(snapMidiToScale(24,0,'major'),24,'snapping respects the supported MIDI range');
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
  assert.deepEqual(voice.melody.notes[0],{midi:108,step:0,duration:99,velocity:96,word:'',layer:'lead'});
  const fullSong=normaliseProject({voice:{melody:{notes:[{step:MAX_MELODY_STEPS-1,duration:16}]}}}).voice.melody.notes[0];
  assert.deepEqual([fullSong.step,fullSong.duration],[MAX_MELODY_STEPS-1,1],'the final sixteenth of a 256-bar Song remains editable without extending beyond the project limit');
  const harmony=normaliseProject({voice:{melody:{harmonyInterval:7,notes:[{midi:67,layer:'harmony'}]}}}).voice.melody;
  assert.equal(harmony.harmonyInterval,7);
  assert.equal(harmony.notes[0].layer,'harmony');
  const vocal=normaliseProject({voice:{layers:[{id:'vocal/one',name:'Lead',startStep:-2,gain:2,muted:true}]}}).voice.layers[0];
  assert.deepEqual(vocal,{id:'vocalone',name:'Lead',origin:'recording',startStep:0,placementEndBar:null,repeatEnabled:false,repeatEveryBars:1,repeatPhaseBars:0,audibleLengthBars:null,reverseEnabled:false,trimStartSec:0,trimEndSec:null,gain:1.5,muted:true,solo:false,sourceId:'vocalone',pitch:0});
  const imported=normaliseProject({voice:{layers:[{id:'audio-1',name:'Beat stem',origin:'import',sourceId:'audio-1'}]}}).voice.layers[0];
  assert.equal(imported.origin,'import','imported Song audio must retain its local source kind across project normalization');
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
  assert.equal(melodyPositionLabel(0),'Bar 1 · Beat 1 · 16th 1');
  assert.equal(melodyPositionLabel(3),'Bar 1 · Beat 1 · 16th 4');
  assert.equal(melodyPositionLabel(4),'Bar 1 · Beat 2 · 16th 1');
  assert.equal(melodyPositionLabel(15),'Bar 1 · Beat 4 · 16th 4');
  assert.equal(melodyPositionLabel(16),'Bar 2 · Beat 1 · 16th 1');
  assert.equal(melodyPositionLabel(255),'Bar 16 · Beat 4 · 16th 4');
  assert.equal(melodyPositionLabel(1024),'Bar 65 · Beat 1 · 16th 1','the melody position readout should continue through the full 256-bar Song');
  assert.equal(melodyPositionLabel(MAX_MELODY_STEPS-1),'Bar 256 · Beat 4 · 16th 4');
  assert.equal(estimateSyllables('Hello little music maker'),8);
  assert.equal(estimateSyllables('wishes boxes dances'),6,'common sibilant -es endings should keep their pronounced syllable');
  assert.equal(estimateSyllables('wanted needed'),4,'-ed should add a syllable after t or d');
  assert.equal(estimateSyllables('played waved'),2,'-ed should remain silent after other consonants');
  const file=midiFile([{midi:69,step:0,duration:4,velocity:83}],120,440);
  assert.equal(file.type,'audio/midi');
  const bytes=new Uint8Array(await file.arrayBuffer());
  assert.equal(new TextDecoder().decode(bytes.slice(0,4)),'MThd');
  assert.ok(new TextDecoder().decode(bytes).includes('MTrk'));
  assert.ok(bytes.includes(0x90)&&bytes.includes(0x80));
  const noteOn=bytes.findIndex((value,index)=>value===0x90&&bytes[index+1]===69);
  assert.equal(bytes[noteOn+2],83,'MIDI note-on velocity should match the editable Melody dynamics');
  assert.equal(normaliseProject({voice:{melody:{notes:[{midi:69,velocity:180}]}}}).voice.melody.notes[0].velocity,127,'Melody velocity should be bounded to the MIDI range');
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
test('MIDI notes export their full multi-bar positions and stop at the 256-bar project limit',async()=>{
  const project=normaliseProject({voice:{melody:{notes:[{midi:48,step:1024,duration:8},{midi:50,step:MAX_MELODY_STEPS-1,duration:16}]}}});
  const bytes=new Uint8Array(await midiFile(project.voice.melody.notes,90).arrayBuffer());
  let offset=22,tick=0;const events=[];
  while(offset<bytes.length){
    let delta=0,byte;
    do{byte=bytes[offset++];delta=(delta<<7)|(byte&0x7f);}while(byte&0x80);
    tick+=delta;
    const status=bytes[offset++];
    if(status===0xff){const type=bytes[offset++];let length=0,next;do{next=bytes[offset++];length=(length<<7)|(next&0x7f);}while(next&0x80);if(type===0x2f)break;offset+=length;continue;}
    const pitch=bytes[offset++];offset++;
    events.push({tick,status,pitch});
  }
  assert.ok(events.some(event=>event.tick===1024*120&&event.status===0x90&&event.pitch===48),'Bar 65 note-on should export at its absolute MIDI tick');
  assert.ok(events.some(event=>event.tick===(1024+8)*120&&event.status===0x80&&event.pitch===48),'Bar 65 note-off should preserve its duration');
  assert.ok(events.some(event=>event.tick===MAX_MELODY_STEPS*120&&event.status===0x80&&event.pitch===50),'final-bar note duration should stop exactly at the 256-bar boundary');
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


test('melodic note lengths distinguish a joined gate from independent adjacent retriggers', () => {
  const joined = setSampleNote([], {step:2,length:3,semitones:7});
  assert.deepEqual(joined,[{step:2,length:3,semitones:7}]);
  assert.equal(sampleNoteAtStep(joined,2).length,3);
  assert.equal(sampleNoteAtStep(joined,3),null,'held step must not retrigger the sample');
  const separate = setSampleNote(setSampleNote([], {step:2,length:1,semitones:7}),{step:3,length:1,semitones:7});
  assert.deepEqual(separate,[{step:2,length:1,semitones:7},{step:3,length:1,semitones:7}]);
  assert.ok(sampleNoteAtStep(separate,2));
  assert.ok(sampleNoteAtStep(separate,3),'adjacent distinct notes must retrigger');
});

test('a newly drawn note replaces overlapping notes, while an unrelated note is preserved', () => {
  const original = [
    {step:0,length:2,semitones:0},
    {step:4,length:1,semitones:3},
    {step:7,length:2,semitones:-2}
  ];
  const edited = setSampleNote(original,{step:3,length:3,semitones:7});
  assert.deepEqual(edited,[{step:0,length:2,semitones:0},{step:3,length:3,semitones:7},{step:7,length:2,semitones:-2}]);
});

test('melodic notes normalise safely and survive projects and named scenes without rewriting old step beats', () => {
  assert.deepEqual(normaliseSampleNotes([{step:15,length:12,semitones:50},{step:-4,length:2,semitones:-99},{step:NaN,length:2}]),[
    {step:0,length:2,semitones:-12},{step:15,length:1,semitones:12}
  ]);
  const legacy=normaliseProject({pads:[{steps:[true,false,true]}]});
  assert.equal(legacy.pads[0].sequenceMode,'steps');
  assert.deepEqual(legacy.pads[0].sampleNotes,[]);
  const project=normaliseProject({pads:[{steps:[true],sequenceMode:'notes',sampleNotes:[{step:1,length:4,semitones:5}]}],scenes:[{pads:[{steps:[true],sequenceMode:'notes',sampleNotes:[{step:1,length:4,semitones:5}]}]}]});
  assert.equal(project.pads[0].sequenceMode,'notes');
  assert.deepEqual(project.pads[0].sampleNotes,[{step:1,length:4,semitones:5}]);
  assert.deepEqual(project.scenes[0].pads[0].sampleNotes,project.pads[0].sampleNotes);
  assert.deepEqual(project.pads[0].steps.slice(0,3),[true,false,false],'old step pattern remains intact when using notes');
});

test('overdub trimming is non-destructive, bounded to the raw audio and independent of transport start', () => {
  const old=normaliseProject({voice:{layers:[{id:'lead',startStep:18}]}}).voice.layers[0];
  assert.equal(old.startStep,18);
  assert.deepEqual(vocalLayerClip(old,3.2),{start:0,end:3.2,duration:3.2});
  const edited=normaliseProject({voice:{layers:[{id:'lead',startStep:18,trimStartSec:.4,trimEndSec:2.1}]}}).voice.layers[0];
  assert.equal(edited.startStep,18,'moving the audible crop must not shift its placement');
  assert.deepEqual(vocalLayerClip(edited,3.2),{start:.4,end:2.1,duration:1.7000000000000002});
  assert.deepEqual(vocalLayerClip({trimStartSec:-12,trimEndSec:100},2),{start:0,end:2,duration:2});
  assert.deepEqual(vocalLayerClip({trimStartSec:10,trimEndSec:-4},2),{start:1.99,end:2,duration:.010000000000000009});
});

test('song sections reference reusable scene IDs, permit A-B-C-A, and set exact bar boundaries', () => {
  const scenes=[{id:'a',name:'A'},{id:'b',name:'B'},{id:'c',name:'C'}];
  const song=normaliseSong({clips:[{sceneId:'a',bars:8},{sceneId:'b',bars:16},{sceneId:'c',bars:4},{sceneId:'a',bars:8}]});
  assert.equal(songTotalBars(song),36);
  assert.equal(songSectionAtStep(song,scenes,0).scene.name,'A');
  assert.equal(songSectionAtStep(song,scenes,8*16).scene.name,'B');
  assert.equal(songSectionAtStep(song,scenes,24*16).scene.name,'C');
  assert.equal(songSectionAtStep(song,scenes,28*16).scene.name,'A');
  assert.equal(songSectionAtStep(song,scenes,28*16+15).localStep,15);
  assert.equal(songSectionAtStep(song,scenes,36*16),null,'song stops at arrangement end rather than looping automatically');
  assert.equal(songSectionAtStep(song,scenes,NaN),null);
});

test('song clips retain missing references for repair and respect finite bar and section caps', () => {
  const legacy=normaliseProject({scenes:[{name:'A'},{name:'B'}]});
  assert.deepEqual(legacy.song.clips,[],'old projects do not invent a song');
  assert.deepEqual(legacy.scenes.map(s=>s.id),['scene-1','scene-2']);
  const p=normaliseProject({scenes:[{id:'beat-a',name:'A'}],song:{clips:[{sceneId:'beat-a',bars:999},{sceneId:'missing',bars:80}]}});
  assert.equal(p.song.clips[0].bars,64);
  assert.equal(p.song.clips[1].bars,64);
  assert.equal(songSectionAtStep(p.song,p.scenes,64*16).scene,null,'missing scene must remain visible for repair');
  assert.deepEqual(normaliseSong({clips:[{sceneId:'a',bars:-1},{sceneId:'a',bars:3}]}).clips.map(x=>x.bars),[1,3]);
});

test('Song timeline reorder moves the same saved section instance without cloning its scene or media', () => {
  const clips=[
    {id:'a-1',sceneId:'A',bars:8},{id:'b-1',sceneId:'B',bars:16},
    {id:'c-1',sceneId:'C',bars:4},{id:'a-2',sceneId:'A',bars:8}
  ];
  const reordered=reorderSongClips(clips,'a-1',4);
  assert.deepEqual(reordered.map(clip=>clip.id),['b-1','c-1','a-2','a-1']);
  assert.deepEqual(reordered.map(clip=>clip.sceneId),['B','C','A','A']);
  assert.equal(songTotalBars({clips:reordered}),36);
  assert.deepEqual(clips.map(clip=>clip.id),['a-1','b-1','c-1','a-2'],'edits must not mutate the saved source array');
  assert.deepEqual(reorderSongClips(reordered,'a-1',0).map(clip=>clip.id),['a-1','b-1','c-1','a-2']);
  assert.deepEqual(reorderSongClips(clips,'missing',2),clips,'unknown clip IDs are ignored');
  assert.deepEqual(reorderSongClips(clips,'a-1',1),clips,'dropping at original boundary is a no-op');
});
test('Song clip resizing respects whole bars, 64 bars per clip and 256 total', () => {
  const clips=[{id:'a',sceneId:'A',bars:8},{id:'b',sceneId:'B',bars:16}];
  assert.deepEqual(resizeSongClipBars(clips,'a',11).map(clip=>clip.bars),[11,16]);
  assert.deepEqual(resizeSongClipBars(clips,'a',0).map(clip=>clip.bars),[1,16]);
  assert.deepEqual(resizeSongClipBars(clips,'a',500).map(clip=>clip.bars),[64,16]);
  assert.deepEqual(clips.map(clip=>clip.bars),[8,16],'resizing must preserve the incoming arrangement');
  const almostFull=[{id:'a',sceneId:'A',bars:60},{id:'b',sceneId:'B',bars:64},{id:'c',sceneId:'C',bars:64},{id:'d',sceneId:'D',bars:64}];
  assert.deepEqual(resizeSongClipBars(almostFull,'a',64).map(clip=>clip.bars),[64,64,64,64]);
  assert.equal(songTotalBars({clips:resizeSongClipBars(almostFull,'a',64)}),256);
  assert.deepEqual(resizeSongClipBars(almostFull,'a',-3).map(clip=>clip.bars),[1,64,64,64]);
});

test('Song track waveform gestures move source without changing the crop or stored media',()=>{
  const raw={id:'take',startStep:16,trimStartSec:1,trimEndSec:5,gain:.8,muted:false};
  const moved=editSongTrackOnTimeline(raw,'move',8,6,120);
  assert.deepEqual(moved,{...raw,startStep:24});
  assert.deepEqual(raw,{id:'take',startStep:16,trimStartSec:1,trimEndSec:5,gain:.8,muted:false},'the original track object and source must remain untouched');
  assert.equal(editSongTrackOnTimeline(raw,'move',-500,6,120).startStep,0,'moving before the Song start is bounded');
  assert.equal(editSongTrackOnTimeline(raw,'move',99999,6,120).startStep,4095,'the 256-bar Song timeline is bounded');
});

test('Song track waveform left and right edges trim non-destructively with sixteenth-note snapping',()=>{
  const raw={id:'verse',startStep:16,trimStartSec:1,trimEndSec:5,includeAudio:false,audioGain:.7};
  const inwards=editSongTrackOnTimeline(raw,'trim-left',8,6,120);
  assert.deepEqual(inwards,{...raw,startStep:24,trimStartSec:2},'moving trim-in inward also advances the visible left edge without changing the recorded source');
  assert.deepEqual(editSongTrackOnTimeline(raw,'trim-left',-8,6,120),{...raw,startStep:8,trimStartSec:0},'dragging left reveals source audio when available');
  assert.deepEqual(editSongTrackOnTimeline(raw,'trim-right',-8,6,120),{...raw,trimEndSec:4},'right edge shortens without moving the clip start');
  assert.deepEqual(editSongTrackOnTimeline(raw,'trim-right',8,6,120),{...raw,trimEndSec:6},'right edge can reveal original media up to its duration');
  assert.equal(editSongTrackOnTimeline(raw,'trim-left',999,6,120).trimStartSec<raw.trimEndSec,true,'left trim preserves a nonempty source interval');
  assert.equal(editSongTrackOnTimeline(raw,'trim-right',-999,6,120).trimEndSec>raw.trimStartSec,true,'right trim preserves a nonempty source interval');
  assert.equal(editSongTrackOnTimeline(raw,'trim-right',-999,6,120).startStep,raw.startStep);
  assert.equal(raw.trimStartSec,1,'gestures must not mutate the source track object');
});

test('Song video waveform gestures preserve source-audio opt-in and note-sized timing',()=>{
  const layer={id:'camera',startStep:160,trimStartSec:0,trimEndSec:null,durationSec:4,includeAudio:true,audioGain:0.6};
  const edited=editSongTrackOnTimeline(layer,'trim-right',-8,4,120);
  assert.deepEqual(edited,{...layer,trimEndSec:3});
  const moved=editSongTrackOnTimeline(edited,'move',-16,4,120);
  assert.equal(moved.startStep,144);
  assert.equal(moved.includeAudio,true);
  assert.equal(moved.audioGain,.6);
  assert.equal(editSongTrackOnTimeline(layer,'trim-left',-1,4,120).trimStartSec,0,'source trim-in cannot reveal audio before the original');
  assert.deepEqual(editSongTrackOnTimeline(layer,'move',0,4,120),layer);
});
