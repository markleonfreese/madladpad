import {
  clamp,
  PAD_COUNT,
  audioBufferToWav,
  isPadAudible,
  melodyClipNotesAtStep,
  midiFrequency,
  sampleNoteAtStep,
  songVideoPositionAtStep,
  songLayerPlaybackEvents,
  songSectionAtStep,
  songTotalBars,
  MAX_REVERSED_AUDIO_BYTES,
  stepGateDuration,
  stepLoopGateDuration
} from './core.js';
import { effectivePitchSemitones, pitchShiftPcm } from './pitch-dsp.js';
import { DEMO_SOUND_SPECS } from './demo-sounds.js';

/**
 * Expand the saved Song into a stable, absolute-time event list for offline
 * renderers. This describes the arrangement; it does not encode media or
 * claim that live MediaRecorder capture is deterministic.
 */
export function buildSongRenderPlan(project, { padDurations = {}, vocalDurations = {}, videoDurations = {}, wordRemixDurations = {} } = {}) {
  const bars = songTotalBars(project?.song);
  if (!bars) throw new Error('Add saved patterns to Song before rendering.');
  for (const clip of project.song.clips) {
    if (!project.scenes.some(scene => scene.id === clip.sceneId)) {
      throw new Error(`Song section “${clip.id}” refers to a missing pattern.`);
    }
  }

  const bpm = clamp(project.bpm, 40, 240);
  const secondsPerStep = 60 / bpm / 4;
  const totalSteps = bars * 16;
  const activePads = project.pads.slice(0, PAD_COUNT[project.layout] || project.pads.length);
  const durationSeconds = totalSteps * secondsPerStep;
  const events = [];
  const sections = [];
  let lastSection = null;
  let sectionStart = 0;
  for (let step = 0; step < totalSteps; step++) {
    const section = songSectionAtStep(project.song, project.scenes, step);
    if (!section) throw new Error(`Song arrangement is incomplete at bar ${Math.floor(step / 16) + 1}.`);
    if (lastSection?.clip.id !== section.clip.id) {
      if (lastSection) sections.push({ sceneId: lastSection.scene.id, clipId: lastSection.clip.id, startStep: sectionStart, endStep: step });
      lastSection = section;
      sectionStart = step;
    }

    const lanes = section.scene.pads || [];
    const pattern = section.localStep;
    const division = section.scene.gridDivision || project.gridDivision;
    const stride = division === '1/4' ? 4 : division === '1/8' ? 2 : 1;
    activePads.forEach((pad, padId) => {
      if (!isPadAudible(activePads, padId)) return;
      const lane = lanes[padId];
      if (!lane) return;
      if (pad.kind === 'image') {
        const active = lane.sequenceMode === 'notes'
          ? Boolean(sampleNoteAtStep(lane.sampleNotes, pattern))
          : pattern % stride === 0 && Boolean(lane.steps?.[pattern]);
        if (active) {
          const offset = lane.stepOffsets?.[pattern] || 0;
          const gate = lane.sequenceMode === 'notes'
            ? (sampleNoteAtStep(lane.sampleNotes, pattern)?.length || 1) * secondsPerStep
            : lane.stepPlaybackMode === 'one-step' ? stepGateDuration(bpm, offset) : secondsPerStep;
          events.push({ kind: 'still', trackId: `pad-${padId}`, padId, startStep: step,
            startSeconds: step * secondsPerStep + offset * secondsPerStep,
            durationSeconds: gate, gain: 0, speed: 1, semitones: 0 });
        }
        return;
      }
      if (!pad.fileName && !pad.demoSound && !project.demoEnabled) return;
      const eventKind = !pad.fileName ? 'demo' : 'sample';
      if (lane.sequenceMode === 'notes') {
        const note = sampleNoteAtStep(lane.sampleNotes, pattern);
        if (!note) return;
        const offset = lane.stepOffsets?.[pattern] || 0;
        events.push({
          kind: eventKind, trackId: `pad-${padId}`, padId, startStep: step,
          startSeconds: step * secondsPerStep + offset * secondsPerStep,
          durationSeconds: note.length * secondsPerStep, sourceStartSeconds: pad.start,
          sourceEndSeconds: pad.end, gain: pad.volume, speed: pad.speed,
          semitones: clamp(pad.pitch + note.semitones, -12, 12), loop: true,
          noteMode: true, demoSound: pad.demoSound || ''
        });
        return;
      }
      if (pattern % stride !== 0 || !lane.steps?.[pattern]) return;
      const offset = lane.stepOffsets?.[pattern] || 0;
      let durationSeconds = null;
      let loop = false;
      if (lane.stepPlaybackMode === 'one-step') durationSeconds = stepGateDuration(bpm, offset);
      if (lane.stepPlaybackMode === 'loop') {
        const isClipStart = step === (section.startBar - 1) * 16;
        durationSeconds = stepLoopGateDuration(lane.steps, pattern, bpm, offset, isClipStart);
        if (durationSeconds === null) return;
        loop = true;
      }
      const sourceDuration = Number(padDurations[padId]) || 0;
      const sourceLength = Math.max(0, Math.min(pad.end, sourceDuration || pad.end) - pad.start);
      const naturalDuration = sourceLength / clamp(pad.speed, .5, 2);
      const indefinite = durationSeconds === Infinity;
      const eventStartSeconds = step * secondsPerStep + offset * secondsPerStep;
      if (indefinite) durationSeconds = Math.max(0, ((section.endBar - 1) * 16 * secondsPerStep) - eventStartSeconds);
      events.push({
        kind: eventKind, trackId: `pad-${padId}`, padId, startStep: step,
        startSeconds: eventStartSeconds,
        durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : naturalDuration,
        sourceStartSeconds: pad.start, sourceEndSeconds: pad.end, gain: pad.volume,
        speed: pad.speed, semitones: pad.pitch, loop, indefinite, demoSound: pad.demoSound || '',
        noteMode: false
      });
    });
  }
  if (lastSection) sections.push({ sceneId: lastSection.scene.id, clipId: lastSection.clip.id, startStep: sectionStart, endStep: totalSteps });

  for (const layer of project.voice?.layers || []) {
    if (layer.muted) continue;
    const hasSolo = project.voice.layers.some(item => item.solo && !item.muted);
    if (hasSolo && !layer.solo) continue;
    const duration = Number(vocalDurations[layer.id]) || 0;
    for (const [cycle, instance] of songLayerPlaybackEvents(layer, duration, bpm, bars).entries()) {
      events.push({
        kind: 'vocal', trackId: layer.id, name: layer.name, cycle,
        startStep: instance.startStep, startSeconds: instance.startStep * secondsPerStep,
        durationSeconds: instance.durationSec, sourceStartSeconds: instance.sourceStartSec,
        gain: clamp(layer.gain ?? 1, 0, 1.5), semitones: clamp(layer.pitch ?? 0, -12, 12),
        reverse: Boolean(layer.reverseEnabled)
      });
    }
  }

  for (const layer of project.voice?.videoLayers || []) {
    if (!layer.includeAudio) continue;
    const duration = Number(videoDurations[layer.id]) || 0;
    for (const [cycle, instance] of songLayerPlaybackEvents(layer, duration, bpm, bars).entries()) {
      events.push({
        kind: 'video-audio', trackId: layer.id, name: layer.name, cycle,
        startStep: instance.startStep, startSeconds: instance.startStep * secondsPerStep,
        durationSeconds: instance.durationSec, sourceStartSeconds: instance.sourceStartSec,
        gain: clamp(layer.audioGain ?? 1, 0, 1.5), semitones: 0, reverse: false
      });
    }
  }

  const wordRemix = project.voice?.wordRemix;
  if (wordRemix?.followTransport) {
    const loopSteps = 64;
    const loopSeconds = loopSteps * secondsPerStep;
    for (const cue of wordRemix.events || []) {
      const transcript = project.voice.transcripts.find(item => item.id === cue.transcriptId);
      const word = transcript?.words.find(item => item.id === cue.wordId);
      const sourcePad = transcript?.sourcePad;
      const pad = Number.isInteger(sourcePad) ? activePads[sourcePad] : null;
      if (!word || !pad || !isPadAudible(activePads, sourcePad)) continue;
      const sourceDuration = Number(wordRemixDurations[cue.id]) || word.end;
      const sourceStartSeconds = clamp(word.start, 0, Math.max(0, sourceDuration - .01));
      const sourceEndSeconds = Math.min(word.end, sourceDuration);
      const sourceLength = sourceEndSeconds - sourceStartSeconds;
      if (sourceLength <= .01) continue;
      for (let loopStartStep = 0; loopStartStep < totalSteps; loopStartStep += loopSteps) {
        const startStep = loopStartStep + cue.step;
        if (startStep >= totalSteps) continue;
        const startSeconds = startStep * secondsPerStep;
        const cueDurationSeconds = Math.min(
          sourceLength * clamp(cue.lengthPercent ?? 100, 25, 100) / 100,
          loopSeconds - cue.step * secondsPerStep,
          durationSeconds - startSeconds
        );
        if (cueDurationSeconds <= .01) continue;
        const videoSource = pad.kind === 'video';
        events.push({
          kind: videoSource ? 'word-remix-video' : 'word-remix-audio',
          id: cue.id, transcriptId: cue.transcriptId, wordId: cue.wordId,
          trackId: `word-remix-${cue.id}`, name: word.text, sourcePad,
          startStep, startSeconds, durationSeconds: cueDurationSeconds, sourceStartSeconds, sourceEndSeconds,
          semitones: clamp(cue.pitch ?? 0, -12, 12),
          gain: clamp(.82 * clamp(pad.volume ?? .9, 0, 1.5) / .9, 0, 1.5),
          cycle: Math.floor(loopStartStep / loopSteps), videoSource
        });
      }
    }
  }

  const melody = project.voice?.melody;
  if (melody?.followBeat) {
    const addNote = (note, trackId) => {
      if (note.step >= totalSteps) return;
      const noteSteps = Math.min(note.duration || 1, totalSteps - note.step);
      events.push({
        kind: 'midi', trackId, name: note.layer || 'lead', startStep: note.step,
        startSeconds: note.step * secondsPerStep, durationSeconds: noteSteps * secondsPerStep,
        midi: note.midi, velocity: clamp(note.velocity ?? 96, 1, 127), word: note.word || '',
        tuning: melody.tuning
      });
    };
    for (const note of melody.notes || []) addNote(note, 'melody');
    for (const [index, clip] of (melody.clips || []).entries()) {
      // Expanding by start step keeps the plan bounded by the Song's 4096-step cap.
      for (let step = 0; step < totalSteps; step++) {
        for (const note of melodyClipNotesAtStep(clip, step, bars)) addNote(note, `midi-${clip.id || index + 1}`);
      }
    }
  }

  events.sort((a, b) => a.startSeconds - b.startSeconds || a.kind.localeCompare(b.kind) || a.trackId.localeCompare(b.trackId));
  return { bpm, bars, totalSteps, durationSeconds, sections, events };
}

