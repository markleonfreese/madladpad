const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

/** Detect the strongest monophonic pitch in a short time-domain frame with YIN. */
export function detectPitch(samples, sampleRate, reference = 440) {
  if (!(samples instanceof Float32Array) || samples.length < 512 || !Number.isFinite(sampleRate) || sampleRate <= 0) return null;
  const minHz = 55, maxHz = Math.min(1200, sampleRate / 4);
  const minLag = Math.max(2, Math.floor(sampleRate / maxHz));
  const maxLag = Math.min(Math.floor(sampleRate / minHz), Math.floor(samples.length / 2));
  if (maxLag <= minLag || !Number.isFinite(reference) || reference < 400 || reference > 480) return null;

  let mean = 0, energy = 0;
  for (const sample of samples) { mean += sample; energy += sample * sample; }
  mean /= samples.length;
  const rms = Math.sqrt(Math.max(0, energy / samples.length - mean * mean));
  if (rms < 0.008) return null;

  const differences = new Float64Array(maxLag + 1);
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    const end = samples.length - lag;
    for (let index = 0; index < end; index++) {
      const delta = (samples[index] - mean) - (samples[index + lag] - mean);
      sum += delta * delta;
    }
    differences[lag] = sum;
  }

  let running = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    running += differences[lag];
    differences[lag] = running > 0 ? differences[lag] * (lag - minLag + 1) / running : 1;
  }

  let selected = -1, best = 1;
  for (let lag = minLag + 1; lag < maxLag; lag++) {
    const value = differences[lag];
    if (value < best) { best = value; selected = lag; }
    if (value < 0.12 && value <= differences[lag - 1] && value <= differences[lag + 1]) { selected = lag; best = value; break; }
  }
  if (selected < 0 || best > 0.28) return null;

  const left = differences[selected - 1], centre = differences[selected], right = differences[selected + 1];
  const denominator = left - 2 * centre + right;
  const correction = Math.abs(denominator) > 1e-9 ? Math.max(-.5, Math.min(.5, .5 * (left - right) / denominator)) : 0;
  const frequency = sampleRate / (selected + correction);
  const midiFloat = 69 + 12 * Math.log2(frequency / reference);
  const midi = Math.round(midiFloat);
  return { frequency, midi, note: `${NOTE_NAMES[(midi % 12 + 12) % 12]}${Math.floor(midi / 12) - 1}`, cents: (midiFloat - midi) * 100, confidence: Math.max(0, Math.min(1, 1 - best)) };
}
