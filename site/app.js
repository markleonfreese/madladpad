import { HOTKEYS, PAD_COUNT, MAX_MEDIA_BYTES, makeProject, normaliseProject, clamp, supportedMediaFile, findRecorderMime, extensionForMime, CaptureSession, suggestActiveRegion } from './core.js';
import { SamplerAudio } from './audio.js';
import { getValue, putValue, deleteValue, collectProjectMedia, blobAsDataUrl, dataUrlAsBlob, saveCapturedPad } from './storage.js';
import { pickFromDrive, pickFromPhotos } from './google.js';

const $ = id => document.getElementById(id);
let project = makeProject();
let selected = 0;
let audio;
let transportTimer = null;
let nextStep = 0;
let nextStepTime = 0;
let recording = null;
let cameraStream = null;
const cameraSession = new CaptureSession();
let cameraRecorder = null;
let cameraTimer = null;
let cameraUrl = null;
let sourcePad = null;
let captureTargetResolve = null;
let captureTargetOrigin = null;
let fileTarget = null;
let cameraSaving = false;
let cameraRegion = {start:0,end:0};
let cameraMeterTimer = null;
let cameraMeterSource = null;
let saveTimer;
let toastTimer;
let drawing = false;
const durations = new Map();
const mediaFiles = new Map();
const pads = [];
const activeUntil = new Map();
const keys = new Set();

function notify(message) {
  const toast = $('toast');
  toast.textContent = String(message);
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 5000);
}

function queueSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => putValue('project', project).catch(error => notify(`Could not save project: ${error.message}`)), 300);
}

function buildGrid() {
  const grid = $('pad-grid');
  for (let id = 0; id < 16; id++) {
    const card = document.createElement('div');
    card.className = 'pad empty';
    card.dataset.id = id;
    const video = document.createElement('video');
    video.className = 'media';
    video.muted = true; video.playsInline = true; video.preload = 'metadata';
    video.setAttribute('playsinline','');
    const image = document.createElement('img');
    image.className = 'media'; image.alt = '';
    image.hidden = true;
    card.innerHTML = `<div class="pad-bg" aria-hidden="true">+</div>
      <button type="button" class="pad-hit" aria-label="Play or load pad ${id+1}"></button>
      <div class="pad-top"><span class="key-tag">${HOTKEYS[id]}</span><span class="pad-index">${String(id+1).padStart(2,'0')}</span></div>
      <div class="pad-bottom-line"><span class="pad-title"></span></div>
      <button type="button" class="edit-pad" aria-label="Edit pad ${id+1}">EDIT</button>`;
    card.prepend(video,image);
    card.querySelector('.pad-hit').addEventListener('click', () => {
      selectPad(id);
      if (!mediaFiles.has(id) && !audio.demoEnabled) { sourcePad=id; $('pad-source-title').textContent=`Add a sample to pad ${id+1}`; $('pad-source-dialog').showModal(); }
      else playPad(id);
    });
    card.querySelector('.edit-pad').addEventListener('click', () => selectPad(id));
    card.addEventListener('dragover', event => { event.preventDefault(); });
    card.addEventListener('drop', async event => {
      event.preventDefault(); selectPad(id);
      await placeFiles([...event.dataTransfer.files], id);
    });
    video.addEventListener('loadedmetadata', () => {
      const duration = video.duration;
      if (Number.isFinite(duration) && duration > 0) {
        durations.set(id,duration);
        if (selected===id) renderControls();
      }
    });
    pads.push({card,video,image});
    grid.append(card);
  }
}

function renderPad(id) {
  const config = project.pads[id];
  const {card,video,image} = pads[id];
  const hasMedia = mediaFiles.has(id);
  card.hidden = id >= PAD_COUNT[project.layout];
  card.classList.toggle('empty',!hasMedia);
  card.classList.toggle('selected',selected===id);
  card.classList.toggle('editable',hasMedia);
  card.classList.toggle('playing', (activeUntil.get(id)||0)>performance.now());
  card.querySelector('.pad-title').textContent = hasMedia ? config.name : (audio.demoEnabled ? 'DEMO '+String(id+1).padStart(2,'0') : 'ADD SAMPLE');
  card.querySelector('.pad-hit').setAttribute('aria-label',`${hasMedia || audio.demoEnabled ? 'Play' : 'Load'} ${config.name}`);
  video.hidden = config.kind !== 'video';
  image.hidden = config.kind !== 'image';
  if (config.kind === 'image' && hasMedia) image.src = audio.sources.get(id)?.url || '';
}

