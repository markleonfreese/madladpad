import test from 'node:test';
import assert from 'node:assert/strict';
import { analyseLyrics } from '../site/lyric-intelligence.js';

const count = text => text.trim() ? text.split(/\s+/).length : 0;

test('recognises approximate rhyme families without equating repeated endings to rhymes', () => {
  const result = analyseLyrics(['I saw a light', 'Out in the night', 'A different light', 'No one was home'], count);
  assert.equal(result.lines[0].family, 'A');
  assert.equal(result.lines[1].family, 'A');
  assert.equal(result.lines[2].family, 'A');
  assert.equal(result.lines[3].family, null);
  assert.deepEqual(result.repeatedEndings, [{ word: 'light', bars: [1, 3] }]);
  assert.equal(result.possibleRhymeFamilies, 1);
});

test('preserves line numbers and punctuation, recognises a curated spelling exception', () => {
  const result = analyseLyrics('Time!\n\nRhyme.\nFine?', count);
  assert.equal(result.lines.length, 4);
  assert.equal(result.lines[1].filled, false);
  assert.equal(result.lines[2].ending, 'rhyme');
  assert.equal(result.lines[0].family, 'A');
  assert.equal(result.lines[2].family, 'A');
  assert.equal(result.lines[3].family, null);
  assert.equal(result.filledBars, 3);
  assert.equal(result.emptyBars, 1);
});

test('computes structural observations from syllable estimates without claiming meaning', () => {
  const result = analyseLyrics(['one two', 'a long story with many words', '', 'short'], count);
  assert.deepEqual(result.lines.map(line => line.syllables), [2, 6, 0, 1]);
  assert.equal(result.syllableRange.min, 1);
  assert.equal(result.syllableRange.max, 6);
  assert.ok(result.observations.some(note => note.includes('empty')));
  assert.ok(result.observations.some(note => note.includes('1–6')));
});

test('bounds oversized inputs and returns data, not executable markup', () => {
  const result = analyseLyrics(Array.from({ length: 300 }, () => '<img src=x onerror=alert(1)> ' + 'word '.repeat(150)), count);
  assert.equal(result.lines.length, 256);
  assert.ok(result.lines.every(line => line.text.length <= 500));
  assert.ok(result.lines.every(line => line.ending === 'word'));
});

test('handles malformed or blank input deterministically', () => {
  assert.deepEqual(analyseLyrics(null, count), analyseLyrics([], count));
  assert.equal(analyseLyrics(['', ' '], count).possibleRhymeFamilies, 0);
  assert.deepEqual(analyseLyrics(['cat', 'hat'], count), analyseLyrics(['cat', 'hat'], count));
  assert.equal(analyseLyrics(['cat', 'hat'], count).possibleRhymeFamilies, 1);
  assert.throws(() => analyseLyrics(['cat']), /syllable estimator/);
});
