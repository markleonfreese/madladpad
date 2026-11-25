import { clamp, boundTranscriptWordTimes, midiFrequency, midiNoteName, melodyPositionLabel, midiFile, melodyClipEvents, melodyClipNotesAtStep, audioBufferToWav, estimateSyllables, HARMONY_INTERVALS, MELODY_ROOTS, MELODY_SCALES, snapMidiToScale, MAX_MEDIA_BYTES, MAX_MELODY_NOTES, MAX_MELODY_CLIPS, MAX_MELODY_EXPORT_NOTES, MAX_MELODY_STEPS, MAX_TRANSCRIPT_WORDS, MAX_VOICE_PHRASES, MAX_VOCAL_LAYERS, MAX_SONG_BARS, MAX_REVERSED_AUDIO_BYTES, RECORDING_STORAGE_RESERVE_BYTES, findAudioRecorderMime, findRecorderMime, extensionForAudioMime, extensionForMime, vocalLayerClip, songVideoPositionAtStep, activeSongAudioVisuals, songMelodyVisualTracks, songLayerPlaybackEvents, songTotalBars, editSongTrackOnTimeline, AsyncActivity, localRecordingBudget, localJournaledRecordingBudget, createBoundedRecordingCapture } from './core.js';
import { getValue, saveVoiceLayer, deleteVoiceLayer, saveSongVideoLayer, deleteSongVideoLayer, beginAudioRecordingRecovery, appendAudioRecordingRecoveryChunk, listInterruptedAudioRecordings, deleteInterruptedAudioRecording, beginVideoRecordingRecovery, appendVideoRecordingRecoveryChunk, listInterruptedVideoRecordings, deleteInterruptedVideoRecording } from './storage.js';
import { detectPitch } from './tuner.js';
import { analyseLyrics } from './lyric-intelligence.js';
import { renderMelodyRoll } from './melody-roll.js';
import { createMidiKeyboard, appendMidiStepNote } from './midi-keyboard.js';
import { buildSongRenderPlan, renderSongAudioWav, songRenderVisualsAtTime } from './song-render.js';
import { renderSongVideo } from './song-video-render.js';

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
const melodyClipPreviewBars=clip=>clip.placementEndBar??Math.max(1,Math.floor(clip.startStep/16)+(clip.repeatEnabled?clip.repeatPhaseBars+clip.repeatEveryBars*2:clip.patternBars));
function rhymeHints(line) {
  const word = wordKey(line.trim().split(/\s+/).at(-1));
  if (!word) return [];
  for (const [key, values] of Object.entries(rhymes)) if (word === key || values.includes(word)) return [key, ...values].filter(value => value !== word).slice(0, 4);
  return [];
}
function rhymeGroup(index, scheme) {
  const position = index % 4;
  if (scheme === 'AABB') return position < 2 ? 'A' : 'B';
  if (scheme === 'ABAB') return position % 2 ? 'B' : 'A';
  if (scheme === 'AAAA') return 'A';
  return null;
}

