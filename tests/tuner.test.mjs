import test from 'node:test';
import assert from 'node:assert/strict';
import { detectPitch } from '../site/tuner.js';

function tone(frequency, sampleRate = 48000, seconds = .09, amplitude = .3) {
  return Float32Array.from({length:Math.round(sampleRate * seconds)},(_,index)=>amplitude * Math.sin(2 * Math.PI * frequency * index / sampleRate));
}

test('local tuner identifies standard A4 and measures in-tune cents',()=>{
  const result=detectPitch(tone(440),48000);
  assert.ok(result);
  assert.equal(result.note,'A4');
  assert.ok(Math.abs(result.frequency-440)<1);
  assert.ok(Math.abs(result.cents)<1);
  assert.ok(result.confidence>.9);
});

test('local tuner recognizes notes across a practical instrument range',()=>{
  for(const [frequency,note] of [[82.4069,'E2'],[261.6256,'C4'],[659.2551,'E5'],[1046.5023,'C6']]) {
    const result=detectPitch(tone(frequency),48000);
    assert.ok(result,`${note} should be detected`);
    assert.equal(result.note,note);
    assert.ok(Math.abs(result.frequency-frequency)<2,`${note} measured at ${result.frequency.toFixed(2)} Hz`);
  }
});

test('local tuner respects custom A4 reference and rejects silence or invalid frames',()=>{
  const result=detectPitch(tone(442),48000,442);
  assert.ok(result);
  assert.equal(result.note,'A4');
  assert.ok(Math.abs(result.cents)<1);
  assert.equal(detectPitch(new Float32Array(2048),48000),null);
  assert.equal(detectPitch(tone(440).slice(0,200),48000),null);
  assert.equal(detectPitch(tone(440),48000,0),null);
});
