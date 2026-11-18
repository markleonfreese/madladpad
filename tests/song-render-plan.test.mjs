import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_REVERSED_AUDIO_BYTES, makeProject, normaliseProject, normaliseSong } from '../site/core.js';
import { buildSongRenderPlan, renderSongAudioWav, songRenderVisualsAtTime } from '../site/song-render.js';

function pattern(id, name, step) {
  const pads = Array.from({ length: 16 }, () => ({ steps: Array(16).fill(false), stepOffsets: Array(16).fill(0) }));
  pads[0].steps[step] = true;
  return { id, name, pads };
}

function renderProject() {
  const base = makeProject();
  return normaliseProject({
    ...base,
    bpm: 90,
    pads: base.pads.map((pad, index) => index === 0 ? { ...pad, fileName: 'local-drum.wav', kind: 'audio' } : pad),
    scenes: [pattern('a', 'A', 0), pattern('b', 'B', 4), pattern('c', 'C', 8)],
    song: normaliseSong({ clips: [
      { id: 'intro', sceneId: 'a', bars: 8 },
      { id: 'verse', sceneId: 'b', bars: 16 },
      { id: 'hook', sceneId: 'c', bars: 24 },
      { id: 'outro', sceneId: 'a', bars: 24 }
    ] }),
    voice: {
      ...base.voice,
      layers: [
        { id: 'vocal', name: 'Verse', startStep: 5, trimStartSec: 1, trimEndSec: 13, gain: .7, repeatEnabled: true, repeatEveryBars: 8, audibleLengthBars: 2 },
        { id: 'muted', name: 'Muted', startStep: 0, trimEndSec: 8, muted: true }
      ],
      videoLayers: [
        { id: 'silent-video', startStep: 0, trimEndSec: 4, durationSec: 8, includeAudio: false },
        { id: 'video-audio', startStep: 32, trimStartSec: 2, trimEndSec: 10, durationSec: 12, includeAudio: true, audioGain: .4 }
      ],
      melody: {
        ...base.voice.melody,
        followBeat: true,
        notes: [{ midi: 60, step: 0, duration: 4, velocity: 100, layer: 'lead' }, { midi: 67, step: 800, duration: 16, layer: 'harmony' }],
        clips: [{ id: 'bass', name: 'Bass', startStep: 16, patternBars: 1, repeatEnabled: true, repeatEveryBars: 8, notes: [{ midi: 36, step: 0, duration: 16, velocity: 90 }] }]
      }
    }
  });
}

test('72-bar Song render plan preserves A/B/C/A transitions and exact 3:12 duration', () => {
  const plan = buildSongRenderPlan(renderProject(), {
    padDurations: { 0: 2 },
    vocalDurations: { vocal: 15, muted: 8 },
    videoDurations: { 'video-audio': 12, 'silent-video': 8 }
  });
  assert.equal(plan.bpm, 90);
  assert.equal(plan.bars, 72);
  assert.equal(plan.totalSteps, 1152);
  assert.equal(plan.durationSeconds, 192);
  assert.deepEqual(plan.sections.map(({ sceneId, clipId, startStep, endStep }) => [sceneId, clipId, startStep, endStep]), [
    ['a', 'intro', 0, 128], ['b', 'verse', 128, 384], ['c', 'hook', 384, 768], ['a', 'outro', 768, 1152]
  ]);
  const samples = plan.events.filter(event => event.kind === 'sample');
  assert.equal(samples.length, 72, 'each section pattern repeats across its arranged bars');
  assert.deepEqual(samples.slice(0, 10).map(event => event.startStep), [0, 16, 32, 48, 64, 80, 96, 112, 132, 148]);
  assert.equal(samples[0].durationSeconds, 2, 'the source clip keeps its natural duration');
  assert.equal(samples.at(-1).startStep, 1136);
  const vocal = plan.events.filter(event => event.kind === 'vocal');
  assert.equal(vocal.length, 9, 'the trimmed repeating vocal renders at bars 1, 9, ... through the Song');
  assert.equal(vocal[0].sourceStartSeconds, 1);
  assert.equal(vocal[0].gain, .7);
  assert.equal(plan.events.filter(event => event.kind === 'video-audio').length, 1, 'video source audio is included only when explicitly enabled');
  assert.equal(plan.events.find(event => event.kind === 'video-audio').startSeconds, 32 * 60 / 90 / 4);
  const melody = plan.events.filter(event => event.kind === 'midi');
  assert.equal(melody.filter(event => event.trackId === 'melody').length, 2);
  assert.equal(melody.filter(event => event.trackId === 'midi-bass').length, 9);
  assert.ok(plan.events.every(event => event.startSeconds >= 0 && event.startSeconds < plan.durationSeconds));
});

