export const HOTKEYS = 'QWERASDFZXCVTYUI'.split('');
export const PAD_COUNT = { '2x2': 4, '3x4': 12, '4x4': 16 };
export const STEP_COUNT = 16;
export const MAX_SCENES = 8;
export const MAX_MEDIA_BYTES = 80 * 1024 * 1024;
export const MAX_TRANSCRIPT_WORDS = 1000;
export const MAX_VOICE_PHRASES = 8;
export const MAX_MELODY_NOTES = 128;
export const RAP_BAR_COUNT = 16;

export const makeVoiceData = () => ({
  transcripts: [], phrases: [], melody: { tuning: 440, notes: [] },
  rap: { scheme: 'AABB', bars: Array(RAP_BAR_COUNT).fill('') }
});

function normaliseVoice(value) {
  const source = value && typeof value === 'object' ? value : {};
  const transcripts = Array.isArray(source.transcripts) ? source.transcripts.slice(0, 16).map(item => ({
    id: String(item?.id || crypto.randomUUID?.() || Math.random().toString(36).slice(2)).slice(0, 80),
    sourcePad: clamp(item?.sourcePad ?? 0, 0, 15),
    words: (Array.isArray(item?.words) ? item.words : []).slice(0, MAX_TRANSCRIPT_WORDS).map((word, index) => ({
      id: String(word?.id || `${item?.id || 'word'}-${index}`).slice(0, 100),
      text: String(word?.text || '').slice(0, 120),
      start: clamp(word?.start ?? 0, 0, 3600), end: clamp(word?.end ?? 0, 0, 3600),
      selected: Boolean(word?.selected), score: Number.isFinite(word?.score) ? clamp(word.score, 0, 1) : null
    })).filter(word => word.text)
  })) : [];
  const phrases = Array.isArray(source.phrases) ? source.phrases.slice(0, MAX_VOICE_PHRASES).map(phrase => {
    const crossfadeMs = clamp(phrase?.crossfadeMs ?? 0, 0, 250);
    return {
      id: String(phrase?.id || Math.random().toString(36).slice(2)).slice(0, 80),
      name: String(phrase?.name || 'Phrase').slice(0, 48),
      gapMs: crossfadeMs ? 0 : clamp(phrase?.gapMs ?? 35, 0, 500),
      crossfadeMs,
      words: (Array.isArray(phrase?.words) ? phrase.words : []).slice(0, MAX_TRANSCRIPT_WORDS).map(word => ({
        text: String(word?.text || '').slice(0, 120), sourcePad: clamp(word?.sourcePad ?? 0, 0, 15),
        start: clamp(word?.start ?? 0, 0, 3600), end: clamp(word?.end ?? 0, 0, 3600)
      })).filter(word => word.text && word.end > word.start)
    };
  }) : [];
  const melodySource = source.melody && typeof source.melody === 'object' ? source.melody : {};
  const notes = Array.isArray(melodySource.notes) ? melodySource.notes.slice(0, MAX_MELODY_NOTES).map(note => ({
    midi: clamp(Math.round(note?.midi ?? 60), 24, 108),
    step: clamp(Math.round(note?.step ?? 0), 0, 255),
    duration: clamp(note?.duration ?? 1, .125, 16),
    word: String(note?.word || '').slice(0, 120)
  })) : [];
  const rapSource = source.rap && typeof source.rap === 'object' ? source.rap : {};
  return {
    transcripts, phrases,
    melody: { tuning: clamp(melodySource.tuning ?? 440, 400, 480), notes },
    rap: {
      scheme: ['AABB', 'ABAB', 'AAAA', 'FREE'].includes(rapSource.scheme) ? rapSource.scheme : 'AABB',
      bars: Array.from({ length: RAP_BAR_COUNT }, (_, index) => String(rapSource.bars?.[index] || '').slice(0, 500))
    }
  };
}

export const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
export function normaliseRegion(start, end, duration, changed = 'start') {
  const total = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const gap = Math.min(.05, total);
  let a = clamp(start, 0, Math.max(0, total-gap));
  let b = clamp(end, gap, total);
  if (b-a < gap-1e-9) {
    if (changed === 'end') a = Math.max(0, b-gap);
    else b = Math.min(total, a+gap);
  }
  return {start:a,end:b};
}