/** Return the local media and note tiles that should be drawn at one render timestamp. */
export function songRenderVisualsAtTime(project, plan, seconds) {
  if (!Number.isFinite(seconds) || seconds < 0 || seconds >= plan.durationSeconds) return [];
  const secondsPerStep = 60 / plan.bpm / 4;
  const step = seconds / secondsPerStep;
  const visuals = [];
  for (const layer of project.voice?.videoLayers || []) {
    const sourceSeconds = songVideoPositionAtStep(layer, step, plan.bpm, plan.bars);
    if (sourceSeconds !== null) visuals.push({ kind: 'video', trackId: layer.id, name: layer.name, sourceSeconds });
  }
  for (const event of plan.events) {
    if (seconds < event.startSeconds || seconds >= event.startSeconds + event.durationSeconds) continue;
    if (event.kind === 'demo') {
      const pad = project.pads[event.padId];
      visuals.push({
        kind: 'generated', trackId: event.trackId, name: pad?.name || `Demo Pad ${event.padId + 1}`,
        sourceSeconds: seconds - event.startSeconds, demoSound: event.demoSound || '', padId: event.padId
      });
    } else if (event.kind === 'sample' || event.kind === 'still') {
      const pad = project.pads[event.padId];
      const sourceSeconds = event.sourceStartSeconds + (seconds - event.startSeconds) * event.speed;
      if (event.kind === 'still' || pad?.kind === 'image') visuals.push({ kind: 'still', trackId: event.trackId, name: pad.name, sourceSeconds: 0 });
      else if (pad?.kind === 'video' && sourceSeconds < event.sourceEndSeconds) visuals.push({ kind: 'video-pad', trackId: event.trackId, name: pad.name, sourceSeconds });
      else if (pad?.kind === 'audio') visuals.push({ kind: 'waveform', trackId: event.trackId, name: pad.name, sourceSeconds });
    } else if (event.kind === 'vocal') {
      visuals.push({ kind: 'waveform', trackId: event.trackId, name: event.name, sourceSeconds: event.sourceStartSeconds + seconds - event.startSeconds });
    } else if (event.kind === 'midi') {
      visuals.push({ kind: 'midi', trackId: event.trackId, name: event.name, midi: event.midi, velocity: event.velocity, sourceSeconds: seconds - event.startSeconds });
    } else if (event.kind === 'word-remix-video') {
      visuals.push({ kind: 'video-pad', trackId: event.trackId, name: event.name, sourceSeconds: event.sourceStartSeconds + seconds - event.startSeconds });
    } else if (event.kind === 'word-remix-audio') {
      visuals.push({ kind: 'waveform', trackId: event.trackId, name: event.name, sourceSeconds: event.sourceStartSeconds + seconds - event.startSeconds });
    }
  }
  return visuals.sort((a, b) => a.kind.localeCompare(b.kind) || a.trackId.localeCompare(b.trackId));
}