test('Song render plan rejects an empty or broken arrangement before media work starts', () => {
  assert.throws(() => buildSongRenderPlan(makeProject()), /Add saved patterns/);
  const project = renderProject();
  project.song.clips[0].sceneId = 'missing';
  assert.throws(() => buildSongRenderPlan(project), /refers to a missing pattern/);
});

test('one render timestamp aligns two video clips, a still pad, and a generated MIDI note', () => {
  const project = renderProject();
  project.pads[0].kind = 'image';
  project.pads[0].fileName = 'local-artwork.png';
  project.voice.videoLayers = [
    { id: 'video-one', name: 'Verse footage', startStep: 0, trimStartSec: 1, trimEndSec: 8, durationSec: 8 },
    { id: 'video-two', name: 'Hook footage', startStep: 0, trimStartSec: 2, trimEndSec: 9, durationSec: 9 }
  ];
  const plan = buildSongRenderPlan(project, { videoDurations: { 'video-one': 8, 'video-two': 9 } });
  const tiles = songRenderVisualsAtTime(project, plan, .1);
  assert.deepEqual(tiles.map(tile => tile.kind), ['midi', 'still', 'video', 'video']);
  assert.deepEqual(tiles.filter(tile => tile.kind === 'video').map(tile => tile.trackId), ['video-one', 'video-two']);
  assert.equal(tiles.find(tile => tile.kind === 'still').trackId, 'pad-0');
  assert.equal(tiles.find(tile => tile.kind === 'midi').midi, 60);
  assert.ok(Math.abs(tiles.find(tile => tile.trackId === 'video-two').sourceSeconds - 2.1) < 1e-9);
  assert.deepEqual(songRenderVisualsAtTime(project, plan, plan.durationSeconds), [], 'the exclusive final Song timestamp has no active frame tiles');
});

function wordRemixProject(kind = 'audio') {
  const project = renderProject();
  project.pads[0] = { ...project.pads[0], kind, fileName: kind === 'video' ? 'speaker.webm' : 'speaker.wav' };
  project.voice.transcripts = [{ id: 'transcript', sourcePad: 0, words: [{ id: 'word-1', text: 'go', start: .25, end: .75 }] }];
  project.voice.wordRemix = { followTransport: true, events: [{ id: 'cue-1', transcriptId: 'transcript', wordId: 'word-1', step: 1, pitch: 0, lengthPercent: 50 }] };
  return project;
}

test('opted-in Word Remix expands source-linked cues over each four-bar Song cycle', () => {
  const project = wordRemixProject();
  const plan = buildSongRenderPlan(project, { wordRemixDurations: { 'cue-1': 1 } });
  const cues = plan.events.filter(event => event.kind === 'word-remix-audio');
  assert.equal(cues.length, 18, 'a 72-bar Song contains eighteen four-bar Word Remix cycles');
  assert.deepEqual(cues.slice(0, 3).map(event => event.startStep), [1, 65, 129]);
  assert.ok(Math.abs(cues[0].startSeconds - 60 / 90 / 4) < 1e-9);
  assert.equal(cues[0].sourceStartSeconds, .25);
  assert.equal(cues[0].sourceEndSeconds, .75);
  assert.equal(cues[0].durationSeconds, .25, 'the 50% trim controls output duration without changing source offsets');
  assert.equal(cues[0].sourcePad, 0);
  assert.equal(cues[0].cycle, 0);
  assert.equal(cues[1].cycle, 1);
  const atCue = songRenderVisualsAtTime(project, plan, cues[0].startSeconds + .05);
  assert.deepEqual(atCue.filter(tile => tile.trackId === 'word-remix-cue-1').map(tile => [tile.kind, tile.name]), [['waveform', 'go']]);
  assert.ok(Math.abs(atCue.find(tile => tile.trackId === 'word-remix-cue-1').sourceSeconds - .3) < 1e-9);
  assert.equal(songRenderVisualsAtTime(project, plan, cues[0].startSeconds + cues[0].durationSeconds)
    .some(tile => tile.trackId === 'word-remix-cue-1'), false, 'the frame after the trimmed cue has no tile');
  project.voice.wordRemix.followTransport = false;
  assert.equal(buildSongRenderPlan(project).events.some(event => event.kind.startsWith('word-remix-')), false,
    'non-opted-in Word Remix events do not enter the Song');
});

