import { HOTKEYS, PAD_COUNT, MAX_MEDIA_BYTES, MAX_SCENES, makeProject, normaliseProject, normaliseRegion, clamp, supportedMediaFile, findRecorderMime, extensionForMime, findAudioRecorderMime, extensionForAudioMime, CaptureSession, suggestActiveRegion, isPadAudible, captureStepPosition, stepTriggerTime, nextBarTime } from './core.js';
import { SamplerAudio } from './audio.js';
import { getValue, putValue, deleteValue, collectProjectMedia, blobAsDataUrl, dataUrlAsBlob, replaceProjectMedia, saveCapturedPad } from './storage.js';
import { pickFromDrive, pickFromPhotos } from './google.js';
import { initVoiceLab } from './voice.js';

const $ = id => document.getElementById(id);
let project = makeProject();
let selected = 0;
let trackGridVisible = false;
let audio;
let transportTimer = null;
let nextStep = 0;
let nextStepTime = 0;
let recording = null;
let patternRecording = null;
let patternUndoSnapshot = null;
let pendingScene = null;
let selectedSceneIndex = -1;
let audioRecording = null;
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
let previewUrl = null;
let previewDuration = 0;
let regionDraft = null;
let previewingRegion = false;
let onsetWorker = null;
let onsetRun = 0;
const durations = new Map();
const mediaFiles = new Map();
const pads = [];
const activeUntil = new Map();
const visualUntil = new Map();
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
  cancelOnsetAnalysis(false);
  const video = $('region-preview');
  video.pause(); previewingRegion=false;
  video.removeAttribute('src'); video.load();
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl=null; previewDuration=0; regionDraft=null;
  const file=mediaFiles.get(selected);
  video.hidden = !file || !/^(audio|video)\//.test(file.type);
  $('region-status').textContent=video.hidden?'Load an audio or video clip to select a region.':'Loading media duration…';
  $('find-samples').disabled=video.hidden;$('analysis-status').textContent='Suggestions are opt-in and processed locally.';$('sample-suggestions').replaceChildren();
  renderRegion();
  if (!video.hidden) { previewUrl=URL.createObjectURL(file); video.src=previewUrl; video.load(); }
}

function cancelOnsetAnalysis(updateStatus=true){
  onsetRun++;onsetWorker?.terminate();onsetWorker=null;
  if($('cancel-analysis'))$('cancel-analysis').hidden=true;
  if($('find-samples'))$('find-samples').disabled=!mediaFiles.has(selected);
  if(updateStatus&&$('analysis-status'))$('analysis-status').textContent='Analysis canceled. Manual region selection is still available.';
}

function showOnsetSuggestions(suggestions,token){
  if(token!==onsetRun)return;
  onsetWorker?.terminate();onsetWorker=null;$('cancel-analysis').hidden=true;
  const list=$('sample-suggestions');list.replaceChildren();
  if(!suggestions.length){$('analysis-status').textContent='No clear transients found. Keep choosing a region manually.';return;}
  suggestions.forEach((candidate,index)=>{
    const button=document.createElement('button');button.type='button';button.className='suggestion';button.textContent=`Candidate ${index+1} · ${candidate.start.toFixed(2)}–${candidate.end.toFixed(2)} s · onset score ${candidate.score.toFixed(2)}`;
    button.addEventListener('click',()=>{regionDraft=normaliseRegion(candidate.start,candidate.end,previewDuration);$('region-preview').pause();previewingRegion=false;$('region-preview').currentTime=regionDraft.start;renderRegion();$('analysis-status').textContent='Heuristic suggestion selected. Preview, adjust, apply or ignore it.';});list.append(button);
  });
  $('analysis-status').textContent='Local heuristic candidates. Scores rank transients; they do not judge musical quality.';
}