function audioBufferLike(buffer) {
  return buffer && Number.isFinite(buffer.duration) && Number.isFinite(buffer.sampleRate)
    && Number.isInteger(buffer.length) && Number.isInteger(buffer.numberOfChannels)
    && typeof buffer.getChannelData === 'function';
}

function assertSourceWindow(event, buffer, { start = event.sourceStartSeconds, end = event.sourceEndSeconds ?? buffer.duration } = {}) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end > buffer.duration + 1 / buffer.sampleRate) {
    throw new Error(`The local trim for “${event.name || event.trackId}” is outside its decoded audio. Adjust the trim or reload the source.`);
  }
}

function setEnvelope(gain, start, end, amount) {
  const inTime = Math.min(.008, Math.max(.001, (end - start) / 8));
  const outTime = Math.min(.008, Math.max(.001, (end - start) / 8));
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(clamp(amount, 0, 1.5), start + inTime);
  if (end - outTime > start + inTime) gain.gain.setValueAtTime(clamp(amount, 0, 1.5), end - outTime);
  gain.gain.linearRampToValueAtTime(0, end);
}

function scheduleBufferEvent(context, master, event, buffer, start, end, { offset = 0, sourceEnd = buffer.duration, speed = 1, gain: gainValue = event.gain, loop = false } = {}) {
  const usableEnd = Math.min(buffer.duration, sourceEnd);
  const clipDuration = usableEnd - offset;
  if (clipDuration <= .001 || end <= start) return;
  const source = context.createBufferSource(), gain = context.createGain();
  source.buffer = buffer;
  source.playbackRate.setValueAtTime(clamp(speed, .5, 2), start);
  const outputDuration = end - start;
  const shouldLoop = Boolean(loop && clipDuration / clamp(speed, .5, 2) < outputDuration - .006);
  if (shouldLoop) {
    source.loop = true;
    source.loopStart = offset;
    source.loopEnd = usableEnd;
  }
  setEnvelope(gain, start, end, gainValue);
  source.connect(gain).connect(master);
  if (shouldLoop) {
    source.start(start, offset);
    source.stop(end + .001);
  } else {
    const sourceDuration = Math.min(clipDuration, outputDuration * clamp(speed, .5, 2));
    source.start(start, offset, sourceDuration);
  }
}