test('video-backed Word Remix frames retain the original local video source offset', () => {
  const project = wordRemixProject('video');
  const plan = buildSongRenderPlan(project, { wordRemixDurations: { 'cue-1': 1 } });
  const cue = plan.events.find(event => event.kind === 'word-remix-video');
  assert.equal(cue.sourcePad, 0);
  const frame = songRenderVisualsAtTime(project, plan, cue.startSeconds + .125)
    .find(tile => tile.trackId === 'word-remix-cue-1');
  assert.deepEqual(frame, { kind: 'video-pad', trackId: 'word-remix-cue-1', name: 'go', sourceSeconds: .375 });
});

class FakeParam {
  constructor(value = 0) { this.value = value; this.events = []; }
  setValueAtTime(value, time) { this.value = value; this.events.push({ value, time }); }
  linearRampToValueAtTime(value, time) { this.value = value; this.events.push({ value, time }); }
}
class FakeAudioBuffer {
  constructor(channels, length, sampleRate) {
    this.numberOfChannels = channels; this.length = length; this.sampleRate = sampleRate;
    this.duration = length / sampleRate; this.channels = Array.from({ length: channels }, () => new Float32Array(length));
  }
  getChannelData(channel) { return this.channels[channel]; }
}
class FakeNode {
  constructor() {
    this.connections = []; this.gain = new FakeParam(); this.threshold = new FakeParam();
    this.knee = new FakeParam(); this.ratio = new FakeParam(); this.attack = new FakeParam();
    this.release = new FakeParam(); this.playbackRate = new FakeParam(1); this.detune = new FakeParam();
    this.frequency = new FakeParam();
  }
  connect(node) { this.connections.push(node); return node; }
  start(...args) { this.started = args; }
  stop(...args) { this.stopped = args; }
}
class FakeOfflineAudioContext {
  static instances = [];
  constructor(channels, length, sampleRate) {
    this.channels = channels; this.length = length; this.sampleRate = sampleRate; this.destination = new FakeNode(); this.nodes = [];
    FakeOfflineAudioContext.instances.push(this);
  }
  createDynamicsCompressor() { const node = new FakeNode(); this.nodes.push(node); return node; }
  createBufferSource() { const node = new FakeNode(); this.nodes.push(node); return node; }
  createGain() { const node = new FakeNode(); this.nodes.push(node); return node; }
  createOscillator() { const node = new FakeNode(); this.nodes.push(node); return node; }
  createBuffer(channels, length, sampleRate) { return new FakeAudioBuffer(channels, length, sampleRate); }
  async startRendering() { return new FakeAudioBuffer(this.channels, this.length, this.sampleRate); }
}