async function findGoodSounds(){
  const token=++onsetRun,file=mediaFiles.get(selected);
  onsetWorker?.terminate();onsetWorker=null;$('sample-suggestions').replaceChildren();
  if(!file||!file.type.match(/^(audio|video)\//))return $('analysis-status').textContent='Choose a local audio or video sample first.';
  if(!previewDuration)return $('analysis-status').textContent='Wait for the media duration to load before starting analysis.';
  if(file.size>32*1024*1024)return $('analysis-status').textContent='This file exceeds the 32 MB phone-analysis budget. Manual selection still works.';
  if(previewDuration>120)return $('analysis-status').textContent='Analysis is limited to 120 seconds. Manual selection still works.';
  $('cancel-analysis').hidden=false;$('find-samples').disabled=true;$('analysis-status').textContent='Decoding this local file. Cancel ignores the result, but cannot interrupt the browser decoder. Video containers vary; manual selection always remains available.';
  try{
    const decoded=await audio.context.decodeAudioData(await file.arrayBuffer());
    if(token!==onsetRun)return;
    if(decoded.duration>120||decoded.length*decoded.numberOfChannels>8_000_000)throw new Error('Decoded audio exceeds the 120-second or 8-million-sample budget.');
    const mono=new Float32Array(decoded.length),channels=decoded.numberOfChannels;
    for(let channel=0;channel<channels;channel++){const samples=decoded.getChannelData(channel);for(let i=0;i<mono.length;i++)mono[i]+=samples[i]/channels;}
    const worker=new Worker(new URL('./onsets-worker.js',import.meta.url),{type:'module'});onsetWorker=worker;
    worker.onmessage=event=>{if(token!==onsetRun)return;if(event.data.error){$('cancel-analysis').hidden=true;$('find-samples').disabled=false;$('analysis-status').textContent=`Analysis unavailable: ${event.data.error}. Manual selection still works.`;worker.terminate();onsetWorker=null;return;}showOnsetSuggestions(event.data.suggestions,token);$('find-samples').disabled=false;};
    worker.onerror=()=>{if(token!==onsetRun)return;$('cancel-analysis').hidden=true;$('find-samples').disabled=false;$('analysis-status').textContent='Local analysis failed in this browser. Manual selection still works.';worker.terminate();onsetWorker=null;};
    worker.postMessage({buffer:mono.buffer,sampleRate:decoded.sampleRate},[mono.buffer]);$('analysis-status').textContent='Finding transient regions locally…';
  }catch(error){if(token===onsetRun){$('cancel-analysis').hidden=true;$('find-samples').disabled=false;$('analysis-status').textContent=`Suggestions unavailable for this media codec: ${error.message}. Manual selection still works.`;}}
}

function padIsAudible(id){return isPadAudible(project.pads.slice(0,PAD_COUNT[project.layout]),id);}

function renderControls() {
  const config = project.pads[selected];
  $('selected-number').textContent = `PAD ${String(selected+1).padStart(2,'0')}`;
  $('selected-circle').textContent = String(selected+1).padStart(2,'0');
  $('pad-name').value = config.name;
  $('sample-info').textContent = mediaFiles.has(selected) ? `${config.fileName} · ${config.kind.toUpperCase()} · stored on this device` : 'No media loaded. Add a clip to get started.';
  $('volume').value = config.volume*100;
  $('pitch').value = config.pitch;
  const pitchAvailable=audio.canPitch(selected);
  $('pitch').disabled=!pitchAvailable;
  $('pitch-out').textContent=pitchAvailable?`${config.pitch>0?'+':''}${config.pitch} st`:'Unavailable';
  $('pitch-note').textContent=pitchAvailable?'Pitch is processed separately from Speed. Pitch shifting adds a short processing delay; sound quality varies by device.':!mediaFiles.has(selected)?'Load an audio or video sample to use independent Pitch.':audio.pitchReady?'Pitch is unavailable for this media source in this browser. Speed remains available.':'The local Pitch processor could not start in this browser. Speed remains available.';
  $('speed').value = config.speed;
  const max = Math.max(2,durations.get(selected)||15);
  $('trim-start').max = max;
  $('trim-end').max = max;
  $('trim-start').value = config.start;
  $('trim-end').value = config.end;
  $('volume-out').textContent = `${Math.round(config.volume*100)}%`;
  $('speed-out').textContent = `${config.speed.toFixed(2)}×`;
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
    button.disabled=Boolean(patternRecording);
    button.addEventListener('click', () => {
      if(patternRecording)return;
      patternUndoSnapshot=null;renderPatternRecordingState();
      project.pads[selected].steps[i] = !project.pads[selected].steps[i];
      project.pads[selected].stepOffsets[i]=0;
      button.classList.toggle('on',project.pads[selected].steps[i]);button.setAttribute('aria-pressed',String(project.pads[selected].steps[i]));button.setAttribute('aria-label',`Step ${i+1} ${project.pads[selected].steps[i]?'on':'off'}`);
      renderTrackGrid();queueSave();
    });
    holder.append(button);
  });
  renderTrackGrid();
}

