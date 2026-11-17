import test from 'node:test';
import assert from 'node:assert/strict';
import { makeProject, normaliseProject, normaliseSong } from '../site/core.js';
import { buildSongRenderPlan, songRenderVisualsAtTime } from '../site/song-render.js';

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
    { id: 'video-two', name: 'Hook footage', startStep: 1, trimStartSec: 2, trimEndSec: 9, durationSec: 9 }
  ];
  const plan = buildSongRenderPlan(project, { videoDurations: { 'video-one': 8, 'video-two': 9 } });
  const tiles = songRenderVisualsAtTime(project, plan, .2);
  assert.deepEqual(tiles.map(tile => tile.kind), ['midi', 'still', 'video', 'video']);
  assert.deepEqual(tiles.filter(tile => tile.kind === 'video').map(tile => tile.trackId), ['video-one', 'video-two']);
  assert.equal(tiles.find(tile => tile.kind === 'still').trackId, 'pad-0');
  assert.equal(tiles.find(tile => tile.kind === 'midi').midi, 60);
  assert.ok(Math.abs(tiles.find(tile => tile.trackId === 'video-two').sourceSeconds - (2 + .2 - 1 / 6)) < 1e-9);
  assert.deepEqual(songRenderVisualsAtTime(project, plan, plan.durationSeconds), [], 'the exclusive final Song timestamp has no active frame tiles');
});