function renderGrid() {
  $('pad-grid').className = `pad-grid layout-${project.layout}`;
  for (let id=0;id<16;id++) renderPad(id);
}

function selectPad(id) {
  if (id >= PAD_COUNT[project.layout]) return;
  selected=id;
  renderGrid(); renderControls(); renderSteps();
}

function renderControls() {
  const config = project.pads[selected];
  $('selected-number').textContent = `PAD ${String(selected+1).padStart(2,'0')}`;
  $('selected-circle').textContent = String(selected+1).padStart(2,'0');
  $('pad-name').value = config.name;
  $('sample-info').textContent = mediaFiles.has(selected) ? `${config.fileName} · ${config.kind.toUpperCase()} · stored on this device` : 'No media loaded. Add a clip to get started.';
  $('volume').value = config.volume*100;
  $('pitch').value = config.pitch;
  const max = Math.max(2,durations.get(selected)||15);
  $('trim-start').max = max;
  $('trim-end').max = max;
  $('trim-start').value = config.start;
  $('trim-end').value = config.end;
  $('volume-out').textContent = `${Math.round(config.volume*100)}%`;
  $('pitch-out').textContent = `${config.pitch>0?'+':''}${config.pitch} st`;
  $('start-out').textContent = `${config.start.toFixed(2)} s`;
  $('end-out').textContent = `${config.end.toFixed(2)} s`;
}

function renderSteps() {
  const holder = $('steps');
  holder.replaceChildren();
  project.pads[selected].steps.forEach((enabled, i) => {
    const button = document.createElement('button');
    button.type = 'button'; button.className = `step${enabled?' on':''}`;
    button.textContent = String(i+1).padStart(2,'0');
    button.setAttribute('aria-label',`Step ${i+1} ${enabled?'on':'off'}`);
    button.setAttribute('aria-pressed',String(enabled));
    button.addEventListener('click', () => {
      project.pads[selected].steps[i] = !project.pads[selected].steps[i];
      renderSteps(); queueSave();
    });
    holder.append(button);
  });
}

function renderSession() {
  $('project-title').value = project.title;
  $('layout-select').value = project.layout;
  $('bpm-input').value = project.bpm;
  $('quantize-select').value = project.quantize;
  renderGrid(); renderControls(); renderSteps();
  audio.setTransport(project.bpm,project.quantize);
}

async function playPad(id, scheduledAt) {
  await audio.unlock();
  audio.setTransport(project.bpm,project.quantize);
  if (!audio.trigger(id,project.pads[id],flashPad,scheduledAt)) {
    notify('This pad is empty. Add a clip or switch on demo sounds.');
  }
}

function flashPad(id) {
  activeUntil.set(id,performance.now()+180);
  pads[id].card.classList.add('playing');
  setTimeout(() => { if ((activeUntil.get(id)||0) <= performance.now()) pads[id].card.classList.remove('playing'); },210);
}

async function addMedia(id,file,persist=true) {
  if (!supportedMediaFile(file)) throw new Error(`${file?.name || 'File'} is not an audio, video or image file`);
  if (file.size > MAX_MEDIA_BYTES) throw new Error(`${file.name} is over the 80 MB per-clip limit. Please trim it first.`);
  const config=project.pads[id];
  const kind=file.type.split('/')[0];
  const source=await audio.load(id,file,kind==='image'?null:pads[id].video);
  mediaFiles.set(id,file);
  config.kind=kind;
  config.fileName=file.name;
  config.name=file.name.replace(/\.[^/.]+$/,'').slice(0,45) || `Pad ${id+1}`;
  config.start=0;
  durations.delete(id);
  if (source.buffer) durations.set(id,source.buffer.duration);
  config.end=Math.max(.05,Math.min(2,durations.get(id)||2));
  if (persist) await putValue(`media:${id}`,file);
  renderPad(id);
  queueSave();
  if (selected===id) renderControls();
}

async function placeFiles(files,start=selected) {
  const accepted=files.filter(supportedMediaFile);
  if (!accepted.length) return notify('Select a video, audio clip or photo.');
  const last=Math.min(PAD_COUNT[project.layout],start+accepted.length);
  const destination=Array.from({length:last-start},(_,i)=>start+i);
  if (destination.some(id=>mediaFiles.has(id)) && !confirm('Replace existing samples in these pads?')) return;
  let loaded=0;
  for (let i=0;i<destination.length;i++) {
    try { await addMedia(destination[i],accepted[i]); loaded++; }
    catch(error) { notify(error.message); }
  }
  selectPad(start);
  notify(`${loaded} sample${loaded===1?'':'s'} added. Tap a pad to play.`);
}