function renderTrackGrid(){
  const holder=$('track-grid'),focused=holder.contains(document.activeElement)?{pad:document.activeElement.closest('.track-row')?.dataset.pad,step:document.activeElement.dataset.step,control:document.activeElement.dataset.control}:null;holder.replaceChildren();
  const count=PAD_COUNT[project.layout],hasSolo=project.pads.slice(0,count).some(pad=>pad.solo);
  for(let id=0;id<count;id++){
    const pad=project.pads[id],row=document.createElement('div');row.className=`track-row${pad.muted?' muted':''}${pad.solo?' solo':''}`;row.dataset.pad=id;
    const head=document.createElement('div');head.className='track-head';
    const trackLabel=mediaFiles.has(id)?pad.name:(audio.demoEnabled?`Demo synth ${String(id+1).padStart(2,'0')}`:'Empty pad');
    const name=document.createElement('button');name.type='button';name.className='track-name';name.textContent=`${String(id+1).padStart(2,'0')} · ${trackLabel}`;name.setAttribute('aria-label',`Select pad ${id+1}, ${trackLabel}`);name.addEventListener('click',()=>selectPad(id));head.append(name);
    for(const [key,label] of [['muted','M'],['solo','S']]){const button=document.createElement('button');button.type='button';button.dataset.control=key;button.className=`track-toggle${pad[key]?' active':''}`;button.textContent=label;button.setAttribute('aria-label',`${pad[key]?'Disable':'Enable'} ${key} for pad ${id+1}`);button.setAttribute('aria-pressed',String(pad[key]));button.addEventListener('click',()=>{pad[key]=!pad[key];renderTrackGrid();queueSave();});head.append(button);}
    const gain=document.createElement('input');gain.type='range';gain.min='0';gain.max='150';gain.value=String(Math.round(pad.volume*100));gain.className='track-gain';gain.setAttribute('aria-label',`Volume for pad ${id+1}`);gain.addEventListener('input',()=>{pad.volume=Number(gain.value)/100;if(selected===id){$('volume').value=gain.value;$('volume-out').textContent=`${gain.value}%`;}queueSave();});head.append(gain);row.append(head);
    const cells=document.createElement('div');cells.className='track-steps';
    pad.steps.forEach((enabled,index)=>{const button=document.createElement('button');button.type='button';button.dataset.step=String(index);button.className=`step${enabled?' on':''}`;button.textContent=String(index+1).padStart(2,'0');button.setAttribute('aria-label',`Pad ${id+1}, step ${index+1}, ${enabled?'on':'off'}`);button.setAttribute('aria-pressed',String(enabled));button.disabled=Boolean(patternRecording);button.addEventListener('click',()=>{if(patternRecording)return;patternUndoSnapshot=null;renderPatternRecordingState();pad.steps[index]=!pad.steps[index];pad.stepOffsets[index]=0;renderSteps();queueSave();});cells.append(button);});row.append(cells);
    if(hasSolo&&!pad.solo)row.classList.add('solo-muted');holder.append(row);
  }
  if(focused?.pad!==undefined){const target=holder.querySelector(`.track-row[data-pad="${focused.pad}"] [${focused.control?`data-control="${focused.control}"`:`data-step="${focused.step}"`}]`);target?.focus();}
}

function renderSession() {
  $('project-title').value = project.title;
  $('layout-select').value = project.layout;
  $('bpm-input').value = project.bpm;
  $('quantize-select').value = project.quantize;
  renderGrid(); renderControls(); renderSteps(); renderScenes();
  audio.setTransport(project.bpm,project.quantize);
  syncRegionPreview();
}

function sceneSnapshot(name){
  return {name,pads:project.pads.map(pad=>({steps:[...pad.steps],stepOffsets:[...pad.stepOffsets]}))};
}

function renderScenes(){
  const select=$('scene-select');select.replaceChildren();
  if(!project.scenes.length){const option=document.createElement('option');option.value='';option.textContent='No saved scenes';option.disabled=true;select.append(option);selectedSceneIndex=-1;$('scene-status').textContent=pendingScene?`Queued: ${pendingScene.scene.name} · next bar`:'Save the current pattern as a named scene.';}
  else {
    selectedSceneIndex=clamp(selectedSceneIndex<0?0:selectedSceneIndex,0,project.scenes.length-1);
    project.scenes.forEach((scene,index)=>{const option=document.createElement('option');option.value=String(index);option.textContent=scene.name;select.append(option);});
    select.value=String(selectedSceneIndex);$('scene-name').value=project.scenes[selectedSceneIndex].name;
    $('scene-status').textContent=pendingScene?`Queued: ${pendingScene.scene.name} · next bar`:`${project.scenes.length} of ${MAX_SCENES} scenes saved.`;
  }
  $('save-scene').disabled=project.scenes.length>=MAX_SCENES||!$('scene-name').value.trim();
  $('update-scene').disabled=selectedSceneIndex<0;
  $('launch-scene').disabled=selectedSceneIndex<0;
  $('launch-scene').textContent=transportTimer?'QUEUE NEXT BAR':'LOAD SCENE';
  $('delete-scene').disabled=selectedSceneIndex<0;
}

