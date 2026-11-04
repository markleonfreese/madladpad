import { clamp, midiFrequency, midiFile, estimateSyllables, MAX_MELODY_NOTES, MAX_TRANSCRIPT_WORDS, MAX_VOICE_PHRASES } from './core.js';

const $ = id => document.getElementById(id);
const rhymes = {
  light:['night','bright','flight','sight','write','mic'], day:['way','play','say','stay','away','display'],
  flow:['glow','show','know','grow','slow','go'], time:['rhyme','climb','line','shine','design'],
  sound:['ground','round','found','around','bound'], heart:['start','art','part','smart'],
  fire:['higher','wire','inspire','desire'], mind:['find','kind','grind','behind']
};
const wordKey = text => String(text).toLowerCase().replace(/[^a-z']/g, '').replace(/(?:ing|ed|s)$/, '');
function rhymeHints(line) {
  const word = wordKey(line.trim().split(/\s+/).at(-1));
  if (!word) return [];
  for (const [key, values] of Object.entries(rhymes)) if (word === key || values.includes(word)) return [key, ...values].filter(value => value !== word).slice(0, 3);
  return Object.entries(rhymes).flatMap(([key, values]) => [key, ...values].filter(value => value.endsWith(word.slice(-2)) && value !== word)).slice(0, 3);
}

async function renderPhraseWav(phrase, project, audio) {
  if (!phrase.words.length) throw new Error('Add words to the phrase before exporting.');
  const sampleRate = Math.min(48000, audio.context.sampleRate), gap = .035;
  const clips = []; let seconds = 0;
  for (const word of phrase.words) {
    const source = audio.sources.get(word.sourcePad);
    if (!source?.file) throw new Error(`The source sample for “${word.text}” is not loaded.`);
    const buffer = source.buffer || await audio.context.decodeAudioData(await source.file.arrayBuffer());
    const start = clamp(word.start, 0, Math.max(0, buffer.duration - .01));
    const duration = Math.min(Math.max(.04, word.end - word.start), buffer.duration - start);
    if (duration < .03) continue;
    clips.push({ buffer, start, duration, at: seconds }); seconds += duration + gap;
    if (seconds > 60) throw new Error('Phrase audio export is limited to 60 seconds. Split this phrase into shorter parts.');
  }
  if (!clips.length) throw new Error('No source audio could be decoded for this phrase.');
  const frameCount = Math.ceil(seconds * sampleRate), offline = new OfflineAudioContext(2, frameCount, sampleRate);
  for (const clip of clips) {
    const node = offline.createBufferSource(), gain = offline.createGain(); node.buffer = clip.buffer;
    const stop = clip.at + clip.duration, fade = Math.min(.008, clip.duration / 4);
    gain.gain.setValueAtTime(0, clip.at); gain.gain.linearRampToValueAtTime(.9, clip.at + fade);
    gain.gain.setValueAtTime(.9, Math.max(clip.at + fade, stop - fade)); gain.gain.linearRampToValueAtTime(0, stop);
    node.connect(gain).connect(offline.destination); node.start(clip.at, clip.start, clip.duration); node.stop(stop + .002);
  }
  const rendered = await offline.startRendering(), channels = 2, dataBytes = rendered.length * channels * 2;
  const bytes = new ArrayBuffer(44 + dataBytes), view = new DataView(bytes);
  const ascii = (offset, text) => [...text].forEach((character, index) => view.setUint8(offset + index, character.charCodeAt(0)));
  ascii(0, 'RIFF'); view.setUint32(4, 36 + dataBytes, true); ascii(8, 'WAVE'); ascii(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true); view.setUint16(34, 16, true); ascii(36, 'data'); view.setUint32(40, dataBytes, true);
  const left = rendered.getChannelData(0), right = rendered.getChannelData(1);
  for (let frame = 0; frame < rendered.length; frame++) {
    view.setInt16(44 + frame * 4, Math.round(clamp(left[frame], -1, 1) * 32767), true);
    view.setInt16(46 + frame * 4, Math.round(clamp(right[frame], -1, 1) * 32767), true);
  }
  return new Blob([bytes], { type: 'audio/wav' });
}

function download(blob, fileName) {
  const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = fileName; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function toMono16k(buffer) {
  const inputLength = buffer.length;
  if (buffer.duration > 120 || inputLength * buffer.numberOfChannels > 8_000_000) throw new Error('Choose a clip under 120 seconds and 8 million decoded samples.');
  const ratio = buffer.sampleRate / 16000;
  const length = Math.floor(inputLength / ratio);
  const mono = new Float32Array(length);
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const samples = buffer.getChannelData(channel);
    for (let index = 0; index < length; index++) {
      const position = index * ratio, base = Math.floor(position), fraction = position - base;
      const sample = (samples[base] || 0) * (1 - fraction) + (samples[Math.min(base + 1, inputLength - 1)] || 0) * fraction;
      mono[index] += sample / buffer.numberOfChannels;
    }
  }
  return mono;
}

function renderWords(project, current, save) {
  const host = $('voice-word-list'); host.replaceChildren();
  const transcript = project.voice.transcripts.at(-1);
  if (!transcript) { $('voice-make-phrase').disabled = true; return; }
  transcript.words.forEach((word, index) => {
    const row = document.createElement('div'); row.className = 'voice-word';
    const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = word.selected; checkbox.setAttribute('aria-label', `Use word ${index + 1}, ${word.text}`);
    checkbox.addEventListener('change', () => { word.selected = checkbox.checked; save(); renderWords(project, current, save); });
    const text = document.createElement('input'); text.type = 'text'; text.maxLength = 120; text.value = word.text; text.setAttribute('aria-label', `Transcript word ${index + 1}`);
    text.addEventListener('change', () => { word.text = text.value.trim(); save(); renderWords(project, current, save); });
    const start = document.createElement('input'); start.type = 'number'; start.min = '0'; start.max = '3600'; start.step = '.01'; start.value = word.start.toFixed(2); start.setAttribute('aria-label', `Word ${index + 1} start seconds`);
    const end = document.createElement('input'); end.type = 'number'; end.min = '0'; end.max = '3600'; end.step = '.01'; end.value = word.end.toFixed(2); end.setAttribute('aria-label', `Word ${index + 1} end seconds`);
    for (const [input, key] of [[start, 'start'], [end, 'end']]) input.addEventListener('change', () => { word[key] = clamp(input.value, 0, 3600); if (word.end <= word.start) word.end = word.start + .05; save(); renderWords(project, current, save); });
    const score = document.createElement('span'); score.className = 'voice-confidence'; score.textContent = 'review'; score.title = 'The local model does not provide a calibrated word confidence score.';
    row.append(checkbox, text, start, end, score); host.append(row);
  });
  $('voice-make-phrase').disabled = !transcript.words.some(word => word.selected) || project.voice.phrases.length >= MAX_VOICE_PHRASES;
}

function renderPhrases(project, audio, notify, save, assignWordsToPads) {
  const host = $('voice-phrases'); host.replaceChildren();
  project.voice.phrases.forEach((phrase, index) => {
    const card = document.createElement('div'); card.className = 'voice-phrase';
    const title = document.createElement('strong'); title.textContent = `${phrase.name} · ${phrase.words.length} words`;
    const controls = document.createElement('div'); controls.className = 'voice-actions';
    const play = document.createElement('button'); play.type = 'button'; play.className = 'pill-button'; play.textContent = '▶ PREVIEW'; play.setAttribute('aria-label', `Preview ${phrase.name}`);
    play.addEventListener('click', async () => {
      await audio.unlock(); let at = audio.context.currentTime + .04;
      for (const word of phrase.words) {
        const pad = project.pads[word.sourcePad];
        if (!audio.sources.get(word.sourcePad)?.file) { notify(`Load the source sample for ${word.text} to preview this phrase.`); return; }
        const start = Math.max(0, word.start), end = Math.max(start + .05, word.end);
        audio.trigger(word.sourcePad, { ...pad, start, end }, undefined, at);
        at += Math.max(.08, end - start);
      }
    }); controls.append(play);
    const assign = document.createElement('button'); assign.type = 'button'; assign.className = 'pill-button'; assign.textContent = 'MAP WORDS TO PADS + STEPS';
    assign.setAttribute('aria-label', `Map ${phrase.name} words to pads and steps`);
    assign.setAttribute('aria-describedby', 'voice-map-help');
    assign.addEventListener('click', async () => {
      if (!phrase.words.length) return;
      assign.disabled = true;
      try {
        const clips = [];
        for (const word of phrase.words) {
          const blob = await renderPhraseWav({ words: [word] }, project, audio);
          const sampleRate = new DataView(await blob.slice(24, 28).arrayBuffer()).getUint32(0, true);
          const duration = (blob.size - 44) / (sampleRate * 4);
          const safeWord = word.text.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 24) || 'word';
          clips.push({ word, file: new File([blob], `${safeWord}.wav`, { type: 'audio/wav' }), duration });
        }
        await assignWordsToPads(phrase, clips);
      } catch (error) { notify(`Could not map phrase words to pads: ${error.message}`); }
      finally { assign.disabled = false; }
    }); controls.append(assign);
    const exportAudio = document.createElement('button'); exportAudio.type = 'button'; exportAudio.className = 'pill-button'; exportAudio.textContent = 'EXPORT WAV';
    exportAudio.setAttribute('aria-label', `Export ${phrase.name} as WAV`);
    exportAudio.addEventListener('click', async () => {
      exportAudio.disabled = true;
      try {
        const blob = await renderPhraseWav(phrase, project, audio);
        const safeTitle = (project.title || 'madladpad').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
        download(blob, `${safeTitle}-${phrase.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.wav`);
      } catch (error) { notify(`Phrase export failed: ${error.message}`); }
      finally { exportAudio.disabled = false; }
    }); controls.append(exportAudio);
    const move = (delta, label) => { const button = document.createElement('button'); button.type = 'button'; button.className = 'pill-button'; button.textContent = label; button.disabled = index + delta < 0 || index + delta >= project.voice.phrases.length; button.addEventListener('click', () => { const [item] = project.voice.phrases.splice(index, 1); project.voice.phrases.splice(index + delta, 0, item); save(); renderPhrases(project, audio, notify, save, assignWordsToPads); }); controls.append(button); };
    move(-1, '↑'); move(1, '↓');
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'pill-button'; remove.textContent = 'REMOVE'; remove.addEventListener('click', () => { project.voice.phrases.splice(index, 1); save(); renderPhrases(project, audio, notify, save, assignWordsToPads); }); controls.append(remove);
    const words = document.createElement('div'); words.className = 'phrase-words';
    phrase.words.forEach((word, wordIndex) => {
      const item = document.createElement('span'); item.textContent = `${word.text} `;
      for (const [delta, label] of [[-1, '‹'], [1, '›']]) { const button = document.createElement('button'); button.type = 'button'; button.textContent = label; button.setAttribute('aria-label', `${delta < 0 ? 'Move earlier' : 'Move later'} ${word.text}`); button.disabled = wordIndex + delta < 0 || wordIndex + delta >= phrase.words.length; button.addEventListener('click', () => { const [entry] = phrase.words.splice(wordIndex, 1); phrase.words.splice(wordIndex + delta, 0, entry); save(); renderPhrases(project, audio, notify, save, assignWordsToPads); }); item.append(button); }
      words.append(item);
    });
    card.append(title, controls, words); host.append(card);
  });
}

function renderMelody(project, save) {
  const host = $('melody-notes'); host.replaceChildren();
  $('melody-tuning').value = project.voice.melody.tuning;
  const wordOptions = [''].concat(project.voice.phrases.flatMap(phrase => phrase.words.map(word => word.text)));
  project.voice.melody.notes.forEach((note, index) => {
    const row = document.createElement('div'); row.className = 'melody-note';
    const noteName = document.createElement('span'); noteName.textContent = `Note ${index + 1} · ${midiFrequency(note.midi, project.voice.melody.tuning).toFixed(1)} Hz`;
    const pitch = document.createElement('input'); pitch.type = 'number'; pitch.min = '24'; pitch.max = '108'; pitch.value = note.midi; pitch.setAttribute('aria-label', `Note ${index + 1} MIDI pitch`);
    const step = document.createElement('input'); step.type = 'number'; step.min = '0'; step.max = '255'; step.value = note.step; step.setAttribute('aria-label', `Note ${index + 1} sixteenth step`);
    const duration = document.createElement('input'); duration.type = 'number'; duration.min = '.125'; duration.max = '16'; duration.step = '.125'; duration.value = note.duration; duration.setAttribute('aria-label', `Note ${index + 1} duration in sixteenth steps`);
    const word = document.createElement('select'); word.setAttribute('aria-label', `Assign phrase word to note ${index + 1}`);
    wordOptions.forEach(value => { const option = document.createElement('option'); option.value = value; option.textContent = value || 'No word cue'; word.append(option); }); word.value = note.word;
    for (const [input, key] of [[pitch, 'midi'], [step, 'step'], [duration, 'duration'], [word, 'word']]) input.addEventListener('change', () => { note[key] = key === 'word' ? input.value : Number(input.value); save(); renderMelody(project, save); });
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'pill-button'; remove.textContent = '×'; remove.setAttribute('aria-label', `Delete melody note ${index + 1}`); remove.addEventListener('click', () => { project.voice.melody.notes.splice(index, 1); save(); renderMelody(project, save); });
    row.append(noteName, pitch, step, duration, word, remove); host.append(row);
  });
  $('melody-add').disabled = project.voice.melody.notes.length >= MAX_MELODY_NOTES;
}

function renderRap(project, save) {
  $('rap-scheme').value = project.voice.rap.scheme;
  const host = $('rap-bars'); host.replaceChildren();
  project.voice.rap.bars.forEach((line, index) => {
    const row = document.createElement('label'); row.className = 'rap-bar';
    const number = document.createElement('span'); number.textContent = String(index + 1).padStart(2, '0');
    const text = document.createElement('textarea'); text.maxLength = 500; text.rows = 2; text.value = line; text.placeholder = `Bar ${index + 1}`; text.setAttribute('aria-label', `Rap bar ${index + 1}`);
    const meta = document.createElement('small'); const renderMeta = () => { const hints = rhymeHints(text.value); meta.textContent = `${estimateSyllables(text.value)} estimated syllables${hints.length ? ` · rhyme ideas: ${hints.join(', ')}` : ''}`; };
    text.addEventListener('input', () => { project.voice.rap.bars[index] = text.value; renderMeta(); save(); }); renderMeta(); row.append(number, text, meta); host.append(row);
  });
}

export function initVoiceLab({ getProject, getMediaFiles, getAudio, notify, save, assignWordsToPads }) {
  const project = getProject(), audio = getAudio();
  let worker = null;
  const updateConsentState = () => { $('voice-transcribe').disabled = !$('voice-source-pad').value || !$('voice-consent').checked; };
  function render() {
    const selected = $('voice-source-pad').value;
    const select = $('voice-source-pad'); select.replaceChildren();
    for (const [id, file] of getMediaFiles()) if (/^(audio|video)\//.test(file.type)) { const option = document.createElement('option'); option.value = id; option.textContent = `${project.pads[id].name} · ${file.name || file.type}`; select.append(option); }
    if ([...select.options].some(option => option.value === selected)) select.value = selected;
    updateConsentState();
    renderWords(project, getMediaFiles, save); renderPhrases(project, audio, notify, save, assignWordsToPads); renderMelody(project, save); renderRap(project, save);
  }
  window.addEventListener('madladpad-media-change', render);
  $('voice-source-pad').addEventListener('change', render);
  $('voice-consent').addEventListener('change', render);
  $('voice-transcribe').addEventListener('click', async () => {
    const padId = Number($('voice-source-pad').value), file = getMediaFiles().get(padId);
    if (!$('voice-consent').checked || !file) return;
    if (file.size > 32 * 1024 * 1024) { $('voice-status').textContent = 'Choose a file smaller than 32 MB for this on-device workflow.'; return; }
    $('voice-transcribe').disabled = true; $('voice-cancel').hidden = false; $('voice-status').textContent = 'Decoding the selected local clip…';
    try {
      let buffer = audio.sources.get(padId)?.buffer;
      if (!buffer) buffer = await audio.context.decodeAudioData(await file.arrayBuffer());
      const samples = toMono16k(buffer);
      worker?.terminate(); worker = new Worker('/voice-inference-worker.bundle.js', { type: 'module' });
      worker.onmessage = event => {
        const data = event.data;
        if (data.type === 'progress') {
          const label = data.state?.file || 'speech model';
          $('voice-status').textContent = data.state?.progress != null ? `Loading ${label}: ${Math.round(data.state.progress)}%… audio remains local.` : `Loading ${label} on this device…`;
        }
        if (data.type === 'error') { $('voice-status').textContent = `Transcription unavailable: ${data.message}. Review the browser and model connection, then retry.`; worker.terminate(); worker = null; $('voice-cancel').hidden = true; updateConsentState(); }
        if (data.type === 'result') {
          const words = data.words.slice(0, MAX_TRANSCRIPT_WORDS).map((word, index) => ({ ...word, id: `${Date.now()}-${index}`, selected: false, score: null }));
          project.voice.transcripts.push({ id: `${Date.now()}`, sourcePad: padId, words }); project.voice.transcripts = project.voice.transcripts.slice(-16);
          save(); $('voice-status').textContent = `Draft transcript has ${words.length} timestamped words. Confidence is not provided; check wording and timing.`;
          worker.terminate(); worker = null; $('voice-cancel').hidden = true; render();
        }
      };
      worker.onerror = () => { $('voice-status').textContent = 'The local model could not start in this browser. The clip was not sent anywhere.'; worker?.terminate(); worker = null; $('voice-cancel').hidden = true; $('voice-transcribe').disabled = false; };
      worker.postMessage({ type: 'transcribe', samples }, [samples.buffer]); $('voice-status').textContent = 'Loading the on-device speech model…';
    } catch (error) { $('voice-status').textContent = `Could not decode this clip: ${error.message}`; $('voice-cancel').hidden = true; updateConsentState(); }
  });
  $('voice-cancel').addEventListener('click', () => { worker?.terminate(); worker = null; $('voice-cancel').hidden = true; updateConsentState(); $('voice-status').textContent = 'Transcription canceled. The local clip was not uploaded.'; });
  $('voice-make-phrase').addEventListener('click', () => {
    if (project.voice.phrases.length >= MAX_VOICE_PHRASES) return;
    const transcript = project.voice.transcripts.at(-1), chosen = transcript?.words.filter(word => word.selected) || [];
    if (!chosen.length) return;
    const words = chosen.map(word => ({ text: word.text, sourcePad: transcript.sourcePad, start: word.start, end: word.end }));
    project.voice.phrases.push({ id: `${Date.now()}`, name: `Phrase ${project.voice.phrases.length + 1}`, words });
    transcript.words.forEach(word => { word.selected = false; }); save(); render();
  });
  $('melody-tuning').addEventListener('change', () => { project.voice.melody.tuning = clamp($('melody-tuning').value, 400, 480); save(); renderMelody(project, save); });
  $('melody-add').addEventListener('click', () => { if (project.voice.melody.notes.length >= MAX_MELODY_NOTES) return; const notes = project.voice.melody.notes; notes.push({ midi: 60, step: notes.length ? notes.at(-1).step + 4 : 0, duration: 4, word: '' }); save(); renderMelody(project, save); });
  $('melody-play').addEventListener('click', async () => {
    if (!project.voice.melody.notes.length) return notify('Add a note to write your melody first.');
    await audio.unlock(); const ctx = audio.context, now = ctx.currentTime + .05, secondsPerStep = 60 / project.bpm / 4;
    for (const note of project.voice.melody.notes) {
      const start = now + note.step * secondsPerStep, length = note.duration * secondsPerStep;
      const cue = note.word && project.voice.phrases.flatMap(phrase => phrase.words).find(word => word.text === note.word && audio.sources.get(word.sourcePad)?.file);
      if (cue) {
        const sourcePad = project.pads[cue.sourcePad];
        audio.trigger(cue.sourcePad, { ...sourcePad, start: cue.start, end: cue.end, pitch: clamp(note.midi - 60, -12, 12), speed: 1 }, undefined, start);
        continue;
      }
      const oscillator = ctx.createOscillator(), gain = ctx.createGain(); oscillator.type = 'triangle'; oscillator.frequency.setValueAtTime(midiFrequency(note.midi, project.voice.melody.tuning), start);
      gain.gain.setValueAtTime(.0001, start); gain.gain.linearRampToValueAtTime(.16, start + .015); gain.gain.setValueAtTime(.16, Math.max(start + .016, start + length - .02)); gain.gain.linearRampToValueAtTime(.0001, start + length);
      oscillator.connect(gain).connect(audio.master); oscillator.start(start); oscillator.stop(start + length + .01); oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
    }
  });
  $('melody-export').addEventListener('click', () => { const blob = midiFile(project.voice.melody.notes, project.bpm, project.voice.melody.tuning); download(blob, `${project.title || 'madladpad'}-melody.mid`); });
  $('rap-scheme').addEventListener('change', () => { project.voice.rap.scheme = $('rap-scheme').value; save(); });
  $('rap-export').addEventListener('click', () => { const lines = project.voice.rap.bars.map((line, index) => `${String(index + 1).padStart(2, '0')}  ${line}`); const blob = new Blob([`# ${project.title} · ${project.bpm} BPM · ${project.voice.rap.scheme}\n\n${lines.join('\n')}\n`], { type: 'text/plain;charset=utf-8' }); download(blob, `${project.title || 'madladpad'}-lyrics.txt`); });
  render();
}
