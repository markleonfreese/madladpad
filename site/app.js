import { HOTKEYS, PAD_COUNT, MAX_MEDIA_BYTES, makeProject, normaliseProject, normaliseRegion, clamp, supportedMediaFile, findRecorderMime, extensionForMime } from './core.js';
import { SamplerAudio } from './audio.js';
import { getValue, putValue, deleteValue, collectProjectMedia, blobAsDataUrl, dataUrlAsBlob } from './storage.js';
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
let saveTimer;
let toastTimer;
let drawing = false;
let previewUrl = null;
let previewDuration = 0;
let regionDraft = null;
let previewingRegion = false;
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
      if (!mediaFiles.has(id) && !audio.demoEnabled) $('media-input').click();
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
  syncRegionPreview();
}

function renderRegion() {
  const enabled = Boolean(regionDraft && previewDuration > 0);
  for (const id of ['region-start','region-end','region-start-range','region-end-range','region-play','region-apply','region-reset']) $(id).disabled = !enabled;
  if (!enabled) return;
  for (const id of ['region-start','region-end','region-start-range','region-end-range']) $(id).max = previewDuration;
  $('region-start').value = $('region-start-range').value = regionDraft.start;
  $('region-end').value = $('region-end-range').value = regionDraft.end;
  $('region-status').textContent = `Draft: ${regionDraft.start.toFixed(2)}–${regionDraft.end.toFixed(2)} s of ${previewDuration.toFixed(2)} s. Apply to save.`;
}

function syncRegionPreview() {
  const video = $('region-preview');
  video.pause(); previewingRegion=false;
  video.removeAttribute('src'); video.load();
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl=null; previewDuration=0; regionDraft=null;
  const file=mediaFiles.get(selected);
  video.hidden = !file || !/^(audio|video)\//.test(file.type);
  $('region-status').textContent=video.hidden?'Load an audio or video clip to select a region.':'Loading media duration…';
  renderRegion();
  if (!video.hidden) { previewUrl=URL.createObjectURL(file); video.src=previewUrl; video.load(); }
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
  syncRegionPreview();
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
  if (selected===id) syncRegionPreview();
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

async function openCamera() {
  try {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) throw new Error('Camera capture needs HTTPS and a supported browser.');
    cameraStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'},audio:true});
    $('camera-preview').srcObject=cameraStream;
    $('camera-status').textContent='Ready to record a two-second clip.';
    $('camera-dialog').showModal();
  } catch(error){ notify(`Camera unavailable: ${error.message}`); }
}

function closeCamera() {
  cameraStream?.getTracks().forEach(track=>track.stop());cameraStream=null;
  $('camera-preview').srcObject=null;
  $('camera-dialog').close();
}