function applyScene(scene){
  project.pads.forEach((pad,id)=>{
    const lane=scene.pads[id]||{};
    pad.steps=Array.from({length:16},(_,step)=>Boolean(lane.steps?.[step]));
    pad.stepOffsets=Array.from({length:16},(_,step)=>clamp(lane.stepOffsets?.[step]??0,0,.9999));
  });
  renderSteps();queueSave();
}

function saveScene(){
  const name=$('scene-name').value.trim().slice(0,32);
  if(!name)return notify('Give this scene a name first.');
  if(project.scenes.length>=MAX_SCENES)return notify(`You can save up to ${MAX_SCENES} scenes in a project.`);
  project.scenes.push(sceneSnapshot(name));selectedSceneIndex=project.scenes.length-1;renderScenes();queueSave();notify(`Scene “${name}” saved.`);
}

function updateScene(){
  if(selectedSceneIndex<0)return;
  const name=$('scene-name').value.trim().slice(0,32)||project.scenes[selectedSceneIndex].name;
  project.scenes[selectedSceneIndex]=sceneSnapshot(name);renderScenes();queueSave();notify(`Scene “${name}” updated.`);
}

function deleteScene(){
  if(selectedSceneIndex<0)return;
  const scene=project.scenes[selectedSceneIndex];
  if(!confirm(`Delete the saved scene “${scene.name}”?`))return;
  project.scenes.splice(selectedSceneIndex,1);
  if(pendingScene?.scene.name===scene.name)pendingScene=null;
  selectedSceneIndex=Math.min(selectedSceneIndex,project.scenes.length-1);renderScenes();queueSave();
}

function launchScene(){
  if(selectedSceneIndex<0)return;
  const scene=JSON.parse(JSON.stringify(project.scenes[selectedSceneIndex]));
  if(transportTimer){
    const earliest=Math.max(audio.context.currentTime+.14,nextStepTime);
    pendingScene={scene,at:nextBarTime(earliest,audio.transportEpoch,project.bpm)};
    renderScenes();notify(`Scene “${scene.name}” queued for the next bar.`);
  } else {applyScene(scene);notify(`Scene “${scene.name}” loaded.`);}
}

async function playPad(id, scheduledAt) {
  if(!padIsAudible(id))return;
  await audio.unlock();
  audio.setTransport(project.bpm,project.quantize);
  if(!audio.demoEnabled&&!audio.sources.get(id)?.file){notify('This pad is empty. Add a clip or switch on demo sounds.');return;}
  if(patternRecording)capturePatternTap(id);
  if (!audio.trigger(id,project.pads[id],flashPad,scheduledAt)) {
    notify('This pad is empty. Add a clip or switch on demo sounds.');
  }
}

function renderPatternRecordingState(){
  const active=Boolean(patternRecording),button=$('record-pattern');
  button.textContent=active?'■ STOP TAKE':'● RECORD PATTERN';
  button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));
  $('pattern-take-mode').disabled=active;$('pattern-quantize').disabled=active;
  $('auto-beat').disabled=active;$('clear-steps').disabled=active;
  $('undo-pattern').disabled=active||!patternUndoSnapshot;
  $('pattern-record-status').textContent=active
    ?`${patternRecording.mode==='replace'?'Replace':'Overdub'} · ${patternRecording.quantize==='nearest'?'nearest 16th':'free timing'}`
    :patternUndoSnapshot?'Take saved locally · undo available':'Ready to record pad taps into the 16-step loop.';
}

function capturePatternTap(id){
  const take=patternRecording,pad=project.pads[id];
  const elapsed=audio.context.currentTime-take.startedAt;
  if(elapsed<0)return;
  const position=captureStepPosition(elapsed,take.bpm,take.quantize);
  pad.steps[position.step]=true;
  pad.stepOffsets[position.step]=position.offset;
  renderSteps();queueSave();
}