function startSequencer() {
  if (transportTimer) return;
  audio.unlock().then(() => {
    audio.setTransport(project.bpm,'off');
    const secondsPerStep=60/project.bpm/4;
    audio.setEpoch(audio.context.currentTime+.08);
    nextStepTime=audio.transportEpoch;
    nextStep=0;
    const tick=() => {
      while (nextStepTime<audio.context.currentTime+.12) {
        const time=nextStepTime;
        const step=nextStep%16;
        project.pads.slice(0,PAD_COUNT[project.layout]).forEach(pad => {
          if (pad.steps[step]) audio.trigger(pad.id,pad,flashPad,time);
        });
        setTimeout(()=>updateBeatIndicator(step),Math.max(0,(time-audio.context.currentTime)*1000));
        nextStep++;
        nextStepTime+=secondsPerStep;
      }
    };
    transportTimer=setInterval(tick,25);
    tick();
    $('play-seq').textContent='■ STOP'; $('play-seq').classList.add('active');
  }).catch(error=>notify(error.message));
}

function updateBeatIndicator(step) {
  if (!transportTimer) return;
  [...$('steps').children].forEach((el,i)=>el.classList.toggle('current',i===step));
}

function stopSequencer() {
  clearInterval(transportTimer); transportTimer=null;
  $('play-seq').textContent='▶ PLAY'; $('play-seq').classList.remove('active');
  [...$('steps').children].forEach(el=>el.classList.remove('current'));
}

function surpriseBeat() {
  const count=PAD_COUNT[project.layout];
  if (!count) return;
  const a=project.pads.slice(0,count);
  for (const pad of a) pad.steps.fill(false);
  const kick=a[0], snare=a[1]||a[0], hat=a[2]||a[0];
  for (const step of [0,8,Math.random()>.5?6:10]) kick.steps[step]=true;
  for (const step of [4,12]) snare.steps[step]=true;
  for (let step=0;step<16;step+=2) if (Math.random()>.16) hat.steps[step]=true;
  for (const pad of a.slice(3)) if (Math.random()<.35) pad.steps[Math.floor(Math.random()*16)]=true;
  renderSteps();queueSave();
  notify('New beat created. Load clips into the first three pads or enable demo sounds.');
}

function drawPerformanceFrame() {
  if (!drawing) return;
  const canvas=$('capture-canvas');
  const context=canvas.getContext('2d');
  const total=PAD_COUNT[project.layout],cols=project.layout==='2x2'?2:4;
  const rows=Math.ceil(total/cols),gap=12,margin=28;
  const width=(canvas.width-margin*2-(cols-1)*gap)/cols;
  const height=(canvas.height-margin*2-(rows-1)*gap)/rows;
  context.fillStyle='#0c100e';context.fillRect(0,0,canvas.width,canvas.height);
  for(let id=0;id<total;id++) {
    const col=id%cols,row=Math.floor(id/cols),x=margin+col*(width+gap),y=margin+row*(height+gap);
    const source=pads[id],config=project.pads[id];
    context.fillStyle=(activeUntil.get(id)||0)>performance.now()?'#d7fc5a':'#26372c';
    context.fillRect(x-3,y-3,width+6,height+6);
    context.fillStyle='#172219';context.fillRect(x,y,width,height);
    try {
      if(config.kind==='video' && source.video.readyState>=2) context.drawImage(source.video,x,y,width,height);
      if(config.kind==='image' && source.image.complete && source.image.naturalWidth) context.drawImage(source.image,x,y,width,height);
    } catch { /* A frame may not be ready yet; preserve the previous capture. */ }
    context.fillStyle='#0d150fcc'; context.fillRect(x,y+height-27,width,27);
    context.fillStyle='#f0f6e8'; context.font='bold 17px sans-serif';
    context.fillText(config.name.slice(0,21),x+10,y+height-8);
  }
  requestAnimationFrame(drawPerformanceFrame);
}

function download(blob,name) {
  const url=URL.createObjectURL(blob);
  const link=document.createElement('a');link.href=url;link.download=name;link.click();
  setTimeout(()=>URL.revokeObjectURL(url),60000);
}

