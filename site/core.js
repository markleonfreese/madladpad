export const HOTKEYS = 'QWERASDFZXCVTYUI'.split('');
export const PAD_COUNT = { '2x2': 4, '3x4': 12, '4x4': 16 };
export const STEP_COUNT = 16;
export const MAX_SCENES = 8;
export const MAX_MEDIA_BYTES = 80 * 1024 * 1024;

export const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
export function isPadAudible(pads,id){
  const pad=pads[id];
  return Boolean(pad)&&!pad.muted&&(!pads.some(item=>item.solo)||pad.solo);
}
export const makePad = id => ({
  id, name: `Pad ${String(id + 1).padStart(2, '0')}`, fileName: '', kind: '',
  volume: 0.9, pitch: 0, start: 0, end: 2, muted:false, solo:false,
  steps: Array(STEP_COUNT).fill(false), stepOffsets: Array(STEP_COUNT).fill(0)
});
export const makeProject = () => ({
  version: 1, title: 'Untitled mixtape', layout: '3x4', bpm: 120,
  quantize: 'off', pads: Array.from({ length: 16 }, (_, i) => makePad(i)), scenes: []
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
      start: clamp(source.start ?? 0, 0, 3600),
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
    quantize: ['off','1/4','1/8','1/16'].includes(value?.quantize) ? value.quantize : 'off', pads, scenes };
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
export const extensionForMime = mime => mime.startsWith('video/mp4') ? 'mp4' : 'webm';
export const supportedMediaFile = file => file && /^(video|audio|image)\//.test(file.type);