async function togglePatternRecording(){
  if(patternRecording){
    patternRecording=null;renderSteps();renderPatternRecordingState();queueSave();
    $('record-pattern').blur();notify('Pattern take saved on this device.');return;
  }
  try{await audio.unlock();}catch(error){notify(`Could not start pattern recording: ${error.message}`);return;}
  const now=audio.context.currentTime,barDuration=60/project.bpm*4;
  const startsOnBar=Boolean(transportTimer),startedAt=startsOnBar
    ?audio.transportEpoch+Math.max(1,Math.ceil((now-audio.transportEpoch)/barDuration-1e-9))*barDuration
    :now;
  patternUndoSnapshot=project.pads.map(pad=>({steps:[...pad.steps],stepOffsets:[...pad.stepOffsets]}));
  const mode=$('pattern-take-mode').value;
  if(mode==='replace')for(const pad of project.pads){pad.steps.fill(false);pad.stepOffsets.fill(0);}
  patternRecording={startedAt,bpm:project.bpm,mode,quantize:$('pattern-quantize').value,startsOnBar};
  renderSteps();renderPatternRecordingState();queueSave();
  $('record-pattern').blur();notify(`Recording ${mode==='replace'?'replacement':'overdub'} pattern${startsOnBar?' from the next bar':''}. Tap pads, then stop the take.`);
}

function undoPatternRecording(){
  if(!patternUndoSnapshot||patternRecording)return;
  project.pads.forEach((pad,id)=>{pad.steps=[...patternUndoSnapshot[id].steps];pad.stepOffsets=[...patternUndoSnapshot[id].stepOffsets];});
  patternUndoSnapshot=null;renderSteps();renderPatternRecordingState();queueSave();notify('Last pattern take undone.');
}

function flashPad(id) {
  activeUntil.set(id,performance.now()+180);
  const config=project.pads[id];visualUntil.set(id,performance.now()+Math.max(180,(config.end-config.start)*1000));
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
  window.dispatchEvent(new Event('madladpad-media-change'));
  config.kind=kind;
  config.fileName=file.name;
  config.name=file.name.replace(/\.[^/.]+$/,'').slice(0,45) || `Pad ${id+1}`;
  config.start=0;
  durations.delete(id);
  if (source.buffer) durations.set(id,source.buffer.duration);
  config.end=Math.max(.05,Math.min(2,durations.get(id)||2));
  if (persist) await putValue(`media:${id}`,file);
  renderPad(id);
  renderTrackGrid();
  queueSave();
  if (selected===id) renderControls();
  if (selected===id) syncRegionPreview();
}

async function assignVoiceWordsToPads(phrase,clips) {
  const visiblePads=PAD_COUNT[project.layout];
  const targets=project.pads.slice(0,visiblePads).map((pad,id)=>id).filter(id=>!mediaFiles.has(id)&&!project.pads[id].steps.some(Boolean)).slice(0,clips.length);
  if(targets.length!==clips.length){notify(`This phrase needs ${clips.length} empty pads with unused patterns in the current ${project.layout} layout. Change layout or clear a lane first.`);return false;}
  const secondsPerStep=60/project.bpm/4,barDuration=secondsPerStep*16;
  let cursor=0;
  const plan=clips.map((clip,index)=>{
    const position=cursor/secondsPerStep,step=Math.floor(position+1e-7),offset=position-step;
    if(step>=16||cursor+clip.duration>barDuration+1e-6)return null;
    cursor+=clip.duration;
    return {id:targets[index],clip,step,offset};
  });
  if(plan.some(item=>!item)){
    notify('This phrase is longer than one 16-step bar at the current tempo. Raise the tempo or choose a shorter phrase, then map it again.');
    return false;
  }

  clearTimeout(saveTimer);
  const previousProject=JSON.parse(JSON.stringify(project));
  const loaded=[];
  try{
    for(const {id,clip,step,offset} of plan){
      const source=await audio.load(id,clip.file,pads[id].video);
      loaded.push(id);
      if(!source.buffer)throw new Error(`Pad ${id+1} could not decode its generated word sample.`);
      mediaFiles.set(id,clip.file);
      const config=project.pads[id];
      config.kind='audio';config.fileName=clip.file.name;
      config.name=`${phrase.name} · ${clip.word.text}`.slice(0,45);
      config.start=0;config.end=Math.min(source.buffer.duration,clip.duration);
      config.steps[step]=true;config.stepOffsets[step]=Math.min(.9999,Math.max(0,offset));
      durations.set(id,source.buffer.duration);
    }
    const allMedia=Array.from({length:16},(_,id)=>mediaFiles.get(id)||null);
    await replaceProjectMedia(project,allMedia);
    for(const id of loaded)renderPad(id);
    renderGrid();renderTrackGrid();selectPad(loaded[0]);
    window.dispatchEvent(new Event('madladpad-media-change'));
    notify(`${clips.length} word samples mapped to pads and the 16-step pattern. Press Play to hear ${phrase.name}.`);
    return true;
  }catch(error){
    for(const id of loaded){audio.unload(id);mediaFiles.delete(id);durations.delete(id);}
    project=normaliseProject(previousProject);
    renderGrid();renderTrackGrid();selectPad(selected);
    window.dispatchEvent(new Event('madladpad-media-change'));
    queueSave();
    notify(`Could not map phrase words; your project was restored. ${error.message}`);
    return false;
  }
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
        if(pendingScene&&time>=pendingScene.at-1e-4){const queued=pendingScene;pendingScene=null;applyScene(queued.scene);renderScenes();notify(`Scene “${queued.scene.name}” launched.`);}
        const step=nextStep%16;
        project.pads.slice(0,PAD_COUNT[project.layout]).forEach(pad => {
          if (pad.steps[step]&&padIsAudible(pad.id)) audio.trigger(pad.id,pad,flashPad,stepTriggerTime(time,project.bpm,pad.stepOffsets?.[step]||0));
        });
        setTimeout(()=>updateBeatIndicator(step),Math.max(0,(time-audio.context.currentTime)*1000));
        nextStep++;
        nextStepTime+=secondsPerStep;
      }
    };
    transportTimer=setInterval(tick,25);
    tick();
    $('play-seq').textContent='■ STOP'; $('play-seq').classList.add('active');
    renderScenes();
  }).catch(error=>notify(error.message));
}