function insertRhymeEnding(line, suggestion) {
  const match = /(\S+)(\s*)$/.exec(line);
  if (!match) return suggestion;
  const ending = match[1];
  const leading = ending.match(/^[^a-z0-9']*/i)?.[0] || '';
  const trailing = ending.match(/[^a-z0-9']*$/i)?.[0] || '';
  const core = ending.slice(leading.length, ending.length - trailing.length || undefined);
  const replacement = core && core === core.toUpperCase()
    ? suggestion.toUpperCase()
    : core && core[0] === core[0].toUpperCase()
      ? suggestion[0].toUpperCase() + suggestion.slice(1)
      : suggestion;
  const prefix = line.slice(0, match.index);
  return `${prefix}${leading}${replacement}${trailing}${match[2]}`;
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

async function renderWordRemixWav(project,audio,getMediaFiles,bpm=project.bpm) {
  const events=[...project.voice.wordRemix.events].sort((a,b)=>a.step-b.step);
  if(!events.length)throw new Error('Place at least one audio word in the four-bar grid first.');
  if(events.some(event=>Math.abs(Number(event.pitch)||0)>.01))throw new Error('Set every event pitch to 0 st before WAV export. The live time-preserving pitch processor is not available in offline export yet.');
  const tempo=clamp(bpm,40,240),secondsPerStep=60/tempo/4,totalSeconds=64*secondsPerStep,sampleRate=clamp(audio.context.sampleRate,22050,48000);
  const clips=[];
  for(const event of events){
    const transcript=project.voice.transcripts.find(item=>item.id===event.transcriptId),word=transcript?.words.find(item=>item.id===event.wordId),file=transcript&&getMediaFiles().get(transcript.sourcePad);
    if(!word||!file)throw new Error('A word source is missing. Re-import its original local clip before exporting.');
    if(!file.type?.startsWith('audio/'))throw new Error('WAV export currently supports audio-backed word cues only. Remove video-backed cues from this grid.');
    const source=audio.sources.get(transcript.sourcePad);
    if(!source?.file)throw new Error(`The original local audio for “${word.text}” is not loaded.`);
    const buffer=source.buffer||await audio.context.decodeAudioData(await source.file.arrayBuffer());
    source.buffer=buffer;
    const start=clamp(word.start,0,Math.max(0,buffer.duration-.01)),offset=event.step*secondsPerStep;
    const duration=Math.min((word.end-word.start)*clamp(event.lengthPercent??100,25,100)/100,totalSeconds-offset,buffer.duration-start);
    if(duration>.01)clips.push({buffer,start,offset,duration});
  }
  if(!clips.length)throw new Error('No source audio could be decoded for the Word Remix.');
  const Offline=globalThis.OfflineAudioContext||globalThis.webkitOfflineAudioContext;
  if(typeof Offline!=='function')throw new Error('This browser does not support local offline WAV rendering.');
  const offline=new Offline(2,Math.ceil(totalSeconds*sampleRate),sampleRate),limiter=offline.createDynamicsCompressor();
  limiter.threshold.value=-2;limiter.knee.value=0;limiter.ratio.value=16;limiter.attack.value=.003;limiter.release.value=.08;limiter.connect(offline.destination);
  for(const clip of clips){
    const node=offline.createBufferSource(),gain=offline.createGain(),fade=Math.min(.008,clip.duration/3),end=clip.offset+clip.duration;
    node.buffer=clip.buffer;node.connect(gain);gain.connect(limiter);
    gain.gain.setValueAtTime(0,clip.offset);gain.gain.linearRampToValueAtTime(.82,clip.offset+fade);
    gain.gain.setValueAtTime(.82,end-fade);gain.gain.linearRampToValueAtTime(0,end);
    node.start(clip.offset,clip.start,clip.duration);
  }
  const rendered=await offline.startRendering();
  return audioBufferToWav(rendered);
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

function renderWords(project, save, previewWord, transcript = project.voice.transcripts.at(-1), onWordEdit = null) {
  const host = $('voice-word-list'); host.replaceChildren();
  const tools = $('voice-selection-tools');
  if (!transcript) { tools.hidden = true; $('voice-make-phrase').disabled = true; return; }
  tools.hidden = false;
  const updatePhraseButton = () => {
    $('voice-make-phrase').disabled = !transcript.words.some(word => word.selected) || project.voice.phrases.length >= MAX_VOICE_PHRASES;
  };
  const updateSelectionTools = () => {
    const selected = transcript.words.filter(word => word.selected).length;
    $('voice-selection-status').textContent = selected ? `${selected} of ${transcript.words.length} words selected.` : 'No words selected.';
    $('voice-select-all').setAttribute('aria-disabled', String(selected === transcript.words.length));
    $('voice-clear-selection').setAttribute('aria-disabled', String(selected === 0));
    updatePhraseButton();
  };
  $('voice-select-all').onclick = () => {
    if ($('voice-select-all').getAttribute('aria-disabled') === 'true') return;
    transcript.words.forEach(word => { word.selected = true; });
    host.querySelectorAll('input[type="checkbox"]').forEach(checkbox => { checkbox.checked = true; });
    save(); updateSelectionTools();
  };
  $('voice-clear-selection').onclick = () => {
    if ($('voice-clear-selection').getAttribute('aria-disabled') === 'true') return;
    transcript.words.forEach(word => { word.selected = false; });
    host.querySelectorAll('input[type="checkbox"]').forEach(checkbox => { checkbox.checked = false; });
    save(); updateSelectionTools();
  };
  transcript.words.forEach((word, index) => {
    const row = document.createElement('div'); row.className = 'voice-word';
    const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = word.selected; checkbox.setAttribute('aria-label', `Use word ${index + 1}, ${word.text}`);
    checkbox.addEventListener('change', () => { word.selected = checkbox.checked; save(); updateSelectionTools(); });
    const text = document.createElement('input'); text.type = 'text'; text.maxLength = 120; text.value = word.text; text.setAttribute('aria-label', `Transcript word ${index + 1}`);
    text.addEventListener('input', () => { word.text = text.value; checkbox.setAttribute('aria-label', `Use word ${index + 1}, ${word.text}`); preview.setAttribute('aria-label', `Preview word ${index + 1}, ${word.text} from original clip`); save(); onWordEdit?.(); });
    text.addEventListener('change', () => { word.text = text.value.trim(); text.value = word.text; checkbox.setAttribute('aria-label', `Use word ${index + 1}, ${word.text}`); preview.setAttribute('aria-label', `Preview word ${index + 1}, ${word.text} from original clip`); save(); onWordEdit?.(); });
    const start = document.createElement('input'); start.type = 'number'; start.min = '0'; start.max = '3600'; start.step = '.01'; start.value = word.start.toFixed(2); start.setAttribute('aria-label', `Word ${index + 1} start seconds`);
    const end = document.createElement('input'); end.type = 'number'; end.min = '0'; end.max = '3600'; end.step = '.01'; end.value = word.end.toFixed(2); end.setAttribute('aria-label', `Word ${index + 1} end seconds`);
    for (const [input, key] of [[start, 'start'], [end, 'end']]) input.addEventListener('change', () => {
      word[key] = clamp(input.value, 0, 3600);
      if (word.end <= word.start) word.end = word.start + .05;
      start.value = word.start.toFixed(2); end.value = word.end.toFixed(2);
      save();
    });
    const preview = document.createElement('button'); preview.type = 'button'; preview.className = 'pill-button voice-word-preview-button'; preview.textContent = '▶';
    preview.setAttribute('aria-label', `Preview word ${index + 1}, ${word.text} from original clip`);
    preview.addEventListener('click', () => previewWord(word, transcript, preview));
    const score = document.createElement('span'); score.className = 'voice-confidence'; score.textContent = 'review'; score.title = 'The local model does not provide a calibrated word confidence score.';
    row.append(checkbox, text, start, end, score, preview); host.append(row);
  });
  updateSelectionTools();
}

function renderWordRemix(project, transcript, save, barState, getMediaFiles) {
  const wordSelect=$('word-remix-word'),barHost=$('word-remix-bars'),grid=$('word-remix-grid'),events=project.voice.wordRemix.events;
  const priorWord=wordSelect.value;
  wordSelect.replaceChildren();
  for(const word of transcript?.words||[]){const option=document.createElement('option');option.value=word.id;option.textContent=word.text;wordSelect.append(option);}
  wordSelect.disabled=!transcript?.words.length;
  if((transcript?.words||[]).some(word=>word.id===priorWord))wordSelect.value=priorWord;
  barHost.replaceChildren();
  for(let bar=0;bar<4;bar++){
    const button=document.createElement('button');button.type='button';button.className='pill-button';button.textContent=`BAR ${bar+1}`;button.setAttribute('aria-pressed',String(barState.value===bar));
    button.addEventListener('click',()=>{barState.value=bar;barState.selectedStep=null;renderWordRemix(project,transcript,save,barState,getMediaFiles);});barHost.append(button);
  }
  grid.replaceChildren();
  for(let stepInBar=0;stepInBar<16;stepInBar++){
    const absoluteStep=barState.value*16+stepInBar,event=events.find(item=>item.step===absoluteStep);
    const eventTranscript=event&&project.voice.transcripts.find(item=>item.id===event.transcriptId),word=eventTranscript?.words.find(item=>item.id===event.wordId);
    const button=document.createElement('button');button.type='button';button.className='pill-button';button.textContent=word?.text||String(stepInBar+1).padStart(2,'0');button.setAttribute('aria-pressed',String(Boolean(event)&&barState.selectedStep===absoluteStep));
    button.setAttribute('aria-label',event?`Bar ${barState.value+1}, step ${stepInBar+1}, ${word?.text||'missing word'}; select event`:`Bar ${barState.value+1}, step ${stepInBar+1}; place ${wordSelect.selectedOptions[0]?.textContent||'selected word'}`);
    button.disabled=!event&&!wordSelect.value;
    button.addEventListener('click',()=>{
      const existing=events.findIndex(item=>item.step===absoluteStep);
      if(existing>=0)barState.selectedStep=absoluteStep;
      else if(transcript&&wordSelect.value&&events.length<64){events.push({id:crypto.randomUUID?.()||`word-event-${Date.now()}-${absoluteStep}`,transcriptId:transcript.id,wordId:wordSelect.value,step:absoluteStep,pitch:0,lengthPercent:100});barState.selectedStep=absoluteStep;}
      save();renderWordRemix(project,transcript,save,barState,getMediaFiles);
    });
    grid.append(button);
  }
  const videoSources=new Set(events.flatMap(event=>{
    const transcript=project.voice.transcripts.find(item=>item.id===event.transcriptId),file=transcript&&getMediaFiles().get(transcript.sourcePad);
    return file?.type?.startsWith('video/')?[transcript.sourcePad]:[];
  }));
  const hasVideoEvent=videoSources.size>0;
  const unsupported=videoSources.size>1;
  if((unsupported||!events.length)&&project.voice.wordRemix.followTransport){project.voice.wordRemix.followTransport=false;window.dispatchEvent(new Event('madladpad-stop-word-remix-track'));save();}
  const followTransport=$('word-remix-follow-transport');
  followTransport.checked=Boolean(project.voice.wordRemix.followTransport);
  followTransport.disabled=!events.length||unsupported;
  $('word-remix-follow-help').textContent=unsupported?'Choose words from one video speaker at a time for this local POC.':'Audio and original-video words follow the four-bar Beat/Song cycle without copying media. Short video cuts may lag; test actual devices.';
  const selectedEvent=events.find(item=>item.step===barState.selectedStep),selectedTranscript=selectedEvent&&project.voice.transcripts.find(item=>item.id===selectedEvent.transcriptId),selectedFile=selectedTranscript&&getMediaFiles().get(selectedTranscript.sourcePad),pitchControl=$('word-remix-pitch');
  pitchControl.value=String(selectedEvent?.pitch??0);$('word-remix-pitch-value').textContent=`${Number(selectedEvent?.pitch??0)>0?'+':''}${Number(selectedEvent?.pitch??0)} st`;
  pitchControl.disabled=!selectedEvent||!selectedFile||(!selectedFile.type?.startsWith('audio/')&&!selectedFile.type?.startsWith('video/'));
  $('word-remix-pitch-help').textContent=selectedFile?.type?.startsWith('video/')?'Video-word pitch requires the local AudioWorklet. Playback speed remains unchanged; video/audio start may lag on phones.':'Pitch changes do not alter cue length or the original recording.';
  const lengthControl=$('word-remix-length'),lengthPercent=clamp(selectedEvent?.lengthPercent??100,25,100);
  lengthControl.value=String(lengthPercent);$('word-remix-length-value').textContent=`${lengthPercent}%`;
  lengthControl.disabled=!selectedEvent;
  $('word-remix-length-help').textContent=selectedEvent?'Trim this cue to a percentage of its reviewed transcript range.':'Select a word event to trim its playback length.';
  $('word-remix-remove').disabled=!selectedEvent;
  $('word-remix-clear').disabled=!events.length;
  $('word-remix-play').disabled=!events.length;
  const exportButton=$('word-remix-export'),hasPitchedEvent=events.some(event=>Math.abs(Number(event.pitch)||0)>.01);
  exportButton.disabled=!events.length||hasVideoEvent||hasPitchedEvent;
  $('word-remix-export-help').textContent=hasVideoEvent?'Local WAV export supports audio-source cues only. Video cues remain available in preview.':hasPitchedEvent?'Set every event pitch to 0 st to export; live pitch processing is not available in offline WAV yet.':'Downloads a four-bar stereo PCM WAV rendered locally. No source media is uploaded.';
  window.dispatchEvent(new Event('madladpad-word-remix-change'));
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

function renderMelody(project, save, onAudition, rollFocusIndex) {
  const host = $('melody-notes'); host.replaceChildren();
  const melody=project.voice.melody,selectedClip=melody.clips.find(clip=>clip.id===melody.activeClipId)||null,notes=selectedClip?.notes||melody.notes;
  $('melody-follow-beat').checked=project.voice.melody.followBeat;
  $('melody-tuning').value = project.voice.melody.tuning;
  $('melody-harmony-interval').value = String(project.voice.melody.harmonyInterval);
  const keySelect = $('melody-key');
  if (!keySelect.options.length) MELODY_ROOTS.forEach((root, index) => { const option = document.createElement('option'); option.value = String(index); option.textContent = root; keySelect.append(option); });
  keySelect.value = String(project.voice.melody.key);
  $('melody-scale').value = project.voice.melody.scale;
  const wordOptions = [''].concat(project.voice.phrases.flatMap(phrase => phrase.words.map(word => word.text)));
  const laneSelect=$('melody-lane-select');laneSelect.replaceChildren();
  const baseOption=document.createElement('option');baseOption.value='';baseOption.textContent='Melody · standalone notes';laneSelect.append(baseOption);
  melody.clips.forEach((clip,index)=>{const option=document.createElement('option');option.value=clip.id;option.textContent=`${clip.name} · MIDI clip ${index+1}`;laneSelect.append(option);});
  laneSelect.value=selectedClip?.id||'';
  for(const element of document.querySelectorAll('.melody-clip-only'))element.hidden=!selectedClip;
  if(selectedClip){
    $('melody-clip-name').value=selectedClip.name;
    $('melody-clip-start').value=String(Math.floor(selectedClip.startStep/16)+1);
    $('melody-clip-length').value=String(selectedClip.patternBars);
    $('melody-clip-period').value=String(selectedClip.repeatEveryBars);$('melody-clip-period').disabled=!selectedClip.repeatEnabled;
    $('melody-clip-phase').value=String(selectedClip.repeatPhaseBars);$('melody-clip-phase').disabled=!selectedClip.repeatEnabled;
    $('melody-clip-end').value=selectedClip.placementEndBar==null?'':String(selectedClip.placementEndBar);
    $('melody-clip-repeat').checked=selectedClip.repeatEnabled;
    $('melody-clip-status').textContent=`${selectedClip.patternBars}-bar phrase · ${selectedClip.repeatEnabled?`repeats every ${selectedClip.repeatEveryBars} bars`:'one-shot'} · starts bar ${Math.floor(selectedClip.startStep/16)+1}${selectedClip.repeatEnabled&&selectedClip.repeatPhaseBars?` with ${selectedClip.repeatPhaseBars}-bar first offset`:''} · ${selectedClip.placementEndBar?`stops before bar ${selectedClip.placementEndBar}`:'stops at Song end'}.`;
  }else $('melody-clip-status').textContent=`${melody.clips.length} of ${MAX_MELODY_CLIPS} MIDI clips. Create a clip to edit an independent phrase and placement.`;
  laneSelect.onchange=()=>{melody.activeClipId=laneSelect.value;save();renderMelody(project,save,onAudition);};
  $('melody-clip-add').disabled=melody.clips.length>=MAX_MELODY_CLIPS;
  $('melody-clip-add').onclick=()=>{
    if(melody.clips.length>=MAX_MELODY_CLIPS)return;
    const clips=melody.clips,copy=notes.slice(0,MAX_MELODY_NOTES).map(note=>({...note}));
    const patternBars=clamp(Math.ceil(Math.max(16,...copy.map(note=>note.step+note.duration))/16),1,MAX_SONG_BARS);
    const clip={id:`midi-${Date.now()}-${clips.length+1}`,name:`MIDI clip ${clips.length+1}`,notes:copy,startStep:0,patternBars,repeatEnabled:false,repeatEveryBars:patternBars,repeatPhaseBars:0,placementEndBar:null};
    clips.push(clip);melody.activeClipId=clip.id;save();renderMelody(project,save,onAudition);
  };
  $('melody-clip-remove').onclick=()=>{if(!selectedClip)return;melody.clips=melody.clips.filter(clip=>clip.id!==selectedClip.id);melody.activeClipId='';save();renderMelody(project,save,onAudition);};
  const updateClip=(field,value)=>{
    if(!selectedClip)return;
    if(field==='name')selectedClip.name=value.trim().slice(0,48)||'MIDI clip';
    else if(field==='startStep')selectedClip.startStep=clamp(Math.round(value-1),0,MAX_SONG_BARS-1)*16;
    else if(field==='patternBars'){
      selectedClip.patternBars=clamp(Math.round(value),1,MAX_SONG_BARS);
      selectedClip.notes=selectedClip.notes.map(note=>{const step=clamp(note.step,0,selectedClip.patternBars*16-1);return {...note,step,duration:clamp(note.duration,.125,selectedClip.patternBars*16-step)};});
      if(selectedClip.repeatEveryBars>MAX_SONG_BARS)selectedClip.repeatEveryBars=selectedClip.patternBars;
    }else if(field==='repeatEveryBars')selectedClip.repeatEveryBars=clamp(Math.round(value),1,MAX_SONG_BARS);
    else if(field==='repeatPhaseBars')selectedClip.repeatPhaseBars=clamp(Math.round(value),0,MAX_SONG_BARS-1);
    else if(field==='placementEndBar')selectedClip.placementEndBar=value===''?null:clamp(Math.round(value),1,MAX_SONG_BARS);
    else if(field==='repeatEnabled')selectedClip.repeatEnabled=Boolean(value);
    save();renderMelody(project,save,onAudition);
  };
  $('melody-clip-name').onchange=event=>updateClip('name',event.target.value);
  $('melody-clip-start').onchange=event=>updateClip('startStep',Number(event.target.value));
  $('melody-clip-length').onchange=event=>updateClip('patternBars',Number(event.target.value));
  $('melody-clip-period').onchange=event=>updateClip('repeatEveryBars',Number(event.target.value));
  $('melody-clip-phase').onchange=event=>updateClip('repeatPhaseBars',Number(event.target.value));
  $('melody-clip-end').onchange=event=>updateClip('placementEndBar',event.target.value);
  $('melody-clip-repeat').onchange=event=>updateClip('repeatEnabled',event.target.checked);
  const noteLimit=selectedClip?selectedClip.patternBars*16:MAX_MELODY_STEPS;
  const midiStep=$('melody-midi-step'),midiEntry=$('melody-midi-step-entry'),laneId=selectedClip?.id||'';
  if(midiStep.dataset.lane!==laneId){midiStep.dataset.lane=laneId;midiStep.value='1';midiEntry.checked=false;}
  midiStep.max=String(noteLimit);midiStep.value=String(clamp(Math.round(Number(midiStep.value)||1),1,noteLimit));
  const drawRoll = focusIndex => renderMelodyRoll($('melody-roll'),notes,index=>{
    save();renderMelody(project,save,onAudition,index);
  },onAudition,focusIndex,noteLimit,{key:melody.key,scale:melody.scale});
  notes.forEach((note, index) => {
    const row = document.createElement('div'); row.className = 'melody-note';
    const noteLabel = `${note.layer === 'harmony' ? 'Harmony' : 'Note'} ${index + 1}`;
    const description = document.createElement('div'); description.className = 'melody-note-description';
    const noteName = document.createElement('span'); noteName.textContent = `${noteLabel} · ${midiNoteName(note.midi)} · ${midiFrequency(note.midi, project.voice.melody.tuning).toFixed(1)} Hz`;
    const positionName = document.createElement('small'); positionName.textContent = melodyPositionLabel(note.step);
    description.append(noteName, positionName);
    const pitch = document.createElement('select'); pitch.setAttribute('aria-label', `${noteLabel} pitch`);
    for (let midi = 24; midi <= 108; midi++) {
      if (midi % 12 === 0) {
        const octave = document.createElement('optgroup');
        octave.label = `${midiNoteName(midi)}–${midiNoteName(Math.min(midi + 11, 108))}`;
        pitch.append(octave);
      }
      const option = document.createElement('option');
      option.value = String(midi);
      option.textContent = `${midiNoteName(midi)} (MIDI ${midi})`;
      pitch.lastElementChild.append(option);
    }
    pitch.value = String(note.midi);
    const step = document.createElement('input'); step.type = 'number'; step.min = '0'; step.max = String(noteLimit-1); step.value = note.step; step.setAttribute('aria-label', `${noteLabel} sixteenth step`);
    const duration = document.createElement('input'); duration.type = 'number'; duration.min = '.125'; duration.max = String(noteLimit-note.step); duration.step = '.125'; duration.value = note.duration; duration.setAttribute('aria-label', `${noteLabel} duration in sixteenth steps`);
    const velocity = document.createElement('input'); velocity.type='number'; velocity.min='1'; velocity.max='127'; velocity.step='1'; velocity.value=note.velocity; velocity.setAttribute('aria-label',`${noteLabel} MIDI velocity`);
    const word = document.createElement('select'); word.setAttribute('aria-label', `Assign phrase word to ${noteLabel.toLowerCase()}`);
    wordOptions.forEach(value => { const option = document.createElement('option'); option.value = value; option.textContent = value || 'No word cue'; word.append(option); }); word.value = note.word;
    for (const [input, key] of [[pitch, 'midi'], [step, 'step'], [duration, 'duration'], [velocity,'velocity'], [word, 'word']]) input.addEventListener('change', () => {
      note[key] = key === 'word' ? input.value : Number(input.value);
      if(key==='step'){
        note.step=clamp(Math.round(note.step),0,noteLimit-1);
        input.value=String(note.step);
        duration.max=String(noteLimit-note.step);
        note.duration=clamp(note.duration,.125,noteLimit-note.step);
        duration.value=String(note.duration);
      }
      if(key==='duration'){
        note.duration=clamp(note.duration,.125,noteLimit-note.step);
        input.value=String(note.duration);
      }
      if(key==='velocity'){
        note.velocity=clamp(Math.round(note.velocity),1,127);
        input.value=String(note.velocity);
      }
      if (key === 'midi') noteName.textContent = `${noteLabel} · ${midiNoteName(note.midi)} · ${midiFrequency(note.midi, project.voice.melody.tuning).toFixed(1)} Hz`;
      if (key === 'step') positionName.textContent = melodyPositionLabel(note.step);
      save();
      drawRoll();
    });
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'pill-button'; remove.textContent = '×'; remove.setAttribute('aria-label', `Delete ${noteLabel.toLowerCase()}`); remove.addEventListener('click', () => { notes.splice(index, 1); save(); renderMelody(project, save, onAudition); });
    row.append(description, pitch, step, duration, velocity, word, remove); host.append(row);
  });
  $('melody-add').disabled = notes.length >= MAX_MELODY_NOTES;
  $('melody-harmony-add').disabled = notes.length >= MAX_MELODY_NOTES;
  drawRoll(rollFocusIndex);
}


function renderLyricInsights(project) {
  const host = $('rap-insights');
  const result = analyseLyrics(project.voice.rap.bars, estimateSyllables);
  $('rap-insights-summary').textContent = 'LYRIC INSIGHTS · ' + result.filledBars + ' OF ' + result.lines.length + ' BARS';
  host.replaceChildren();
  if (!result.filledBars) {
    const empty = document.createElement('p');
    empty.className = 'voice-note';
    empty.textContent = 'Write a bar to see its ending, estimated syllables and possible rhyme relationships.';
    host.append(empty);
    return;
  }
  const headings = document.createElement('p');
  headings.className = 'voice-note';
  headings.textContent = result.possibleRhymeFamilies + ' possible rhyme families · ' + result.filledBars + ' written bars. Spelling-based estimates; listen to confirm.';
  host.append(headings);
  const endings = document.createElement('div');
  endings.className = 'rap-insight-endings';
  endings.setAttribute('role', 'list');
  endings.setAttribute('aria-label', 'Line endings and possible rhymes');
  for (const line of result.lines) {
    if (!line.filled) continue;
    const chip = document.createElement('span');
    chip.setAttribute('role', 'listitem');
    chip.className = 'rap-insight-ending' + (line.family ? ' possible-rhyme' : '') + (line.repeatedEnding ? ' repeated-ending' : '');
    chip.textContent = 'Bar ' + line.bar + ': ~' + line.syllables + ' syllables · ' + line.ending + (line.family ? ' · approx ' + line.family : '') + (line.repeatedEnding ? ' · repeated' : '');
    endings.append(chip);
  }
  host.append(endings);
  const observations = document.createElement('ul');
  observations.className = 'rap-insight-observations';
  for (const observation of result.observations) {
    const item = document.createElement('li');
    item.textContent = observation;
    observations.append(item);
  }
  host.append(observations);
}

function renderRap(project, save, audio, notify) {
  $('rap-scheme').value = project.voice.rap.scheme;
  const host = $('rap-bars'); host.replaceChildren();
  project.voice.rap.bars.forEach((line, index) => {
    const row = document.createElement('div'); row.className = 'rap-bar';
    row.dataset.bar=String(index);
    const number = document.createElement('label'); number.className = 'rap-bar-number'; number.htmlFor = `rap-bar-input-${index}`; number.textContent = String(index + 1).padStart(2, '0');
    const text = document.createElement('textarea'); text.id = `rap-bar-input-${index}`; text.maxLength = 500; text.rows = 2; text.value = line; text.placeholder = `Bar ${index + 1}`; text.setAttribute('aria-label', `Rap bar ${index + 1}`);
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
      meta.textContent = [`${group ? `${group} rhyme` : 'Free rhyme'}`, `${estimateSyllables(line)} estimated syllables`, ...cues].join(' · ');
      rhymeDetails.hidden = !hints.length;
      rhymeSummary.textContent = `RHYME IDEAS · ${hints.length}`;
      rhymeButtons.replaceChildren();
      hints.forEach(suggestion => {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'rap-rhyme-chip'; button.textContent = suggestion;
        button.setAttribute('aria-label', `Use rhyme idea ${suggestion} for bar ${index + 1}`);
        button.addEventListener('click', () => {
          text.value = insertRhymeEnding(text.value, suggestion);
          text.dispatchEvent(new Event('input', { bubbles: true }));
          text.focus();
        });
        rhymeButtons.append(button);
      });
    };
    const rhymeDetails = document.createElement('details'); rhymeDetails.className = 'rap-rhyme-ideas';
    const rhymeSummary = document.createElement('summary'); rhymeDetails.append(rhymeSummary);
    const rhymeButtons = document.createElement('div'); rhymeButtons.className = 'rap-rhyme-list'; rhymeDetails.append(rhymeButtons);
    row.updateMeta = renderMeta;
    text.addEventListener('input', () => { project.voice.rap.bars[index] = text.value; host.querySelectorAll('.rap-bar').forEach(item => item.updateMeta?.()); renderLyricInsights(project); save(); }); renderMeta(); row.append(number, text, meta, rhymeDetails);
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
  renderLyricInsights(project);
}

export async function initVoiceLab({ getProject, getMediaFiles, getAudio, getTransport, notify, save, assignWordsToPads, onTimelineScale, rememberAudioTake, rememberVideoTake }) {
  const project = getProject(), audio = getAudio();
  const midiKeyboard=createMidiKeyboard({start:startMidiKeyboardNote});
  let activeTranscript = null;
  let activeWordPreview = null;
  let wordPreviewToken = 0;
  let wordRemixPlayback = null;
  const wordRemixBar={value:0};
  const wordRemixTransportVoices=new Set();
  // Two monitors use one MediaElementAudioSourceNode each for their lifetime.
  // No edited WAV/video files are generated from the original transcript words.
  let wordRemixLiveRoute=null,wordRemixLiveFile=null,wordRemixLiveUrl=null,wordRemixLiveCue=null,wordPreviewVideoRoute=null;
  const wordRemixVideoTimers=new Set();
  const connectWordVideoAudio=(video,existing)=>{
    if(existing)return existing;
    const mediaNode=audio.context.createMediaElementSource(video),gain=audio.context.createGain();
    gain.connect(audio.master);
    const source={element:video,mediaNode,gain,pitchNode:null,pitch:0,speed:1,mediaRoute:''};
    if(!audio.routeMediaPitch(source))throw new Error('Could not route source video through local mixer.');
    gain.gain.value=0;
    return source;
  };
  const stopLiveVideoCue=()=>{
    if(wordRemixLiveCue?.timer)clearTimeout(wordRemixLiveCue.timer);
    if(wordRemixLiveCue?.onTime)$('word-remix-live-video').removeEventListener('timeupdate',wordRemixLiveCue.onTime);
    wordRemixLiveCue=null;
    const video=$('word-remix-live-video');video.pause();
    if(wordRemixLiveRoute)audio.fadeMediaOutput(wordRemixLiveRoute);
    video.hidden=true;$('word-remix-live').hidden=true;
  };
  const releaseWordRemixLiveVideo=()=>{
    stopLiveVideoCue();
    const video=$('word-remix-live-video');video.removeAttribute('src');video.load();
    if(wordRemixLiveUrl)URL.revokeObjectURL(wordRemixLiveUrl);
    wordRemixLiveUrl=null;wordRemixLiveFile=null;
  };
  let wordRemixTransportReady=false,wordRemixTransportPreparing=null;
  const stopWordRemixTransport=()=>{
    for(const timer of wordRemixVideoTimers)clearTimeout(timer);
    wordRemixVideoTimers.clear();stopLiveVideoCue();
    const now=audio.context.currentTime;
    for(const voice of wordRemixTransportVoices){
      voice.gain.gain.cancelScheduledValues(now);voice.gain.gain.setTargetAtTime(0,now,.003);
      try{voice.node.stop(now+.015);}catch{}
    }
    wordRemixTransportVoices.clear();
  };
  const prepareWordRemixTransport=async()=>{
    if(wordRemixTransportReady)return;
    if(wordRemixTransportPreparing)return wordRemixTransportPreparing;
    wordRemixTransportPreparing=(async()=>{
      const events=project.voice.wordRemix.events;
      if(!events.length)throw new Error('Add at least one Word Remix cue first.');
      const videos=new Map();
      for(const event of events){
        const transcript=project.voice.transcripts.find(item=>item.id===event.transcriptId),file=transcript&&getMediaFiles().get(transcript.sourcePad);
        if(!transcript||!file)throw new Error('An original local word source is missing; re-import it before using transport.');
        if(file.type.startsWith('video/')){videos.set(transcript.sourcePad,file);continue;}
        if(!file.type.startsWith('audio/'))throw new Error('Word Remix only supports locally playable audio and video.');
        const source=audio.sources.get(transcript.sourcePad);
        if(!source?.file)throw new Error('The original source audio is unavailable.');
        if(!source.buffer)source.buffer=await audio.context.decodeAudioData(await source.file.arrayBuffer());
      }
      if(videos.size>1)throw new Error('Use one original speaker video at a time in this POC.');
      if(events.some(event=>Math.abs(Number(event.pitch)||0)>.01)&&!audio.pitchReady)throw new Error('Local time-preserving pitch is unavailable on this browser.');
      if(videos.size){
        const file=[...videos.values()][0],video=$('word-remix-live-video');
        if(!wordRemixLiveRoute)wordRemixLiveRoute=connectWordVideoAudio(video,wordRemixLiveRoute);
        if(wordRemixLiveFile!==file){
          releaseWordRemixLiveVideo();
          wordRemixLiveFile=file;wordRemixLiveUrl=URL.createObjectURL(file);
          video.src=wordRemixLiveUrl;video.load();
          await new Promise((resolve,reject)=>{
            if(video.readyState>=1){resolve();return;}
            const cleanup=()=>{clearTimeout(timer);video.removeEventListener('loadedmetadata',onReady);video.removeEventListener('error',onError);};
            const onReady=()=>{cleanup();resolve();},onError=()=>{cleanup();reject(new Error('Could not decode the original speaker video.'));};
            const timer=setTimeout(()=>{cleanup();reject(new Error('The original speaker video did not load.'));},5000);
            video.addEventListener('loadedmetadata',onReady);video.addEventListener('error',onError);
          });
        }
      }else if(wordRemixLiveFile)releaseWordRemixLiveVideo();
      wordRemixTransportReady=true;
    })();
    try{await wordRemixTransportPreparing;}finally{wordRemixTransportPreparing=null;}
  };
  window.addEventListener('madladpad-stop-word-remix-track',()=>{stopWordRemixTransport();releaseWordRemixLiveVideo();wordRemixTransportReady=false;});
  window.addEventListener('pagehide',()=>{stopWordRemixTransport();releaseWordRemixLiveVideo();},{once:true});
  const stopWordPreview = (message = 'Word preview stopped.') => {
    wordPreviewToken++;
    const active = activeWordPreview;
    activeWordPreview = null;
    if (active?.kind === 'audio') {
      try { active.source.stop(); } catch {}
      active.source.disconnect(); active.gain.disconnect();
    } else if (active?.kind === 'video') {
      active.element.pause();
      active.element.removeEventListener('timeupdate', active.onTime);
      active.element.removeEventListener('ended', active.onEnded);
      active.element.removeAttribute('src'); active.element.load();
      URL.revokeObjectURL(active.url);
    }
    if (active?.button?.isConnected) {
      active.button.textContent = '▶';
      active.button.setAttribute('aria-label', `Preview word ${active.wordIndex + 1}, ${active.wordText} from original clip`);
    }
    if ($('voice-word-preview-status')) $('voice-word-preview-status').textContent = message;
    if ($('voice-word-preview')) $('voice-word-preview').hidden = !activeWordPreview;
  };
  const previewTranscriptWord = async (word, transcript, button) => {
    if(wordRemixPlayback)stopWordRemix('Stopped the Word Remix to preview one word.');
    if (activeWordPreview?.button === button) { stopWordPreview(); return; }
    stopWordPreview('Loading the selected word from its original local clip…');
    const token = wordPreviewToken, sourcePad = transcript.sourcePad, file = getMediaFiles().get(sourcePad);
    if (!file) { $('voice-word-preview-status').textContent = 'The original local clip is unavailable. Reload or re-import it before previewing this word.'; $('voice-word-preview').hidden = false; return; }
    const range = { start: Math.max(0, Number(word.start) || 0), end: Math.max(0, Number(word.end) || 0) };
    const wordIndex = transcript.words.indexOf(word), wordText = word.text;
    if (file.type.startsWith('video/')) {
      const element = $('voice-word-video'), url = URL.createObjectURL(file);
      let end = range.end;
      const stopAtWordEnd = () => { if (element.currentTime >= end - .015) stopWordPreview(`Finished previewing “${wordText}”. Video timing is best-effort on this browser.`); };
      const onEnded = () => stopWordPreview(`Finished previewing “${wordText}”.`);
      element.hidden = false; $('voice-word-preview').hidden = false;
      // Word-only preview remains available even if audio routing is unsupported.
      try{wordPreviewVideoRoute=connectWordVideoAudio(element,wordPreviewVideoRoute);wordPreviewVideoRoute.pitch=0;audio.routeMediaPitch(wordPreviewVideoRoute);audio.setMediaOutputGain(wordPreviewVideoRoute,.82);}catch{ /* Browser retains its native video-preview fallback. */ }
      element.src = url;
      element.currentTime = range.start;
      element.addEventListener('timeupdate', stopAtWordEnd);
      element.addEventListener('ended', onEnded, { once: true });
      activeWordPreview = { kind: 'video', element, url, onTime: stopAtWordEnd, onEnded, button, wordIndex, wordText };
      button.textContent = 'Ⅱ';
      button.setAttribute('aria-label', `Stop preview of word ${wordIndex + 1}, ${wordText}`);
      $('voice-word-preview-status').textContent = `Previewing “${wordText}” at ${range.start.toFixed(2)}–${range.end.toFixed(2)} seconds from the original clip. Audio and video seek timing is best-effort.`;
      try { await audio.unlock(); await element.play(); }
      catch (error) { if (activeWordPreview?.url === url) stopWordPreview(`Could not play this source video: ${error.message}`); }
      return;
    }
    try {
      const source = audio.sources.get(sourcePad);
      let buffer = source?.buffer;
      if (!buffer && file.type.startsWith('audio/')) buffer = await audio.context.decodeAudioData(await file.arrayBuffer());
      if (token !== wordPreviewToken) return;
      if (!buffer) throw new Error('This browser cannot decode audio from the original clip.');
      const start = Math.min(range.start, Math.max(0, buffer.duration - .01));
      const end = Math.min(buffer.duration, Math.max(start + .01, range.end));
      const duration = end - start;
      if (!Number.isFinite(duration) || duration <= 0) throw new Error('The selected word has no playable audio range.');
      await audio.unlock();
      if (token !== wordPreviewToken) return;
      const node = audio.context.createBufferSource(), gain = audio.context.createGain();
      node.buffer = buffer; node.connect(gain).connect(audio.master);
      const at = audio.context.currentTime + .02, fade = Math.min(.008, duration / 3), level = .8;
      gain.gain.setValueAtTime(0, at); gain.gain.linearRampToValueAtTime(level, at + fade);
      gain.gain.setValueAtTime(level, at + duration - fade); gain.gain.linearRampToValueAtTime(0, at + duration);
      activeWordPreview = { kind: 'audio', source: node, gain, button, wordIndex, wordText };
      button.textContent = 'Ⅱ';
      button.setAttribute('aria-label', `Stop preview of word ${wordIndex + 1}, ${wordText}`);
      $('voice-word-preview').hidden = false;
      $('voice-word-video').hidden = true;
      $('voice-word-preview-status').textContent = `Previewing “${wordText}” at ${start.toFixed(2)}–${end.toFixed(2)} seconds from the original local clip.`;
      node.onended = () => { if (activeWordPreview?.source === node) stopWordPreview(`Finished previewing “${wordText}”.`); };
      node.start(at, start, duration);
    } catch (error) {
      if (token === wordPreviewToken) { $('voice-word-preview').hidden = false; $('voice-word-preview-status').textContent = `Could not preview this word: ${error.message}`; }
    }
  };
  const stopWordRemix = (message='Word Remix stopped.') => {
    const playback=wordRemixPlayback;
    if(!playback)return;
    wordRemixPlayback=null;
    playback.timers.forEach(timer=>clearTimeout(timer));
    playback.sources.forEach(({node,gain,pitchNode})=>{try{node.stop();}catch{}node.disconnect();pitchNode?.disconnect();gain.disconnect();});
    if(playback.video){playback.video.pause();playback.video.removeEventListener('timeupdate',playback.onVideoTime);if(wordPreviewVideoRoute)audio.fadeMediaOutput(wordPreviewVideoRoute);playback.video.removeAttribute('src');playback.video.load();playback.video.hidden=true;}
    if(playback.videoUrl)URL.revokeObjectURL(playback.videoUrl);
    $('word-remix-play').disabled=!getProject().voice.wordRemix.events.length;
    $('word-remix-stop').disabled=true;
    $('word-remix-status').textContent=message;
  };
  const playWordRemix = async () => {
    stopWordRemix('Preparing the local word events…');
    if(activeWordPreview)stopWordPreview('Stopped the single-word preview to play the Word Remix.');
    const currentProject=getProject(),events=[...currentProject.voice.wordRemix.events].sort((a,b)=>a.step-b.step);
    if(!events.length)return;
    const token={sources:[],timers:[],video:null,videoUrl:null,onVideoTime:null};
    try{
      await audio.unlock();
      const bpm=clamp(getTransport?.()?.bpm||currentProject.bpm,40,240),secondsPerStep=60/bpm/4,totalDuration=64*secondsPerStep;
      const plans=[];
      for(const event of events){
        const transcript=currentProject.voice.transcripts.find(item=>item.id===event.transcriptId),word=transcript?.words.find(item=>item.id===event.wordId),file=transcript&&getMediaFiles().get(transcript.sourcePad);
        if(!word||!file)throw new Error('A word source is missing. Re-import its original local clip before playing.');
        const offset=event.step*secondsPerStep,rangeStart=clamp(word.start,0,3600),rangeEnd=clamp(word.end,rangeStart,3600),duration=Math.min((rangeEnd-rangeStart)*clamp(event.lengthPercent??100,25,100)/100,totalDuration-offset);
        if(duration<=.01)continue;
        if(file.type.startsWith('video/')){
          plans.push({event,word,file,rangeStart,duration,offset,transcript});
        }
        else if(file.type.startsWith('audio/')){
          let buffer=audio.sources.get(transcript.sourcePad)?.buffer;
          if(!buffer)buffer=await audio.context.decodeAudioData(await file.arrayBuffer());
          const start=Math.min(rangeStart,Math.max(0,buffer.duration-.01)),playDuration=Math.min(duration,buffer.duration-start);
          if(playDuration>.01)plans.push({event,word,file,buffer,start,duration:playDuration,offset,transcript});
        }else throw new Error(`The source for “${word.text}” is not playable audio or video.`);
      }
      if(plans.some(plan=>Math.abs(Number(plan.event.pitch)||0)>.01)&&!audio.pitchReady)throw new Error('The local time-preserving pitch processor is unavailable on this browser.');
      const videoPads=new Set(plans.filter(plan=>plan.file.type.startsWith('video/')).map(plan=>plan.transcript.sourcePad));
      if(videoPads.size>1)throw new Error('This preview supports one original video source at a time. Use words from one transcript.');
      if(videoPads.size){
        const pad=[...videoPads][0],file=getMediaFiles().get(pad),video=$('voice-word-video');
        token.video=video;token.videoUrl=URL.createObjectURL(file);video.hidden=false;
        wordPreviewVideoRoute=connectWordVideoAudio(video,wordPreviewVideoRoute);wordPreviewVideoRoute.pitch=0;audio.routeMediaPitch(wordPreviewVideoRoute);
        video.src=token.videoUrl;video.load();
        await new Promise((resolve,reject)=>{
          if(video.readyState>=1){resolve();return;}
          const timer=setTimeout(()=>reject(new Error('The source video did not become ready.')),5000);token.timers.push(timer);
          video.addEventListener('loadedmetadata',()=>{clearTimeout(timer);resolve();},{once:true});
          video.addEventListener('error',()=>{clearTimeout(timer);reject(new Error('This browser could not open the source video.'));},{once:true});
        });
        token.onVideoTime=()=>{const active=token.currentVideoPlan;if(active&&video.currentTime>=active.rangeStart+active.duration-.02)video.pause();};
        video.addEventListener('timeupdate',token.onVideoTime);
      }
      if(wordRemixPlayback)stopWordRemix();
      wordRemixPlayback=token;
      const epoch=audio.context.currentTime+.12;
      for(const plan of plans){
        if(plan.buffer){
          const node=audio.context.createBufferSource(),gain=audio.context.createGain(),when=epoch+plan.offset,duration=plan.duration,fade=Math.min(.008,duration/3),pitch=clamp(plan.event.pitch??0,-12,12),pitchNode=Math.abs(pitch)>.01?audio.createPitchNode():null,latency=pitchNode?Math.round(audio.context.sampleRate*.04)/audio.context.sampleRate:0;
          if(Math.abs(pitch)>.01&&!pitchNode)throw new Error('The local time-preserving pitch processor is unavailable on this browser.');
          node.buffer=plan.buffer;
          if(pitchNode){pitchNode.parameters.get('semitones').setValueAtTime(pitch,when-latency);node.connect(pitchNode);pitchNode.connect(gain);}else node.connect(gain);
          gain.connect(audio.master);gain.gain.setValueAtTime(0,when);gain.gain.linearRampToValueAtTime(.82,when+fade);gain.gain.setValueAtTime(.82,when+duration-fade);gain.gain.linearRampToValueAtTime(0,when+duration);
          token.sources.push({node,gain,pitchNode});node.onended=()=>{node.disconnect();pitchNode?.disconnect();gain.disconnect();};node.start(when-latency,plan.start,duration+latency);
        }else{
          const timer=setTimeout(()=>{
            if(wordRemixPlayback!==token)return;
            const video=token.video;token.currentVideoPlan=plan;video.pause();video.currentTime=Math.min(plan.rangeStart,Math.max(0,video.duration-.02));
            wordPreviewVideoRoute.pitch=clamp(plan.event.pitch??0,-12,12);wordPreviewVideoRoute.speed=1;
            if(!audio.routeMediaPitch(wordPreviewVideoRoute)){stopWordRemix('Local video pitch is unavailable.');return;}
            audio.setMediaOutputGain(wordPreviewVideoRoute,.82);
            const trimTimer=setTimeout(()=>{if(wordRemixPlayback===token&&token.currentVideoPlan===plan)video.pause();},Math.max(0,Math.round(plan.duration*1000)));token.timers.push(trimTimer);
            video.play().catch(error=>{if(wordRemixPlayback===token)$('word-remix-status').textContent=`Video playback was blocked: ${error.message}. Tap Play again.`;});
          },Math.max(0,Math.round(plan.offset*1000)));
          token.timers.push(timer);
        }
      }
      $('voice-word-preview').hidden=false;
      $('word-remix-play').disabled=true;$('word-remix-stop').disabled=false;
      $('word-remix-status').textContent=`Playing ${events.length} source-linked word event${events.length===1?'':'s'} across four bars at ${bpm} BPM. Original video seek timing is best-effort.`;
      const finish=setTimeout(()=>stopWordRemix('Finished the four-bar Word Remix.'),Math.ceil((totalDuration+.15)*1000));token.timers.push(finish);
      wordRemixPlayback=token;
    }catch(error){
      if(wordRemixPlayback===token)stopWordRemix(`Word Remix could not play: ${error.message}`);
      else {token.sources.forEach(({node,gain,pitchNode})=>{try{node.stop();}catch{}node.disconnect();pitchNode?.disconnect();gain.disconnect();});if(token.videoUrl)URL.revokeObjectURL(token.videoUrl);if(token.video){token.video.pause();token.video.removeAttribute('src');token.video.load();token.video.hidden=true;}}
      $('word-remix-play').disabled=false;$('word-remix-stop').disabled=true;$('word-remix-status').textContent=`Word Remix could not play: ${error.message}`;
    }
  };
  let worker = null;
  const transcriptionActivity = new AsyncActivity();
  let vocalRecording = null;
  let interruptedAudioRecordings = [];
  let interruptedAudioRecording = null;
  let interruptedVideoRecordings = [];
  let interruptedVideoRecording = null;
  let videoRecording = null;
  const pendingRecordingDownloads=new Map();
  const videoRecordingActivity = new AsyncActivity();
  const songRenderActivity = new AsyncActivity();
  let songVideoAbortController = null;
  let tunerStream = null, tunerSource = null, tunerAnalyser = null, tunerTimer = null, tunerFrame = null;
  const tunerActivity = new AsyncActivity();
  const vocalFiles = new Map();
  const videoFiles = new Map(), videoUrls = new Map();
  const videoPlaybackElements = new Map();
  const videoAudioRoutes = new Map();
  const visualWaveformCache = new WeakMap();
  let songVideoAudioFrameId=null;
  let overdubZoom=1;
  const songTimelineSteps=()=>{
    const secondsPerStep=60/clamp(project.bpm,40,240)/4;
    const songSteps=Math.min(4096,songTotalBars(project.song)*16);
    const maxEnd=Math.max(16,songSteps,...project.voice.layers.map(layer=>{
      const raw=audio.vocalSources.get(layer.id)?.buffer?.duration||0;
      return layer.startStep+vocalLayerClip(layer,raw).duration/secondsPerStep;
    }),...project.voice.videoLayers.map(layer=>layer.startStep+Math.max(0,(layer.durationSec-(layer.trimStartSec||0)-(layer.trimEndSec==null?0:Math.max(0,layer.durationSec-layer.trimEndSec)))/secondsPerStep)));
    return Math.max(16,Math.min(4096,Math.ceil(maxEnd/16)*16));
  };
  const zoomLabel=()=>Number.isInteger(overdubZoom)?overdubZoom+'×':Math.round(overdubZoom*100)+'%';
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
  const offerRecordingDownload=(statusId,file,message,label)=>{
    const status=$(statusId),url=URL.createObjectURL(file),entry={url,pending:true};
    const cleanup=()=>{
      URL.revokeObjectURL(url);
      window.removeEventListener('pagehide',cleanup);
      if(pendingRecordingDownloads.get(statusId)===entry)pendingRecordingDownloads.delete(statusId);
    };
    entry.cleanup=cleanup;
    pendingRecordingDownloads.set(statusId,entry);
    status.textContent=`${message} Download this take before leaving; it remains available in this tab.`;
    const link=document.createElement('a');link.href=url;link.download=file.name;link.className='pill-button';link.textContent=label;
    link.addEventListener('click',()=>{
      entry.pending=false;
      pendingRecordingDownloads.delete(statusId);
      updateOverdubControls();
      setTimeout(cleanup,60000);
    },{once:true});
    window.addEventListener('pagehide',cleanup,{once:true});
    status.append(' ',link);
  };
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
    const videoStarting=videoRecordingActivity.phase==='starting';
    $('voice-overdub-record').disabled = !state.running || Boolean(vocalRecording) || Boolean(videoRecording) || videoStarting || Boolean(interruptedAudioRecording) || Boolean(pendingRecordingDownloads.get('voice-overdub-status')?.pending) || project.voice.layers.length >= MAX_VOCAL_LAYERS;
    $('voice-overdub-stop').hidden = !vocalRecording;
    if (project.voice.layers.length >= MAX_VOCAL_LAYERS && !vocalRecording) $('voice-overdub-status').textContent = `The ${MAX_VOCAL_LAYERS} audio-track limit is full. Export a project pack before deleting a local track.`;
    else if (!state.running && !vocalRecording && !$('voice-overdub-status').textContent) $('voice-overdub-status').textContent = 'Start the sequencer to record an audio track.';
    $('overdub-video-record').disabled=!state.running||Boolean(vocalRecording)||Boolean(videoRecording)||Boolean(interruptedVideoRecording)||Boolean(pendingRecordingDownloads.get('song-video-status')?.pending)||project.voice.videoLayers.length>=MAX_VOCAL_LAYERS;
    $('overdub-video-record').textContent=videoStarting?'× CANCEL CAMERA START':'● RECORD VIDEO TRACK';
    $('overdub-video-record').setAttribute('aria-label',videoStarting?'Cancel Song camera start':'Record a video track over the Song');
    $('overdub-video-stop').hidden=!videoRecording;
    $('overdub-video-cancel').hidden=!videoRecording;
    if(project.voice.videoLayers.length>=MAX_VOCAL_LAYERS&&!videoRecording)$('song-video-status').textContent=`The ${MAX_VOCAL_LAYERS} video-track limit is full. Delete a track before adding another.`;
    else if(!state.running&&!videoRecording&&!videoStarting&&!$('song-video-status').textContent)$('song-video-status').textContent='Start the Song to record a video track.';
    const rendering=songRenderActivity.phase!=='idle';
    const blocked=!songTotalBars(project.song)||state.running||rendering||Boolean(vocalRecording)||Boolean(videoRecording)||videoStarting;
    const renderButton=$('render-song-audio');
    if(renderButton)renderButton.disabled=blocked;
    const videoButton=$('render-song-video');
    if(videoButton){
      videoButton.disabled=blocked&&!songVideoAbortController;
      videoButton.textContent=songVideoAbortController?'× CANCEL VIDEO RENDER':'RENDER SONG VIDEO · MP4 / WEBM';
      videoButton.setAttribute('aria-label',songVideoAbortController?'Cancel offline Song video render':'Render complete Song video locally');
    }
  };

  async function prepareSongRenderInputs(){
    const decodeFile=async(file,label,existing=null)=>{
      if(existing)return existing;
      if(!file)throw new Error(`The local media for “${label}” is missing.`);
      try{return await audio.context.decodeAudioData(await file.arrayBuffer());}
      catch(error){throw new Error(`Could not decode “${label}” for the offline Song export: ${error?.message||'unsupported audio codec'}.`);}
    };
    if(!songTotalBars(project.song))throw new Error('Add saved patterns to Song before rendering.');
    const pads=new Map(),vocals=new Map(),videos=new Map(),cues=new Map(),wordRemix=new Map();
    const vocalDurations={},videoDurations={},wordRemixDurations={};
    for(const layer of project.voice.layers){
      if(layer.muted)continue;
      const existing=audio.vocalSources.get(layer.id)?.buffer;
      const file=vocalFiles.get(layer.id)||audio.vocalSources.get(layer.id)?.file;
      if(!file&&!existing)continue;
      const buffer=await decodeFile(file,layer.name,existing);
      vocals.set(layer.id,buffer);vocalDurations[layer.id]=buffer.duration;
    }
    for(const layer of project.voice.videoLayers){
      if(!layer.includeAudio)continue;
      const file=videoFiles.get(layer.id);
      if(!file)throw new Error(`The opted-in source audio for “${layer.name}” is missing locally.`);
      const buffer=await decodeFile(file,layer.name);
      videos.set(layer.id,buffer);videoDurations[layer.id]=Math.min(layer.durationSec,buffer.duration);
    }
    let plan=buildSongRenderPlan(project,{vocalDurations,videoDurations});
    const mediaFiles=getMediaFiles();
    for(const event of plan.events.filter(item=>item.kind==='word-remix-audio'||item.kind==='word-remix-video')){
      if(wordRemix.has(event.id))continue;
      const source=audio.sources.get(event.sourcePad),file=mediaFiles.get(event.sourcePad)||source?.file;
      const word=project.voice.transcripts.find(item=>item.id===event.transcriptId)?.words.find(item=>item.id===event.wordId);
      if(!word)throw new Error(`The transcript word for “${event.name}” is no longer available.`);
      if(event.kind==='word-remix-video'&&!file)throw new Error(`The local source video for “${event.name}” is missing.`);
      if(!file&&!source?.buffer)throw new Error(`The local source audio for “${event.name}” is missing.`);
      const buffer=await decodeFile(file,word.text,source?.buffer);
      wordRemix.set(event.id,{buffer,file,sourcePad:event.sourcePad,word});
      wordRemixDurations[event.id]=buffer.duration;
    }
    const activePadIds=[...new Set(plan.events.filter(event=>event.kind==='sample').map(event=>event.padId))];
    for(const id of activePadIds){
      const pad=project.pads[id],source=audio.sources.get(id),file=getMediaFiles().get(id)||source?.file;
      if(!file&&!source?.buffer)throw new Error(`Pad ${id+1} has an active Song step but no local audio source.`);
      pads.set(id,await decodeFile(file,pad.name,source?.buffer));
    }
    for(const note of plan.events.filter(event=>event.kind==='midi'&&event.word)){
      if(cues.has(note.word))continue;
      const word=project.voice.phrases.flatMap(phrase=>phrase.words).find(item=>item.text===note.word);
      const sourcePad=word&&project.pads[word.sourcePad],source=word&&audio.sources.get(word.sourcePad),file=word&&getMediaFiles().get(word.sourcePad);
      if(!word||!sourcePad?.fileName||!file&&!source?.buffer)continue;
      const buffer=pads.get(word.sourcePad)||await decodeFile(file,sourcePad.name,source?.buffer);
      pads.set(word.sourcePad,buffer);
      cues.set(note.word,{buffer,start:word.start,end:word.end,gain:sourcePad.volume});
    }
    const padDurations=Object.fromEntries([...pads].map(([id,buffer])=>[id,buffer.duration]));
    plan=buildSongRenderPlan(project,{padDurations,vocalDurations,videoDurations,wordRemixDurations});
    const visualFiles=new Map();
    for(const layer of project.voice.videoLayers){const file=videoFiles.get(layer.id);if(file)visualFiles.set(layer.id,file);}
    for(let id=0;id<project.pads.length;id++){
      const pad=project.pads[id],file=mediaFiles.get(id);
      if(file&&(pad.kind==='image'||pad.kind==='video'))visualFiles.set(`pad-${id}`,file);
    }
    const waveformBuffers=new Map([...pads].map(([id,buffer])=>[`pad-${id}`,buffer]));
    for(const [id,buffer] of vocals)waveformBuffers.set(id,buffer);
    for(const event of plan.events){
      if(event.kind!=='word-remix-audio'&&event.kind!=='word-remix-video')continue;
      const source=wordRemix.get(event.id);
      if(event.kind==='word-remix-video')visualFiles.set(event.trackId,source.file);
      else waveformBuffers.set(event.trackId,source.buffer);
    }
    return {plan,pads,vocals,videos,cues,wordRemix,visualFiles,waveformBuffers};
  }

  async function renderSongAudioExport(){
    const status=$('render-song-audio-status');
    const token=songRenderActivity.begin();
    if(token===null)return;
    updateOverdubControls();
    status.textContent='Preparing local Song audio sources…';
    try{
      if(transportState().running)throw new Error('Stop Song playback before starting an offline WAV render.');
      const {plan,pads,vocals,videos,cues,wordRemix}=await prepareSongRenderInputs();
      if(!songRenderActivity.current(token))return;
      status.textContent=`Rendering ${plan.bars} bars to a local 44.1 kHz WAV. Keep this tab open…`;
      const result=await renderSongAudioWav(plan,{pads,vocals,videos,cues,wordRemix});
      if(!songRenderActivity.current(token))return;
      rememberAudioTake?.(result.blob,result.durationSeconds);
      status.textContent=`Offline Song mix ready · ${result.durationSeconds.toFixed(1)} s · ${(result.blob.size/1024/1024).toFixed(1)} MB · stereo 16-bit PCM WAV. Review or download it below.`;
    }catch(error){
      status.textContent=error?.message||'Offline Song audio rendering failed. The original project media is unchanged.';
    }finally{
      if(songRenderActivity.current(token))songRenderActivity.cancel();
      updateOverdubControls();
    }
  }

  async function renderSongVideoExport(){
    if(songVideoAbortController){songVideoAbortController.abort();return;}
    const status=$('render-song-video-status');
    const token=songRenderActivity.begin();
    if(token===null)return;
    songVideoAbortController=new AbortController();
    const signal=songVideoAbortController.signal;
    updateOverdubControls();
    status.textContent='Preparing the local Song mix and visual sources…';
    try{
      if(transportState().running)throw new Error('Stop Song playback before starting an offline video render.');
      const sources=await prepareSongRenderInputs();
      if(!songRenderActivity.current(token)||signal.aborted)return;
      status.textContent=`Loading the local render engine for ${sources.plan.bars} bars…`;
      let Media;
      try{Media=await import('./media-codec-kit.bundle.js');}
      catch{throw new Error('The local render engine is not cached yet. Connect once, start this export to save it for offline use, then retry.');}
      if(!songRenderActivity.current(token)||signal.aborted)return;
      status.textContent=`Mixing ${sources.plan.bars} bars locally and encoding 24 fps video. Keep this tab open…`;
      const mixed=await renderSongAudioWav(sources.plan,sources,{sampleRate:44100,makeWav:false});
      if(!songRenderActivity.current(token)||signal.aborted)return;
      const aspect=$('video-aspect')?.value||project.video.aspect||'16:9';
      const result=await renderSongVideo(sources.plan,{audioBuffer:mixed.buffer,visualFiles:sources.visualFiles,
        waveformBuffers:sources.waveformBuffers,visualsAtTime:seconds=>songRenderVisualsAtTime(project,sources.plan,seconds)},
      {Media,format:$('record-video-format')?.value||'auto',aspect,signal,onProgress:progress=>{
        if(songRenderActivity.current(token))status.textContent=`Rendering Song video · ${progress.seconds.toFixed(0)} / ${progress.durationSeconds.toFixed(0)} s · ${Math.round(progress.frames/progress.totalFrames*100)}%. Keep this tab open…`;
      }});
      if(!songRenderActivity.current(token)||signal.aborted)return;
      rememberVideoTake?.(result.blob,result.durationSeconds);
      status.textContent=`Local Song video ready · ${result.durationSeconds.toFixed(1)} s · ${result.width}×${result.height} at ${result.frameRate} fps · ${result.format.toUpperCase()} · ${(result.blob.size/1024/1024).toFixed(1)} MB. Review or download it below.`;
    }catch(error){
      status.textContent=error?.message||'Offline Song video rendering failed. The original project media is unchanged.';
    }finally{
      songVideoAbortController=null;
      if(songRenderActivity.current(token))songRenderActivity.cancel();
      updateOverdubControls();
    }
  }

  const renderInterruptedAudioRecovery = () => {
    interruptedAudioRecording=interruptedAudioRecordings[0]||null;
    const recover=$('voice-overdub-recover'),discard=$('voice-overdub-discard');
    recover.hidden=!interruptedAudioRecording;
    discard.hidden=!interruptedAudioRecording;
    if(interruptedAudioRecording){
      recover.disabled=!interruptedAudioRecording.blob.size;
      const when=new Date(interruptedAudioRecording.createdAt).toLocaleString();
      $('voice-overdub-status').textContent=interruptedAudioRecording.blob.size
        ?`An interrupted local take from ${when} has ${interruptedAudioRecording.completeChunks} saved audio chunks (${(interruptedAudioRecording.blob.size/1024/1024).toFixed(1)} MB). Recover it into Song tracks or discard it.`
        :'An interrupted local take has no complete audio chunks. You can discard this empty recovery record.';
    }
    updateOverdubControls();
  };

  const refreshInterruptedAudioRecordings = async () => {
    try { interruptedAudioRecordings=await listInterruptedAudioRecordings(); }
    catch(error){console.warn('Interrupted audio recovery could not be checked',error);}
    renderInterruptedAudioRecovery();
  };

  const renderInterruptedVideoRecovery=()=>{
    interruptedVideoRecording=interruptedVideoRecordings[0]||null;
    const recover=$('overdub-video-recover'),discard=$('overdub-video-discard');
    recover.hidden=!interruptedVideoRecording;
    discard.hidden=!interruptedVideoRecording;
    if(interruptedVideoRecording){
      recover.disabled=!interruptedVideoRecording.blob.size;
      const when=new Date(interruptedVideoRecording.createdAt).toLocaleString();
      $('song-video-status').textContent=interruptedVideoRecording.blob.size
        ?`An interrupted local video take from ${when} has ${interruptedVideoRecording.completeChunks} saved chunks (${(interruptedVideoRecording.blob.size/1024/1024).toFixed(1)} MB). Recover it into Video tracks or discard it.`
        :'An interrupted local video take has no complete chunks. You can discard this empty recovery record.';
    }
    updateOverdubControls();
  };

  const refreshInterruptedVideoRecordings=async()=>{
    try{interruptedVideoRecordings=await listInterruptedVideoRecordings();}
    catch(error){console.warn('Interrupted video recovery could not be checked',error);}
    renderInterruptedVideoRecovery();
  };


  function createTrackGestureOverlay(layer,kind,index,rawDuration,secondsPerStep,pixelsPerStep) {
    const editable=document.createElement('div');
    editable.className='overdub-editable-clip';
    editable.dataset.trackKind=kind;editable.dataset.layerId=layer.id;
    const setPosition=next=>{
      const range=vocalLayerClip(next,rawDuration);
      editable.style.left=(next.startStep*pixelsPerStep)+'px';
      editable.style.width=Math.max(2,range.duration/secondsPerStep*pixelsPerStep)+'px';
    };
    setPosition(layer);
    const describe=kind==='audio'?'audio waveform':'video clip';
    const status=kind==='audio'?'voice-overdub-status':'song-video-status';
    const current=()=>kind==='audio'?project.voice.layers.find(item=>item.id===layer.id):project.voice.videoLayers.find(item=>item.id===layer.id);
    const apply=next=>{
      const active=current();if(!active)return;
      const oldRange=vocalLayerClip(active,rawDuration),newRange=vocalLayerClip(next,rawDuration);
      if(active.startStep===next.startStep&&Math.abs(oldRange.start-newRange.start)<.0001&&Math.abs(oldRange.end-newRange.end)<.0001)return;
      Object.assign(active,next);
      if(kind==='audio')audio.stopVocalLayer(layer.id);
      save();
      if(kind==='audio')renderVocalLayers();else {renderVideoLayers();renderOverdubTimeline();}
      $('overdub-timeline-status').textContent=kind+' track '+(index+1)+' moved or trimmed on the Song timeline; original source retained.';
    };
    const button=(kindOfDrag,text,position)=>{
      const control=document.createElement('button');control.type='button';
      control.className='overdub-clip-handle overdub-clip-'+position;
      control.textContent=text;
      const action=kindOfDrag==='move'?'Move':kindOfDrag==='trim-left'?'Trim beginning of':'Trim end of';
      control.setAttribute('aria-label',action+' '+describe+' '+(index+1)+' on the Song ruler; drag or use arrow keys');
      control.title=kindOfDrag==='move'?'Drag to move on Song; arrows move 1 step, Shift+arrows move 1 bar':'Drag to trim without changing raw media; arrows trim 1 step, Shift+arrows trim 1 bar';
      const blocked=()=>{if(!transportState().running)return false;$(status).textContent='Stop Song playback before dragging or trimming a track.';return true;};
      control.addEventListener('keydown',event=>{
        if(event.key!=='ArrowLeft'&&event.key!=='ArrowRight')return;
        event.preventDefault();if(blocked())return;
        const offset=(event.key==='ArrowRight'?1:-1)*(event.shiftKey?16:1);
        const active=current();if(active)apply(editSongTrackOnTimeline(active,kindOfDrag,offset,rawDuration,project.bpm));
        const replacement=$('overdub-timeline').querySelector('.overdub-editable-clip[data-layer-id="'+layer.id+'"] .overdub-clip-'+position);
        replacement?.focus({preventScroll:true});
      });
      control.addEventListener('pointerdown',event=>{
        if(event.button!==0||blocked())return;
        event.preventDefault();event.stopPropagation();
        control.setPointerCapture(event.pointerId);
        const original={...current()},originX=event.clientX;
        let proposed=original,started=false;
        editable.classList.add('is-editing');
        const move=point=>{
          if(point.pointerId!==event.pointerId)return;
          if(!started&&Math.abs(point.clientX-originX)<5)return;
          started=true;
          const delta=Math.round((point.clientX-originX)/pixelsPerStep);
          proposed=editSongTrackOnTimeline(original,kindOfDrag,delta,rawDuration,project.bpm);
          setPosition(proposed);
        };
        const cleanup=()=>{
          control.removeEventListener('pointermove',move);
          control.removeEventListener('pointerup',finish);
          control.removeEventListener('pointercancel',cancel);
          if(control.hasPointerCapture(event.pointerId))control.releasePointerCapture(event.pointerId);
          editable.classList.remove('is-editing');
        };
        const cancel=point=>{if(point.pointerId!==event.pointerId)return;cleanup();setPosition(original);};
        const finish=point=>{
          if(point.pointerId!==event.pointerId)return;
          cleanup();if(started&&!blocked())apply(proposed);else setPosition(original);
        };
        control.addEventListener('pointermove',move);
        control.addEventListener('pointerup',finish);
        control.addEventListener('pointercancel',cancel);
      });
      return control;
    };
    editable.append(button('move','↔','move'),button('trim-left','╷','left'),button('trim-right','╷','right'));
    return editable;
  }

  for(const [name,change] of [['overdub-zoom-in',1],['overdub-zoom-out',-1]]){
    $(name).addEventListener('click',()=>{
      const options=[.03,.05,.1,.25,.5,1,2,4],index=options.reduce((closest,value,candidate)=>Math.abs(value-overdubZoom)<Math.abs(options[closest]-overdubZoom)?candidate:closest,0);
      overdubZoom=options[Math.max(0,Math.min(options.length-1,index+change))];
      $('overdub-zoom-label').textContent=zoomLabel();
      $('overdub-zoom-in').disabled=overdubZoom===4;
      $('overdub-zoom-out').disabled=overdubZoom===.03;
      renderOverdubTimeline();
    });
  }
  $('overdub-zoom-fit').addEventListener('click',()=>{
    const width=$('overdub-timeline').parentElement.clientWidth||320;
    const bars=Math.max(1,songTimelineSteps()/16);
    overdubZoom=clamp(width/(bars*28),.03,4);
    $('overdub-zoom-label').textContent=zoomLabel();
    $('overdub-zoom-in').disabled=overdubZoom>=4;
    $('overdub-zoom-out').disabled=overdubZoom<=.03;
    renderOverdubTimeline();
  });

  function renderOverdubTimeline(){
    const host=$('overdub-timeline');
    host.replaceChildren();
    const secondsPerStep=60/clamp(project.bpm,40,240)/4;
    // Vocal placements support up to 256 bars; keep the full arrangement compact
    // and scrollable inside this component rather than widening the page.
    const totalSteps=songTimelineSteps();
    const width=Math.max(host.parentElement.clientWidth,Math.min(32768,totalSteps*1.75*overdubZoom)),height=64;
    const pixelsPerStep=width/totalSteps;
    const visibleBars=totalSteps/16,barWidth=width/visibleBars;
    onTimelineScale?.({barWidth,width,visibleBars});
    updateSongCycleControlAvailability();
    for(const [index,layer] of project.voice.layers.entries()){
      const row=document.createElement('div');row.className='overdub-wave-row';row.dataset.waveLayer=layer.id;row.style.width=width+'px';
      const title=document.createElement('strong');title.textContent=(index+1)+'. '+layer.name;row.append(title);
      const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
      svg.setAttribute('viewBox','0 0 '+width+' '+height);
      svg.setAttribute('role','img');svg.setAttribute('height',String(height));svg.setAttribute('width',String(width));
      const source=audio.vocalSources.get(layer.id)?.buffer,clip=vocalLayerClip(layer,source?.duration||0);
      const endStep=layer.startStep+clip.duration/secondsPerStep;
      svg.setAttribute('aria-label',layer.name+' from bar '+(Math.floor(layer.startStep/16)+1)+', step '+(layer.startStep%16+1)+' to bar '+(Math.floor(endStep/16)+1)+', step '+((endStep%16)+1).toFixed(1)+'; '+clip.duration.toFixed(2)+' seconds of audible audio');
      const add=(tag,attrs)=>{const node=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [key,value] of Object.entries(attrs))node.setAttribute(key,String(value));svg.append(node);return node;};
      for(let step=0;step<=totalSteps;step+=(totalSteps>512?16:4)){const x=step/totalSteps*width;add('line',{x1:x,x2:x,y1:0,y2:height,stroke:step%16===0?'#758a66':'#344b39','stroke-width':step%16===0?1.6:.6});}
      if(source&&clip.duration>0&&layer.startStep<totalSteps){
        const instances=songLayerPlaybackEvents(layer,source.duration,project.bpm,songTotalBars(project.song));
        const first=instances[0],shownStart=layer.repeatEnabled?(first?.startStep??layer.startStep):layer.startStep;
        const shownDuration=layer.repeatEnabled?(first?.durationSec??0):clip.duration;
        const x=shownStart/totalSteps*width;
        const audibleWidth=Math.max(1,Math.min(width-x,shownDuration/secondsPerStep/totalSteps*width));
        add('rect',{x,y:7,width:audibleWidth,height:height-14,rx:3,fill:'#31573a',stroke:'#a9d87b','stroke-width':1});
        const data=source.getChannelData(0),waveStart=layer.reverseEnabled?Math.max(clip.start,clip.end-shownDuration):clip.start;
        const from=Math.floor(waveStart*source.sampleRate),to=Math.min(data.length,Math.ceil((waveStart+shownDuration)*source.sampleRate));
        const count=Math.min(160,Math.max(8,Math.floor(audibleWidth/5)));
        for(let bin=0;bin<count;bin++){
          const lo=layer.reverseEnabled?to-Math.floor((to-from)*(bin+1)/count):from+Math.floor((to-from)*bin/count);
          const hi=layer.reverseEnabled?to-Math.floor((to-from)*bin/count):from+Math.floor((to-from)*(bin+1)/count);
          let peak=0;
          for(let position=lo;position<hi;position+=Math.max(1,Math.floor((hi-lo)/96)))peak=Math.max(peak,Math.abs(data[position]||0));
          const px=x+(bin+.5)*audibleWidth/count,extent=Math.max(.7,peak*23);
          add('line',{x1:px,x2:px,y1:height/2-extent,y2:height/2+extent,stroke:'#b9ec94','stroke-width':Math.max(.8,audibleWidth/count-1)});
        }
        add('line',{x1:x+audibleWidth,x2:x+audibleWidth,y1:6,y2:height-6,stroke:'#edce7c','stroke-width':2});
        if(layer.repeatEnabled){
          for(const [instanceIndex,instance] of instances.entries()){
            if(instanceIndex===0&&instance.startStep===shownStart)continue;
            const repeatX=instance.startStep/totalSteps*width;
            const repeatWidth=Math.max(1,Math.min(width-repeatX,instance.durationSec/secondsPerStep/totalSteps*width));
            if(repeatX<width)add('rect',{x:repeatX,y:7,width:repeatWidth,height:height-14,rx:3,fill:'#31573a',opacity:.55,stroke:'#a9d87b','stroke-dasharray':'4 3','stroke-width':1,'data-repeat-instance':instanceIndex});
          }
        }
      }
      const stage=document.createElement('div');stage.className='overdub-wave-stage';stage.style.width=width+'px';stage.style.height='106px';stage.append(svg);
      if(source&&clip.duration>0)stage.append(createTrackGestureOverlay(layer,'audio',index,source.duration,secondsPerStep,pixelsPerStep));
      row.append(stage);host.append(row);
    }
    for(const [index,layer] of project.voice.videoLayers.entries()){
      const row=document.createElement('div');row.className='overdub-wave-row';row.dataset.videoLayer=layer.id;row.style.width=width+'px';
      const title=document.createElement('strong');title.textContent=`VIDEO ${index+1}. ${layer.name}`;row.append(title);
      const lane=document.createElement('div');lane.className='overdub-video-lane';lane.style.width=width+'px';lane.setAttribute('role','group');lane.setAttribute('aria-label',`Song placement lane for video track ${index+1}, ${layer.name}`);
      const start=clamp(layer.startStep,0,totalSteps),rawEnd=layer.trimEndSec==null?layer.durationSec:Math.min(layer.durationSec,layer.trimEndSec);
      const clipSeconds=Math.max(0,rawEnd-clamp(layer.trimStartSec,0,Math.max(0,rawEnd-.01)));
      if(start<totalSteps&&clipSeconds>0){
        const instances=songLayerPlaybackEvents(layer,layer.durationSec,project.bpm,songTotalBars(project.song));
        for(const [instanceIndex,instance] of instances.entries()){
          const instanceX=clamp(instance.startStep,0,totalSteps)/totalSteps*100;
          if(instanceX>=100)continue;
          const clip=document.createElement('span');clip.className='overdub-video-clip'+(instanceIndex?' song-repeat-instance':'');clip.style.left=`${instanceX}%`;clip.style.width=`${Math.min(100-instanceX,instance.durationSec/secondsPerStep/totalSteps*100)}%`;clip.textContent=instanceIndex?`↻ ${layer.name}`:layer.name;
          clip.setAttribute('aria-label',`${layer.name} video repeat ${instanceIndex+1} from bar ${Math.floor(instance.startStep/16)+1}, playing ${instance.durationSec.toFixed(1)} seconds`);lane.append(clip);
        }
        lane.append(createTrackGestureOverlay(layer,'video',index,layer.durationSec,secondsPerStep,pixelsPerStep));
      }
      row.append(lane);host.append(row);
    }
    $('overdub-timeline-status').textContent=project.voice.layers.length||project.voice.videoLayers.length
      ?'Drag clip centre to move; drag left or right handles to trim non-destructively. Zoom in for detail. The ruler aligns audio and video to the same Song bars. Stop playback before editing.'
      :'Recorded and imported audio waveforms will appear here, aligned with your Song bars. Original files stay local.';
  }

  function restoreTrackMoveFocus(type,index,delta){
    const label=(direction)=>`Move ${type} track ${index+1} ${direction} by one bar`;
    const preferred=document.querySelector(`[aria-label="${label(delta<0?'earlier':'later')}"]`);
    const fallback=document.querySelector(`[aria-label="${label(delta<0?'later':'earlier')}"]`);
    (preferred&&!preferred.disabled?preferred:fallback)?.focus();
  }

  function renderVideoLayers(){
    const host=$('song-video-layers');host.replaceChildren();
    project.voice.videoLayers.forEach((layer,index)=>{
      const row=document.createElement('article');row.className='song-video-track';row.dataset.videoLayer=layer.id;
      const name=document.createElement('input');name.className='vocal-layer-name';name.value=layer.name;name.maxLength=48;name.setAttribute('aria-label',`Video track ${index+1} name`);
      name.addEventListener('change',()=>{layer.name=name.value.trim()||`Video track ${index+1}`;save();renderVideoLayers();});
      const url=videoUrls.get(layer.id),preview=document.createElement('video');preview.controls=true;preview.muted=true;preview.playsInline=true;preview.preload='metadata';preview.setAttribute('aria-label',`Muted preview for video track ${index+1}`);if(url)preview.src=url;
      const controls=document.createElement('div');controls.className='song-video-controls';
      const field=(key,labelText,value,max)=>{
        const label=document.createElement('label');label.className='vocal-layer-start';label.append(document.createTextNode(labelText));
        const input=document.createElement('input');input.type='number';input.min='0';input.max=String(max);input.step='0.05';input.value=String(Number(value.toFixed(2)));input.setAttribute('aria-label',`${labelText} for video track ${index+1}`);
        input.addEventListener('change',()=>{const n=clamp(input.value,0,max);if(key==='startStep')layer.startStep=Math.round(n);else if(key==='trimStartSec')layer.trimStartSec=Math.min(n,Math.max(0,(layer.trimEndSec??layer.durationSec)-.01));else layer.trimEndSec=Math.max(n,Math.min(layer.durationSec,(layer.trimStartSec||0)+.01));save();renderVideoLayers();renderOverdubTimeline();});
        label.append(input);controls.append(label);
      };
      field('startStep','START STEP',layer.startStep,4096);field('trimStartSec','TRIM IN (S)',layer.trimStartSec,layer.durationSec);
      field('trimEndSec','TRIM OUT (S)',layer.trimEndSec??layer.durationSec,layer.durationSec);
      const moveControls=document.createElement('div');moveControls.className='song-track-move-controls';
      const moveVideoBar=(delta)=>{layer.startStep=clamp(layer.startStep+delta*16,0,4095);save();renderVideoLayers();renderOverdubTimeline();restoreTrackMoveFocus('video',index,delta);};
      const moveEarlier=document.createElement('button');moveEarlier.type='button';moveEarlier.className='pill-button';moveEarlier.textContent='− 1 BAR';moveEarlier.disabled=layer.startStep<16;moveEarlier.setAttribute('aria-label',`Move video track ${index+1} earlier by one bar`);moveEarlier.addEventListener('click',()=>moveVideoBar(-1));
      const moveLater=document.createElement('button');moveLater.type='button';moveLater.className='pill-button';moveLater.textContent='+ 1 BAR';moveLater.disabled=layer.startStep>=4080;moveLater.setAttribute('aria-label',`Move video track ${index+1} later by one bar`);moveLater.addEventListener('click',()=>moveVideoBar(1));
      moveControls.append(moveEarlier,moveLater);controls.append(moveControls);
      const sourceAudio=document.createElement('label');sourceAudio.className='song-video-audio-control';
      const includeAudio=document.createElement('input');includeAudio.type='checkbox';includeAudio.checked=Boolean(layer.includeAudio);includeAudio.setAttribute('aria-label',`Mix source audio for video track ${index+1}`);
      const includeLabel=document.createElement('span');includeLabel.textContent='MIX SOURCE AUDIO';
      const audioGain=document.createElement('input');audioGain.type='range';audioGain.min='0';audioGain.max='150';audioGain.step='1';audioGain.value=String(Math.round(clamp(layer.audioGain??1,0,1.5)*100));audioGain.disabled=!includeAudio.checked;audioGain.setAttribute('aria-label',`Source audio volume for video track ${index+1}`);
      const audioGainValue=document.createElement('output');audioGainValue.textContent=`${audioGain.value}%`;
      includeAudio.addEventListener('change',()=>{layer.includeAudio=includeAudio.checked;audioGain.disabled=!layer.includeAudio;save();updateSongVideoAudio(layer);startSongVideoAudioPlayback();renderVideoLayers();});
      audioGain.addEventListener('input',()=>{layer.audioGain=clamp(Number(audioGain.value)/100,0,1.5);audioGainValue.textContent=`${audioGain.value}%`;updateSongVideoAudio(layer);});
      audioGain.addEventListener('change',()=>{layer.audioGain=clamp(Number(audioGain.value)/100,0,1.5);save();});
      sourceAudio.append(includeAudio,includeLabel,audioGain,audioGainValue);controls.append(sourceAudio);
      const remove=document.createElement('button');remove.type='button';remove.className='pill-button';remove.textContent='DELETE VIDEO';remove.setAttribute('aria-label',`Delete video track ${index+1} and its local source`);
      remove.addEventListener('click',async()=>{
        if(!confirm(`Delete ${layer.name} and its saved local video file?`))return;
        const nextLayers=project.voice.videoLayers.filter(item=>item.id!==layer.id);
        try{await deleteSongVideoLayer(layer.id,{...project,voice:{...project.voice,videoLayers:nextLayers}});project.voice.videoLayers=nextLayers;videoFiles.delete(layer.id);const player=videoPlaybackElements.get(layer.id);if(player){player.pause();player.removeAttribute('src');player.load();player.remove();videoPlaybackElements.delete(layer.id);}const route=videoAudioRoutes.get(layer.id);if(route){route.source.disconnect();route.gain.disconnect();videoAudioRoutes.delete(layer.id);}const url=videoUrls.get(layer.id);if(url)URL.revokeObjectURL(url);videoUrls.delete(layer.id);save();renderVideoLayers();renderOverdubTimeline();$('song-video-status').textContent='Video track and its local source file deleted.';}
        catch(error){$('song-video-status').textContent=`Could not delete the video track: ${error.message}`;}
      });controls.append(remove);
      const meta=document.createElement('small');meta.className='song-video-meta';const clipStart=layer.trimStartSec||0,clipEnd=layer.trimEndSec??layer.durationSec;const sourceKind=layer.origin==='recording'?'Raw camera take saved locally':'Original video saved on this device';meta.textContent=`${videoFiles.has(layer.id)?sourceKind:'Local video file missing'} · bar ${Math.floor(layer.startStep/16)+1}, step ${layer.startStep%16+1} · ${Math.max(0,clipEnd-clipStart).toFixed(2)} s visible · source audio ${layer.includeAudio?'included':'muted by default'}`;
      controls.append(createSongCycleControls(layer,'video',index,Math.max(0,clipEnd-clipStart)));
      row.append(name,preview,controls,meta);host.append(row);
    });
    updateSongCycleControlAvailability();
  }

  function releaseSongVideoPlayers(){
    for(const video of videoPlaybackElements.values()){
      video.pause();video.removeAttribute('src');video.load();video.remove();
    }
    videoPlaybackElements.clear();
    for(const route of videoAudioRoutes.values()){route.source.disconnect();route.gain.disconnect();}
    videoAudioRoutes.clear();
  }

  function songVideoAudioRoute(layer,video,allowAudio=true){
    let route=videoAudioRoutes.get(layer.id);
    if(!route){
      if(video.dataset.songVideoAudioRoute==='unavailable')return null;
      try{
        const source=audio.context.createMediaElementSource(video),gain=audio.context.createGain();
        gain.gain.value=0;
        source.connect(gain);gain.connect(audio.master);
        route={source,gain};videoAudioRoutes.set(layer.id,route);video.muted=false;video.dataset.songVideoAudioRoute='connected';
      }catch(error){
        video.dataset.songVideoAudioRoute='unavailable';video.muted=true;
        if(layer.includeAudio)notify(`Video source audio could not be mixed in this browser: ${error.message}`);
        return null;
      }
    }
    const desired=layer.includeAudio&&allowAudio?clamp(layer.audioGain??1,0,1.5):0;
    if(Number(video.dataset.songVideoAudioGain)!==desired){
      const now=audio.context.currentTime,parameter=route.gain.gain;
      parameter.cancelScheduledValues(now);parameter.setTargetAtTime(desired,now,.012);
      video.dataset.songVideoAudioGain=String(desired);
    }
    video.dataset.songVideoAudioEnabled=String(Boolean(layer.includeAudio));
    return route;
  }

  function updateSongVideoAudio(layer){
    const video=videoPlaybackElements.get(layer.id);
    if(video){const allowAudio=video.dataset.songVideoActive==='true'&&video.readyState>=2&&!video.seeking&&!video.paused;songVideoAudioRoute(layer,video,allowAudio);if(layer.includeAudio&&!videoAudioRoutes.has(layer.id)&&video.dataset.songVideoAudioRoute==='unavailable')$('song-video-status').textContent='This browser could not route the video track source audio into the Song mix.';}
  }

  function pauseSongVideoPlayers(){
    for(const [id,video] of videoPlaybackElements){
      video.pause();video.dataset.songVideoActive='false';
      const route=videoAudioRoutes.get(id);
      if(route){const now=audio.context.currentTime;route.gain.gain.cancelScheduledValues(now);route.gain.gain.setTargetAtTime(0,now,.012);video.dataset.songVideoAudioGain='0';}
    }
  }

  function updateSongVideoTracksAtStep(absoluteStep,{audioOnly=false}={}){
    const transport=transportState();
    if(!transport.running||!Number.isFinite(absoluteStep)){if(!audioOnly)pauseSongVideoPlayers();return [];}
    const activeIds=new Set(),frames=[];
    for(const layer of project.voice.videoLayers){
      if(audioOnly&&!layer.includeAudio)continue;
      const url=videoUrls.get(layer.id),sourceSec=songVideoPositionAtStep(layer,absoluteStep,transport.bpm,songTotalBars(project.song));
      if(!url||!videoFiles.has(layer.id)||sourceSec===null){
        const inactive=videoPlaybackElements.get(layer.id),route=videoAudioRoutes.get(layer.id);
        if(inactive){inactive.pause();inactive.dataset.songVideoActive='false';}
        if(route){const now=audio.context.currentTime;route.gain.gain.cancelScheduledValues(now);route.gain.gain.setTargetAtTime(0,now,.012);if(inactive)inactive.dataset.songVideoAudioGain='0';}
        continue;
      }
      activeIds.add(layer.id);
      let video=videoPlaybackElements.get(layer.id);
      if(!video){
        video=document.createElement('video');video.muted=true;video.playsInline=true;video.preload='auto';video.controls=false;video.tabIndex=-1;video.dataset.songVideoTrack=layer.id;video.setAttribute('aria-hidden','true');
        Object.assign(video.style,{position:'fixed',left:'-4px',top:'-4px',width:'1px',height:'1px',opacity:'0.001',pointerEvents:'none'});
        video.src=url;document.body.append(video);videoPlaybackElements.set(layer.id,video);
      }
      const firstActiveFrame=video.dataset.songVideoActive!=='true';
      try{if(video.readyState>=1&&(firstActiveFrame||(!video.seeking&&Math.abs(video.currentTime-sourceSec)>.20))){video.currentTime=sourceSec;video.dataset.songVideoActive='true';}}catch{}
      songVideoAudioRoute(layer,video,video.dataset.songVideoActive==='true'&&video.readyState>=2&&!video.seeking);
      if(video.dataset.songVideoActive==='true'&&video.paused)video.play().catch(()=>{});
      if(!audioOnly&&video.readyState>=2)frames.push({id:layer.id,name:layer.name,video});
    }
    for(const [id,video] of videoPlaybackElements)if(!activeIds.has(id)&&(!audioOnly||project.voice.videoLayers.find(layer=>layer.id===id)?.includeAudio)){video.pause();video.dataset.songVideoActive='false';}
    return frames;
  }

  function songVideoFramesAtStep(absoluteStep){return updateSongVideoTracksAtStep(absoluteStep);}

  function waveformPeaks(buffer){
    let peaks=visualWaveformCache.get(buffer);
    if(peaks)return peaks;
    const bins=64,channels=buffer.numberOfChannels,frames=buffer.length;
    peaks=new Float32Array(bins);
    for(let bin=0;bin<bins;bin++){
      const from=Math.floor(bin*frames/bins),to=Math.max(from+1,Math.floor((bin+1)*frames/bins));
      let peak=0;
      for(let channel=0;channel<channels;channel++){
        const samples=buffer.getChannelData(channel);
        const stride=Math.max(1,Math.floor((to-from)/128));
        for(let index=from;index<to;index+=stride)peak=Math.max(peak,Math.abs(samples[index]||0));
      }
      peaks[bin]=peak;
    }
    visualWaveformCache.set(buffer,peaks);
    return peaks;
  }

  function songAudioFramesAtStep(absoluteStep){
    const buffers=new Map(project.voice.layers.map(layer=>[layer.id,audio.vocalSources.get(layer.id)?.buffer]));
    const durations=new Map([...buffers].flatMap(([id,buffer])=>buffer?[[id,buffer.duration]]:[]));
    return activeSongAudioVisuals(project.voice.layers,durations,absoluteStep,project.bpm,songTotalBars(project.song)).map(track=>({
      ...track,
      peaks:waveformPeaks(buffers.get(track.id))
    }));
  }

  function songMelodyVisualTracksAtStep(absoluteStep){
    return songMelodyVisualTracks(project.voice.melody,absoluteStep,songTotalBars(project.song));
  }

  function songVideoAudioPlaybackFrame(){
    songVideoAudioFrameId=null;
    const transport=transportState();
    if(!transport.running){pauseSongVideoPlayers();return;}
    if(!project.voice.videoLayers.some(layer=>layer.includeAudio))return;
    const secondsPerStep=60/clamp(transport.bpm,40,240)/4;
    const absoluteStep=(audio.context.currentTime-transport.epoch)/secondsPerStep;
    updateSongVideoTracksAtStep(absoluteStep,{audioOnly:true});
    songVideoAudioFrameId=requestAnimationFrame(songVideoAudioPlaybackFrame);
  }

  function startSongVideoAudioPlayback(){
    if(!transportState().running||!project.voice.videoLayers.some(layer=>layer.includeAudio)||songVideoAudioFrameId!==null)return;
    songVideoAudioFrameId=requestAnimationFrame(songVideoAudioPlaybackFrame);
  }

  function stopSongVideoAudioPlayback(){
    if(songVideoAudioFrameId!==null)cancelAnimationFrame(songVideoAudioFrameId);
    songVideoAudioFrameId=null;pauseSongVideoPlayers();
  }

  function stopSongVideoVisualPlayback(){
    for(const [id,video] of videoPlaybackElements){
      if(project.voice.videoLayers.find(layer=>layer.id===id)?.includeAudio)continue;
      video.pause();video.dataset.songVideoActive='false';
    }
  }

  function createSongCycleControls(layer,kind,index,sourceDuration){
    const details=document.createElement('details');details.className='song-cycle-settings';
    details.dataset.layerId=layer.id;
    const summary=document.createElement('summary');summary.textContent=layer.repeatEnabled?`Repeat every ${layer.repeatEveryBars} bar${layer.repeatEveryBars===1?'':'s'}`:'Repeat';details.append(summary);
    const note=document.createElement('small');note.className='song-cycle-note';note.textContent='Cycles continue across section changes. Play length can differ from the repeat interval; playback stops after the chosen bar or at Song end.';details.append(note);
    const repeat=document.createElement('label');repeat.className='song-cycle-toggle';
    const enabled=document.createElement('input');enabled.type='checkbox';enabled.checked=Boolean(layer.repeatEnabled);enabled.setAttribute('aria-label',`Repeat ${kind} track ${index+1}`);
    const repeatLabel=document.createElement('span');repeatLabel.textContent='Repeat this clip in the Song';repeat.append(enabled,repeatLabel);details.append(repeat);
    const fields=document.createElement('div');fields.className='song-cycle-fields';
    const secondsPerBar=60/clamp(project.bpm,40,240)*4;
    const naturalBars=clamp(sourceDuration/secondsPerBar,1/16,MAX_SONG_BARS);
    const addField=(key,labelText,value,min,max,step)=>{
      const label=document.createElement('label');label.className='vocal-layer-start';label.append(document.createTextNode(labelText));
      const input=document.createElement('input');input.type='number';input.min=String(min);input.max=String(max);input.step=String(step);input.value=String(value);input.dataset.cycleField=key;
      input.setAttribute('aria-label',`${labelText} for ${kind} track ${index+1}`);label.append(input);fields.append(label);return input;
    };
    const period=addField('repeatEveryBars','REPEAT EVERY (BARS)',layer.repeatEveryBars??1,1,MAX_SONG_BARS,1);
    const phase=addField('repeatPhaseBars','FIRST OFFSET (BARS)',layer.repeatPhaseBars??0,0,MAX_SONG_BARS-1,1);
    const length=addField('audibleLengthBars','PLAY LENGTH (BARS)',layer.audibleLengthBars??Number(naturalBars.toFixed(3)),1/16,MAX_SONG_BARS,1/16);
    const placementEnd=addField('placementEndBar','STOP AFTER BAR',layer.placementEndBar??'',1,MAX_SONG_BARS,1);
    placementEnd.value=layer.placementEndBar==null?'':String(layer.placementEndBar);placementEnd.placeholder='SONG END';
    details.append(fields);
    const update=()=>{
      if(transportState().running)return;
      layer.repeatEnabled=enabled.checked;
      layer.repeatEveryBars=Math.round(clamp(period.value,1,MAX_SONG_BARS));
      layer.repeatPhaseBars=Math.round(clamp(phase.value,0,MAX_SONG_BARS-1));
      layer.audibleLengthBars=clamp(length.value,1/16,MAX_SONG_BARS);
      layer.placementEndBar=placementEnd.value.trim()===''?null:Math.round(clamp(placementEnd.value,1,MAX_SONG_BARS));
      summary.textContent=layer.repeatEnabled?`Repeat every ${layer.repeatEveryBars} bar${layer.repeatEveryBars===1?'':'s'}`:'Repeat';
      length.disabled=!layer.repeatEnabled;period.disabled=!layer.repeatEnabled;phase.disabled=!layer.repeatEnabled;
      save();renderOverdubTimeline();
      const status=kind==='audio'?'voice-overdub-status':'song-video-status';
      $(status).textContent=layer.repeatEnabled
        ?`${layer.name} plays ${layer.audibleLengthBars} bar(s), then repeats every ${layer.repeatEveryBars} bar(s)${layer.repeatPhaseBars?` after a ${layer.repeatPhaseBars}-bar first offset`:''}${layer.placementEndBar?`, stopping after bar ${layer.placementEndBar}`:''}. Original media stays unchanged.`
        :`${layer.name} is a one-shot. Original media stays unchanged.`;
    };
    enabled.addEventListener('change',update);period.addEventListener('change',update);phase.addEventListener('change',update);length.addEventListener('change',update);placementEnd.addEventListener('change',update);
    if(!enabled.checked){period.disabled=true;phase.disabled=true;length.disabled=true;}
    return details;
  }

  function updateSongCycleControlAvailability(){
    const disabled=transportState().running,hasSong=songTotalBars(project.song)>0;
    for(const input of document.querySelectorAll('.song-audio-reverse input'))input.disabled=disabled||input.dataset.reverseSupported!=='true';
    for(const details of document.querySelectorAll('.song-cycle-settings')){
      const enabled=details.querySelector('input[type="checkbox"]').checked;
      for(const input of details.querySelectorAll('input')){
        const endBoundary=input.dataset.cycleField==='placementEndBar';
        input.disabled=disabled||(!hasSong&&(input.type==='checkbox'||endBoundary))||(!endBoundary&&input.type!=='checkbox'&&!enabled);
      }
    }
  }

  function probeVideoDuration(file,fallbackDurationSec=null){
    return new Promise((resolve,reject)=>{
      const fallback=Number.isFinite(fallbackDurationSec)&&fallbackDurationSec>0?clamp(fallbackDurationSec,.05,10800):null;
      const video=document.createElement('video'),url=URL.createObjectURL(file),timer=setTimeout(()=>finish(new Error('This video did not report a readable duration.')),fallback?1500:10000);
      let settled=false;
      const finish=error=>{if(settled)return;settled=true;const duration=video.duration;clearTimeout(timer);video.removeAttribute('src');video.load();URL.revokeObjectURL(url);if(error&&fallback)resolve(fallback);else if(error)reject(error);else resolve(duration);};
      video.preload='metadata';video.onloadedmetadata=()=>Number.isFinite(video.duration)&&video.duration>0?finish():finish(new Error('This video has no readable duration.'));
      video.onerror=()=>finish(new Error('This browser cannot read the selected video format.'));video.src=url;
    });
  }

  function renderVocalLayers() {
    const host = $('voice-overdub-layers'); host.replaceChildren();
    project.voice.layers.forEach((layer, index) => {
      const row = document.createElement('div'); row.className = 'vocal-layer'; row.dataset.layer = layer.id;
      const name = document.createElement('input'); name.className = 'vocal-layer-name'; name.value = layer.name; name.maxLength = 48; name.setAttribute('aria-label', `Audio track ${index + 1} name`);
      name.addEventListener('change', () => { layer.name = name.value.trim() || `Vocal take ${index + 1}`; save(); });
      const offset = document.createElement('label'); offset.className = 'vocal-layer-start'; offset.append(document.createTextNode('START STEP'));
      const offsetInput = document.createElement('input'); offsetInput.type = 'number'; offsetInput.min = '0'; offsetInput.max = '4096'; offsetInput.step = '1'; offsetInput.value = String(layer.startStep); offsetInput.setAttribute('aria-label', `Audio track ${index + 1} start step`);
      offsetInput.addEventListener('change', () => { layer.startStep = Math.round(clamp(offsetInput.value, 0, 4096)); save(); renderVocalLayers(); });
      offset.append(offsetInput);
      const gain = document.createElement('label'); gain.className = 'vocal-layer-gain'; gain.append(document.createTextNode('GAIN'));
      const slider = document.createElement('input'); slider.type = 'range'; slider.min = '0'; slider.max = '1.5'; slider.step = '.01'; slider.value = String(layer.gain); slider.setAttribute('aria-label', `Audio track ${index + 1} gain`);
      const output = document.createElement('output'); output.textContent = `${Math.round(layer.gain * 100)}%`;
      slider.addEventListener('input', () => { layer.gain = clamp(slider.value, 0, 1.5); output.textContent = `${Math.round(layer.gain * 100)}%`; audio.updateVocalLayerStates(project.voice.layers); save(); });
      gain.append(slider, output);
      const control = (text, label, active, action) => { const button = document.createElement('button'); button.type = 'button'; button.className = `pill-button${active ? ' active' : ''}`; button.textContent = text; button.setAttribute('aria-label', label); button.setAttribute('aria-pressed', String(active)); button.addEventListener('click', action); return button; };
      const mute = control(layer.muted ? 'UNMUTE' : 'MUTE', `${layer.muted ? 'Unmute' : 'Mute'} audio track ${index + 1}`, layer.muted, () => { layer.muted = !layer.muted; audio.updateVocalLayerStates(project.voice.layers); save(); renderVocalLayers(); });
      const solo = control(layer.solo ? 'SOLO ON' : 'SOLO', `${layer.solo ? 'Disable solo' : 'Solo'} audio track ${index + 1}`, layer.solo, () => { layer.solo = !layer.solo; audio.updateVocalLayerStates(project.voice.layers); save(); renderVocalLayers(); });
      const preview = control('▶', `Preview audio track ${index + 1}`, false, async () => { await audio.unlock(); if (!audio.previewVocalLayer(layer.id, layer.gain,layer.pitch,layer)) $('voice-overdub-status').textContent = layer.reverseEnabled?'This reversed clip exceeds the local memory budget or could not be decoded.':'Pitch processor or audio decoder unavailable for this track.'; });
      preview.disabled = !audio.vocalSources.get(layer.id)?.buffer;
      const pitch=document.createElement('label');pitch.className='vocal-layer-pitch';pitch.append(document.createTextNode('PITCH (ST)'));
      const pitchInput=document.createElement('input');pitchInput.type='number';pitchInput.min='-12';pitchInput.max='12';pitchInput.step='.1';pitchInput.value=String(layer.pitch||0);pitchInput.setAttribute('aria-label',`Pitch for audio track ${index+1}`);
      pitchInput.addEventListener('change',()=>{layer.pitch=clamp(pitchInput.value,-12,12);save();renderVocalLayers();});pitch.append(pitchInput);

      const rawDuration=audio.vocalSources.get(layer.id)?.buffer?.duration||0;
      const crop=vocalLayerClip(layer,rawDuration);
      const trimField=(key,labelText,value)=>{
        const label=document.createElement('label');label.className='vocal-layer-trim';label.append(document.createTextNode(labelText));
        const input=document.createElement('input');input.type='number';input.min='0';input.max=String(rawDuration);input.step='.05';input.value=String(Number(value.toFixed(2)));
        input.disabled=!rawDuration;input.setAttribute('aria-label',labelText+' for audio track '+(index+1)+' in seconds');
        input.addEventListener('change',()=>{
          const n=clamp(input.value,0,rawDuration);
          if(key==='trimStartSec'){layer.trimStartSec=Math.min(n,Math.max(0,vocalLayerClip(layer,rawDuration).end-.01));}
          else layer.trimEndSec=Math.max(n,Math.min(rawDuration,(layer.trimStartSec||0)+.01));
          audio.stopVocalLayer(layer.id);save();renderVocalLayers();
        });
        label.append(input);return label;
      };
      const trimFrom=trimField('trimStartSec','TRIM START (S)',crop.start);
      const trimTo=trimField('trimEndSec','TRIM END (S)',crop.end);
      const reverseLabel=document.createElement('label');reverseLabel.className='song-audio-reverse';
      const reverseInput=document.createElement('input');reverseInput.type='checkbox';reverseInput.checked=Boolean(layer.reverseEnabled);reverseInput.setAttribute('aria-label',`Reverse audio track ${index+1}`);
      const reverseSource=audio.vocalSources.get(layer.id)?.buffer;
      const reverseFrames=reverseSource?Math.max(0,Math.ceil(crop.end*reverseSource.sampleRate)-Math.floor(crop.start*reverseSource.sampleRate)):0;
      const reverseSupported=Boolean(reverseSource&&reverseFrames*reverseSource.numberOfChannels*4<=MAX_REVERSED_AUDIO_BYTES);
      reverseInput.disabled=!reverseSupported||transportState().running;
      reverseInput.dataset.reverseSupported=String(reverseSupported);
      reverseInput.title=reverseSupported?'Reverse this trimmed clip in playback without changing its saved source.':'This trimmed clip is too large for the local reverse memory budget.';
      const reverseText=document.createElement('span');reverseText.textContent=reverseSupported?'REVERSE PLAYBACK':'REVERSE UNAVAILABLE · LOCAL MEMORY LIMIT';reverseLabel.append(reverseInput,reverseText);
      reverseInput.addEventListener('change',()=>{
        if(transportState().running){reverseInput.checked=Boolean(layer.reverseEnabled);return;}
        layer.reverseEnabled=reverseInput.checked;audio.stopVocalLayer(layer.id);save();renderVocalLayers();
        $('voice-overdub-status').textContent=layer.reverseEnabled?`${layer.name} plays in reverse from its selected trim. The original local media stays unchanged.`:`${layer.name} plays forward from its selected trim.`;
      });
      const remove = control('DELETE', `Delete audio track ${index + 1} and its saved local audio file`, false, async () => {
        if (!confirm(`Delete ${layer.name} and its saved local audio file?`)) return;
        const nextLayers = project.voice.layers.filter(item => item.id !== layer.id);
        try {
          await deleteVoiceLayer(layer.id, {...project, voice:{...project.voice, layers:nextLayers}});
          audio.stopVocalLayer(layer.id); audio.vocalSources.delete(layer.id); vocalFiles.delete(layer.id);
          project.voice.layers = nextLayers; save(); renderVocalLayers(); updateOverdubControls();
          $('voice-overdub-status').textContent = 'Audio track and its local source file deleted.';
        } catch (error) { $('voice-overdub-status').textContent = `Could not delete this take: ${error.message}`; }
      });
      const moveControls=document.createElement('div');moveControls.className='song-track-move-controls';
      const moveAudioBar=(delta)=>{layer.startStep=clamp(layer.startStep+delta*16,0,4095);audio.stopVocalLayer(layer.id);save();renderVocalLayers();restoreTrackMoveFocus('audio',index,delta);};
      const moveEarlier=document.createElement('button');moveEarlier.type='button';moveEarlier.className='pill-button';moveEarlier.textContent='− 1 BAR';moveEarlier.disabled=layer.startStep<16;moveEarlier.setAttribute('aria-label',`Move audio track ${index+1} earlier by one bar`);moveEarlier.addEventListener('click',()=>moveAudioBar(-1));
      const moveLater=document.createElement('button');moveLater.type='button';moveLater.className='pill-button';moveLater.textContent='+ 1 BAR';moveLater.disabled=layer.startStep>=4080;moveLater.setAttribute('aria-label',`Move audio track ${index+1} later by one bar`);moveLater.addEventListener('click',()=>moveAudioBar(1));
      moveControls.append(moveEarlier,moveLater);
      const meta = document.createElement('small'); meta.className = 'vocal-layer-meta';
      const bar = Math.floor(layer.startStep / 16) + 1, step = layer.startStep % 16;
      const audibleEnd=layer.startStep+crop.duration/(60/clamp(project.bpm,40,240)/4);
      const sourceLabel = layer.origin === 'import' ? 'Imported audio saved locally' : layer.origin === 'harmony' ? 'Harmony source retained locally' : 'Raw take saved locally';
      meta.textContent = `${vocalFiles.has(layer.id) ? sourceLabel : 'Local audio file missing'} · starts at bar ${bar}, step ${step + 1} · ends near bar ${Math.floor(audibleEnd/16)+1}, step ${Math.floor(audibleEnd%16)+1} · ${crop.duration.toFixed(2)} s audible (original retained)`;
      const cycleControls=createSongCycleControls(layer,'audio',index,crop.duration);
      row.append(name, offset, trimFrom, trimTo, gain, pitch, mute, solo, preview, reverseLabel, moveControls, remove, cycleControls, meta); host.append(row);
    });
    updateSongCycleControlAvailability();
    renderOverdubTimeline();
    updateOverdubControls();
  }
  function renderTranscriptPicker() {
    const transcripts = project.voice.transcripts, select = $('voice-transcript-select');
    if (!transcripts.includes(activeTranscript)) activeTranscript = transcripts.at(-1) || null;
    select.replaceChildren();
    transcripts.forEach((transcript, index) => {
      const option = document.createElement('option'); option.value = String(index);
      option.textContent = `Take ${index + 1} · Pad ${transcript.sourcePad + 1} · ${transcript.words.length} words`;
      select.append(option);
    });
    const activeIndex = transcripts.indexOf(activeTranscript);
    if (activeIndex >= 0) select.value = String(activeIndex);
    $('voice-transcript-picker-label').hidden = transcripts.length < 2;
  }
  function render() {
    const selected = $('voice-source-pad').value;
    const select = $('voice-source-pad'); select.replaceChildren();
    for (const [id, file] of getMediaFiles()) if (/^(audio|video)\//.test(file.type)) { const option = document.createElement('option'); option.value = id; option.textContent = `${project.pads[id].name} · ${file.name || file.type}`; select.append(option); }
    if ([...select.options].some(option => option.value === selected)) select.value = selected;
    updateConsentState(); updateManualEntryState(); renderTranscriptPicker();
    renderWords(project, save, previewTranscriptWord, activeTranscript,()=>renderWordRemix(project,activeTranscript,save,wordRemixBar,getMediaFiles)); renderWordRemix(project,activeTranscript,save,wordRemixBar,getMediaFiles);renderPhrases(project, audio, notify, save, assignWordsToPads); renderMelody(project, save,auditionMelodyNote); renderRap(project, save, audio, notify); renderVocalLayers();renderVideoLayers();
  }
  const stopOverdub = () => {
    const take = vocalRecording;
    if (!take) return;
    $('voice-overdub-status').textContent = 'Saving the raw vocal take locally…';
    if (take.recorder.state !== 'inactive') take.recorder.stop();
  };
  $('voice-overdub-recover').addEventListener('click',async()=>{
    const recovery=interruptedAudioRecording;
    if(!recovery?.blob.size)return;
    if(project.voice.layers.length>=MAX_VOCAL_LAYERS){
      $('voice-overdub-status').textContent=`The ${MAX_VOCAL_LAYERS} audio-track limit is full. Delete a local track, then try recovery again; the interrupted chunks remain saved.`;
      return;
    }
    const usedBytes=[...getMediaFiles().values(),...vocalFiles.values()].reduce((sum,file)=>sum+(file?.size||0),0);
    if(usedBytes+recovery.blob.size>MAX_MEDIA_BYTES){
      $('voice-overdub-status').textContent='There is not enough project media space to restore this take. Export a project pack and remove unused media, then try recovery again.';
      return;
    }
    $('voice-overdub-recover').disabled=true;
    $('voice-overdub-status').textContent='Restoring the last safely saved audio chunks…';
    try{
      const id=`vocal-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
      const index=project.voice.layers.length+1;
      const file=new File([recovery.blob],`recovered-vocal-take-${Date.now()}.${extensionForAudioMime(recovery.mime)}`,{type:recovery.mime});
      const layer={id,name:`Recovered take ${index}`,origin:'recording',startStep:recovery.startStep,gain:1,muted:false,solo:false};
      const nextLayers=[...project.voice.layers,layer];
      await saveVoiceLayer(id,file,{...project,voice:{...project.voice,layers:nextLayers}},{recoveryId:recovery.id});
      project.voice.layers.push(layer);vocalFiles.set(id,file);
      const playable=await audio.loadVocalLayer(id,file);
      save();renderVocalLayers();
      interruptedAudioRecordings=interruptedAudioRecordings.filter(item=>item.id!==recovery.id);
      renderInterruptedAudioRecovery();
      $('voice-overdub-status').textContent=playable
        ?`${layer.name} recovered from ${recovery.completeChunks} locally saved chunks. Review it in the Song tracks below.`
        :`${layer.name} recovered and saved locally, but this browser cannot decode its audio format.`;
    }catch(error){
      $('voice-overdub-status').textContent=`Could not recover this audio take: ${error.message}. Its saved chunks are still available to retry.`;
      $('voice-overdub-recover').disabled=false;
    }
  });
  $('voice-overdub-discard').addEventListener('click',async()=>{
    const recovery=interruptedAudioRecording;
    if(!recovery)return;
    $('voice-overdub-discard').disabled=true;
    try{
      await deleteInterruptedAudioRecording(recovery.id);
      interruptedAudioRecordings=interruptedAudioRecordings.filter(item=>item.id!==recovery.id);
      renderInterruptedAudioRecovery();
      if(!interruptedAudioRecording)$('voice-overdub-status').textContent='Interrupted audio recovery discarded.';
    }catch(error){
      $('voice-overdub-status').textContent=`Could not discard the interrupted take: ${error.message}`;
      $('voice-overdub-discard').disabled=false;
    }
  });
  $('overdub-video-recover').addEventListener('click',async()=>{
    const recovery=interruptedVideoRecording;
    if(!recovery?.blob.size)return;
    if(project.voice.videoLayers.length>=MAX_VOCAL_LAYERS){
      $('song-video-status').textContent=`The ${MAX_VOCAL_LAYERS} video-track limit is full. Delete a local track, then try recovery again; the interrupted chunks remain saved.`;
      return;
    }
    const usedBytes=[...getMediaFiles().values(),...vocalFiles.values(),...videoFiles.values()].reduce((sum,file)=>sum+(file?.size||0),0);
    if(usedBytes+recovery.blob.size>MAX_MEDIA_BYTES){
      $('song-video-status').textContent='There is not enough project media space to restore this take. Export a project pack and remove media, then try recovery again.';
      return;
    }
    $('overdub-video-recover').disabled=true;
    $('song-video-status').textContent='Restoring the last safely saved camera and microphone chunks…';
    try{
      const durationSec=await probeVideoDuration(recovery.blob,recovery.durationSec||(Date.now()-recovery.createdAt)/1000);
      const id=`video-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
      const index=project.voice.videoLayers.length+1;
      const file=new File([recovery.blob],`recovered-song-video-${Date.now()}.${extensionForMime(recovery.mime)}`,{type:recovery.mime});
      const layer={id,name:`Recovered video ${index}`,origin:'recording',startStep:recovery.startStep,trimStartSec:0,trimEndSec:durationSec,durationSec,type:recovery.mime};
      const nextLayers=[...project.voice.videoLayers,layer];
      await saveSongVideoLayer(id,file,{...project,voice:{...project.voice,videoLayers:nextLayers}},{recoveryId:recovery.id});
      project.voice.videoLayers.push(layer);videoFiles.set(id,file);videoUrls.set(id,URL.createObjectURL(file));
      renderVideoLayers();renderOverdubTimeline();
      interruptedVideoRecordings=interruptedVideoRecordings.filter(item=>item.id!==recovery.id);
      renderInterruptedVideoRecovery();
      $('song-video-status').textContent=`${layer.name} recovered from ${recovery.completeChunks} locally saved chunks. Review it in the Song video tracks below.`;
    }catch(error){
      $('song-video-status').textContent=`Could not recover this video take: ${error.message}. Its saved chunks are still available to retry.`;
      $('overdub-video-recover').disabled=false;
    }
  });
  $('overdub-video-discard').addEventListener('click',async()=>{
    const recovery=interruptedVideoRecording;
    if(!recovery)return;
    $('overdub-video-discard').disabled=true;
    try{
      await deleteInterruptedVideoRecording(recovery.id);
      interruptedVideoRecordings=interruptedVideoRecordings.filter(item=>item.id!==recovery.id);
      renderInterruptedVideoRecovery();
      if(!interruptedVideoRecording)$('song-video-status').textContent='Interrupted video recovery discarded.';
    }catch(error){
      $('song-video-status').textContent=`Could not discard the interrupted video take: ${error.message}`;
      $('overdub-video-discard').disabled=false;
    }
  });
  $('voice-overdub-record').addEventListener('click', async () => {
    if (project.voice.layers.length >= MAX_VOCAL_LAYERS) return updateOverdubControls();
    const currentTransport = transportState();
    if (!currentTransport.running) { $('voice-overdub-status').textContent = 'Start the sequencer before recording a vocal overdub.'; return; }
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { $('voice-overdub-status').textContent = 'This browser does not support local microphone recording.'; return; }
    $('voice-overdub-record').disabled = true; $('voice-overdub-status').textContent = 'Requesting microphone access…';
    let stream,recoveryId=null;
    try {
      const usedBytes = [...getMediaFiles().values(), ...vocalFiles.values()].reduce((sum, file) => sum + (file?.size || 0), 0);
      let storageEstimate = null;
      try { storageEstimate = await navigator.storage?.estimate?.(); } catch { /* fall back to the project media limit */ }
      const recordingBudget = localJournaledRecordingBudget(usedBytes, storageEstimate);
      if (!recordingBudget) throw new Error('There is not enough safe local storage for another take. Export a project pack and remove unused media, or free space on this device.');
      await audio.unlock();
      stream = await navigator.mediaDevices.getUserMedia({audio:true});
      const transport = transportState();
      if (!transport.running) throw new Error('The sequencer stopped before recording could start.');
      const mime = findAudioRecorderMime();
      const recorder = new MediaRecorder(stream, mime ? {mimeType:mime} : undefined);
      const secondsPerStep = 60 / clamp(transport.bpm, 40, 240) / 4;
      const elapsedStep = Math.max(0, Math.ceil((audio.context.currentTime - transport.epoch - .001) / secondsPerStep));
      const startStep = (transport.songStartStep || 0) + elapsedStep;
      const targetTime = transport.epoch + elapsedStep * secondsPerStep;
      if (targetTime > audio.context.currentTime) {
        $('voice-overdub-status').textContent = 'Microphone ready. Aligning the raw take to the next sixteenth note…';
        await new Promise(resolve => setTimeout(resolve, Math.max(0, (targetTime - audio.context.currentTime) * 1000)));
      }
      const alignedTransport = transportState();
      if (!alignedTransport.running || alignedTransport.epoch !== transport.epoch) throw new Error('The sequencer changed before the aligned recording could start.');
      const capture = createBoundedRecordingCapture(recordingBudget + RECORDING_STORAGE_RESERVE_BYTES, recordingBudget);
      recoveryId=`vocal-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
      await beginAudioRecordingRecovery(recoveryId,{startStep,mime:recorder.mimeType||mime||'audio/webm'});
      const take = {stream, recorder, startStep, capture, recoveryId, journalWrite:Promise.resolve(), journalError:null}; vocalRecording = take;
      recorder.ondataavailable = event => {
        if (!event.data?.size) return;
        if (!capture.add(event.data)) {
          $('voice-overdub-status').textContent = 'Pausing at the safe local-storage limit and saving the captured audio…';
          if (recorder.state !== 'inactive') recorder.stop();
          return;
        }
        if(!take.journalError){
          take.journalWrite=take.journalWrite.then(()=>appendAudioRecordingRecoveryChunk(recoveryId,event.data)).catch(error=>{
            take.journalError=error;
            $('voice-overdub-status').textContent=`Local recovery paused: ${error.message}. Saving the captured audio now…`;
            if(recorder.state!=='inactive')recorder.stop();
          });
        }
        if (capture.shouldStop && recorder.state !== 'inactive') {
          $('voice-overdub-status').textContent = 'Pausing at the safe local-storage limit and saving the captured audio…';
          recorder.stop();
        }
      };
      recorder.onerror = event => { $('voice-overdub-status').textContent = `Microphone recording failed: ${event.error?.message || 'unknown error'}`; stopOverdub(); };
      recorder.onstop = async () => {
        stream.getTracks().forEach(track => track.stop());
        const type = recorder.mimeType || mime || 'audio/webm';
        let blob = new Blob(capture.chunks, {type});
        let unsavedTakeFile=null;
        try {
          await take.journalWrite;
          if(!take.discard&&!blob.size){const recovery=(await listInterruptedAudioRecordings()).find(item=>item.id===take.recoveryId);if(recovery?.blob.size)blob=recovery.blob;}
          if (!blob.size) {
            await deleteInterruptedAudioRecording(take.recoveryId);
            throw new Error('The browser did not capture any microphone audio.');
          }
          const usedBytes = [...getMediaFiles().values(), ...vocalFiles.values()].reduce((sum, file) => sum + (file?.size || 0), 0);
          if (usedBytes + blob.size > MAX_MEDIA_BYTES) throw new Error('This take would exceed the 80 MB local project media limit. Export a pack and remove unused media before recording more.');
          const index = project.voice.layers.length + 1, id = `vocal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          const file = new File([blob], `vocal-take-${Date.now()}.${extensionForAudioMime(type)}`, {type});
          unsavedTakeFile=file;
          const layer = {id, name:`Vocal take ${index}`, origin:'recording', startStep:take.startStep, gain:1, muted:false, solo:false};
          const nextLayers = [...project.voice.layers, layer];
          await saveVoiceLayer(id, file, {...project, voice:{...project.voice, layers:nextLayers}},{recoveryId:take.recoveryId});
          project.voice.layers.push(layer); vocalFiles.set(id, file);
          const playable = await audio.loadVocalLayer(id, file);
          save(); renderVocalLayers();
          const savedMessage = playable
            ? `${layer.name} saved locally as a separate raw take. It starts at bar ${Math.floor(layer.startStep / 16) + 1}, step ${layer.startStep % 16 + 1}.`
            : `${layer.name} raw take is saved locally, but this browser cannot decode it for playback.`;
          $('voice-overdub-status').textContent = capture.stoppedForStorage
            ? `${savedMessage} Recording stopped at the safe local-storage limit; export a pack and remove unused media before the next take.`
            : savedMessage;
        } catch (error) {
          await refreshInterruptedAudioRecordings();
          if(!take.discard&&unsavedTakeFile)offerRecordingDownload('voice-overdub-status',unsavedTakeFile,`Could not save vocal take: ${error.message}`,'Download unsaved audio take');
          else $('voice-overdub-status').textContent = `Could not save vocal take: ${error.message}`;
        }
        finally { if (vocalRecording === take) vocalRecording = null; updateOverdubControls(); }
      };
      recorder.start(1000);
      $('voice-overdub-stop').hidden = false;
      const availableMb = (recordingBudget / 1024 / 1024).toFixed(1);
      $('voice-overdub-status').textContent = `Recording microphone audio over the playing sequence. Audio chunks save locally about once per second for interruption recovery; up to ${availableMb} MB is available for this take, with a small safety margin.`;
    } catch (error) {
      if(recoveryId)try{await deleteInterruptedAudioRecording(recoveryId);}catch(cleanupError){console.warn('Could not clear unused audio recovery record',cleanupError);}
      stream?.getTracks().forEach(track => track.stop());
      vocalRecording = null; updateOverdubControls();
      $('voice-overdub-status').textContent = `Could not start local vocal recording: ${error.message}`;
    }
  });
  $('overdub-import-audio').addEventListener('click', () => {
    if (project.voice.layers.length >= MAX_VOCAL_LAYERS) { updateOverdubControls(); return; }
    $('overdub-audio-input').click();
  });
  $('overdub-audio-input').addEventListener('change', async event => {
    const input = event.currentTarget, file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (!file.type.startsWith('audio/')) { $('voice-overdub-status').textContent = 'Choose an audio file for a Song track.'; return; }
    if (project.voice.layers.length >= MAX_VOCAL_LAYERS) { updateOverdubControls(); return; }
    $('overdub-import-audio').disabled = true;
    $('voice-overdub-status').textContent = 'Checking local storage and decoding the audio track…';
    let id = null;
    try {
      const usedBytes = [...getMediaFiles().values(), ...vocalFiles.values()].reduce((sum, item) => sum + (item?.size || 0), 0);
      let storageEstimate = null;
      try { storageEstimate = await navigator.storage?.estimate?.(); } catch { /* the app media limit remains a fallback */ }
      if (file.size > localRecordingBudget(usedBytes, storageEstimate)) throw new Error('This file is larger than the safe local storage available. Export a project pack and remove unused media, or free space on this device.');
      id = `audio-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
      const playable = await audio.loadVocalLayer(id, file);
      if (!playable) throw new Error('This browser could not decode the selected audio. Choose a supported audio file.');
      const baseName = file.name.replace(/\.[^.]+$/, '').trim().slice(0,48) || `Audio track ${project.voice.layers.length + 1}`;
      const layer = {id,name:baseName,origin:'import',startStep:0,gain:1,muted:false,solo:false};
      const nextLayers = [...project.voice.layers,layer];
      await saveVoiceLayer(id,file,{...project,voice:{...project.voice,layers:nextLayers}});
      project.voice.layers.push(layer);vocalFiles.set(id,file);save();renderVocalLayers();
      $('voice-overdub-status').textContent = `Imported “${baseName}” as a local audio track at bar 1. Change START STEP to place it elsewhere in the Song.`;
    } catch (error) {
      if (id) audio.vocalSources.delete(id);
      $('voice-overdub-status').textContent = `Could not import audio track: ${error.message}`;
    } finally { $('overdub-import-audio').disabled = false; }
  });
  $('overdub-import-video').addEventListener('click',()=>{
    if(project.voice.videoLayers.length>=MAX_VOCAL_LAYERS){$('song-video-status').textContent=`The ${MAX_VOCAL_LAYERS} video-track limit is full. Delete a track before adding another.`;return;}
    $('overdub-video-input').click();
  });
  $('overdub-video-input').addEventListener('change',async event=>{
    const input=event.currentTarget,file=input.files?.[0];input.value='';if(!file)return;
    if(!file.type.startsWith('video/')){$('song-video-status').textContent='Choose a video file for a Song video track.';return;}
    if(project.voice.videoLayers.length>=MAX_VOCAL_LAYERS)return;
    const button=$('overdub-import-video');button.disabled=true;$('song-video-status').textContent='Checking local storage and reading video duration…';
    let id=null;
    try{
      const usedBytes=[...getMediaFiles().values(),...vocalFiles.values(),...videoFiles.values()].reduce((sum,item)=>sum+(item?.size||0),0);
      let estimate=null;try{estimate=await navigator.storage?.estimate?.();}catch{}
      if(file.size>localRecordingBudget(usedBytes,estimate))throw new Error('This file is larger than the safe local storage available. Export a project pack and remove unused media, or free space on this device.');
      const durationSec=await probeVideoDuration(file);
      if(durationSec>10800)throw new Error('Video tracks are limited to three hours per source clip.');
      id=`video-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
      const baseName=file.name.replace(/\.[^.]+$/,'').trim().slice(0,48)||`Video track ${project.voice.videoLayers.length+1}`;
      const layer={id,name:baseName,origin:'import',startStep:0,trimStartSec:0,trimEndSec:durationSec,durationSec,type:file.type};
      const nextLayers=[...project.voice.videoLayers,layer];
      await saveSongVideoLayer(id,file,{...project,voice:{...project.voice,videoLayers:nextLayers}});
      project.voice.videoLayers.push(layer);videoFiles.set(id,file);videoUrls.set(id,URL.createObjectURL(file));save();renderVideoLayers();renderOverdubTimeline();
      $('song-video-status').textContent=`Imported “${baseName}” as a local video clip at bar 1. Set its start and trim range below; the preview is muted.`;
    }catch(error){if(id){videoFiles.delete(id);const url=videoUrls.get(id);if(url)URL.revokeObjectURL(url);videoUrls.delete(id);}$('song-video-status').textContent=`Could not import video track: ${error.message}`;}
    finally{button.disabled=false;}
  });
  const stopSongVideoRecording=(discard=false)=>{
    if(videoRecordingActivity.phase==='starting'){
      videoRecordingActivity.cancel();$('song-video-status').textContent='Camera start canceled. No camera or microphone remains active.';updateOverdubControls();return;
    }
    const take=videoRecording;if(!take)return;
    take.discard=discard;
    $('song-video-status').textContent=discard?'Discarding the camera take.':'Stopping and saving the raw camera take locally…';
    if(take.recorder.state!=='inactive')take.recorder.stop();
  };
  $('overdub-video-record').addEventListener('click',async()=>{
    if(videoRecordingActivity.phase==='starting'){stopSongVideoRecording(true);return;}
    if(videoRecording||project.voice.videoLayers.length>=MAX_VOCAL_LAYERS)return updateOverdubControls();
    const transport=transportState();
    if(!transport.running){$('song-video-status').textContent='Start the Song before recording a video track.';return;}
    if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder){$('song-video-status').textContent='This browser does not support local camera and microphone recording.';return;}
    const token=videoRecordingActivity.begin();if(token===null)return;
    $('song-video-status').textContent='Checking local storage before requesting camera and microphone access…';updateOverdubControls();
    let stream=null,recoveryId=null;
    try{
      const usedBytes=[...getMediaFiles().values(),...vocalFiles.values(),...videoFiles.values()].reduce((sum,file)=>sum+(file?.size||0),0);
      let estimate=null;try{estimate=await navigator.storage?.estimate?.();}catch{}
      const budget=localJournaledRecordingBudget(usedBytes,estimate);
      if(!budget)throw new Error('There is not enough safe local storage for another video take. Export a project pack, remove unused media, or free space on this device.');
      await audio.unlock();if(!videoRecordingActivity.current(token))return;
      stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'user'},audio:true});
      if(!videoRecordingActivity.current(token)){stream.getTracks().forEach(track=>track.stop());return;}
      if(!stream.getVideoTracks().length||!stream.getAudioTracks().length)throw new Error('Both camera and microphone are required for a Song video take.');
      const secondsPerStep=60/clamp(transport.bpm,40,240)/4;
      const elapsedStep=Math.max(0,Math.ceil((audio.context.currentTime-transport.epoch-.001)/secondsPerStep));
      const startStep=(transport.songStartStep||0)+elapsedStep;
      const targetTime=transport.epoch+elapsedStep*secondsPerStep;
      if(targetTime>audio.context.currentTime){$('song-video-status').textContent='Camera ready. Aligning the video take to the next sixteenth note…';await new Promise(resolve=>setTimeout(resolve,Math.ceil((targetTime-audio.context.currentTime)*1000)));}
      const aligned=transportState();
      if(!videoRecordingActivity.current(token)||!aligned.running||aligned.epoch!==transport.epoch)throw new Error('The Song stopped or changed before video recording could begin.');
      const mime=findRecorderMime();if(!mime)throw new Error('This browser has no supported local video recording format.');
      const capture=createBoundedRecordingCapture(budget+RECORDING_STORAGE_RESERVE_BYTES,budget);
      const recorder=new MediaRecorder(stream,{mimeType:mime});
      recoveryId=`video-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
      await beginVideoRecordingRecovery(recoveryId,{startStep,mime:recorder.mimeType||mime});
      const take={stream,recorder,capture,startStep,discard:false,recoveryId,journalWrite:Promise.resolve(),journalError:null,startedAt:performance.now()};videoRecording=take;
      recorder.ondataavailable=event=>{
        if(!event.data?.size)return;
        if(!capture.add(event.data)){if(recorder.state!=='inactive')recorder.stop();return;}
        if(!take.journalError){
          const elapsed=(performance.now()-take.startedAt)/1000;
          take.journalWrite=take.journalWrite.then(()=>appendVideoRecordingRecoveryChunk(take.recoveryId,event.data,elapsed)).catch(error=>{
            take.journalError=error;
            $('song-video-status').textContent=`Local video recovery paused: ${error.message}. Saving the captured take now…`;
            if(recorder.state!=='inactive')recorder.stop();
          });
        }
        if(capture.shouldStop&&recorder.state!=='inactive')recorder.stop();
      };
      recorder.onerror=event=>{$('song-video-status').textContent=`Camera recording failed: ${event.error?.message||'unknown error'}`;stopSongVideoRecording(false);};
      recorder.onstop=async()=>{
        stream.getTracks().forEach(track=>track.stop());
        const type=recorder.mimeType||mime;let blob=new Blob(capture.chunks,{type});
        let unsavedTakeFile=null;
        try{
          await take.journalWrite;
          if(take.discard){await deleteInterruptedVideoRecording(take.recoveryId);$('song-video-status').textContent='Camera take discarded. No video was saved.';return;}
          if(!blob.size){const recovery=(await listInterruptedVideoRecordings()).find(item=>item.id===take.recoveryId);if(recovery?.blob.size)blob=recovery.blob;}
          if(!blob.size){await deleteInterruptedVideoRecording(take.recoveryId);throw new Error('The browser did not capture a video take.');}
          const currentBytes=[...getMediaFiles().values(),...vocalFiles.values(),...videoFiles.values()].reduce((sum,file)=>sum+(file?.size||0),0);
          if(currentBytes+blob.size>MAX_MEDIA_BYTES)throw new Error('This take reached the project media limit. Export a pack and remove media before recording another.');
          const index=project.voice.videoLayers.length+1,id=`video-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
          const file=new File([blob],`song-video-${Date.now()}.${extensionForMime(type)}`,{type});
          unsavedTakeFile=file;
          const durationSec=await probeVideoDuration(file,(performance.now()-take.startedAt)/1000);
          const layer={id,name:`Video take ${index}`,origin:'recording',startStep:take.startStep,trimStartSec:0,trimEndSec:durationSec,durationSec,type};
          const nextLayers=[...project.voice.videoLayers,layer];
          await saveSongVideoLayer(id,file,{...project,voice:{...project.voice,videoLayers:nextLayers}},{recoveryId:take.recoveryId});
          project.voice.videoLayers.push(layer);videoFiles.set(id,file);videoUrls.set(id,URL.createObjectURL(file));save();renderVideoLayers();renderOverdubTimeline();
          $('song-video-status').textContent=capture.stoppedForStorage
            ?`${layer.name} saved locally from bar ${Math.floor(layer.startStep/16)+1}. Recording stopped at the safe storage limit.`
            :`${layer.name} saved locally from bar ${Math.floor(layer.startStep/16)+1}. The raw camera take is retained.`;
        }catch(error){
          await refreshInterruptedVideoRecordings();
          if(!take.discard&&unsavedTakeFile)offerRecordingDownload('song-video-status',unsavedTakeFile,`Could not save camera take: ${error.message}`,'Download unsaved video take');
          else $('song-video-status').textContent=`Could not ${take.discard?'discard':'save'} camera take: ${error.message}`;
        }
        finally{if(videoRecording===take)videoRecording=null;videoRecordingActivity.cancel();updateOverdubControls();}
      };
      if(!videoRecordingActivity.activate(token))throw new Error('Camera recording start was canceled.');
      recorder.start(1000);$('song-video-status').textContent=`Recording camera and microphone locally over the Song. Chunks save locally about once per second; up to ${(budget/1024/1024).toFixed(1)} MB is available. Stop saves it, Cancel discards it.`;updateOverdubControls();
    }catch(error){stream?.getTracks().forEach(track=>track.stop());if(recoveryId)await deleteInterruptedVideoRecording(recoveryId).catch(()=>{});videoRecording=null;videoRecordingActivity.cancel();$('song-video-status').textContent=`Could not start Song camera recording: ${error.message}`;updateOverdubControls();}
  });
  $('overdub-video-stop').addEventListener('click',()=>stopSongVideoRecording(false));
  $('overdub-video-cancel').addEventListener('click',()=>stopSongVideoRecording(true));
  $('voice-overdub-stop').addEventListener('click', stopOverdub);
  $('vocal-add-harmony').addEventListener('click',async()=>{
    if(!audio.pitchReady)return notify('The local pitch processor is unavailable; a harmony would not stay in tune and time on this device.');
    if(project.voice.layers.length>=MAX_VOCAL_LAYERS)return notify('The audio-track limit is full.');
    const source=project.voice.layers.slice().reverse().find(layer=>layer.sourceId===layer.id||!layer.sourceId);
    const raw=source&&vocalFiles.get(source.id);
    if(!raw)return notify('Record and save a raw microphone take before adding an automatic harmony.');
    const usedBytes=[...getMediaFiles().values(),...vocalFiles.values()].reduce((sum,file)=>sum+(file?.size||0),0);
    if(usedBytes+raw.size>MAX_MEDIA_BYTES)return notify('Not enough local project media space to preserve another editable harmony layer.');
    const interval=Number($('vocal-harmony-interval').value),id=`harmony-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
    const layer={id,name:`${source.name} · harmony ${interval>0?'+':''}${interval}`,origin:'harmony',sourceId:source.id,startStep:source.startStep,gain:.6,muted:false,solo:false,pitch:interval};
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
    releaseSongVideoPlayers();for(const url of videoUrls.values())URL.revokeObjectURL(url);videoUrls.clear();videoFiles.clear();
    for(const layer of project.voice.videoLayers){const file=await getValue(`video-layer:${layer.id}`);if(file?.type?.startsWith('video/')){videoFiles.set(layer.id,file);videoUrls.set(layer.id,URL.createObjectURL(file));}}
    renderVocalLayers();renderVideoLayers();
  }
  await reloadLayers();
  await refreshInterruptedAudioRecordings();
  await refreshInterruptedVideoRecordings();
  window.addEventListener('madladpad-media-change',()=>{
    wordRemixTransportReady=false;stopWordRemixTransport();releaseWordRemixLiveVideo();
    if(project.voice.wordRemix.followTransport)prepareWordRemixTransport().catch(error=>{project.voice.wordRemix.followTransport=false;stopWordRemixTransport();save();notify(`Word Remix transport was turned off: ${error.message}`);});
    render();
  });
  $('word-remix-word').addEventListener('change',()=>renderWordRemix(project,activeTranscript,save,wordRemixBar,getMediaFiles));
  $('word-remix-play').addEventListener('click',playWordRemix);
  $('word-remix-stop').addEventListener('click',()=>stopWordRemix());
  $('word-remix-export').addEventListener('click',async()=>{
    const button=$('word-remix-export'),help=$('word-remix-export-help');let resultMessage='';button.disabled=true;help.textContent='Rendering the four-bar WAV on this device…';
    try{
      const bpm=clamp(getTransport?.()?.bpm||project.bpm,40,240),blob=await renderWordRemixWav(project,audio,getMediaFiles,bpm),safeTitle=(project.title||'madladpad').replace(/[^a-z0-9]+/gi,'-').replace(/^-|-$/g,'').toLowerCase()||'madladpad';
      download(blob,`${safeTitle}-word-remix-${bpm}bpm.wav`);resultMessage=`Local four-bar WAV ready at ${bpm} BPM. Source audio remains on this device.`;
    }catch(error){resultMessage=`Word Remix export failed: ${error.message}`;notify(resultMessage);}
    finally{
      renderWordRemix(project,activeTranscript,save,wordRemixBar,getMediaFiles);
      if(resultMessage)help.textContent=resultMessage;
    }
  });
  $('word-remix-follow-transport').addEventListener('change',async event=>{
    const control=event.currentTarget;
    if(!control.checked){project.voice.wordRemix.followTransport=false;wordRemixTransportReady=false;stopWordRemixTransport();releaseWordRemixLiveVideo();save();renderWordRemix(project,activeTranscript,save,wordRemixBar,getMediaFiles);return;}
    control.disabled=true;$('word-remix-follow-help').textContent='Preparing local audio cues for the Beat/Song transport…';
    try{await prepareWordRemixTransport();project.voice.wordRemix.followTransport=true;save();renderWordRemix(project,activeTranscript,save,wordRemixBar,getMediaFiles);}
    catch(error){project.voice.wordRemix.followTransport=false;control.checked=false;notify(`Could not enable Word Remix transport: ${error.message}`);renderWordRemix(project,activeTranscript,save,wordRemixBar,getMediaFiles);}
  });
  $('word-remix-pitch').addEventListener('input',()=>{$('word-remix-pitch-value').textContent=`${Number($('word-remix-pitch').value)>0?'+':''}${$('word-remix-pitch').value} st`;});
  $('word-remix-pitch').addEventListener('change',()=>{const event=project.voice.wordRemix.events.find(item=>item.step===wordRemixBar.selectedStep);if(!event)return;event.pitch=clamp($('word-remix-pitch').value,-12,12);save();renderWordRemix(project,activeTranscript,save,wordRemixBar,getMediaFiles);});
  $('word-remix-length').addEventListener('input',()=>{$('word-remix-length-value').textContent=`${$('word-remix-length').value}%`;});
  $('word-remix-length').addEventListener('change',()=>{const event=project.voice.wordRemix.events.find(item=>item.step===wordRemixBar.selectedStep);if(!event)return;event.lengthPercent=Math.round(clamp($('word-remix-length').value,25,100));save();renderWordRemix(project,activeTranscript,save,wordRemixBar,getMediaFiles);});
  $('word-remix-remove').addEventListener('click',()=>{const index=project.voice.wordRemix.events.findIndex(item=>item.step===wordRemixBar.selectedStep);if(index<0)return;project.voice.wordRemix.events.splice(index,1);wordRemixBar.selectedStep=null;save();renderWordRemix(project,activeTranscript,save,wordRemixBar,getMediaFiles);});
  $('word-remix-clear').addEventListener('click',()=>{project.voice.wordRemix.events=[];project.voice.wordRemix.followTransport=false;wordRemixTransportReady=false;wordRemixBar.selectedStep=null;stopWordRemix('Cleared all Word Remix events.');stopWordRemixTransport();releaseWordRemixLiveVideo();save();renderWordRemix(project,activeTranscript,save,wordRemixBar,getMediaFiles);});
  window.addEventListener('pagehide',()=>stopWordRemix('Stopped when this page closed.'),{once:true});
  $('voice-source-pad').addEventListener('change', () => {
    if (transcriptionActivity.phase!=='idle') cancelTranscription('Source changed. Previous transcription canceled.');
    render();
  });
  $('voice-transcript-select').addEventListener('change', () => {
    stopWordPreview();stopWordRemix();
    activeTranscript = project.voice.transcripts[Number($('voice-transcript-select').value)] || null;
    renderWords(project, save, previewTranscriptWord, activeTranscript,()=>renderWordRemix(project,activeTranscript,save,wordRemixBar,getMediaFiles));renderWordRemix(project,activeTranscript,save,wordRemixBar,getMediaFiles);
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
    let transcript = activeTranscript?.sourcePad === padId ? activeTranscript : project.voice.transcripts.slice().reverse().find(item => item.sourcePad === padId);
    if (transcript?.words.length >= MAX_TRANSCRIPT_WORDS) { $('voice-status').textContent = `This transcript already has the ${MAX_TRANSCRIPT_WORDS}-word limit.`; return; }
    if (transcript) {
      project.voice.transcripts.splice(project.voice.transcripts.indexOf(transcript), 1);
    } else {
      transcript = {id:`manual-${Date.now()}`, sourcePad:padId, words:[]};
      if (project.voice.transcripts.length >= 16) project.voice.transcripts.shift();
    }
    transcript.words.push({id:`manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, text, start, end, selected:true, score:null});
    project.voice.transcripts.push(transcript);
    activeTranscript = transcript; save(); renderTranscriptPicker(); renderWords(project, save, previewTranscriptWord, activeTranscript,()=>renderWordRemix(project,activeTranscript,save,wordRemixBar,getMediaFiles));renderWordRemix(project,activeTranscript,save,wordRemixBar,getMediaFiles);
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
          const modelWords = Array.isArray(data.words) ? data.words : [];
          const boundedWords = boundTranscriptWordTimes(modelWords, buffer.duration);
          const omittedWords = Math.max(0, modelWords.length - boundedWords.length);
          const words = boundedWords.slice(0, MAX_TRANSCRIPT_WORDS).map((word, index) => ({ ...word, id: `${Date.now()}-${index}`, selected: false, score: null }));
          if (!words.length) {
            cancelTranscription('No usable timestamped words fit within this clip. Try again or add words and timestamps manually.');
            return;
          }
          const transcript = { id: `${Date.now()}`, sourcePad: padId, words };
          project.voice.transcripts.push(transcript); project.voice.transcripts = project.voice.transcripts.slice(-16); activeTranscript = transcript;
          const omissionNotice = omittedWords ? ` ${omittedWords} returned word${omittedWords === 1 ? ' had' : 's had'} unusable or out-of-clip timing and ${omittedWords === 1 ? 'was' : 'were'} omitted. Review the clip and add any missing words manually.` : '';
          save(); $('voice-status').textContent = `Draft transcript has ${words.length} timestamped words. Confidence is not provided; check wording and timing.${omissionNotice}`;
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
    const transcript = activeTranscript || project.voice.transcripts.at(-1), chosen = transcript?.words.filter(word => word.selected) || [];
    if (!chosen.length) return;
    const words = chosen.map(word => ({ text: word.text, sourcePad: transcript.sourcePad, start: word.start, end: word.end }));
    project.voice.phrases.push({ id: `${Date.now()}`, name: `Phrase ${project.voice.phrases.length + 1}`, gapMs: 35, crossfadeMs: 0, words });
    transcript.words.forEach(word => { word.selected = false; }); save(); render();
  });
  $('melody-tuning').addEventListener('change', () => { project.voice.melody.tuning = clamp($('melody-tuning').value, 400, 480); save(); renderMelody(project, save,auditionMelodyNote); });
  $('melody-key').addEventListener('change', () => { project.voice.melody.key = clamp(Math.round($('melody-key').value), 0, 11); save(); renderMelody(project,save,auditionMelodyNote); });
  $('melody-scale').addEventListener('change', () => { const scale = $('melody-scale').value; if (Object.hasOwn(MELODY_SCALES, scale)) { project.voice.melody.scale = scale; save(); renderMelody(project,save,auditionMelodyNote); } });
  $('melody-snap-scale').addEventListener('click', () => {
    const melody=project.voice.melody;
    const notes=melody.clips.find(clip=>clip.id===melody.activeClipId)?.notes||melody.notes;
    if (!notes.length) { $('melody-scale-status').textContent = 'Add melody notes before snapping them to a scale.'; return; }
    let changed = 0;
    notes.forEach((note, index) => {
      const pitch = snapMidiToScale(note.midi, project.voice.melody.key, project.voice.melody.scale);
      if (pitch !== note.midi) changed++;
      note.midi = pitch;
      const row = $('melody-notes').children[index];
      if (!row) return;
      const pitchSelect = row.querySelector('select[aria-label$=" pitch"]');
      if (pitchSelect) pitchSelect.value = String(pitch);
      const noteName = row.querySelector('.melody-note-description span');
      if (noteName) noteName.textContent = `${note.layer === 'harmony' ? 'Harmony' : 'Note'} ${index + 1} · ${midiNoteName(pitch)} · ${midiFrequency(pitch, project.voice.melody.tuning).toFixed(1)} Hz`;
    });
    save();
    renderMelody(project,save,auditionMelodyNote);
    const scaleName = $('melody-scale').selectedOptions[0]?.textContent || 'major';
    $('melody-scale-status').textContent = changed ? `${changed} note${changed === 1 ? '' : 's'} moved into ${MELODY_ROOTS[project.voice.melody.key]} ${scaleName}. Timing and word cues were kept.` : `All notes already fit ${MELODY_ROOTS[project.voice.melody.key]} ${scaleName}.`;
  });
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
    save();renderPhrases(project,audio,notify,save,assignWordsToPads);renderMelody(project,save,auditionMelodyNote);
    notify('Story montage created from the current phrase order; the original phrases remain intact.');
  });
  $('melody-harmony-interval').addEventListener('change', () => { const interval = Number($('melody-harmony-interval').value); if (!HARMONY_INTERVALS.includes(interval)) return; project.voice.melody.harmonyInterval = interval; save(); });
  $('melody-add').addEventListener('click', () => { const melody=project.voice.melody,notes=melody.clips.find(clip=>clip.id===melody.activeClipId)?.notes||melody.notes;if(notes.length>=MAX_MELODY_NOTES)return;const noteLimit=melody.clips.find(clip=>clip.id===melody.activeClipId)?.patternBars*16||MAX_MELODY_STEPS;const step=clamp(notes.length?notes.at(-1).step+4:0,0,noteLimit-1);notes.push({midi:60+melody.key,step,duration:Math.min(4,noteLimit-step),velocity:96,word:'',layer:'lead'});save();renderMelody(project,save,auditionMelodyNote); });
  $('melody-harmony-add').addEventListener('click', () => {
    const melody=project.voice.melody,notes=melody.clips.find(clip=>clip.id===melody.activeClipId)?.notes||melody.notes;
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
    save(); renderMelody(project, save,auditionMelodyNote);
    notify(`${added} harmony note${added === 1 ? '' : 's'} added at ${interval > 0 ? '+' : ''}${interval} semitones${skipped ? `; ${skipped} skipped` : ''}.`);
  });
  function stopMidiKeyboard(){
    midiKeyboard.stopAll();
    $('melody-midi-step-entry').checked=false;
  }
  function startMidiKeyboardNote(message){
    const {midi,velocity}=message;
    // Polyphonic held-note preview, independent of transport and note-entry.
    let stopped=false,release=null;
    audio.unlock().then(()=>{
      if(stopped)return;
      const ctx=audio.context,now=ctx.currentTime,osc=ctx.createOscillator(),gain=ctx.createGain();
      osc.type='triangle';osc.frequency.setValueAtTime(midiFrequency(midi,project.voice.melody.tuning),now);
      gain.gain.setValueAtTime(0,now);gain.gain.linearRampToValueAtTime(.08*velocity/127,now+.008);
      osc.connect(gain).connect(audio.master);
      osc.onended=()=>{osc.disconnect();gain.disconnect();};
      osc.start(now);osc.stop(now+60); // safety bound if the controller never sends note-off
      release=()=>{
        const end=ctx.currentTime;
        if(end>=now+60)return;
        gain.gain.cancelScheduledValues(end);gain.gain.setTargetAtTime(0,end,.008);
        osc.stop(Math.min(now+60,end+.045));
      };
    }).catch(error=>notify('MIDI preview unavailable: '+error.message));
    const entry=$('melody-midi-step-entry');
    if(entry.checked&&!entry.disabled){
      const melody=project.voice.melody,clip=melody.clips.find(item=>item.id===melody.activeClipId),notes=clip?.notes||melody.notes,limit=clip?clip.patternBars*16:MAX_MELODY_STEPS;
      const cursor=$('melody-midi-step'),length=Number(document.querySelector('#melody-roll [aria-label="Piano roll tap note length"]')?.value)||4;
      const result=appendMidiStepNote(notes,Math.round(Number(cursor.value)||1)-1,limit,midi,velocity,length);
      if(result){
        cursor.value=String(Math.min(limit,result.nextStep+1));save();renderMelody(project,save,auditionMelodyNote,result.index);
        if(result.nextStep>=limit){entry.checked=false;notify('End of MIDI lane. Choose a new step to continue.');}
      }else{entry.checked=false;notify('MIDI step entry stopped: lane is full or cursor is outside it.');}
    }
    return ()=>{stopped=true;release?.();};
  }
  function scheduleMelodyNote(note,start,secondsPerStep){
    const length=note.duration*secondsPerStep;
    const cue=note.word&&project.voice.phrases.flatMap(phrase=>phrase.words).find(word=>word.text===note.word&&audio.sources.get(word.sourcePad)?.file);
    if(cue){
      const sourcePad=project.pads[cue.sourcePad];
      audio.trigger(cue.sourcePad,{...sourcePad,start:cue.start,end:Math.min(cue.end,cue.start+length),pitch:clamp(note.midi-60,-12,12),speed:1,volume:clamp(sourcePad.volume*clamp(note.velocity??96,1,127)/96,0,1.5)},undefined,start);
      return;
    }
    const ctx=audio.context,oscillator=ctx.createOscillator(),gain=ctx.createGain();
    oscillator.type='triangle';oscillator.frequency.setValueAtTime(midiFrequency(note.midi,project.voice.melody.tuning),start);
    const peak=.16*clamp(note.velocity??96,1,127)/127;
    const attack=Math.min(.015,length*.35),release=Math.min(.02,length*.45),sustainEnd=Math.max(start+attack,start+length-release);
    gain.gain.setValueAtTime(.0001,start);gain.gain.linearRampToValueAtTime(peak,start+attack);
    gain.gain.setValueAtTime(peak,sustainEnd);gain.gain.linearRampToValueAtTime(.0001,start+length);
    oscillator.connect(gain).connect(audio.master);oscillator.start(start);oscillator.stop(start+length+.01);
    oscillator.onended=()=>{oscillator.disconnect();gain.disconnect();};
  }
  async function auditionMelodyNote(note){
    await audio.unlock();
    scheduleMelodyNote(note,audio.context.currentTime+.01,60/clamp(project.bpm,40,240)/4);
  }
  $('melody-play').addEventListener('click', async () => {
    const melody=project.voice.melody,clip=melody.clips.find(item=>item.id===melody.activeClipId),notes=clip?.notes||melody.notes;
    if (!notes.length) return notify('Add a note to write your melody first.');
    await audio.unlock(); const ctx = audio.context, now = ctx.currentTime + .05, secondsPerStep = 60 / project.bpm / 4;
    const previewBars=clip?(songTotalBars(project.song)||Math.min(MAX_SONG_BARS,melodyClipPreviewBars(clip))):MAX_SONG_BARS;
    const previewNotes=clip?melodyClipEvents(clip,previewBars):notes;
    for (const note of previewNotes) {
      scheduleMelodyNote(note,now+note.step*secondsPerStep,secondsPerStep);
    }
  });
  $('render-song-audio').addEventListener('click',renderSongAudioExport);
  $('render-song-video').addEventListener('click',renderSongVideoExport);
  $('melody-export').addEventListener('click', () => {
    const melody=project.voice.melody,songBars=songTotalBars(project.song),bars=songBars||Math.min(MAX_SONG_BARS,Math.max(1,...melody.notes.map(note=>Math.ceil((note.step+note.duration)/16)),...melody.clips.map(melodyClipPreviewBars)));
    const notes=melody.notes.map(note=>({...note,track:'Melody'}));
    for(const [index,clip] of melody.clips.entries()){
      const events=melodyClipEvents(clip,bars);
      if(notes.length+events.length>MAX_MELODY_EXPORT_NOTES)return notify('This MIDI is larger than the safe local export limit. Shorten the Song, use fewer notes or lengthen clip repeat periods, then export again.');
      notes.push(...events.map(note=>({...note,track:`${index+1}. ${clip.name}`})));
    }
    const blob=midiFile(notes,project.bpm,melody.tuning);download(blob,`${project.title||'madladpad'}-melody.mid`);
  });
  $('rap-scheme').addEventListener('change', () => { project.voice.rap.scheme = $('rap-scheme').value; save(); renderRap(project, save, audio, notify); });
  $('rap-export').addEventListener('click', () => { const lines = project.voice.rap.bars.map((line, index) => {const flow=project.voice.rap.flow[index];const guide=flow.some(Boolean)?`\n    FLOW  ${flow.map((active,step)=>active?(step%4===0?'●':'x'):'·').join(' ')}`:'';return `${String(index + 1).padStart(2, '0')}  ${line}${guide}`;}); const blob = new Blob([`# ${project.title} · ${project.bpm} BPM · ${project.voice.rap.scheme}\n\n${lines.join('\n')}\n`], { type: 'text/plain;charset=utf-8' }); download(blob, `${project.title || 'madladpad'}-lyrics.txt`); });
  render();
  if(project.voice.wordRemix.followTransport){try{await prepareWordRemixTransport();}catch(error){project.voice.wordRemix.followTransport=false;save();notify(`Word Remix transport was turned off: ${error.message}`);renderWordRemix(project,activeTranscript,save,wordRemixBar,getMediaFiles);}}
  return {
    scheduleWordRemixStep(absoluteStep,time,bpm,isSourceAudible=()=>true){
      if(!project.voice.wordRemix.followTransport||!wordRemixTransportReady)return;
      const position=absoluteStep%64,secondsPerStep=60/clamp(bpm,40,240)/4,loopDuration=64*secondsPerStep;
      for(const event of project.voice.wordRemix.events){
        if(event.step!==position)continue;
        const transcript=project.voice.transcripts.find(item=>item.id===event.transcriptId),word=transcript?.words.find(item=>item.id===event.wordId),sourcePad=transcript?.sourcePad,source=transcript&&audio.sources.get(sourcePad),buffer=source?.buffer,file=transcript&&getMediaFiles().get(sourcePad),pad=Number.isInteger(sourcePad)?project.pads[sourcePad]:null;
        if(pad&&!isSourceAudible(sourcePad))continue;
        if(!word||!file)continue;
        if(file.type.startsWith('video/')){
          if(!wordRemixLiveRoute||wordRemixLiveFile!==file)continue;
          const video=$('word-remix-live-video'),start=clamp(word.start,0,3600),duration=Math.min((word.end-word.start)*clamp(event.lengthPercent??100,25,100)/100,loopDuration-event.step*secondsPerStep);
          if(duration<=.01)continue;
          const timer=setTimeout(()=>{
            wordRemixVideoTimers.delete(timer);
            if(!project.voice.wordRemix.followTransport||!wordRemixTransportReady||wordRemixLiveFile!==file)return;
            stopLiveVideoCue(); // a repeated spoken word cuts the previous one
            const cue={timer:null,onTime:null};wordRemixLiveCue=cue;
            video.currentTime=Math.min(start,Number.isFinite(video.duration)?Math.max(0,video.duration-.01):start);video.playbackRate=1;
            wordRemixLiveRoute.pitch=clamp(event.pitch??0,-12,12);wordRemixLiveRoute.speed=1;
            if(!audio.routeMediaPitch(wordRemixLiveRoute)){
              notify('Word video playback cannot use the local audio pitch processor.');
              project.voice.wordRemix.followTransport=false;stopWordRemixTransport();save();return;
            }
            const level=clamp(.82*clamp(pad?.volume??.9,0,1.5)/.9,0,1.5);
            audio.setMediaOutputGain(wordRemixLiveRoute,level);
            $('word-remix-live-label').textContent=word.text;
            $('word-remix-live').hidden=false;video.hidden=false;
            const finish=()=>{if(wordRemixLiveCue===cue)stopLiveVideoCue();};
            cue.onTime=()=>{if(video.currentTime>=start+duration-.015)finish();};
            video.addEventListener('timeupdate',cue.onTime);
            // Video seeks are asynchronous. Keep a safety timer for stalled
            // decoders, but start the audible/visual length once play succeeds.
            cue.timer=setTimeout(finish,Math.max(1000,Math.ceil(duration*2000)));
            video.play().then(()=>{
              if(wordRemixLiveCue!==cue)return;
              clearTimeout(cue.timer);
              cue.timer=setTimeout(finish,Math.ceil(duration*1000));
            }).catch(error=>{
              if(wordRemixLiveCue===cue){stopLiveVideoCue();notify('Word Remix speaker video could not play: '+error.message);}
            });
          },Math.max(0,Math.round((time-audio.context.currentTime)*1000)));
          wordRemixVideoTimers.add(timer);continue;
        }
        if(!buffer)continue;
        const start=clamp(word.start,0,Math.max(0,buffer.duration-.01)),duration=Math.min((word.end-word.start)*clamp(event.lengthPercent??100,25,100)/100,loopDuration-event.step*secondsPerStep,buffer.duration-start);
        if(duration<=.01)continue;
        const pitch=clamp(event.pitch??0,-12,12),when=time,latency=Math.abs(pitch)>.01?Math.round(audio.context.sampleRate*.04)/audio.context.sampleRate:0,pitchNode=Math.abs(pitch)>.01?audio.createPitchNode():null;
        if(Math.abs(pitch)>.01&&!pitchNode){wordRemixTransportReady=false;notify('Word Remix transport stopped: the local pitch processor is unavailable.');stopWordRemixTransport();return;}
        const node=audio.context.createBufferSource(),gain=audio.context.createGain(),fade=Math.min(.008,duration/3);
        node.buffer=buffer;
        if(pitchNode){pitchNode.parameters.get('semitones').setValueAtTime(pitch,when-latency);node.connect(pitchNode);pitchNode.connect(gain);}else node.connect(gain);
        const level=clamp(.82*clamp(pad?.volume??.9,0,1.5)/.9,0,1.5);
        gain.connect(audio.master);gain.gain.setValueAtTime(0,when);gain.gain.linearRampToValueAtTime(level,when+fade);gain.gain.setValueAtTime(level,when+duration-fade);gain.gain.linearRampToValueAtTime(0,when+duration);
        const voice={node,gain,pitchNode};wordRemixTransportVoices.add(voice);
        node.onended=()=>{node.disconnect();pitchNode?.disconnect();gain.disconnect();wordRemixTransportVoices.delete(voice);};
        node.start(when-latency,start,duration+latency);
      }
    },
    scheduleMelodyStep(absoluteStep,time,bpm){
      if(!project.voice.melody.followBeat)return;
      const position=absoluteStep%MAX_MELODY_STEPS,secondsPerStep=60/bpm/4;
      for(const note of project.voice.melody.notes)if(note.step===position)scheduleMelodyNote(note,time,secondsPerStep);
      const bars=songTotalBars(project.song)||MAX_SONG_BARS;
      for(const clip of project.voice.melody.clips)for(const note of melodyClipNotesAtStep(clip,absoluteStep,bars))scheduleMelodyNote(note,time,secondsPerStep);
    },
    highlightRapBar(absoluteStep){
      const bar=Math.floor(absoluteStep/16)%16;
      for(const row of $('rap-bars').children)row.classList.toggle('current',Number(row.dataset.bar)===bar);
    },
    transportStarted(epoch, bpm) { if(project.voice.wordRemix.followTransport&&!wordRemixTransportReady)prepareWordRemixTransport().catch(error=>{project.voice.wordRemix.followTransport=false;save();notify(`Word Remix transport was turned off: ${error.message}`);renderWordRemix(project,activeTranscript,save,wordRemixBar,getMediaFiles);});audio.playVocalLayers(project.voice.layers, epoch, bpm, songTotalBars(project.song)); startSongVideoAudioPlayback();updateSongCycleControlAvailability();updateOverdubControls(); },
    transportStopped() { stopWordRemixTransport();audio.stopVocalLayers();stopSongVideoAudioPlayback(); if (vocalRecording) stopOverdub(); if(videoRecordingActivity.phase==='starting')stopSongVideoRecording(true);else if(videoRecording)stopSongVideoRecording(false);updateSongCycleControlAvailability();updateOverdubControls(); },
    songVideoFramesAtStep,
    songAudioFramesAtStep,
    songMelodyVisualTracksAtStep,
    renderSongAudioExport,
    stopSongVideoVisualPlayback,
    stopTuner,
    stopMidiKeyboard,
    handleMidiKeyboard(source,data){midiKeyboard.handle(source,data);},
    refreshTimeline() { renderOverdubTimeline(); },
    transportChanged() { updateSongCycleControlAvailability();updateOverdubControls(); },
    isRecording() { return Boolean(vocalRecording||videoRecording||videoRecordingActivity.phase==='starting'); },
    reloadLayers
  };
}