export class CaptureSession {
  constructor() { this.version=0; this.phase='idle'; this.target=null; this.take=null; }
  begin(target) {
    if (!Number.isInteger(target) || target<0 || target>=16 || this.phase!=='idle') return null;
    this.version++; this.target=target; this.take=null; this.phase='ready'; return this.version;
  }
  current(token) { return token===this.version && this.phase!=='idle'; }
  start(token) { if(!this.current(token) || this.phase!=='ready')return false; this.phase='recording'; return true; }
  review(token,take) { if(!this.current(token) || this.phase!=='recording' || !take)return false; this.take=take;this.phase='review';return true; }
  retake(token) { if(!this.current(token) || this.phase!=='review')return false;this.take=null;this.phase='ready';return true; }
  keep(token) { if(!this.current(token) || this.phase!=='review')return null;const result={target:this.target,take:this.take};this.cancel();return result; }
  cancel() { this.version++;this.phase='idle';this.target=null;this.take=null; }
}

export function isPadAudible(pads,id){
  const pad=pads[id];
  return Boolean(pad)&&!pad.muted&&(!pads.some(item=>item.solo)||pad.solo);
}
export const makePad = id => ({
  id, name: `Pad ${String(id + 1).padStart(2, '0')}`, fileName: '', kind: '',
  volume: 0.9, pitch: 0, speed: 1, start: 0, end: 2, muted:false, solo:false,
  steps: Array(STEP_COUNT).fill(false), stepOffsets: Array(STEP_COUNT).fill(0)
});
export const makeProject = () => ({
  version: 1, title: 'Untitled mixtape', layout: '3x4', bpm: 120,
  quantize: 'off', pads: Array.from({ length: 16 }, (_, i) => makePad(i)), scenes: [], voice: makeVoiceData()
});
export function normaliseProject(value) {
  const base = makeProject();
  const layout = PAD_COUNT[value?.layout] ? value.layout : base.layout;
  const pads = base.pads.map((pad, i) => {
    const source = value?.pads?.[i] || {};
    return { ...pad,
      name: String(source.name || pad.name).slice(0, 45),
      fileName: String(source.fileName || '').slice(0, 200),
      kind: ['audio','video','image'].includes(source.kind) ? source.kind : '',
      volume: clamp(source.volume ?? pad.volume, 0, 1.5),
      pitch: clamp(source.pitch ?? 0, -12, 12),
      speed: clamp(source.speed ?? 1, 0.5, 2),
      start: clamp(source.start ?? 0, 0, 3599.99),
      end: clamp(source.end ?? 2, 0.01, 3600),
      muted: Boolean(source.muted), solo: Boolean(source.solo),
      steps: Array.from({ length: STEP_COUNT }, (_, j) => Boolean(source.steps?.[j])),
      stepOffsets: Array.from({ length: STEP_COUNT }, (_, j) => clamp(source.stepOffsets?.[j] ?? 0, 0, .9999))
    };
  });
  const scenes=Array.isArray(value?.scenes)?value.scenes.slice(0,MAX_SCENES).map((scene,index)=>({
    name:String(scene?.name||`Scene ${index+1}`).slice(0,32),
    pads:Array.from({length:16},(_,j)=>({
      steps:Array.from({length:STEP_COUNT},(_,k)=>Boolean(scene?.pads?.[j]?.steps?.[k])),
      stepOffsets:Array.from({length:STEP_COUNT},(_,k)=>clamp(scene?.pads?.[j]?.stepOffsets?.[k]??0,0,.9999))
    }))
  })):[];
  return { version: 1, title: String(value?.title || base.title).slice(0, 80), layout,
    bpm: clamp(value?.bpm ?? 120, 40, 240),
    quantize: ['off','1/4','1/8','1/16'].includes(value?.quantize) ? value.quantize : 'off', pads, scenes,
    voice: normaliseVoice(value?.voice) };
}

export const midiFrequency = (note, tuning = 440) => clamp(tuning, 400, 480) * 2 ** ((clamp(note, 24, 108) - 69) / 12);

export function estimateSyllables(text) {
  const words = String(text || '').toLowerCase().match(/[a-z]+/g) || [];
  return words.reduce((total, word) => {
    if (word.length <= 3) return total + 1;
    const normalized = /[^aeiouy]le$/.test(word) ? word : word.replace(/(?:e|ed|es)$/, '');
    const groups = normalized.match(/[aeiouy]+/g);
    return total + Math.max(1, groups?.length || 1);
  }, 0);
}