async function toggleSetRecording() {
  if (recording) { if(recording.state!=='inactive')recording.stop(); return; }
  if (!window.MediaRecorder || !$('capture-canvas').captureStream) return notify('Video recording is unavailable in this browser.');
  try {
    await audio.unlock();
    const mime=findRecorderMime();
    const frames=$('capture-canvas').captureStream(30);
    const stream=new MediaStream([...frames.getVideoTracks(),...audio.recordOut.stream.getAudioTracks()]);
    const recorder=new MediaRecorder(stream,mime?{mimeType:mime}:undefined);
    const chunks=[];
    recorder.ondataavailable=event=>{ if(event.data.size)chunks.push(event.data); };
    recorder.onerror=event=>notify(`Recording failed: ${event.error?.message||'unknown error'}`);
    recorder.onstop=()=>{
      drawing=false;
      stream.getVideoTracks().forEach(track=>track.stop());
      const type=recorder.mimeType||mime||'video/webm';
      const blob=new Blob(chunks,{type});
      if(blob.size)download(blob,`madladpad-${Date.now()}.${extensionForMime(type)}`);
      else notify('The browser did not capture video.');
      recording=null;
      $('start-record').classList.remove('recording');$('start-record').innerHTML='<span class="record-dot"></span> RECORD SET';
      $('start-record').setAttribute('aria-pressed','false');
    };
    recording=recorder;drawing=true;drawPerformanceFrame();recorder.start(200);
    $('start-record').classList.add('recording');$('start-record').textContent='■ STOP RECORDING';
    $('start-record').setAttribute('aria-pressed','true');
    notify('Recording your audiovisual performance. Tap pads or start the beat maker.');
  } catch(error) { drawing=false;recording=null;notify(error.message); }
}

function cameraReady() {
  const video=$('camera-preview');
  if(cameraUrl){URL.revokeObjectURL(cameraUrl);cameraUrl=null;}
  video.removeAttribute('src');video.srcObject=cameraStream;video.muted=true;video.controls=false;video.autoplay=true;
  video.play().catch(()=>{});
  $('camera-capture').hidden=false;$('camera-capture').disabled=!cameraStream;
  $('camera-retake').hidden=true;$('camera-keep').hidden=true;
  $('camera-status').textContent='Camera and microphone active. Start when ready.';
  $('camera-length-label').hidden=false;$('camera-review').hidden=true;
  $('camera-capture').textContent='● START RECORDING';
}

function finishCaptureTarget(target){
  if(!captureTargetResolve)return;
  const resolve=captureTargetResolve;
  captureTargetResolve=null;captureTargetOrigin=null;
  if($('capture-target-dialog').open)$('capture-target-dialog').close();
  resolve(target);
}

function chooseCaptureTarget(target){
  if(!mediaFiles.has(target))return Promise.resolve(target);
  const select=$('capture-target-select'),empty=project.pads.slice(0,PAD_COUNT[project.layout]).filter(pad=>pad.id!==target&&!mediaFiles.has(pad.id));
  select.replaceChildren(...empty.map(pad=>{const option=document.createElement('option');option.value=String(pad.id);option.textContent=`Pad ${String(pad.id+1).padStart(2,'0')} · ${pad.name}`;return option;}));
  $('capture-target-status').textContent=empty.length?'The old sample stays safe until you keep the new take.':'All visible pads are occupied. Change to a layout with an empty pad or cancel.';
  $('capture-target-new').disabled=!empty.length;
  captureTargetOrigin=target;
  $('capture-target-dialog').showModal();
  return new Promise(resolve=>{captureTargetResolve=resolve;});
}

async function openCamera(target=selected) {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return notify('Camera capture needs HTTPS and a supported browser.');
  const destination=await chooseCaptureTarget(target);
  if(destination===null)return;
  const token=cameraSession.begin(destination);
  if(token===null)return;
  $('camera-title').textContent=`Record on pad ${destination+1}`;
  $('camera-status').textContent='Requesting camera and microphone access…';
  $('camera-capture').disabled=true;$('camera-capture').hidden=false;
  $('camera-retake').hidden=true;$('camera-keep').hidden=true;
  $('camera-dialog').showModal();
  try {
    const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'},audio:true});
    if(!cameraSession.current(token)){stream.getTracks().forEach(track=>track.stop());return;}
    if(!stream.getVideoTracks().length || !stream.getAudioTracks().length){stream.getTracks().forEach(track=>track.stop());throw new Error('Both camera and microphone are required.');}
    cameraStream=stream;cameraReady();
  } catch(error) {if(cameraSession.current(token)){closeCamera();notify(`Camera unavailable: ${error.message}`);}}
}