test('offline WAV renderer schedules sample and MIDI events and returns an actual PCM WAV', async () => {
  FakeOfflineAudioContext.instances.length = 0;
  const source = new FakeAudioBuffer(1, 4800, 24000);
  const plan = { durationSeconds: .2, events: [
    { kind: 'sample', trackId: 'pad-0', padId: 0, startSeconds: 0, durationSeconds: .1, sourceStartSeconds: .02, sourceEndSeconds: .12, gain: .7, speed: 1, semitones: 0 },
    { kind: 'midi', trackId: 'melody', startSeconds: .1, durationSeconds: .05, midi: 69, velocity: 127, tuning: 440, word: '' }
  ] };
  const result = await renderSongAudioWav(plan, { pads: new Map([[0, source]]) }, { OfflineAudioContextClass: FakeOfflineAudioContext, sampleRate: 24000 });
  assert.equal(result.durationSeconds, .2);
  assert.equal(result.buffer.numberOfChannels, 2);
  assert.equal(result.blob.type, 'audio/wav');
  const bytes = new Uint8Array(await result.blob.arrayBuffer());
  assert.equal(new TextDecoder().decode(bytes.slice(0, 4)), 'RIFF');
  assert.equal(new TextDecoder().decode(bytes.slice(8, 12)), 'WAVE');
  const context = FakeOfflineAudioContext.instances.at(-1);
  const sample = context.nodes.find(node => node.started?.length === 3);
  assert.deepEqual(sample.started.slice(0, 2), [0, .02]);
  assert.ok(Math.abs(sample.started[2] - .1) < 1e-9);
  const midi = context.nodes.find(node => node.frequency.events.length);
  assert.equal(midi.frequency.events[0].value, 440);
});

test('offline WAV renderer schedules and pitch-shifts Word Remix audio from its transcript source window', async () => {
  FakeOfflineAudioContext.instances.length = 0;
  const source = new FakeAudioBuffer(1, 48000, 48000),samples=source.getChannelData(0);
  for(let i=0;i<samples.length;i++)samples[i]=Math.sin(2*Math.PI*440*i/source.sampleRate);
  const plan = { durationSeconds: 1, events: [{ kind: 'word-remix-audio', id: 'cue-1', trackId: 'word-remix-cue-1', name: 'go',
    startSeconds: .1, durationSeconds: .25, sourceStartSeconds: .25, sourceEndSeconds: .75, gain: .82, semitones: 0 }] };
  await renderSongAudioWav(plan, { wordRemix: new Map([['cue-1', { buffer: source }]]) },
    { OfflineAudioContextClass: FakeOfflineAudioContext, sampleRate: 24000, makeWav: false });
  const node = FakeOfflineAudioContext.instances.at(-1).nodes.find(item => item.started?.length === 3);
  assert.ok(node);
  assert.deepEqual(node.started.slice(0, 2), [.1, .25]);
  assert.ok(Math.abs(node.started[2] - .25) < 1e-9, 'the shortened remix cue only reads its requested source duration');

  FakeOfflineAudioContext.instances.length = 0;
  const pitched = { ...plan, events: [{ ...plan.events[0], semitones: 4 }] };
  await renderSongAudioWav(pitched, { wordRemix: new Map([['cue-1', { buffer: source }]]) },
    { OfflineAudioContextClass: FakeOfflineAudioContext, sampleRate: 24000, makeWav: false });
  const pitchedNode=FakeOfflineAudioContext.instances.at(-1).nodes.find(item=>item.buffer&&item.started?.length===3);
  assert.ok(pitchedNode?.buffer,'the pitched cue is rendered into a local processed buffer');
  assert.deepEqual(pitchedNode.started.slice(0,2),[.1,0],'the processed cue preserves its Song start and uses its rendered source from frame zero');
  const shifted=pitchedNode.buffer.getChannelData(0),shiftedStart=2400;let crossings=0;
  for(let i=shiftedStart;i<shifted.length;i++)if(shifted[i-1]<=0&&shifted[i]>0)crossings++;
  const measured=crossings/((shifted.length-shiftedStart)/pitchedNode.buffer.sampleRate);
  assert.ok(Math.abs(measured-440*2**(4/12))<35,`the exported cue should be shifted four semitones, measured ${measured} Hz`);
});

