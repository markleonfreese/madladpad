import test from 'node:test';
import assert from 'node:assert/strict';
import { detectPitch, frequencyToNote } from '../site/tuning.js';

const sine = (hz, seconds=.5, rate=48000) => Float32Array.from(
  {length:Math.floor(rate*seconds)},(_,i)=>.5*Math.sin(2*Math.PI*hz*i/rate)
);

test('detects the pitch of a local sustained note over an instrument-sized range',()=>{
  for(const [hz,name] of [[82.41,'E2'],[110,'A2'],[261.626,'C4'],[440,'A4'],[880,'A5']]){
    const note=detectPitch(sine(hz),48000);
    assert.equal(note?.name,name,`expected ${name} at ${hz} Hz`);
    assert.ok(Math.abs(note.frequency-hz)<1,`found ${note.frequency} Hz instead of ${hz}`);
    assert.ok(note.confidence>.8);
  }
});

test('reports tuning correction in semitones relative to A440 without altering raw audio',()=>{
  const note=frequencyToNote(445);
  assert.equal(note.name,'A4');
  assert.ok(note.cents>0);
  assert.ok(note.correction<0);
  assert.equal(frequencyToNote(0),null);
  assert.equal(detectPitch(new Float32Array(24000),48000),null);
  assert.throws(()=>detectPitch(new Uint8Array(1000),48000),/Invalid PCM/);
});