function closeCamera() {
  cameraSession.cancel();
  clearTimeout(cameraTimer);cameraTimer=null;
  clearInterval(cameraMeterTimer);cameraMeterTimer=null;cameraMeterSource?.disconnect();cameraMeterSource=null;
  if(cameraRecorder && cameraRecorder.state!=='inactive')cameraRecorder.stop();
  cameraRecorder=null;
  cameraStream?.getTracks().forEach(track=>track.stop());cameraStream=null;
  const video=$('camera-preview');video.pause();video.srcObject=null;video.removeAttribute('src');video.load();
  if(cameraUrl){URL.revokeObjectURL(cameraUrl);cameraUrl=null;}
  cameraRegion={start:0,end:0};
  if($('camera-dialog').open)$('camera-dialog').close();
}

async function captureCamera() {
  if(cameraRecorder){if(cameraRecorder.state!=='inactive')cameraRecorder.stop();return;}
  const token=cameraSession.version;
  if(!cameraStream || !cameraSession.start(token))return;
  $('camera-capture').disabled=true;
  try {
    await audio.unlock();
    const mime=findRecorderMime();
    const recorder=new MediaRecorder(cameraStream,mime?{mimeType:mime}:undefined);
    cameraRecorder=recorder;
    const chunks=[],levels=[];
    recorder.ondataavailable=event=>{if(event.data.size)chunks.push(event.data);};
    recorder.onerror=event=>{if(cameraSession.current(token)){closeCamera();notify(`Recording failed: ${event.error?.message||'unknown error'}`);}};
    try {const analyser=audio.context.createAnalyser();analyser.fftSize=1024;cameraMeterSource=audio.context.createMediaStreamSource(cameraStream);cameraMeterSource.connect(analyser);const samples=new Float32Array(analyser.fftSize);cameraMeterTimer=setInterval(()=>{analyser.getFloatTimeDomainData(samples);let sum=0;for(const sample of samples)sum+=sample*sample;levels.push(Math.sqrt(sum/samples.length));},50);} catch { /* The full clip remains available when live metering is unsupported. */ }
    recorder.onstop=()=>{
      if(!cameraSession.current(token))return;
      if(cameraRecorder===recorder)cameraRecorder=null;clearInterval(cameraMeterTimer);cameraMeterTimer=null;cameraMeterSource?.disconnect();cameraMeterSource=null;clearTimeout(cameraTimer);cameraTimer=null;
      const type=recorder.mimeType||mime||'';
      if(!chunks.length || !/^video\/(mp4|webm)(;|$)/i.test(type)){closeCamera();notify('This browser did not provide a supported recording format.');return;}
      try {
        const file=new File(chunks,`capture-${Date.now()}.${extensionForMime(type)}`,{type});
        if(file.size>MAX_MEDIA_BYTES)throw new Error('Recording exceeds the 80 MB per-clip limit. Choose a shorter recording length.');
        if(!file.size || !cameraSession.review(token,file))throw new Error('No recording was captured.');
        cameraStream?.getTracks().forEach(track=>track.stop());cameraStream=null;
        const video=$('camera-preview');video.pause();video.srcObject=null;video.autoplay=false;cameraUrl=URL.createObjectURL(file);video.src=cameraUrl;video.muted=false;video.controls=true;video.load();
        const setReviewRegion=()=>{if(!cameraSession.current(token)||cameraSession.phase!=='review'||cameraRegion.end>0)return;const duration=Number.isFinite(video.duration)&&video.duration>0?video.duration:Number($('camera-length').value);cameraRegion=suggestActiveRegion(levels,duration);$('camera-start').max=Math.max(0,duration-.05);$('camera-start').value=Math.min(cameraRegion.start,Number($('camera-start').max));$('camera-end').max=duration;$('camera-end').value=cameraRegion.end;updateCameraRegion();$('camera-keep').disabled=false;};
        $('camera-keep').disabled=true;video.addEventListener('loadedmetadata',setReviewRegion,{once:true});setTimeout(setReviewRegion,1200);
        $('camera-capture').hidden=true;$('camera-retake').hidden=false;$('camera-keep').hidden=false;
        $('camera-length-label').hidden=true;$('camera-review').hidden=false;$('camera-status').textContent='Camera and microphone stopped. Suggested trim surrounds the detected sound; adjust, preview or keep.';
      } catch(error){closeCamera();notify(`Could not review take: ${error.message}`);}
    };
    recorder.start(200);$('camera-length-label').hidden=true;$('camera-capture').disabled=false;$('camera-capture').textContent='■ STOP RECORDING';$('camera-status').textContent='Recording… tap Stop when ready.';
    cameraTimer=setTimeout(()=>{if(recorder.state!=='inactive')recorder.stop();},(Number($('camera-length').value)||5)*1000);
  } catch(error){cameraRecorder=null;closeCamera();notify(`Recording failed: ${error.message}`);}
}