function demoNoise(context,cache,key,seconds,seed){
  const cacheKey=`${key}:${context.sampleRate}`;
  if(cache.has(cacheKey))return cache.get(cacheKey);
  const frames=Math.max(1,Math.ceil(context.sampleRate*seconds)),buffer=context.createBuffer(1,frames,context.sampleRate),channel=buffer.getChannelData(0);
  let state=(seed>>>0)||0x6d2b79f5;
  for(let frame=0;frame<frames;frame++){state^=state<<13;state^=state>>>17;state^=state<<5;channel[frame]=(state>>>0)/2147483648-1;}
  cache.set(cacheKey,buffer);return buffer;
}

function hashDemoNoise(value){let hash=2166136261;for(const character of value)hash=Math.imul(hash^character.charCodeAt(0),16777619);return hash>>>0;}

function scheduleDemoEvent(context,master,event,start,end,noiseCache){
  const id=Math.max(0,Number(event.padId)||0),spec=DEMO_SOUND_SPECS[event.demoSound],naturalLength=spec?.length??(.14+(id%4)*.055),length=Math.min(naturalLength,end-start);
  if(length<.006)return;
  const peak=Math.max(.0001,Math.min(1.5,Number(event.gain)||0)*(spec?.level??.35)),gain=context.createGain();
  gain.gain.setValueAtTime(.0001,start);
  gain.gain.exponentialRampToValueAtTime(spec?peak:Math.max(.001,peak),start+Math.min(spec?.bursts?.004:.008,length/10));
  gain.gain.exponentialRampToValueAtTime(.0001,start+length);gain.connect(master);
  const connect=node=>{
    if(spec?.filter){const filter=context.createBiquadFilter();filter.type=spec.kind==='noise'?spec.filter:'lowpass';filter.frequency.value=spec.cutoff||spec.filter;node.connect(filter).connect(gain);}
    else node.connect(gain);
  };
  if(spec?.kind==='noise'){
    const noise=demoNoise(context,noiseCache,`preset:${event.demoSound}`,naturalLength,hashDemoNoise(`preset:${event.demoSound}`)),source=context.createBufferSource();
    source.buffer=noise;connect(source);source.start(start);source.stop(start+length);
    if(spec.tone&&length>.006){const toneLength=Math.min(.11,length),tone=context.createOscillator();tone.type='triangle';tone.frequency.setValueAtTime(spec.tone,start);tone.frequency.exponentialRampToValueAtTime(65,start+Math.min(.1,toneLength));tone.connect(gain);tone.start(start);tone.stop(start+toneLength);}
    if(spec.bursts)for(const offset of [.035,.075,.115])if(offset<length){gain.gain.setValueAtTime(peak*.75,start+offset);gain.gain.exponentialRampToValueAtTime(.0001,start+Math.min(length,offset+.035));}
  }else if(spec){
    const frequencies=spec.kind==='chord'?spec.frequencies:[spec.frequency||spec.from];
    for(const frequency of frequencies){const oscillator=context.createOscillator();oscillator.type=spec.wave||'triangle';oscillator.frequency.setValueAtTime(frequency,start);if(spec.kind==='sweep')oscillator.frequency.exponentialRampToValueAtTime(spec.to,start+length);connect(oscillator);oscillator.start(start);oscillator.stop(start+length);}
  }else if(id%3===2){
    const key=`default:${id}`,noise=demoNoise(context,noiseCache,key,naturalLength,hashDemoNoise(key)),source=context.createBufferSource(),filter=context.createBiquadFilter();
    source.buffer=noise;filter.type='highpass';filter.frequency.value=2400+id*130;source.connect(filter).connect(gain);source.start(start);source.stop(start+length);
  }else{
    const oscillator=context.createOscillator();oscillator.type=id%3===0?'sine':'triangle';oscillator.frequency.setValueAtTime(80+id*48,start);oscillator.frequency.exponentialRampToValueAtTime(42+id*14,start+length);oscillator.connect(gain);oscillator.start(start);oscillator.stop(start+length);
  }
}

