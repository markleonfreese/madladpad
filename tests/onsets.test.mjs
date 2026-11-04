import test from 'node:test';
import assert from 'node:assert/strict';
import { findCandidates } from '../site/onsets.js';

const rate = 8000;
test('silence has no candidates', () => {
  assert.deepEqual(findCandidates(new Float32Array(rate), rate), []);
});
test('separate transient bursts produce diverse bounded regions', () => {
  const signal = new Float32Array(rate * 3);
  for (const t of [.5, 2]) for (let i=0;i<80;i++) signal[Math.floor(t*rate)+i] = .6 * Math.sin(i*.8);
  const candidates = findCandidates(signal, rate);
  assert.ok(candidates.length >= 2);
  assert.ok(candidates.some(c => Math.abs(c.start-.5) < .25));
  assert.ok(candidates.some(c => Math.abs(c.start-2) < .25));
  assert.ok(candidates.every(c => c.start >= 0 && c.end <= 3 && c.end > c.start));
});
test('heavily clipped segments are penalised against clean transients', () => {
  const signal = new Float32Array(rate * 3);
  for(let i=0;i<160;i++) { signal[rate+i]=1; signal[2*rate+i]=.8*Math.sin(i*.8); }
  const candidates=findCandidates(signal,rate);
  assert.ok(candidates.length);
  assert.ok(Math.abs(candidates[0].start-2)<.25);
});
test('invalid inputs and long clips fail explicitly', () => {
  assert.throws(()=>findCandidates(new Float32Array(2),0), /sample rate/i);
  assert.throws(()=>findCandidates(new Float32Array(rate*121),rate), /120 seconds/i);
});