function updateCameraRegion(){
  cameraRegion.start=Number($('camera-start').value);cameraRegion.end=Number($('camera-end').value);
  if(cameraRegion.start>=cameraRegion.end)cameraRegion.end=Math.min(Number($('camera-end').max),cameraRegion.start+.05);
  $('camera-end').value=cameraRegion.end;$('camera-start-out').textContent=`${cameraRegion.start.toFixed(2)} s`;$('camera-end-out').textContent=`${cameraRegion.end.toFixed(2)} s`;
}

async function previewCameraRegion(){
  const video=$('camera-preview');updateCameraRegion();video.currentTime=cameraRegion.start;await video.play().catch(()=>{});
  const stopAtEnd=()=>{if(video.currentTime>=cameraRegion.end){video.pause();video.removeEventListener('timeupdate',stopAtEnd);}};video.addEventListener('timeupdate',stopAtEnd);
}

async function retakeCamera(){
  const token=cameraSession.version;
  if(!cameraSession.retake(token))return;
  cameraRegion={start:0,end:0};
  if(cameraUrl){URL.revokeObjectURL(cameraUrl);cameraUrl=null;}
  $('camera-review').hidden=true;$('camera-length-label').hidden=false;$('camera-capture').textContent='● START RECORDING';
  $('camera-retake').disabled=true;$('camera-keep').disabled=true;$('camera-status').textContent='Requesting camera and microphone access for a new take…';
  try {
    const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'},audio:true});
    if(!cameraSession.current(token)){stream.getTracks().forEach(track=>track.stop());return;}
    if(!stream.getVideoTracks().length||!stream.getAudioTracks().length){stream.getTracks().forEach(track=>track.stop());throw new Error('Both camera and microphone are required.');}
    cameraStream=stream;cameraReady();
  } catch(error){if(cameraSession.current(token)){closeCamera();notify(`Retake unavailable: ${error.message}`);}}
  finally {$('camera-retake').disabled=false;$('camera-keep').disabled=false;}
}

async function keepCameraTake() {
  const token=cameraSession.version;
  if(cameraSession.phase!=='review')return;
  const target=cameraSession.target,take=cameraSession.take;
  cameraSaving=true;
  $('camera-keep').disabled=true;$('camera-retake').disabled=true;$('camera-close').disabled=true;
  try {
    const next=JSON.parse(JSON.stringify(project));
    const pad=next.pads[target];
    if(cameraRegion.end-cameraRegion.start<.05)throw new Error('Choose a sample at least 0.05 seconds long.');
    pad.kind='video';pad.fileName=take.name;pad.name=take.name.replace(/\.[^/.]+$/,'').slice(0,45)||`Pad ${target+1}`;pad.start=cameraRegion.start;pad.end=cameraRegion.end;
    clearTimeout(saveTimer);
    try {await saveCapturedPad(target,take,next);} catch(error){queueSave();throw error;}
    project=next;
    let loadError=null;
    try {pads[target].video.controls=false;await audio.load(target,take,pads[target].video);mediaFiles.set(target,take);durations.delete(target);}
    catch(error){loadError=error;}
    cameraSession.keep(token);closeCamera();selectPad(target);
    notify(loadError?'Take saved locally, but could not load. Reload to retry.':'Take saved on this device.');
  } catch(error){notify(`Could not save take: ${error.message}`);}
  finally {cameraSaving=false;$('camera-keep').disabled=false;$('camera-retake').disabled=false;$('camera-close').disabled=false;}
}

async function exportPack() {
  try {
    const media=await collectProjectMedia();
    const bytes=media.reduce((sum,blob)=>sum+(blob?.size||0),0);
    if(bytes>MAX_MEDIA_BYTES) throw new Error('This pack exceeds 80 MB. Save smaller clips before exporting.');
    notify('Preparing a portable project with its media…');
    const contents=[];
    for(const blob of media) contents.push(blob?await blobAsDataUrl(blob):null);
    const pack={format:'madladpad',version:1,project,media:contents};
    download(new Blob([JSON.stringify(pack)],{type:'application/json'}),`${project.title.replace(/[^a-z0-9-]+/gi,'-').toLowerCase()||'session'}.madladpad`);
    notify('Project pack downloaded. It contains your media, so share it thoughtfully.');
  } catch(error) {notify(`Export failed: ${error.message}`);}
}