test('offline WAV renderer preserves independent Pitch, compensates Speed, and bounds long output', async () => {
  FakeOfflineAudioContext.instances.length = 0;
  const source = new FakeAudioBuffer(1, 24000, 24000);
  const samples=source.getChannelData(0);for(let i=0;i<samples.length;i++)samples[i]=Math.sin(2*Math.PI*440*i/source.sampleRate);
  const pitched = { durationSeconds: 1, events: [{ kind: 'sample', trackId: 'pad-0', padId: 0,
    startSeconds: 0, durationSeconds: .5, sourceStartSeconds: 0, sourceEndSeconds: .5, gain: 1, speed: 1, semitones: 4 }] };
  await renderSongAudioWav(pitched, { pads: new Map([[0, source]]) }, { OfflineAudioContextClass: FakeOfflineAudioContext, sampleRate: 24000, makeWav: false });
  let node=FakeOfflineAudioContext.instances.at(-1).nodes.find(item=>item.buffer&&item.started?.length===3);
  assert.equal(node.buffer.length,12000);
  let output=node.buffer.getChannelData(0),crossings=0;
  for(let i=2400;i<output.length;i++)if(output[i-1]<=0&&output[i]>0)crossings++;
  let measured=crossings/((output.length-2400)/node.buffer.sampleRate);
  assert.ok(Math.abs(measured-440*2**(4/12))<35,`the rendered pad should retain +4 semitones, measured ${measured} Hz`);

  FakeOfflineAudioContext.instances.length=0;
  const compensated={...pitched,events:[{...pitched.events[0],durationSeconds:.25,speed:2,semitones:0}]};
  await renderSongAudioWav(compensated,{pads:new Map([[0,source]])},{OfflineAudioContextClass:FakeOfflineAudioContext,sampleRate:24000,makeWav:false});
  node=FakeOfflineAudioContext.instances.at(-1).nodes.find(item=>item.buffer&&item.started?.length===3);
  assert.equal(node.playbackRate.events[0].value,2);
  output=node.buffer.getChannelData(0);crossings=0;
  for(let i=2400;i<output.length;i++)if(output[i-1]<=0&&output[i]>0)crossings++;
  measured=crossings/((output.length-2400)/node.buffer.sampleRate);
  assert.ok(Math.abs(measured-220)<25,`Speed 2x should be compensated one octave down before playback, measured ${measured} Hz`);

  const tooLong = { durationSeconds: 241, events: [] };
  await assert.rejects(renderSongAudioWav(tooLong, {}, { OfflineAudioContextClass: FakeOfflineAudioContext }), /limited to 4 minutes/);
  assert.equal(FakeOfflineAudioContext.instances.length, 1, 'the invalid long project is rejected before allocating a second offline buffer');
});

test('offline WAV renderer rejects invalid local trims and over-limit reversed vocals before scheduling', async () => {
  FakeOfflineAudioContext.instances.length = 0;
  const source = new FakeAudioBuffer(1, 4800, 24000);
  const invalidTrim = { durationSeconds: .2, events: [{ kind: 'sample', trackId: 'pad-0', padId: 0,
    startSeconds: 0, durationSeconds: .1, sourceStartSeconds: .15, sourceEndSeconds: .1, gain: 1, speed: 1, semitones: 0 }] };
  await assert.rejects(renderSongAudioWav(invalidTrim, { pads: new Map([[0, source]]) }, { OfflineAudioContextClass: FakeOfflineAudioContext }), /trim.*outside its decoded audio/);

  FakeOfflineAudioContext.instances.length = 0;
  const frames = Math.floor(MAX_REVERSED_AUDIO_BYTES / (2 * Float32Array.BYTES_PER_ELEMENT)) + 1;
  const oversized = { numberOfChannels: 2, sampleRate: 44100, length: frames, duration: frames / 44100,
    getChannelData: () => new Float32Array(1) };
  const reversePlan = { durationSeconds: .2, events: [{ kind: 'vocal', trackId: 'vocal', name: 'Lead', reverse: true,
    startSeconds: 0, durationSeconds: oversized.duration, sourceStartSeconds: 0, gain: 1, semitones: 0 }] };
  await assert.rejects(renderSongAudioWav(reversePlan, { vocals: new Map([['vocal', oversized]]) }, { OfflineAudioContextClass: FakeOfflineAudioContext }), /exceeds the local reverse-buffer limit/);
  assert.equal(FakeOfflineAudioContext.instances.length, 0, 'invalid source work is rejected before allocating the offline renderer');
});