async function captureCamera() {
  if(!cameraStream) return;
  const target=selected;
  $('camera-capture').disabled=true;
  const types=['video/mp4','video/webm;codecs=vp8,opus','video/webm'];
  const mime=types.find(type=>MediaRecorder.isTypeSupported(type));
  try {
    const recorder=new MediaRecorder(cameraStream,mime?{mimeType:mime}:undefined);
    const chunks=[];
    recorder.ondataavailable=event=>{if(event.data.size)chunks.push(event.data);};
    const complete=new Promise((resolve,reject)=>{
      recorder.onstop=resolve;
      recorder.onerror=event=>reject(event.error||new Error('Camera recorder failed'));
    });
    recorder.start(200);$('camera-status').textContent='Recording…';
    await new Promise(resolve=>setTimeout(resolve,2000));
    if(recorder.state!=='inactive')recorder.stop();
    await complete;
    const type=recorder.mimeType||mime||'video/webm';
    const file=new File(chunks,`capture-${Date.now()}.${extensionForMime(type)}`,{type});
    closeCamera();await placeFiles([file],target);
  } catch(error) {notify(error.message);closeCamera();}
  finally { $('camera-capture').disabled=false; }
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
  const preview=$('region-preview');
  preview.addEventListener('loadedmetadata',()=>{
    if (!Number.isFinite(preview.duration) || preview.duration<=0) { $('region-status').textContent='Duration unavailable; this clip cannot be previewed here.'; return; }
    previewDuration=preview.duration;
    regionDraft=normaliseRegion(project.pads[selected].start,project.pads[selected].end,previewDuration);
    renderRegion();
  });
  preview.addEventListener('error',()=>{previewDuration=0;regionDraft=null;renderRegion();$('region-status').textContent='Preview unavailable for this file in this browser.';});
  preview.addEventListener('timeupdate',()=>{if(previewingRegion && regionDraft && preview.currentTime>=regionDraft.end){preview.pause();previewingRegion=false;}});
  for(const [id,key] of [['region-start','start'],['region-end','end'],['region-start-range','start'],['region-end-range','end']]) {
    $(id).addEventListener('input',event=>{
      if(!regionDraft || event.target.value==='')return;
      regionDraft=normaliseRegion(key==='start'?Number(event.target.value):regionDraft.start,key==='end'?Number(event.target.value):regionDraft.end,previewDuration,key);
      previewingRegion=false;preview.pause();preview.currentTime=key==='start'?regionDraft.start:regionDraft.end;
      renderRegion();
    });
  }
  $('region-play').addEventListener('click',async()=>{
    if(!regionDraft)return;
    try {preview.pause();preview.currentTime=regionDraft.start;previewingRegion=true;await preview.play();}
    catch(error){previewingRegion=false;notify(`Preview unavailable: ${error.message}`);}
  });
  $('region-apply').addEventListener('click',()=>{
    if(!regionDraft)return;
    project.pads[selected].start=regionDraft.start;project.pads[selected].end=regionDraft.end;
    renderControls();queueSave();notify('Selection applied to this pad.');
  });
  $('region-reset').addEventListener('click',()=>{
    if(!previewDuration)return;
    preview.pause();previewingRegion=false;
    regionDraft=normaliseRegion(project.pads[selected].start,project.pads[selected].end,previewDuration);
    preview.currentTime=regionDraft.start;renderRegion();
  });
  $('layout-select').addEventListener('change',event=>{
    project.layout=event.target.value;
    if(selected>=PAD_COUNT[project.layout])selected=0;
    renderGrid();renderControls();renderSteps();syncRegionPreview();queueSave();
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
      if(key==='start' && pad.start>=pad.end)pad.end=pad.start+.05;
      if(key==='end' && pad.end<=pad.start)pad.start=Math.max(0,pad.end-.05);
      renderControls();queueSave();
    });
  }
  $('media-input').addEventListener('change',async event=>{await placeFiles([...event.target.files]);event.target.value='';});
  $('project-input').addEventListener('change',async event=>{if(event.target.files?.[0])await importPack(event.target.files[0]);event.target.value='';});
  $('add-file').addEventListener('click',()=>$('media-input').click());
  $('import-project-button').addEventListener('click',()=>$('project-input').click());
  $('export-button').addEventListener('click',exportPack);
  $('camera-button').addEventListener('click',openCamera);
  $('camera-capture').addEventListener('click',captureCamera);
  $('camera-close').addEventListener('click',closeCamera);
  $('camera-dialog').addEventListener('cancel',event=>{event.preventDefault();closeCamera();});
  $('clear-pad').addEventListener('click',async()=>{
    if(!mediaFiles.has(selected))return;
    if(!confirm('Remove this sample from local storage?'))return;
    audio.unload(selected);mediaFiles.delete(selected);durations.delete(selected);
    const original=makeProject().pads[selected];
    project.pads[selected]={...original,steps:project.pads[selected].steps};
    await deleteValue(`media:${selected}`);renderPad(selected);renderControls();syncRegionPreview();queueSave();
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
    if(event.repeat || event.metaKey || event.ctrlKey || event.altKey || ['INPUT','SELECT','TEXTAREA'].includes(document.activeElement?.tagName)) return;
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