async function importPack(file) {
  if(file.size>MAX_MEDIA_BYTES*1.5) return notify('Pack is over the 120 MB import limit.');
  try {
    const raw=JSON.parse(await file.text());
    if(raw.format!=='madladpad' || raw.version!==1 || !Array.isArray(raw.media)||raw.media.length!==16) throw new Error('Unsupported project format');
    const incoming=normaliseProject(raw.project);
    const blobs=raw.media.map(data=>data ? dataUrlAsBlob(data):null);
    if(blobs.some(blob=>blob && blob.size>MAX_MEDIA_BYTES)) throw new Error('A sample is larger than the 80 MB limit');
    if(!confirm('Replace your current local project? Export it first if you want a backup.')) return;
    stopSequencer();
    for(let i=0;i<16;i++) {
      audio.unload(i);mediaFiles.delete(i);durations.delete(i);
      if(blobs[i]) {
        const blob=blobs[i];
        const name=incoming.pads[i].fileName||`sample-${i+1}`;
        const restored=new File([blob],name,{type:blob.type});
        await putValue(`media:${i}`,restored);
        const source=await audio.load(i,restored,blob.type.startsWith('image/')?null:pads[i].video);
        mediaFiles.set(i,restored);
        if(source.buffer)durations.set(i,source.buffer.duration);
      } else await deleteValue(`media:${i}`);
    }
    project=incoming;selected=0;
    renderSession();await putValue('project',project);
    notify('Project restored with its media.');
  } catch(error){notify(`Import failed: ${error.message}`);}
}