function updateBeatIndicator(step) {
  if (!transportTimer) return;
  [...$('steps').children].forEach((el,i)=>el.classList.toggle('current',i===step));
  $('track-grid').querySelectorAll('.track-steps').forEach(lane=>[...lane.children].forEach((el,i)=>el.classList.toggle('current',i===step)));
}

function stopSequencer() {
  clearInterval(transportTimer); transportTimer=null;
  if(pendingScene){pendingScene=null;renderScenes();notify('Queued scene canceled because the sequencer stopped.');}
  else renderScenes();
  $('play-seq').textContent='▶ PLAY'; $('play-seq').classList.remove('active');
  [...$('steps').children].forEach(el=>el.classList.remove('current'));
  $('track-grid').querySelectorAll('.current').forEach(el=>el.classList.remove('current'));
}

function surpriseBeat() {
  const count=PAD_COUNT[project.layout];
  if (!count) return;
  patternUndoSnapshot=null;
  const a=project.pads.slice(0,count);
  for (const pad of a){pad.steps.fill(false);pad.stepOffsets.fill(0);}
  const kick=a[0], snare=a[1]||a[0], hat=a[2]||a[0];
  for (const step of [0,8,Math.random()>.5?6:10]) kick.steps[step]=true;
  for (const step of [4,12]) snare.steps[step]=true;
  for (let step=0;step<16;step+=2) if (Math.random()>.16) hat.steps[step]=true;
  for (const pad of a.slice(3)) if (Math.random()<.35) pad.steps[Math.floor(Math.random()*16)]=true;
  renderSteps();renderPatternRecordingState();queueSave();
  notify('New beat created. Load clips into the first three pads or enable demo sounds.');
}

function drawPerformanceFrame() {
  if (!drawing) return;
  const canvas=$('capture-canvas');
  const context=canvas.getContext('2d');
  context.fillStyle='#0c100e';context.fillRect(0,0,canvas.width,canvas.height);
  const adaptive=$('record-layout').value==='follow-active';
  const active=adaptive?[...visualUntil].filter(([,until])=>until>performance.now()).map(([id])=>id):Array.from({length:PAD_COUNT[project.layout]},(_,id)=>id);
  if(adaptive&&!active.length){context.fillStyle='#d7fc5a';context.font='bold 28px sans-serif';context.textAlign='center';context.fillText('PLAY A PAD TO BEGIN',canvas.width/2,canvas.height/2);context.textAlign='left';requestAnimationFrame(drawPerformanceFrame);return;}
  const total=active.length,cols=adaptive?(total===1?1:total<=4?2:4):(project.layout==='2x2'?2:4);
  const rows=Math.ceil(total/cols),gap=12,margin=28;
  const width=(canvas.width-margin*2-(cols-1)*gap)/cols;
  const height=(canvas.height-margin*2-(rows-1)*gap)/rows;
  for(let index=0;index<total;index++) {
    const id=active[index],col=index%cols,row=Math.floor(index/cols),x=margin+col*(width+gap),y=margin+row*(height+gap);
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
  if(audioRecording)return notify('Stop the audio-only take before recording an audiovisual set.');
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
    $('start-record').blur();
    notify('Recording your audiovisual performance. Tap pads or start the beat maker.');
  } catch(error) { drawing=false;recording=null;notify(error.message); }
}

