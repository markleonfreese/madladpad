/** Local deterministic lyric diagnostics. This is not phonetic transcription or AI feedback.
 * Pass the host's syllable estimator so apps can reuse the analyser without extra dependencies.
 */
const MAX_LINES = 256;
const MAX_LINE_LENGTH = 500;
const KNOWN_SOUND_FAMILIES = [
  ['time','rhyme','climb','prime','crime','lime','slime'],
  ['light','night','bright','flight','right','sight','might'],
  ['blue','true','through','new','grew']
];
const KNOWN_KEYS = new Map(KNOWN_SOUND_FAMILIES.flatMap((words, index) => words.map(word => [word, 'known-' + index])));

function wordsIn(text) {
  return text.match(/[a-z]+(?:'[a-z]+)*/gi) || [];
}

function endingKey(word) {
  if (!word || word.length < 3) return null;
  if (KNOWN_KEYS.has(word)) return KNOWN_KEYS.get(word);
  const base = word.replace(/e$/, '');
  const suffix = base.match(/[aeiouy][^aeiouy]*$/)?.[0];
  return suffix && suffix.length >= 2 ? 'spelling-' + suffix : null;
}

function groupLabel(index) {
  return String.fromCharCode(65 + index % 26) + (index >= 26 ? String(Math.floor(index / 26) + 1) : '');
}

/** Analyse up to 256 lyric bars (or newline-separated text) without editing the source. */
export function analyseLyrics(input, estimateSyllables) {
  if (typeof estimateSyllables !== 'function') throw new TypeError('A syllable estimator function is required');
  const raw = typeof input === 'string' ? input.split(/\r?\n/) : Array.isArray(input) ? input : [];
  const lines = raw.slice(0, MAX_LINES).map((value, index) => {
    const original = String(value ?? '');
    let text = original.slice(0, MAX_LINE_LENGTH);
    if (original.length > MAX_LINE_LENGTH && /[a-z']/i.test(original[MAX_LINE_LENGTH])) text = text.replace(/[a-z']+$/i, '').trimEnd();
    const words = wordsIn(text);
    const ending = words.at(-1)?.toLowerCase() || '';
    const syllables = words.length ? Math.max(0, Math.round(Number(estimateSyllables(text)) || 0)) : 0;
    return { bar: index + 1, text, filled: words.length > 0, syllables, ending, family: null, repeatedEnding: false, key: endingKey(ending) };
  });

  const byKey = new Map();
  const byEnding = new Map();
  for (const line of lines) {
    if (!line.filled) continue;
    if (line.key) {
      if (!byKey.has(line.key)) byKey.set(line.key, new Set());
      byKey.get(line.key).add(line.ending);
    }
    if (!byEnding.has(line.ending)) byEnding.set(line.ending, []);
    byEnding.get(line.ending).push(line.bar);
  }

  const groupedKeys = [...byKey].filter(([, words]) => words.size > 1).map(([key]) => key);
  const labelByKey = new Map(groupedKeys.map((key, index) => [key, groupLabel(index)]));
  for (const line of lines) {
    line.family = labelByKey.get(line.key) || null;
    line.repeatedEnding = (byEnding.get(line.ending)?.length || 0) > 1 && line.filled;
    delete line.key;
  }

  const repeatedEndings = [...byEnding].filter(([, bars]) => bars.length > 1).map(([word, bars]) => ({ word, bars }));
  const filledBars = lines.filter(line => line.filled).length;
  const syllableCounts = lines.filter(line => line.filled).map(line => line.syllables);
  const syllableRange = { min: Math.min(...syllableCounts, 0), max: Math.max(...syllableCounts, 0) };
  if (syllableCounts.length) syllableRange.min = Math.min(...syllableCounts);
  const observations = [];
  if (lines.length - filledBars) observations.push((lines.length - filledBars) + ' of ' + lines.length + ' bars are empty.');
  if (filledBars > 1) observations.push('Estimated syllables range from ' + syllableRange.min + '–' + syllableRange.max + ' across ' + filledBars + ' written bars.');
  if (groupedKeys.length) observations.push(groupedKeys.length + ' possible end-rhyme ' + (groupedKeys.length === 1 ? 'family' : 'families') + ' found from spellings and a small word list; check by ear.');
  if (repeatedEndings.length) observations.push('Repeated line endings: ' + repeatedEndings.map(item => '“' + item.word + '” (bars ' + item.bars.join(', ') + ')').join('; ') + '.');
  return { lines, filledBars, emptyBars: lines.length - filledBars, syllableRange, possibleRhymeFamilies: groupedKeys.length, repeatedEndings, observations };
}