async function pitchBufferForEvent(context, buffer, { offset, sourceEnd, outputDuration, speed, semitones, loop }, cache) {
  const sampleRate=buffer.sampleRate,first=Math.max(0,Math.floor(offset*sampleRate)),last=Math.min(buffer.length,Math.floor(sourceEnd*sampleRate));
  const clipFrames=last-first;if(clipFrames<=0)return null;
  const targetFrames=Math.max(1,Math.ceil(outputDuration*speed*sampleRate));
  const frames=loop?targetFrames:Math.min(clipFrames,targetFrames);
  const adjustedPitch=effectivePitchSemitones(semitones,speed),loopSource=Boolean(loop&&clipFrames<frames);
  const key=`${first}:${last}:${frames}:${speed}:${adjustedPitch}:${loopSource}`;
  let bySettings=cache.get(buffer);
  if(!bySettings){bySettings=new Map();cache.set(buffer,bySettings);}
  if(bySettings.has(key))return bySettings.get(key);
  const bytes=frames*buffer.numberOfChannels*Float32Array.BYTES_PER_ELEMENT;
  if(cache.bytes+bytes>48*1024*1024)throw new Error('Pitch-processed Song sources exceed the local 48 MB working limit. Shorten the Song or use real-time recording.');
  const pitched=context.createBuffer(buffer.numberOfChannels,frames,sampleRate);
  const sourceChannels=Array.from({length:buffer.numberOfChannels},(_,channel)=>buffer.getChannelData(channel));
  const outputChannels=Array.from({length:buffer.numberOfChannels},(_,channel)=>pitched.getChannelData(channel));
  await pitchShiftPcm({channels:buffer.numberOfChannels,sampleRate,semitones:adjustedPitch,frames,outputChannels,
    readFrame:(channel,frame)=>{
      const sourceFrame=loopSource?frame%clipFrames:frame;
      return sourceFrame<clipFrames?sourceChannels[channel][first+sourceFrame]:0;
    }});
  cache.bytes+=bytes;bySettings.set(key,pitched);return pitched;
}