async function toggleAudioRecording() {
  if(audioRecording){if(audioRecording.state!=='inactive')audioRecording.stop();return;}
  if(recording)return notify('Stop the audiovisual set before recording an audio-only mix.');
  if(!window.MediaRecorder)return notify('Audio recording is unavailable in this browser.');
  try{
    await audio.unlock();
    const stream=audio.recordOut.stream;
    if(!stream.getAudioTracks().length)throw new Error('The audio mix stream is unavailable.');
    const mime=findAudioRecorderMime();
    const recorder=new MediaRecorder(stream,mime?{mimeType:mime}:undefined),chunks=[];
    recorder.ondataavailable=event=>{if(event.data.size)chunks.push(event.data);};
    recorder.onerror=event=>notify(`Audio recording failed: ${event.error?.message||'unknown error'}`);
    recorder.onstop=()=>{
      const type=recorder.mimeType||mime||'audio/webm';
      const blob=new Blob(chunks,{type});
      if(blob.size)download(blob,`madladpad-audio-${Date.now()}.${extensionForAudioMime(type)}`);
      else notify('The browser did not capture audio.');
      audioRecording=null;
      $('record-audio').classList.remove('recording');$('record-audio').textContent='♪ RECORD AUDIO MIX';
      $('record-audio').setAttribute('aria-pressed','false');
    };
    audioRecording=recorder;recorder.start(200);
    $('record-audio').classList.add('recording');$('record-audio').textContent='■ STOP AUDIO TAKE';
    $('record-audio').setAttribute('aria-pressed','true');
    $('record-audio').blur();
    notify('Recording the master audio mix. Stop to download the supported audio format.');
  }catch(error){audioRecording=null;notify(error.message);}
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
    const files=blobs.map((blob,i)=>blob ? new File([blob],incoming.pads[i].fileName||`sample-${i+1}`,{type:blob.type}) : null);
    if(!confirm('Replace your current local project? Export it first if you want a backup.')) return;
    patternRecording=null;patternUndoSnapshot=null;renderPatternRecordingState();
    // A single IndexedDB transaction prevents a partial replacement on quota or write failure.
    clearTimeout(saveTimer);
    try { await replaceProjectMedia(incoming,files); }
    catch(error) { queueSave(); throw error; }
    stopSequencer();
    project=incoming;selected=0;
    let unavailable=0;
    for(let i=0;i<16;i++) {
      audio.unload(i);mediaFiles.delete(i);durations.delete(i);
      if(files[i]) try {
        const source=await audio.load(i,files[i],files[i].type.startsWith('image/')?null:pads[i].video);
        mediaFiles.set(i,files[i]);
        if(source.buffer)durations.set(i,source.buffer.duration);
      } catch(error) { unavailable++; console.warn(`Failed to load restored pad ${i+1}`,error); }
    }
    renderSession();
    window.dispatchEvent(new Event('madladpad-media-change'));
    notify(unavailable ? `Project saved, but ${unavailable} sample(s) could not load. Try reloading; your pack remains unchanged.` : 'Project restored with its media.');
  } catch(error){notify(`Import failed: ${error.message}`);}
}