function bindControls() {
  $('layout-select').addEventListener('change',event=>{
    project.layout=event.target.value;
    if(selected>=PAD_COUNT[project.layout])selected=0;
    renderGrid();renderControls();renderSteps();queueSave();
  });
  $('bpm-input').addEventListener('change',event=>{
    project.bpm=clamp(event.target.value,40,240);event.target.value=project.bpm;
    audio.setTransport(project.bpm,project.quantize);if(transportTimer){stopSequencer();startSequencer();}queueSave();
  });
  $('quantize-select').addEventListener('change',event=>{project.quantize=event.target.value;audio.setTransport(project.bpm,project.quantize);queueSave();});
  $('project-title').addEventListener('input',event=>{project.title=event.target.value;queueSave();});
  $('pad-name').addEventListener('input',event=>{project.pads[selected].name=event.target.value;renderPad(selected);queueSave();});
  for(const [id,key,convert] of [['volume','volume',v=>v/100],['pitch','pitch',Number],['trim-start','start',Number],['trim-end','end',Number]]) {
    $(id).addEventListener('input',event=>{
      const pad=project.pads[selected];pad[key]=convert(Number(event.target.value));
      if(key==='start' && pad.start>=pad.end)pad.end=Math.min(3600,pad.start+.05);
      if(key==='end' && pad.end<=pad.start)pad.start=Math.max(0,pad.end-.05);
      renderControls();queueSave();
    });
  }
  $('media-input').addEventListener('change',async event=>{const target=fileTarget??selected;fileTarget=null;await placeFiles([...event.target.files],target);event.target.value='';});
  $('project-input').addEventListener('change',async event=>{if(event.target.files?.[0])await importPack(event.target.files[0]);event.target.value='';});
  $('add-file').addEventListener('click',()=>{fileTarget=selected;$('media-input').click();});
  $('import-project-button').addEventListener('click',()=>$('project-input').click());
  $('export-button').addEventListener('click',exportPack);
  $('camera-button').addEventListener('click',()=>openCamera(selected));
  $('pad-record').addEventListener('click',()=>{const target=sourcePad;$('pad-source-dialog').close();if(target!==null)openCamera(target);});
  $('pad-files').addEventListener('click',()=>{fileTarget=sourcePad;$('pad-source-dialog').close();$('media-input').click();});
  $('pad-source-cancel').addEventListener('click',()=>$('pad-source-dialog').close());
  $('capture-target-replace').addEventListener('click',()=>finishCaptureTarget(captureTargetOrigin));
  $('capture-target-new').addEventListener('click',()=>finishCaptureTarget(Number($('capture-target-select').value)));
  $('capture-target-cancel').addEventListener('click',()=>finishCaptureTarget(null));
  $('capture-target-dialog').addEventListener('cancel',event=>{event.preventDefault();finishCaptureTarget(null);});
  $('camera-capture').addEventListener('click',captureCamera);
  $('camera-start').addEventListener('input',updateCameraRegion);$('camera-end').addEventListener('input',updateCameraRegion);
  $('camera-preview-region').addEventListener('click',previewCameraRegion);
  $('camera-retake').addEventListener('click',retakeCamera);
  $('camera-keep').addEventListener('click',keepCameraTake);
  $('camera-close').addEventListener('click',closeCamera);
  $('camera-dialog').addEventListener('cancel',event=>{event.preventDefault();if(!cameraSaving)closeCamera();});
  $('clear-pad').addEventListener('click',async()=>{
    if(!mediaFiles.has(selected))return;
    if(!confirm('Remove this sample from local storage?'))return;
    audio.unload(selected);mediaFiles.delete(selected);durations.delete(selected);
    const original=makeProject().pads[selected];
    project.pads[selected]={...original,steps:project.pads[selected].steps};
    await deleteValue(`media:${selected}`);renderPad(selected);renderControls();queueSave();
  });
  $('demo-button').addEventListener('click',()=>{
    audio.demoEnabled=!audio.demoEnabled;
    $('demo-button').classList.toggle('active',audio.demoEnabled);
    $('demo-button').setAttribute('aria-pressed',String(audio.demoEnabled));
    renderGrid();notify(audio.demoEnabled?'Demo synth sounds enabled on empty pads.':'Demo sounds off.');
  });
  $('play-seq').addEventListener('click',()=>transportTimer?stopSequencer():startSequencer());
  $('auto-beat').addEventListener('click',surpriseBeat);
  $('clear-steps').addEventListener('click',()=>{project.pads[selected].steps.fill(false);renderSteps();queueSave();});
  $('start-record').addEventListener('click',toggleSetRecording);
  $('google-drive').addEventListener('click',()=>pickFromDrive(files=>placeFiles(files)).catch(error=>notify(error.message)));
  $('google-photos').addEventListener('click',()=>pickFromPhotos(files=>placeFiles(files),notify).catch(error=>notify(error.message)));
  window.addEventListener('madladpad-error',event=>notify(event.detail));
  document.addEventListener('keydown',event=>{
    if(event.repeat || event.metaKey || event.ctrlKey || event.altKey || $('camera-dialog').open || $('pad-source-dialog').open || $('capture-target-dialog').open || ['INPUT','SELECT','TEXTAREA'].includes(document.activeElement?.tagName)) return;
    const key=event.key.toUpperCase();
    if(key===' '){event.preventDefault();transportTimer?stopSequencer():startSequencer();return;}
    const id=HOTKEYS.indexOf(key);
    if(id>=0 && id<PAD_COUNT[project.layout]){event.preventDefault();playPad(id);keys.add(key);}
  });
  document.addEventListener('keyup',event=>keys.delete(event.key.toUpperCase()));
  $('connect-midi').addEventListener('click',async()=>{
    if(!navigator.requestMIDIAccess)return notify('Web MIDI is not supported by this browser. Touch and keyboard are ready.');
    try {
      const midi=await navigator.requestMIDIAccess();
      const bind=input=>input.onmidimessage=event=>{
        const [status,note,velocity]=event.data;
        if((status&0xf0)===0x90 && velocity>0 && note>=36 && note<36+PAD_COUNT[project.layout])playPad(note-36);
      };
      for(const input of midi.inputs.values())bind(input);
      midi.onstatechange=()=>{for(const input of midi.inputs.values())bind(input);};
      notify('MIDI connected. Note On 36–51 maps to pads 1–16.');
    } catch(error){notify(`MIDI access failed: ${error.message}`);}
  });
}

async function initialise() {
  try {
    audio=new SamplerAudio();
    buildGrid();bindControls();
    const saved=await getValue('project');
    if(saved)project=normaliseProject(saved);
    renderSession();
    let restored=0;
    for(let id=0;id<16;id++) {
      const file=await getValue(`media:${id}`);
      if(!file)continue;
      try {
        const source=await audio.load(id,file,file.type.startsWith('image/')?null:pads[id].video);
        mediaFiles.set(id,file);
        if(source.buffer)durations.set(id,source.buffer.duration);
        restored++;
      } catch(error){console.warn(`Failed to restore pad ${id+1}`,error);}
    }
    renderSession();
    if(restored)notify(`Restored ${restored} locally saved samples.`);
    if('serviceWorker' in navigator && (location.protocol==='https:'||location.hostname==='localhost'))navigator.serviceWorker.register('/sw.js').catch(()=>{});
    $('connection-indicator').textContent=navigator.onLine?'LOCAL STUDIO':'OFFLINE READY';
  } catch(error){notify(`Studio startup error: ${error.message}`);console.error(error);}
}

initialise();