export function midiFile(notes, bpm = 120, tuning = 440) {
  const u16 = n => [n >> 8 & 255, n & 255], u32 = n => [n >>> 24 & 255, n >>> 16 & 255, n >>> 8 & 255, n & 255];
  const vlq = value => { let n = Math.max(0, Math.round(value)), out = [n & 127]; while ((n >>= 7)) out.unshift((n & 127) | 128); return out; };
  const tempo = Math.round(60000000 / clamp(bpm, 40, 240));
  const events = [[0, [255, 81, 3, tempo >> 16 & 255, tempo >> 8 & 255, tempo & 255]]];
  for (const note of notes.slice(0, MAX_MELODY_NOTES)) {
    const start = Math.round(clamp(note.step, 0, 255) * 120), end = start + Math.max(1, Math.round(clamp(note.duration, .125, 16) * 120));
    const pitch = clamp(Math.round(note.midi), 24, 108);
    events.push([start, [0x90, pitch, 96]], [end, [0x80, pitch, 0]]);
  }
  events.sort((a, b) => a[0] - b[0]);
  let previous = 0; const track = [];
  for (const [tick, bytes] of events) { track.push(...vlq(tick - previous), ...bytes); previous = tick; }
  track.push(0, 255, 47, 0);
  const header = [...[77, 84, 104, 100], ...u32(6), ...u16(0), ...u16(1), ...u16(480)];
  const body = [...[77, 84, 114, 107], ...u32(track.length), ...track];
  return new Blob([new Uint8Array([...header, ...body])], { type: 'audio/midi' });
}
export function nextQuantizedTime(now, epoch, bpm, division) {
  if (division === 'off') return now;
  const divisor = Number(division.split('/')[1]) / 4;
  const unit = 60 / clamp(bpm, 40, 240) / divisor;
  return epoch + Math.max(0, Math.ceil((now - epoch) / unit - 1e-7)) * unit;
}
export function captureStepPosition(seconds,bpm,quantize='nearest'){
  const stepDuration=60/clamp(bpm,40,240)/4;
  const position=Math.max(0,Number(seconds)||0)/stepDuration;
  const base=Math.floor(position);
  if(quantize==='off')return {step:base%STEP_COUNT,offset:position-base};
  return {step:Math.round(position)%STEP_COUNT,offset:0};
}
export function stepTriggerTime(stepTime,bpm,offset=0){
  return stepTime+clamp(offset,0,.9999)*(60/clamp(bpm,40,240)/4);
}
export function nextBarTime(now,epoch,bpm){
  const bar=60/clamp(bpm,40,240)*4;
  return epoch+Math.max(1,Math.ceil((now-epoch)/bar-1e-9))*bar;
}
export function findRecorderMime(isSupported = type => MediaRecorder.isTypeSupported(type)) {
  return ['video/mp4;codecs=avc1.42E01E,mp4a.40.2','video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm','video/mp4'].find(isSupported) || '';
}
export function findAudioRecorderMime(isSupported = type => MediaRecorder.isTypeSupported(type)) {
  return ['audio/mp4;codecs=mp4a.40.2','audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus'].find(isSupported) || '';
}
export const extensionForMime = mime => mime.startsWith('video/mp4') ? 'mp4' : 'webm';
export const extensionForAudioMime = mime => mime.startsWith('audio/mp4') ? 'm4a' : mime.startsWith('audio/ogg') ? 'ogg' : 'webm';
export const supportedMediaFile = file => file && /^(video|audio|image)\//.test(file.type);

export function suggestActiveRegion(levels, duration) {
  if (!Array.isArray(levels) || !levels.length || !Number.isFinite(duration) || duration <= 0) return {start:0,end:Math.max(.05,duration||.05)};
  const sorted=[...levels].sort((a,b)=>a-b);
  const floor=sorted[Math.floor((sorted.length-1)*.2)]||0;
  const gate=Math.max(.018,floor*2.5);
  const active=levels.map((level,index)=>level>=gate?index:-1).filter(index=>index>=0);
  if(!active.length)return {start:0,end:duration};
  const frame=duration/levels.length;
  return {start:Math.max(0,active[0]*frame-.08),end:Math.min(duration,(active.at(-1)+1)*frame+.12)};
}