function bindControls() {
  const preview=$('region-preview');
  preview.addEventListener('loadedmetadata',()=>{
    if (!Number.isFinite(preview.duration) || preview.duration<=0) { $('region-status').textContent='Duration unavailable; this clip cannot be previewed here.'; return; }
    previewDuration=preview.duration;
    $('find-samples').disabled=false;
    regionDraft=normaliseRegion(project.pads[selected].start,project.pads[selected].end,previewDuration);
    renderRegion();
  });
  preview.addEventListener('error',()=>{previewDuration=0;regionDraft=null;renderRegion();$('find-samples').disabled=true;$('region-status').textContent='Preview unavailable for this file in this browser.';});
  $('find-samples').addEventListener('click',findGoodSounds);
  $('cancel-analysis').addEventListener('click',()=>cancelOnsetAnalysis(true));
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
  $('pad-name').addEventListener('input',event=>{project.pads[selected].name=event.target.value;renderPad(selected);renderTrackGrid();queueSave();});
  for(const [id,key,convert] of [['volume','volume',v=>v/100],['pitch','pitch',Number],['speed','speed',Number],['trim-start','start',Number],['trim-end','end',Number]]) {
    $(id).addEventListener('input',event=>{
      const pad=project.pads[selected];pad[key]=convert(Number(event.target.value));
      if(key==='pitch'&&!audio.setPadPitch(selected,pad.pitch,pad.speed))notify('Pitch processing is unavailable for this pad in this browser.');
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
    const previous=project.pads[selected],original=makeProject().pads[selected];
    project.pads[selected]={...original,steps:previous.steps,stepOffsets:previous.stepOffsets,muted:previous.muted,solo:previous.solo};
    await deleteValue(`media:${selected}`);renderPad(selected);renderTrackGrid();renderControls();syncRegionPreview();queueSave();
  });
  $('demo-button').addEventListener('click',()=>{
    audio.demoEnabled=!audio.demoEnabled;
    $('demo-button').classList.toggle('active',audio.demoEnabled);
    $('demo-button').setAttribute('aria-pressed',String(audio.demoEnabled));
    renderGrid();renderTrackGrid();notify(audio.demoEnabled?'Demo synth sounds enabled on empty pads.':'Demo sounds off.');
  });
  $('play-seq').addEventListener('click',()=>transportTimer?stopSequencer():startSequencer());
  $('auto-beat').addEventListener('click',surpriseBeat);
  $('clear-steps').addEventListener('click',()=>{project.pads[selected].steps.fill(false);project.pads[selected].stepOffsets.fill(0);patternUndoSnapshot=null;renderSteps();renderPatternRecordingState();queueSave();});
  $('record-pattern').addEventListener('click',togglePatternRecording);
  $('undo-pattern').addEventListener('click',undoPatternRecording);
  $('scene-select').addEventListener('change',event=>{selectedSceneIndex=Number(event.target.value);renderScenes();});
  $('scene-name').addEventListener('input',()=>{$('save-scene').disabled=project.scenes.length>=MAX_SCENES||!$('scene-name').value.trim();});
  $('save-scene').addEventListener('click',saveScene);
  $('update-scene').addEventListener('click',updateScene);
  $('launch-scene').addEventListener('click',launchScene);
  $('delete-scene').addEventListener('click',deleteScene);
  $('track-view').addEventListener('click',()=>{trackGridVisible=!trackGridVisible;$('steps').hidden=trackGridVisible;$('track-grid').hidden=!trackGridVisible;$('track-view').textContent=trackGridVisible?'SELECTED PAD':'ALL TRACKS';$('track-view').setAttribute('aria-pressed',String(trackGridVisible));if(trackGridVisible)renderTrackGrid();});
  $('start-record').addEventListener('click',toggleSetRecording);
  $('record-audio').addEventListener('click',toggleAudioRecording);
  $('google-drive').addEventListener('click',()=>pickFromDrive(files=>placeFiles(files)).catch(error=>notify(error.message)));
  $('google-photos').addEventListener('click',()=>pickFromPhotos(files=>placeFiles(files),notify).catch(error=>notify(error.message)));
  window.addEventListener('madladpad-error',event=>notify(event.detail));
  document.addEventListener('keydown',event=>{
    if(event.repeat || event.metaKey || event.ctrlKey || event.altKey || $('camera-dialog').open || $('pad-source-dialog').open || $('capture-target-dialog').open || ['INPUT','SELECT','TEXTAREA','BUTTON'].includes(document.activeElement?.tagName)) return;
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
    await audio.initPitchProcessor();
    buildGrid();bindControls();
    const saved=await getValue('project');
    if(saved)project=normaliseProject(saved);
    renderSession();
    renderPatternRecordingState();
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
    initVoiceLab({ getProject: () => project, getMediaFiles: () => mediaFiles, getAudio: () => audio, notify, save: queueSave, assignWordsToPads: assignVoiceWordsToPads });
    if(restored)notify(`Restored ${restored} locally saved samples.`);
    if('serviceWorker' in navigator && (location.protocol==='https:'||location.hostname==='localhost'))navigator.serviceWorker.register('/sw.js').catch(()=>{});
    $('connection-indicator').textContent=navigator.onLine?'LOCAL STUDIO':'OFFLINE READY';
  } catch(error){notify(`Studio startup error: ${error.message}`);console.error(error);}
}

initialise();
