import { clamp, boundTranscriptWordTimes, midiFrequency, midiFile, audioBufferToWav, estimateSyllables, HARMONY_INTERVALS, MAX_MEDIA_BYTES, MAX_MELODY_NOTES, MAX_TRANSCRIPT_WORDS, MAX_VOICE_PHRASES, MAX_VOCAL_LAYERS, findAudioRecorderMime, extensionForAudioMime, AsyncActivity } from './core.js';
import { getValue, saveVoiceLayer, deleteVoiceLayer } from './storage.js';
import { detectPitch } from './tuner.js';

const $ = id => document.getElementById(id);
const rhymes = {
  light:['night','bright','flight','sight','write','mic'], day:['way','play','say','stay','away','display'],
  flow:['glow','show','know','grow','slow','go'], time:['rhyme','climb','line','shine','design'],
  sound:['ground','round','found','around','bound'], heart:['start','art','part','smart'],
  fire:['higher','wire','inspire','desire'], mind:['find','kind','grind','behind'],
  cat:['bat','flat','hat','mat','sat','chat'], back:['black','crack','track','stack','pack','attack'],
  face:['place','grace','space','trace','case','chase'], rain:['train','chain','brain','plain','gain','remain'],
  run:['fun','sun','spun','stun','begun','outrun'], love:['above','dove','glove','shove'],
  home:['roam','foam','dome','chrome','comb'], make:['take','break','shake','wake','awake','mistake'],
  beat:['heat','street','repeat','complete','seat','meet'], high:['sky','fly','try','why','supply','reply'],
  name:['game','same','flame','frame','claim','became'], dream:['beam','cream','seem','team','stream','theme'],
  real:['feel','deal','heal','steal','reveal','appeal'], cold:['bold','hold','told','gold','sold','scold'],
  star:['car','far','scar','bar','guitar','bizarre'], world:['curled','twirled','hurled','unfurled']
};
const wordKey = text => String(text).toLowerCase().replace(/[^a-z']/g, '').replace(/(?:ing|ed|s)$/, '');
function rhymeHints(line) {
  const word = wordKey(line.trim().split(/\s+/).at(-1));
  if (!word) return [];
  for (const [key, values] of Object.entries(rhymes)) if (word === key || values.includes(word)) return [key, ...values].filter(value => value !== word).slice(0, 4);
  return Object.entries(rhymes).flatMap(([key, values]) => [key, ...values].filter(value => value.endsWith(word.slice(-2)) && value !== word)).slice(0, 4);
}
function rhymeGroup(index, scheme) {
  const position = index % 4;
  if (scheme === 'AABB') return position < 2 ? 'A' : 'B';
  if (scheme === 'ABAB') return position % 2 ? 'B' : 'A';
  if (scheme === 'AAAA') return 'A';
  return null;
}

async function renderPhraseBuffer(phrase, audio) {
  if (!phrase.words.length) throw new Error('Add words to the phrase before exporting.');
  const sampleRate = Math.min(48000, audio.context.sampleRate);
  const requestedCrossfade = clamp(phrase.crossfadeMs ?? 0, 0, 250) / 1000;
  const gap = requestedCrossfade ? 0 : clamp(phrase.gapMs ?? 35, 0, 500) / 1000;
  const clips = [];
  let cursor = 0, previousDuration = 0;
  for (const word of phrase.words) {
    const source = audio.sources.get(word.sourcePad);
    if (!source?.file) throw new Error(`The source sample for “${word.text}” is not loaded.`);
    const buffer = source.buffer || await audio.context.decodeAudioData(await source.file.arrayBuffer());
    const start = clamp(word.start, 0, Math.max(0, buffer.duration - .01));
    const duration = Math.min(Math.max(.04, word.end - word.start), buffer.duration - start);
    if (duration < .03) continue;
    const overlap = clips.length ? Math.min(requestedCrossfade, previousDuration / 2, duration / 2) : 0;
    if (clips.length) cursor += previousDuration + gap - overlap;
    const explicitFadeIn = clips.length ? overlap : clamp(phrase.wordFadeInMs ?? 0, 0, 250) / 1000;
    const clip = { buffer, start, duration, at: cursor, fadeIn: Math.min(explicitFadeIn, duration / 2), fadeOut: 0 };
    if (clips.length) clips.at(-1).fadeOut = overlap;
    clips.push(clip); previousDuration = duration;
    if (cursor + duration > 60) throw new Error('Phrase audio export is limited to 60 seconds. Split this phrase into shorter parts.');
  }
  if (!clips.length) throw new Error('No source audio could be decoded for this phrase.');
  if (clips.length === 1) clips[0].fadeOut = Math.min(clamp(phrase.wordFadeOutMs ?? 0, 0, 250) / 1000, clips[0].duration / 2);
  const seconds = clips.at(-1).at + clips.at(-1).duration;
  const frameCount = Math.max(1, Math.ceil(seconds * sampleRate)), offline = new OfflineAudioContext(2, frameCount, sampleRate);
  const curve = (rising, gain = .9) => Float32Array.from({ length: 33 }, (_, index) => {
    const phase = index / 32 * Math.PI / 2;
    return gain * (rising ? Math.sin(phase) : Math.cos(phase));
  });
  for (const clip of clips) {
    const node = offline.createBufferSource(), gain = offline.createGain(); node.buffer = clip.buffer;
    const stop = clip.at + clip.duration;
    const fadeIn = clip.fadeIn || Math.min(.008, clip.duration / 4);
    const fadeOut = clip.fadeOut || Math.min(.008, clip.duration / 4);
    gain.gain.setValueAtTime(0, clip.at);
    gain.gain.setValueCurveAtTime(curve(true), clip.at, fadeIn);
    const sustainStart = clip.at + fadeIn, sustainEnd = stop - fadeOut;
    if (sustainEnd > sustainStart + .00001) gain.gain.setValueAtTime(.9, sustainEnd);
    gain.gain.setValueCurveAtTime(curve(false), sustainEnd, fadeOut);
    node.connect(gain).connect(offline.destination); node.start(clip.at, clip.start, clip.duration); node.stop(stop + .002);
  }
  return offline.startRendering();
}

async function renderPhraseWav(phrase, audio) {
  return audioBufferToWav(await renderPhraseBuffer(phrase, audio));
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
    const timing = document.createElement('div'); timing.className = 'phrase-timing';
    const timingHelp = document.createElement('small'); timingHelp.className = 'phrase-timing-help'; timingHelp.textContent = 'Choose silence between words or a crossfade overlap.'; timing.append(timingHelp);
    const timingControl = (key, label, max, help) => {
      const field = document.createElement('label'); field.textContent = label;
      const input = document.createElement('input'); input.type = 'number'; input.min = '0'; input.max = String(max); input.step = '5'; input.value = String(phrase[key] ?? 0);
      input.setAttribute('aria-label', `${phrase.name} ${label.toLowerCase()}`);
      input.addEventListener('change', () => {
        phrase[key] = clamp(input.value, 0, max);
        if (phrase[key] > 0) phrase[key === 'gapMs' ? 'crossfadeMs' : 'gapMs'] = 0;
        save(); renderPhrases(project, audio, notify, save, assignWordsToPads);
      });
      const note = document.createElement('small'); note.textContent = help; field.append(input, note); timing.append(field);
    };
    timingControl('gapMs', 'GAP', 500, 'between words · ms');
    timingControl('crossfadeMs', 'CROSSFADE', 250, 'overlap · ms');
    const controls = document.createElement('div'); controls.className = 'voice-actions';
    const play = document.createElement('button'); play.type = 'button'; play.className = 'pill-button'; play.textContent = '▶ PREVIEW'; play.setAttribute('aria-label', `Preview ${phrase.name}`);
    play.addEventListener('click', async () => {
      play.disabled = true;
      try {
        await audio.unlock();
        const rendered = await renderPhraseBuffer(phrase, audio);
        const source = audio.context.createBufferSource(); source.buffer = rendered; source.connect(audio.master);
        source.onended = () => { source.disconnect(); play.disabled = false; };
        source.start(audio.context.currentTime + .04);
      } catch (error) { notify(`Phrase preview failed: ${error.message}`); play.disabled = false; }
    }); controls.append(play);
    const assign = document.createElement('button'); assign.type = 'button'; assign.className = 'pill-button'; assign.textContent = 'MAP WORDS TO PADS + STEPS';
    assign.setAttribute('aria-label', `Map ${phrase.name} words to pads and steps`);
    assign.setAttribute('aria-describedby', 'voice-map-help');
    assign.addEventListener('click', async () => {
      if (!phrase.words.length) return;
      assign.disabled = true;
      try {
        const clips = [];
        const wordDurations = await Promise.all(phrase.words.map(async word => {
          const source = audio.sources.get(word.sourcePad);
          if (!source?.file) throw new Error(`The source sample for “${word.text}” is not loaded.`);
          const buffer = source.buffer || await audio.context.decodeAudioData(await source.file.arrayBuffer());
          const start = clamp(word.start, 0, Math.max(0, buffer.duration - .01));
          return Math.min(Math.max(.04, word.end - word.start), buffer.duration - start);
        }));
        const crossfade = clamp(phrase.crossfadeMs ?? 0, 0, 250) / 1000;
        for (let wordIndex = 0; wordIndex < phrase.words.length; wordIndex++) {
          const word = phrase.words[wordIndex];
          const fadeIn = wordIndex ? Math.min(crossfade, wordDurations[wordIndex - 1] / 2, wordDurations[wordIndex] / 2) : 0;
          const fadeOut = wordIndex < phrase.words.length - 1 ? Math.min(crossfade, wordDurations[wordIndex] / 2, wordDurations[wordIndex + 1] / 2) : 0;
          const blob = await renderPhraseWav({ words: [word], gapMs: 0, crossfadeMs: 0, wordFadeInMs: fadeIn * 1000, wordFadeOutMs: fadeOut * 1000 }, audio);
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
        const blob = await renderPhraseWav(phrase, audio);
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
    card.append(title, timing, controls, words); host.append(card);
  });
}

function renderMelody(project, save) {
  const host = $('melody-notes'); host.replaceChildren();
  $('melody-follow-beat').checked=project.voice.melody.followBeat;
  $('melody-tuning').value = project.voice.melody.tuning;
  $('melody-harmony-interval').value = String(project.voice.melody.harmonyInterval);
  const wordOptions = [''].concat(project.voice.phrases.flatMap(phrase => phrase.words.map(word => word.text)));
  project.voice.melody.notes.forEach((note, index) => {
    const row = document.createElement('div'); row.className = 'melody-note';
    const noteLabel = `${note.layer === 'harmony' ? 'Harmony' : 'Note'} ${index + 1}`;
    const noteName = document.createElement('span'); noteName.textContent = `${noteLabel} · ${midiFrequency(note.midi, project.voice.melody.tuning).toFixed(1)} Hz`;
    const pitch = document.createElement('input'); pitch.type = 'number'; pitch.min = '24'; pitch.max = '108'; pitch.value = note.midi; pitch.setAttribute('aria-label', `${noteLabel} MIDI pitch`);
    const step = document.createElement('input'); step.type = 'number'; step.min = '0'; step.max = '255'; step.value = note.step; step.setAttribute('aria-label', `${noteLabel} sixteenth step`);
    const duration = document.createElement('input'); duration.type = 'number'; duration.min = '.125'; duration.max = '16'; duration.step = '.125'; duration.value = note.duration; duration.setAttribute('aria-label', `${noteLabel} duration in sixteenth steps`);
    const word = document.createElement('select'); word.setAttribute('aria-label', `Assign phrase word to ${noteLabel.toLowerCase()}`);
    wordOptions.forEach(value => { const option = document.createElement('option'); option.value = value; option.textContent = value || 'No word cue'; word.append(option); }); word.value = note.word;
    for (const [input, key] of [[pitch, 'midi'], [step, 'step'], [duration, 'duration'], [word, 'word']]) input.addEventListener('change', () => { note[key] = key === 'word' ? input.value : Number(input.value); save(); renderMelody(project, save); });
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'pill-button'; remove.textContent = '×'; remove.setAttribute('aria-label', `Delete ${noteLabel.toLowerCase()}`); remove.addEventListener('click', () => { project.voice.melody.notes.splice(index, 1); save(); renderMelody(project, save); });
    row.append(noteName, pitch, step, duration, word, remove); host.append(row);
  });
  $('melody-add').disabled = project.voice.melody.notes.length >= MAX_MELODY_NOTES;
  $('melody-harmony-add').disabled = project.voice.melody.notes.length >= MAX_MELODY_NOTES;
}

function renderRap(project, save, audio, notify) {
  $('rap-scheme').value = project.voice.rap.scheme;
  const host = $('rap-bars'); host.replaceChildren();
  project.voice.rap.bars.forEach((line, index) => {
    const row = document.createElement('label'); row.className = 'rap-bar';
    row.dataset.bar=String(index);
    const number = document.createElement('span'); number.textContent = String(index + 1).padStart(2, '0');
    const text = document.createElement('textarea'); text.maxLength = 500; text.rows = 2; text.value = line; text.placeholder = `Bar ${index + 1}`; text.setAttribute('aria-label', `Rap bar ${index + 1}`);
    const meta = document.createElement('small'); const renderMeta = () => {
      const line = project.voice.rap.bars[index], scheme = project.voice.rap.scheme, group = rhymeGroup(index, scheme);
      let anchor = null;
      if (group) for (let earlier = index - 1; earlier >= 0; earlier--) {
        if (rhymeGroup(earlier, scheme) !== group) continue;
        const candidate = project.voice.rap.bars[earlier].trim().split(/\s+/).at(-1) || '';
        if (wordKey(candidate)) { anchor = { word: candidate, index: earlier }; break; }
      }
      const target = anchor?.word || line.trim().split(/\s+/).at(-1) || '';
      const currentEnding = wordKey(line.trim().split(/\s+/).at(-1));
      const hints = rhymeHints(target).filter(word => word !== currentEnding).slice(0, 3);
      const cues = [];
      if (anchor) cues.push(`match bar ${anchor.index + 1} “${anchor.word}”`);
      if (hints.length) cues.push(`rhyme ideas: ${hints.join(', ')}`);
      meta.textContent = [`${group ? `${group} rhyme` : 'Free rhyme'}`, `${estimateSyllables(line)} estimated syllables`, ...cues].join(' · ');
    };
    row.updateMeta = renderMeta;
    text.addEventListener('input', () => { project.voice.rap.bars[index] = text.value; host.querySelectorAll('.rap-bar').forEach(item => item.updateMeta?.()); save(); }); renderMeta(); row.append(number, text, meta);
    const flowDetails=document.createElement('details');flowDetails.className='rap-flow';
    const summary=document.createElement('summary');summary.textContent=`FLOW · ${project.voice.rap.flow[index].filter(Boolean).length}/16 syllable starts`;flowDetails.append(summary);
    const grid=document.createElement('div');grid.className='rap-flow-grid';grid.setAttribute('role','group');grid.setAttribute('aria-label',`Rap bar ${index+1} syllable flow steps`);
    project.voice.rap.flow[index].forEach((active,step)=>{
      const cell=document.createElement('button');cell.type='button';cell.className=`rap-flow-step${active?' active':''}`;cell.textContent=String(step+1);cell.setAttribute('aria-label',`Bar ${index+1} flow step ${step+1}`);cell.setAttribute('aria-pressed',String(active));
      cell.addEventListener('click',()=>{project.voice.rap.flow[index][step]=!project.voice.rap.flow[index][step];cell.classList.toggle('active',project.voice.rap.flow[index][step]);cell.setAttribute('aria-pressed',String(project.voice.rap.flow[index][step]));summary.textContent=`FLOW · ${project.voice.rap.flow[index].filter(Boolean).length}/16 syllable starts`;save();});grid.append(cell);
    });
    const audition=document.createElement('button');audition.type='button';audition.className='pill-button';audition.textContent='▶ AUDITION FLOW';audition.setAttribute('aria-label',`Audition rap flow for bar ${index+1}`);
    audition.addEventListener('click',async()=>{
      if(!project.voice.rap.flow[index].some(Boolean)){notify(`Add syllable starts to bar ${index+1} before auditioning its flow.`);return;}
      audition.disabled=true;
      try{await audio.unlock();const ctx=audio.context,now=ctx.currentTime+.04,secondsPerStep=60/project.bpm/4;
        for(let step=0;step<16;step++)if(project.voice.rap.flow[index][step]){const at=now+step*secondsPerStep,osc=ctx.createOscillator(),gain=ctx.createGain();osc.type='sine';osc.frequency.setValueAtTime(step%4===0?1050:step%4===2?820:640,at);gain.gain.setValueAtTime(.0001,at);gain.gain.exponentialRampToValueAtTime(step%4===0?.11:.07,at+.003);gain.gain.exponentialRampToValueAtTime(.0001,at+.045);osc.connect(gain).connect(audio.master);osc.start(at);osc.stop(at+.05);osc.onended=()=>{osc.disconnect();gain.disconnect();};}
        notify(`Auditioning bar ${index+1} flow at ${project.bpm} BPM.`);
      }catch(error){notify(`Could not audition rap flow: ${error.message}`);}finally{audition.disabled=false;}
    });
    flowDetails.append(grid,audition);row.append(flowDetails);host.append(row);
  });
}

export async function initVoiceLab({ getProject, getMediaFiles, getAudio, getTransport, notify, save, assignWordsToPads }) {
  const project = getProject(), audio = getAudio();
  let worker = null;
  const transcriptionActivity = new AsyncActivity();
  let vocalRecording = null;
  let tunerStream = null, tunerSource = null, tunerAnalyser = null, tunerTimer = null, tunerFrame = null;
  const tunerActivity = new AsyncActivity();
  const vocalFiles = new Map();
  const updateConsentState = () => { $('voice-transcribe').disabled = transcriptionActivity.phase!=='idle' || !$('voice-source-pad').value || !$('voice-consent').checked; };
  const cancelTranscription = (message = null) => {
    transcriptionActivity.cancel();
    worker?.terminate(); worker = null;
    $('voice-cancel').hidden = true;
    updateConsentState();
    if (message) $('voice-status').textContent = message;
  };
  const updateManualEntryState = () => { $('voice-manual-add').disabled = !$('voice-source-pad').value || !getMediaFiles().has(Number($('voice-source-pad').value)) || !$('voice-manual-text').value.trim(); };
  const transportState = () => getTransport?.() || {running:false, epoch:audio.transportEpoch, bpm:project.bpm};
  const stopTuner = (message = 'Tuner stopped. Microphone is off.') => {
    tunerActivity.cancel();
    if (tunerTimer) clearInterval(tunerTimer);
    tunerTimer = null;
    if (tunerFrame) cancelAnimationFrame(tunerFrame);
    tunerFrame = null;
    try { tunerSource?.disconnect(); } catch { /* already disconnected */ }
    tunerSource = null; tunerAnalyser = null;
    tunerStream?.getTracks().forEach(track => track.stop()); tunerStream = null;
    $('tuner-start').hidden = false; $('tuner-start').disabled = false; $('tuner-stop').hidden = true;
    $('tuner-status').textContent = message;
  };
  const updateOverdubControls = () => {
    const state = transportState();
    $('voice-overdub-record').disabled = !state.running || Boolean(vocalRecording) || project.voice.layers.length >= MAX_VOCAL_LAYERS;
    $('voice-overdub-stop').hidden = !vocalRecording;
    if (project.voice.layers.length >= MAX_VOCAL_LAYERS && !vocalRecording) $('voice-overdub-status').textContent = `The ${MAX_VOCAL_LAYERS} vocal-layer limit is full. Export a project pack before deleting a raw take.`;
    else if (!state.running && !vocalRecording && !$('voice-overdub-status').textContent) $('voice-overdub-status').textContent = 'Start the sequencer to record a vocal layer.';
  };
  function renderVocalLayers() {
    const host = $('voice-overdub-layers'); host.replaceChildren();
    project.voice.layers.forEach((layer, index) => {
      const row = document.createElement('div'); row.className = 'vocal-layer'; row.dataset.layer = layer.id;
      const name = document.createElement('input'); name.className = 'vocal-layer-name'; name.value = layer.name; name.maxLength = 48; name.setAttribute('aria-label', `Vocal layer ${index + 1} name`);
      name.addEventListener('change', () => { layer.name = name.value.trim() || `Vocal take ${index + 1}`; save(); });
      const offset = document.createElement('label'); offset.className = 'vocal-layer-start'; offset.append(document.createTextNode('START STEP'));
      const offsetInput = document.createElement('input'); offsetInput.type = 'number'; offsetInput.min = '0'; offsetInput.max = '4096'; offsetInput.step = '1'; offsetInput.value = String(layer.startStep); offsetInput.setAttribute('aria-label', `Vocal layer ${index + 1} start step`);
      offsetInput.addEventListener('change', () => { layer.startStep = Math.round(clamp(offsetInput.value, 0, 4096)); save(); renderVocalLayers(); });
      offset.append(offsetInput);
      const gain = document.createElement('label'); gain.className = 'vocal-layer-gain'; gain.append(document.createTextNode('GAIN'));
      const slider = document.createElement('input'); slider.type = 'range'; slider.min = '0'; slider.max = '1.5'; slider.step = '.01'; slider.value = String(layer.gain); slider.setAttribute('aria-label', `Vocal layer ${index + 1} gain`);
      const output = document.createElement('output'); output.textContent = `${Math.round(layer.gain * 100)}%`;
      slider.addEventListener('input', () => { layer.gain = clamp(slider.value, 0, 1.5); output.textContent = `${Math.round(layer.gain * 100)}%`; audio.updateVocalLayerStates(project.voice.layers); save(); });
      gain.append(slider, output);
      const control = (text, label, active, action) => { const button = document.createElement('button'); button.type = 'button'; button.className = `pill-button${active ? ' active' : ''}`; button.textContent = text; button.setAttribute('aria-label', label); button.setAttribute('aria-pressed', String(active)); button.addEventListener('click', action); return button; };
      const mute = control(layer.muted ? 'UNMUTE' : 'MUTE', `${layer.muted ? 'Unmute' : 'Mute'} vocal layer ${index + 1}`, layer.muted, () => { layer.muted = !layer.muted; audio.updateVocalLayerStates(project.voice.layers); save(); renderVocalLayers(); });
      const solo = control(layer.solo ? 'SOLO ON' : 'SOLO', `${layer.solo ? 'Disable solo' : 'Solo'} vocal layer ${index + 1}`, layer.solo, () => { layer.solo = !layer.solo; audio.updateVocalLayerStates(project.voice.layers); save(); renderVocalLayers(); });
      const preview = control('▶', `Preview vocal layer ${index + 1}`, false, async () => { await audio.unlock(); if (!audio.previewVocalLayer(layer.id, layer.gain,layer.pitch)) $('voice-overdub-status').textContent = 'Pitch processor or audio decoder unavailable for this layer.'; });
      preview.disabled = !audio.vocalSources.get(layer.id)?.buffer;
      const pitch=document.createElement('label');pitch.className='vocal-layer-pitch';pitch.append(document.createTextNode('PITCH (ST)'));
      const pitchInput=document.createElement('input');pitchInput.type='number';pitchInput.min='-12';pitchInput.max='12';pitchInput.step='.1';pitchInput.value=String(layer.pitch||0);pitchInput.setAttribute('aria-label',`Pitch for vocal layer ${index+1}`);
      pitchInput.addEventListener('change',()=>{layer.pitch=clamp(pitchInput.value,-12,12);save();renderVocalLayers();});pitch.append(pitchInput);
      const remove = control('DELETE', `Delete vocal layer ${index + 1} and its raw take`, false, async () => {
        if (!confirm(`Delete ${layer.name} and its saved raw recording?`)) return;
        const nextLayers = project.voice.layers.filter(item => item.id !== layer.id);
        try {
          await deleteVoiceLayer(layer.id, {...project, voice:{...project.voice, layers:nextLayers}});
          audio.stopVocalLayer(layer.id); audio.vocalSources.delete(layer.id); vocalFiles.delete(layer.id);
          project.voice.layers = nextLayers; save(); renderVocalLayers(); updateOverdubControls();
          $('voice-overdub-status').textContent = 'Vocal layer and local raw take deleted.';
        } catch (error) { $('voice-overdub-status').textContent = `Could not delete this take: ${error.message}`; }
      });
      const meta = document.createElement('small'); meta.className = 'vocal-layer-meta';
      const bar = Math.floor(layer.startStep / 16) + 1, step = layer.startStep % 16;
      meta.textContent = `${vocalFiles.has(layer.id) ? 'Raw take saved locally' : 'Raw take file missing'} · starts at bar ${bar}, step ${step + 1}`;
      row.append(name, offset, gain, pitch, mute, solo, preview, remove, meta); host.append(row);
    });
    updateOverdubControls();
  }
  function render() {
    const selected = $('voice-source-pad').value;
    const select = $('voice-source-pad'); select.replaceChildren();
    for (const [id, file] of getMediaFiles()) if (/^(audio|video)\//.test(file.type)) { const option = document.createElement('option'); option.value = id; option.textContent = `${project.pads[id].name} · ${file.name || file.type}`; select.append(option); }
    if ([...select.options].some(option => option.value === selected)) select.value = selected;
    updateConsentState(); updateManualEntryState();
    renderWords(project, getMediaFiles, save); renderPhrases(project, audio, notify, save, assignWordsToPads); renderMelody(project, save); renderRap(project, save, audio, notify); renderVocalLayers();
  }
  const stopOverdub = () => {
    const take = vocalRecording;
    if (!take) return;
    $('voice-overdub-status').textContent = 'Saving the raw vocal take locally…';
    if (take.recorder.state !== 'inactive') take.recorder.stop();
  };
  $('voice-overdub-record').addEventListener('click', async () => {
    if (project.voice.layers.length >= MAX_VOCAL_LAYERS) return updateOverdubControls();
    const currentTransport = transportState();
    if (!currentTransport.running) { $('voice-overdub-status').textContent = 'Start the sequencer before recording a vocal overdub.'; return; }
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { $('voice-overdub-status').textContent = 'This browser does not support local microphone recording.'; return; }
    $('voice-overdub-record').disabled = true; $('voice-overdub-status').textContent = 'Requesting microphone access…';
    let stream;
    try {
      await audio.unlock();
      stream = await navigator.mediaDevices.getUserMedia({audio:true});
      const transport = transportState();
      if (!transport.running) throw new Error('The sequencer stopped before recording could start.');
      const mime = findAudioRecorderMime();
      const recorder = new MediaRecorder(stream, mime ? {mimeType:mime} : undefined), chunks = [];
      const secondsPerStep = 60 / clamp(transport.bpm, 40, 240) / 4;
      const startStep = Math.max(0, Math.ceil((audio.context.currentTime - transport.epoch - .001) / secondsPerStep));
      const targetTime = transport.epoch + startStep * secondsPerStep;
      if (targetTime > audio.context.currentTime) {
        $('voice-overdub-status').textContent = 'Microphone ready. Aligning the raw take to the next sixteenth note…';
        await new Promise(resolve => setTimeout(resolve, Math.max(0, (targetTime - audio.context.currentTime) * 1000)));
      }
      const alignedTransport = transportState();
      if (!alignedTransport.running || alignedTransport.epoch !== transport.epoch) throw new Error('The sequencer changed before the aligned recording could start.');
      const take = {stream, recorder, startStep, chunks}; vocalRecording = take;
      recorder.ondataavailable = event => { if (event.data?.size) chunks.push(event.data); };
      recorder.onerror = event => { $('voice-overdub-status').textContent = `Microphone recording failed: ${event.error?.message || 'unknown error'}`; stopOverdub(); };
      recorder.onstop = async () => {
        stream.getTracks().forEach(track => track.stop());
        const type = recorder.mimeType || mime || 'audio/webm';
        const blob = new Blob(chunks, {type});
        try {
          if (!blob.size) throw new Error('The browser did not capture any microphone audio.');
          const usedBytes = [...getMediaFiles().values(), ...vocalFiles.values()].reduce((sum, file) => sum + (file?.size || 0), 0);
          if (usedBytes + blob.size > MAX_MEDIA_BYTES) throw new Error('This take would exceed the 80 MB local project media limit. Export a pack and remove unused media before recording more.');
          const index = project.voice.layers.length + 1, id = `vocal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          const file = new File([blob], `vocal-take-${Date.now()}.${extensionForAudioMime(type)}`, {type});
          const layer = {id, name:`Vocal take ${index}`, startStep:take.startStep, gain:1, muted:false, solo:false};
          const nextLayers = [...project.voice.layers, layer];
          await saveVoiceLayer(id, file, {...project, voice:{...project.voice, layers:nextLayers}});
          project.voice.layers.push(layer); vocalFiles.set(id, file);
          const playable = await audio.loadVocalLayer(id, file);
          save(); renderVocalLayers();
          $('voice-overdub-status').textContent = playable
            ? `${layer.name} saved locally as a separate raw take. It starts at bar ${Math.floor(layer.startStep / 16) + 1}, step ${layer.startStep % 16 + 1}.`
            : `${layer.name} raw take is saved locally, but this browser cannot decode it for playback.`;
        } catch (error) { $('voice-overdub-status').textContent = `Could not save vocal take: ${error.message}`; }
        finally { if (vocalRecording === take) vocalRecording = null; updateOverdubControls(); }
      };
      recorder.start(200);
      $('voice-overdub-stop').hidden = false;
      $('voice-overdub-status').textContent = 'Recording microphone audio over the playing sequence. The raw take stays local.';
    } catch (error) {
      stream?.getTracks().forEach(track => track.stop());
      vocalRecording = null; updateOverdubControls();
      $('voice-overdub-status').textContent = `Could not start local vocal recording: ${error.message}`;
    }
  });
  $('voice-overdub-stop').addEventListener('click', stopOverdub);
  $('vocal-add-harmony').addEventListener('click',async()=>{
    if(!audio.pitchReady)return notify('The local pitch processor is unavailable; a harmony would not stay in tune and time on this device.');
    if(project.voice.layers.length>=MAX_VOCAL_LAYERS)return notify('The vocal layer limit is full.');
    const source=project.voice.layers.slice().reverse().find(layer=>layer.sourceId===layer.id||!layer.sourceId);
    const raw=source&&vocalFiles.get(source.id);
    if(!raw)return notify('Record and save a raw microphone take before adding an automatic harmony.');
    const usedBytes=[...getMediaFiles().values(),...vocalFiles.values()].reduce((sum,file)=>sum+(file?.size||0),0);
    if(usedBytes+raw.size>MAX_MEDIA_BYTES)return notify('Not enough local project media space to preserve another editable harmony layer.');
    const interval=Number($('vocal-harmony-interval').value),id=`harmony-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
    const layer={id,name:`${source.name} · harmony ${interval>0?'+':''}${interval}`,sourceId:source.id,startStep:source.startStep,gain:.6,muted:false,solo:false,pitch:interval};
    const file=new File([raw],`harmony-source-${Date.now()}.${extensionForAudioMime(raw.type)}`,{type:raw.type});
    try{
      await saveVoiceLayer(id,file,{...project,voice:{...project.voice,layers:[...project.voice.layers,layer]}});
      project.voice.layers.push(layer);vocalFiles.set(id,file);
      await audio.loadVocalLayer(id,file);save();renderVocalLayers();
      $('voice-overdub-status').textContent=`Created an editable ${interval>0?'+':''}${interval}-semitone harmony. It retains a separate copy of the original recording.`;
    }catch(error){$('voice-overdub-status').textContent=`Harmony could not be saved: ${error.message}`;}
  });
  async function reloadLayers() {
    audio.stopVocalLayers(); audio.vocalSources.clear(); vocalFiles.clear();
    for (const layer of project.voice.layers) {
      const file = await getValue(`voice-layer:${layer.id}`);
      if (file?.type?.startsWith('audio/')) { vocalFiles.set(layer.id, file); await audio.loadVocalLayer(layer.id, file); }
    }
    renderVocalLayers();
  }
  await reloadLayers();
  window.addEventListener('madladpad-media-change', render);
  $('voice-source-pad').addEventListener('change', () => {
    if (transcriptionActivity.phase!=='idle') cancelTranscription('Source changed. Previous transcription canceled.');
    render();
  });
  $('voice-consent').addEventListener('change', () => {
    if (!$('voice-consent').checked && transcriptionActivity.phase!=='idle') cancelTranscription('Consent withdrawn. Transcription canceled.');
    render();
  });
  $('voice-manual-text').addEventListener('input', updateManualEntryState);
  $('voice-manual-add').addEventListener('click', () => {
    const padId = Number($('voice-source-pad').value), text = $('voice-manual-text').value.trim();
    const start = clamp($('voice-manual-start').value, 0, 3600), end = clamp($('voice-manual-end').value, 0, 3600);
    if (!getMediaFiles().has(padId) || !text) { updateManualEntryState(); return; }
    if (end <= start) { $('voice-status').textContent = 'The manual word end time must be after its start time.'; $('voice-manual-end').focus(); return; }
    let transcript = project.voice.transcripts.slice().reverse().find(item => item.sourcePad === padId);
    if (transcript?.words.length >= MAX_TRANSCRIPT_WORDS) { $('voice-status').textContent = `This transcript already has the ${MAX_TRANSCRIPT_WORDS}-word limit.`; return; }
    if (transcript) {
      project.voice.transcripts.splice(project.voice.transcripts.indexOf(transcript), 1);
    } else {
      transcript = {id:`manual-${Date.now()}`, sourcePad:padId, words:[]};
      if (project.voice.transcripts.length >= 16) project.voice.transcripts.shift();
    }
    transcript.words.push({id:`manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, text, start, end, selected:true, score:null});
    project.voice.transcripts.push(transcript);
    save(); renderWords(project, getMediaFiles, save);
    $('voice-status').textContent = `Added “${text}” at ${start.toFixed(2)}–${end.toFixed(2)} seconds. This manual alignment used no speech model.`;
    $('voice-manual-text').value = ''; $('voice-manual-start').value = end.toFixed(2); $('voice-manual-end').value = (end + .3).toFixed(2);
    updateManualEntryState();
  });
  $('voice-transcribe').addEventListener('click', async () => {
    const padId = Number($('voice-source-pad').value), file = getMediaFiles().get(padId);
    if (!$('voice-consent').checked || !file) return;
    if (file.size > 32 * 1024 * 1024) { $('voice-status').textContent = 'Choose a file smaller than 32 MB for this on-device workflow.'; return; }
    const token = transcriptionActivity.begin();
    if (token===null) return;
    $('voice-transcribe').disabled = true; $('voice-cancel').hidden = false; $('voice-status').textContent = 'Decoding the selected local clip…';
    try {
      let buffer = audio.sources.get(padId)?.buffer;
      if (!buffer) buffer = await audio.context.decodeAudioData(await file.arrayBuffer());
      if (!transcriptionActivity.current(token)) return;
      const samples = toMono16k(buffer);
      if (!transcriptionActivity.activate(token)) return;
      const activeWorker = new Worker('/voice-inference-worker.bundle.js', { type: 'module' });
      worker = activeWorker;
      activeWorker.onmessage = event => {
        if (!transcriptionActivity.current(token)) return;
        const data = event.data;
        if (data.type === 'progress') {
          const label = data.state?.file || 'speech model';
          $('voice-status').textContent = data.state?.progress != null ? `Loading ${label}: ${Math.round(data.state.progress)}%… audio remains local.` : `Loading ${label} on this device…`;
        }
        if (data.type === 'error') { const message=String(data.message||'Local transcription failed.'); const fetchFailure=/failed to fetch|networkerror|network request failed/i.test(message); cancelTranscription(fetchFailure?'Could not download the on-device speech model. Check your internet connection and retry, or add words and timestamps manually. Your audio was not uploaded.':`Transcription unavailable: ${message}. Review the browser and model connection, then retry.`); }
        if (data.type === 'result') {
          if (getMediaFiles().get(padId)!==file || $('voice-source-pad').value!==String(padId) || !$('voice-consent').checked) {
            cancelTranscription('Source or consent changed. The stale draft was discarded.');
            return;
          }
          const words = boundTranscriptWordTimes(data.words, buffer.duration).slice(0, MAX_TRANSCRIPT_WORDS).map((word, index) => ({ ...word, id: `${Date.now()}-${index}`, selected: false, score: null }));
          if (!words.length) {
            cancelTranscription('No usable timestamped words fit within this clip. Try again or add words and timestamps manually.');
            return;
          }
          project.voice.transcripts.push({ id: `${Date.now()}`, sourcePad: padId, words }); project.voice.transcripts = project.voice.transcripts.slice(-16);
          save(); $('voice-status').textContent = `Draft transcript has ${words.length} timestamped words. Confidence is not provided; check wording and timing.`;
          cancelTranscription(); render();
        }
      };
      activeWorker.onerror = () => { if (transcriptionActivity.current(token)) cancelTranscription('The local model could not start in this browser. The clip was not sent anywhere.'); };
      activeWorker.postMessage({ type: 'transcribe', samples }, [samples.buffer]); $('voice-status').textContent = 'Loading the on-device speech model…';
    } catch (error) { if (transcriptionActivity.current(token)) cancelTranscription(`Could not decode this clip: ${error.message}`); }
  });
  $('voice-cancel').addEventListener('click', () => cancelTranscription('Transcription canceled. The local clip was not uploaded.'));
  $('voice-make-phrase').addEventListener('click', () => {
    if (project.voice.phrases.length >= MAX_VOICE_PHRASES) return;
    const transcript = project.voice.transcripts.at(-1), chosen = transcript?.words.filter(word => word.selected) || [];
    if (!chosen.length) return;
    const words = chosen.map(word => ({ text: word.text, sourcePad: transcript.sourcePad, start: word.start, end: word.end }));
    project.voice.phrases.push({ id: `${Date.now()}`, name: `Phrase ${project.voice.phrases.length + 1}`, gapMs: 35, crossfadeMs: 0, words });
    transcript.words.forEach(word => { word.selected = false; }); save(); render();
  });
  $('melody-tuning').addEventListener('change', () => { project.voice.melody.tuning = clamp($('melody-tuning').value, 400, 480); save(); renderMelody(project, save); });
  $('tuner-start').addEventListener('click', async () => {
    const token = tunerActivity.begin();
    if (token===null) return;
    $('tuner-start').disabled = true;
    $('tuner-status').textContent = 'Requesting microphone access. Audio stays on this device…';
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.AudioContext) throw new Error('This browser does not support local microphone analysis.');
      await audio.unlock();
      if (!tunerActivity.current(token)) return;
      const stream = await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false}});
      if (!tunerActivity.activate(token)) { stream.getTracks().forEach(track => track.stop()); return; }
      tunerStream = stream;
      if (!tunerStream.getAudioTracks().length) throw new Error('The browser did not provide an audio track.');
      tunerSource = audio.context.createMediaStreamSource(tunerStream);
      tunerAnalyser = audio.context.createAnalyser(); tunerAnalyser.fftSize = 2048; tunerSource.connect(tunerAnalyser);
      tunerFrame = new Float32Array(tunerAnalyser.fftSize);
      $('tuner-start').hidden = true; $('tuner-stop').hidden = false;
      $('tuner-status').textContent = 'Listening locally. Play one steady note near your microphone.';
      const update = () => {
        if (!tunerAnalyser) return;
        tunerAnalyser.getFloatTimeDomainData(tunerFrame);
        const result = detectPitch(tunerFrame, audio.context.sampleRate, project.voice.melody.tuning);
        if (result) {
          const cents = Math.round(result.cents), inTune = Math.abs(cents) <= 5;
          $('tuner-note').textContent = result.note; $('tuner-frequency').textContent = `${result.frequency.toFixed(1)} Hz`;
          $('tuner-cents').textContent = `${cents > 0 ? '+' : ''}${cents} cents · A4 = ${project.voice.melody.tuning} Hz${inTune ? ' · IN TUNE' : ''}`;
          $('tuner-needle').style.left = `${50 + Math.max(-50, Math.min(50, cents))}%`;
        } else {
          $('tuner-note').textContent = '—'; $('tuner-frequency').textContent = 'Play one steady note';
          $('tuner-cents').textContent = `A4 = ${project.voice.melody.tuning} Hz`; $('tuner-needle').style.left = '50%';
        }
      };
      tunerTimer = setInterval(update, 90); update();
      const track = tunerStream.getAudioTracks()[0]; track.addEventListener('ended', () => { if (tunerActivity.current(token)) stopTuner('Microphone ended. Tuner stopped.'); });
    } catch (error) { if (tunerActivity.current(token)) stopTuner(`Tuner could not start: ${error.message}`); }
    finally { if (tunerActivity.current(token)) $('tuner-start').disabled = false; }
  });
  $('tuner-stop').addEventListener('click', () => stopTuner());
  $('melody-follow-beat').addEventListener('change',()=>{project.voice.melody.followBeat=$('melody-follow-beat').checked;save();});
  $('voice-story-combine').addEventListener('click',()=>{
    if(project.voice.phrases.length<2)return notify('Create at least two phrases from recorded or imported speech first.');
    if(project.voice.phrases.length>=MAX_VOICE_PHRASES)return notify('The phrase limit is full. Remove an unused phrase or export it first.');
    const originals=[...project.voice.phrases],words=originals.flatMap(phrase=>phrase.words.map(word=>({...word})));
    if(words.length>MAX_TRANSCRIPT_WORDS)return notify('The combined story exceeds the word limit. Use shorter phrases.');
    project.voice.phrases.push({id:`story-${Date.now()}`,name:'Story montage',gapMs:35,crossfadeMs:0,words});
    save();renderPhrases(project,audio,notify,save,assignWordsToPads);renderMelody(project,save);
    notify('Story montage created from the current phrase order; the original phrases remain intact.');
  });
  $('melody-harmony-interval').addEventListener('change', () => { const interval = Number($('melody-harmony-interval').value); if (!HARMONY_INTERVALS.includes(interval)) return; project.voice.melody.harmonyInterval = interval; save(); });
  $('melody-add').addEventListener('click', () => { if (project.voice.melody.notes.length >= MAX_MELODY_NOTES) return; const notes = project.voice.melody.notes; notes.push({ midi: 60, step: notes.length ? notes.at(-1).step + 4 : 0, duration: 4, word: '', layer: 'lead' }); save(); renderMelody(project, save); });
  $('melody-harmony-add').addEventListener('click', () => {
    const notes = project.voice.melody.notes;
    if (!notes.some(note => note.layer !== 'harmony')) return notify('Add a lead melody note before creating a harmony line.');
    const interval = project.voice.melody.harmonyInterval, existing = new Set(notes.map(note => `${note.midi}:${note.step}:${note.duration}:${note.word}`));
    let added = 0, skipped = 0;
    for (const note of notes.filter(item => item.layer !== 'harmony')) {
      const midi = note.midi + interval;
      const key = `${midi}:${note.step}:${note.duration}:${note.word}`;
      if (midi < 24 || midi > 108 || (note.word && (midi < 48 || midi > 72)) || existing.has(key) || notes.length >= MAX_MELODY_NOTES) { skipped++; continue; }
      notes.push({ ...note, midi, layer: 'harmony' }); existing.add(key); added++;
    }
    if (!added) return notify(skipped ? 'No harmony notes fit the current pitch range or available note limit.' : 'There are no lead notes to harmonize.');
    save(); renderMelody(project, save);
    notify(`${added} harmony note${added === 1 ? '' : 's'} added at ${interval > 0 ? '+' : ''}${interval} semitones${skipped ? `; ${skipped} skipped` : ''}.`);
  });
  function scheduleMelodyNote(note,start,secondsPerStep){
    const length=note.duration*secondsPerStep;
    const cue=note.word&&project.voice.phrases.flatMap(phrase=>phrase.words).find(word=>word.text===note.word&&audio.sources.get(word.sourcePad)?.file);
    if(cue){
      const sourcePad=project.pads[cue.sourcePad];
      audio.trigger(cue.sourcePad,{...sourcePad,start:cue.start,end:Math.min(cue.end,cue.start+length),pitch:clamp(note.midi-60,-12,12),speed:1},undefined,start);
      return;
    }
    const ctx=audio.context,oscillator=ctx.createOscillator(),gain=ctx.createGain();
    oscillator.type='triangle';oscillator.frequency.setValueAtTime(midiFrequency(note.midi,project.voice.melody.tuning),start);
    gain.gain.setValueAtTime(.0001,start);gain.gain.linearRampToValueAtTime(.16,start+.015);
    gain.gain.setValueAtTime(.16,Math.max(start+.016,start+length-.02));gain.gain.linearRampToValueAtTime(.0001,start+length);
    oscillator.connect(gain).connect(audio.master);oscillator.start(start);oscillator.stop(start+length+.01);
    oscillator.onended=()=>{oscillator.disconnect();gain.disconnect();};
  }
  $('melody-play').addEventListener('click', async () => {
    if (!project.voice.melody.notes.length) return notify('Add a note to write your melody first.');
    await audio.unlock(); const ctx = audio.context, now = ctx.currentTime + .05, secondsPerStep = 60 / project.bpm / 4;
    for (const note of project.voice.melody.notes) {
      scheduleMelodyNote(note,now+note.step*secondsPerStep,secondsPerStep);
    }
  });
  $('melody-export').addEventListener('click', () => { const blob = midiFile(project.voice.melody.notes, project.bpm, project.voice.melody.tuning); download(blob, `${project.title || 'madladpad'}-melody.mid`); });
  $('rap-scheme').addEventListener('change', () => { project.voice.rap.scheme = $('rap-scheme').value; save(); renderRap(project, save, audio, notify); });
  $('rap-export').addEventListener('click', () => { const lines = project.voice.rap.bars.map((line, index) => {const flow=project.voice.rap.flow[index];const guide=flow.some(Boolean)?`\n    FLOW  ${flow.map((active,step)=>active?(step%4===0?'●':'x'):'·').join(' ')}`:'';return `${String(index + 1).padStart(2, '0')}  ${line}${guide}`;}); const blob = new Blob([`# ${project.title} · ${project.bpm} BPM · ${project.voice.rap.scheme}\n\n${lines.join('\n')}\n`], { type: 'text/plain;charset=utf-8' }); download(blob, `${project.title || 'madladpad'}-lyrics.txt`); });
  render();
  return {
    scheduleMelodyStep(absoluteStep,time,bpm){
      if(!project.voice.melody.followBeat)return;
      const position=absoluteStep%256,secondsPerStep=60/bpm/4;
      for(const note of project.voice.melody.notes)if(note.step===position)scheduleMelodyNote(note,time,secondsPerStep);
    },
    highlightRapBar(absoluteStep){
      const bar=Math.floor(absoluteStep/16)%16;
      for(const row of $('rap-bars').children)row.classList.toggle('current',Number(row.dataset.bar)===bar);
    },
    transportStarted(epoch, bpm) { audio.playVocalLayers(project.voice.layers, epoch, bpm); updateOverdubControls(); },
    transportStopped() { audio.stopVocalLayers(); if (vocalRecording) stopOverdub(); updateOverdubControls(); },
    stopTuner,
    transportChanged() { updateOverdubControls(); },
    isRecording() { return Boolean(vocalRecording); },
    reloadLayers
  };
}
