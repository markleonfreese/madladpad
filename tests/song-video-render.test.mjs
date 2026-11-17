import test from 'node:test';
import assert from 'node:assert/strict';
import { SONG_VIDEO_MAX_BYTES, SONG_VIDEO_MAX_SECONDS, renderSongVideo, songVideoDimensions } from '../site/song-video-render.js';

const audioBuffer={duration:2,sampleRate:44100,numberOfChannels:2};
const plan={durationSeconds:2,bpm:90};
const visualsAtTime=()=>[];

test('Song video aspects use even dimensions suitable for browser encoders',()=>{
  assert.deepEqual(songVideoDimensions('16:9'),{width:640,height:360});
  assert.deepEqual(songVideoDimensions('9:16'),{width:360,height:640});
  assert.deepEqual(songVideoDimensions('4:3'),{width:480,height:360});
  assert.deepEqual(songVideoDimensions('1:1'),{width:480,height:480});
  assert.throws(()=>songVideoDimensions('2:1'),/supported Song video aspect/);
});

test('Song video export fails closed for absent features and unsafe lengths',async()=>{
  assert.equal(SONG_VIDEO_MAX_SECONDS,240);assert.equal(SONG_VIDEO_MAX_BYTES,48*1024*1024);
  await assert.rejects(()=>renderSongVideo(plan,{audioBuffer,visualsAtTime}),/local video encoder is unavailable/);
  await assert.rejects(()=>renderSongVideo({...plan,durationSeconds:241},{audioBuffer,visualsAtTime},{Media:{}}),/limited to 4 minutes/);
  await assert.rejects(()=>renderSongVideo(plan,{audioBuffer,visualsAtTime},{Media:{},format:'avi'}),/Choose Auto, MP4 or WebM/);
  await assert.rejects(()=>renderSongVideo(plan,{audioBuffer,visualsAtTime},{Media:{canEncodeVideo:async()=>true,canEncodeAudio:async()=>true},maxBytes:1}),/48 MB local export limit/);
  await assert.rejects(()=>renderSongVideo(plan,{audioBuffer:{...audioBuffer,duration:3},visualsAtTime},{Media:{}}),/duration does not match/);
});