/** Mix the supported Song events to a local stereo PCM WAV using the same local
 * granular time-preserving Pitch processor as live playback.
 */
export async function renderSongAudioWav(plan, sources, {
  OfflineAudioContextClass = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext,
  sampleRate = 44100,
  maxSeconds = 240,
  makeWav = true
} = {}) {
  if (typeof OfflineAudioContextClass !== 'function') throw new Error('This browser does not support local offline audio rendering. Use real-time audio recording instead.');
  if (!Number.isFinite(plan?.durationSeconds) || plan.durationSeconds <= 0) throw new Error('The Song has no renderable duration.');
  if (plan.durationSeconds > maxSeconds) throw new Error(`Offline WAV rendering is limited to ${maxSeconds / 60} minutes on this device. Shorten the Song or use real-time audio recording.`);
  const rate = clamp(sampleRate, 22050, 48000);
  const frameCount = Math.ceil(plan.durationSeconds * rate);
  const estimatedBytes = 44 + frameCount * 4;
  if (estimatedBytes > 48 * 1024 * 1024) throw new Error('This WAV would exceed the local export size limit. Lower the Song duration before rendering.');
  const pads = sources?.pads || new Map(), vocals = sources?.vocals || new Map(), videos = sources?.videos || new Map(), cues = sources?.cues || new Map();
  const playable = plan.events.filter(event => ['sample', 'vocal', 'video-audio', 'word-remix-audio', 'word-remix-video', 'midi', 'demo'].includes(event.kind));
  const bufferFor = event => event.kind === 'sample' ? pads.get(event.padId)
    : event.kind === 'vocal' ? vocals.get(event.trackId)
      : event.kind === 'video-audio' ? videos.get(event.trackId)
        : event.kind === 'word-remix-audio' || event.kind === 'word-remix-video' ? sources?.wordRemix?.get(event.id)?.buffer : null;
  for (const event of playable) {
    if (event.kind === 'demo') continue;
    if (event.kind === 'midi' && event.word && cues.has(event.word)) {
      const cue = cues.get(event.word);
      if (!audioBufferLike(cue?.buffer)) throw new Error(`The local phrase audio for “${event.word}” is unavailable.`);
      assertSourceWindow(event, cue.buffer, { start: cue.start, end: cue.end });
      continue;
    }
    if (event.kind === 'midi') continue;
    const buffer = bufferFor(event);
    if (!audioBufferLike(buffer)) throw new Error(`A local audio source for “${event.name || event.trackId}” is unavailable or cannot be decoded in this browser.`);
    const sourceEnd = event.sourceEndSeconds ?? event.sourceStartSeconds + event.durationSeconds;
    assertSourceWindow(event, buffer, { end: sourceEnd });
    if (event.kind === 'vocal' && event.reverse) {
      const first = Math.floor(event.sourceStartSeconds * buffer.sampleRate);
      const last = Math.min(buffer.length, Math.ceil((event.sourceStartSeconds + event.durationSeconds) * buffer.sampleRate));
      const bytes = Math.max(1, last - first) * buffer.numberOfChannels * Float32Array.BYTES_PER_ELEMENT;
      if (bytes > MAX_REVERSED_AUDIO_BYTES) {
        throw new Error(`The reversed vocal “${event.name || event.trackId}” exceeds the local reverse-buffer limit. Shorten its trim or turn off Reverse.`);
      }
    }
  }

  const offline = new OfflineAudioContextClass(2, frameCount, rate);
  const compressor = offline.createDynamicsCompressor();
  compressor.threshold.value = -1.5;
  compressor.knee.value = 0;
  compressor.ratio.value = 20;
  compressor.attack.value = .003;
  compressor.release.value = .08;
  compressor.connect(offline.destination);
  const sortedSamples = playable.filter(event => event.kind === 'sample'||event.kind==='demo').sort((a, b) => a.startSeconds - b.startSeconds);
  const demoNoiseCache=new Map();
  const reversedBuffers = new Map();
  const pitchCache = new WeakMap();pitchCache.bytes=0;
  for (const event of playable) {
    const start = clamp(event.startSeconds, 0, plan.durationSeconds);
    if (event.kind === 'midi') {
      const cue = event.word ? cues.get(event.word) : null;
      if (cue) {
        const end = Math.min(plan.durationSeconds, start + event.durationSeconds);
        const offset=clamp(cue.start,0,cue.buffer.duration),sourceEnd=clamp(cue.end,0,cue.buffer.duration),gain=clamp((cue.gain??1)*event.velocity/96,0,1.5),pitch=event.midi-60;
        if(Math.abs(pitch)>.01){
          const rendered=await pitchBufferForEvent(offline,cue.buffer,{offset,sourceEnd,outputDuration:end-start,speed:1,semitones:pitch,loop:true},pitchCache);
          if(rendered)scheduleBufferEvent(offline,compressor,event,rendered,start,end,{gain,offset:0,sourceEnd:rendered.duration});
        }else scheduleBufferEvent(offline,compressor,event,cue.buffer,start,end,{offset,sourceEnd,gain,loop:true});
      } else {
        const end = Math.min(plan.durationSeconds, start + event.durationSeconds);
        const oscillator = offline.createOscillator(), gain = offline.createGain();
        oscillator.type = 'triangle';
        oscillator.frequency.setValueAtTime(midiFrequency(event.midi, event.tuning), start);
        setEnvelope(gain, start, end, .16 * event.velocity / 127);
        oscillator.connect(gain).connect(compressor);
        oscillator.start(start);
        oscillator.stop(end + .001);
      }
      continue;
    }
    if(event.kind==='demo'){
      const nextSamePad=sortedSamples.find(other=>other.padId===event.padId&&other.startSeconds>event.startSeconds)?.startSeconds;
      const end=Math.min(plan.durationSeconds,start+event.durationSeconds,nextSamePad??Infinity);
      scheduleDemoEvent(offline,compressor,event,start,end,demoNoiseCache);
      continue;
    }
    const buffer = bufferFor(event);
    const nextSamePad = event.kind === 'sample'
      ? sortedSamples.find(other => other.padId === event.padId && other.startSeconds > event.startSeconds)?.startSeconds
      : null;
    const end = Math.min(plan.durationSeconds, start + event.durationSeconds, nextSamePad ?? Infinity);
    if (event.kind === 'vocal' && event.reverse) {
      const key = `${event.trackId}:${event.sourceStartSeconds}:${event.durationSeconds}`;
      let reversed = reversedBuffers.get(key);
      if (!reversed) {
        const first = Math.floor(event.sourceStartSeconds * buffer.sampleRate);
        const last = Math.min(buffer.length, Math.ceil((event.sourceStartSeconds + event.durationSeconds) * buffer.sampleRate));
        const frames = Math.max(1, last - first);
        reversed = offline.createBuffer(buffer.numberOfChannels, frames, buffer.sampleRate);
        for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
          const input = buffer.getChannelData(channel), output = reversed.getChannelData(channel);
          for (let frame = 0; frame < frames; frame++) output[frame] = input[last - 1 - frame] || 0;
        }
        reversedBuffers.set(key, reversed);
      }
      if(Math.abs(Number(event.semitones)||0)>.01){
        const rendered=await pitchBufferForEvent(offline,reversed,{offset:0,sourceEnd:reversed.duration,outputDuration:end-start,speed:1,semitones:event.semitones,loop:false},pitchCache);
        if(rendered)scheduleBufferEvent(offline,compressor,event,rendered,start,end,{gain:event.gain,offset:0,sourceEnd:rendered.duration});
      }else scheduleBufferEvent(offline, compressor, event, reversed, start, end, { gain: event.gain });
      continue;
    }
    const offset=event.sourceStartSeconds,sourceEnd=event.sourceEndSeconds??buffer.duration,speed=event.kind==='sample'?event.speed:1,semitones=event.semitones??0;
    if(Math.abs(effectivePitchSemitones(semitones,speed))>.01){
      const rendered=await pitchBufferForEvent(offline,buffer,{offset,sourceEnd,outputDuration:end-start,speed,semitones,loop:event.loop},pitchCache);
      if(rendered)scheduleBufferEvent(offline,compressor,event,rendered,start,end,{offset:0,sourceEnd:rendered.duration,speed,gain:event.gain});
    }else scheduleBufferEvent(offline, compressor, event, buffer, start, end, {offset,sourceEnd,speed,gain:event.gain,loop:event.loop});
  }
  const rendered = await offline.startRendering();
  return { buffer: rendered, blob: makeWav ? audioBufferToWav(rendered) : null, durationSeconds: rendered.duration };
}
