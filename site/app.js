import { HOTKEYS, PAD_COUNT, MAX_MEDIA_BYTES, MAX_SCENES, VIDEO_ASPECTS, DEMO_SOUNDS, directedPads, makeProject, normaliseProject, normaliseRegion, copyPadSound, clamp, supportedMediaFile, findRecorderMime, extensionForMime, findAudioRecorderMime, extensionForAudioMime, audioBufferToWav, CaptureSession, AsyncActivity, suggestActiveRegion, captureRegionStatus, cameraTakeTargetSeconds, isPadAudible, captureStepPosition, stepTriggerTime, stepGateDuration, stepLoopGateDuration, songSectionAtStep, songTotalBars, MAX_SONG_CLIPS, MAX_SONG_BARS, normaliseSampleNotes, setSampleNote, sampleNoteAtStep, nextBarTime, videoVisualDurationMs } from './core.js';
import { SamplerAudio } from './audio.js';
import { getValue, putValue, deleteValue, collectProjectMedia, collectVoiceMedia, collectSongVideoMedia, blobAsDataUrl, dataUrlAsBlob, replaceProjectMedia, saveCapturedPad } from './storage.js';
import { isGooglePickerConfigured, pickFromDrive, pickFromPhotos } from './google.js';
import { initVoiceLab } from './voice.js';
import { detectPitch } from './tuning.js';
import { processInputFiles } from './file-input.js';

const $ = id => document.getElementById(id);
let project = makeProject();
let selected = 0;
let sampleEditorTrigger = null;
let trackGridVisible = true;
let sequenceView = 'patterns';
let selectedSampleNote = null;
let notePointer = null;
let audio;
let voiceLab = null;
let transportTimer = null;
const transportActivity = new AsyncActivity();
let nextStep = 0;
let nextStepTime = 0;
let songEndTimer = null;
let recording = null;
const takeActivity = new AsyncActivity();
let takeKind = null;
let patternRecording = null;
let patternUndoSnapshot = null;
let pendingScene = null;
let selectedSceneIndex = -1;
const loopFallbackNotified = new Set();
const loopRestartAtStep = new Map();
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
const PROJECT_RECOVERY_KEY = 'madladpad-project-recovery-v1';
let saveRevision = 0;
let pendingProjectSnapshot = null;
let toastTimer;
let drawing = false;
let previewUrl = null;
let previewDuration = 0;
let regionDraft = null;
let previewingRegion = false;
let onsetWorker = null;
let onsetRun = 0;
let onsetMediaAnalysis = null;
let onsetSuggestions = [];
const durations = new Map();
const mediaFiles = new Map();
const pads = [];
const activeUntil = new Map();
const visualUntil = new Map();
const keys = new Set();
const STUDIO_SCREENS = new Set(['sounds','beats','voice','overdub','export']);
// Open the compact first-use guide on demand, not over the performance surface.
let introOpen = false;
let padEditMode = false;
let sequencePadsVisible = false;
const lastTakes = { video:null, audio:null };
const MAX_WAV_TAKE_SECONDS = 30;
const MAX_CAMERA_TAKE_SECONDS = 30;
const MAX_WAV_SOURCE_BYTES = 16 * 1024 * 1024;
const MAX_WAV_OUTPUT_BYTES = 12 * 1024 * 1024;
let directorEditStep=0;
let directorPlayingStep=null;
let latestDetectedNote=null;
let activeVoiceTool='transcript-title';

function showStudioScreen() {
  const requested = location.hash.slice(1);
  const screen = STUDIO_SCREENS.has(requested) ? requested : 'sounds';
  $('loop-settings').open = false;
  // Menus opened on a previous screen must never cover the current controls.
  $('session-menu').open = false;
  if(screen!=='beats' && $('sequence-focus-dialog')?.open)closeSequenceFocus();
  if(screen!=='beats' && $('sample-note-dialog')?.open)$('sample-note-dialog').close();
  if(screen!=='sounds'&&padEditMode)setPadEditMode(false);
  if(screen!=='sounds' && $('sample-editor-dialog')?.open)closeSampleEditor();
  if (screen !== 'voice') voiceLab?.stopTuner?.('Voice Lab closed. Microphone is off.');
  document.body.dataset.screen = screen;
  // Keep the sequencer first in reading and tab order on Sequence/Overdub.
  const workspace=$('studio-workspace'),sequencer=$('sequencer');
  if(screen==='beats'||screen==='overdub')workspace.before(sequencer);
  else workspace.after(sequencer);
  for(const link of $('studio-nav').querySelectorAll('[data-studio-screen]')) {
    if(link.dataset.studioScreen===screen)link.setAttribute('aria-current','page');
    else link.removeAttribute('aria-current');
  }
  const moreTools=$('studio-more-tools'),moreSummary=moreTools.querySelector('summary');
  if(screen==='voice'||screen==='overdub'){
    moreSummary.textContent=`Lab · ${screen==='voice'?'Voice Lab':'Overdub'}`;
    moreSummary.setAttribute('aria-current','page');
  }else{
    moreSummary.textContent='Lab';
    moreSummary.removeAttribute('aria-current');
  }
  moreTools.open=false;
  $('studio-intro').hidden = screen!=='sounds'||!introOpen;
  $('show-help').setAttribute('aria-expanded',String(screen==='sounds'&&introOpen));
  $('studio-workspace').hidden = screen!=='sounds' && !(screen==='beats'&&sequencePadsVisible);
  $('studio-workspace').classList.toggle('wide-grid',screen==='beats');
  $('sequence-pad-toggle').setAttribute('aria-expanded',String(sequencePadsVisible));
  $('sequence-pad-toggle').textContent=sequencePadsVisible?'Hide performance pads':'Show performance pads';
  $('pad-edit-mode').hidden = screen==='beats';
  $('sequencer').hidden = screen!=='beats' && screen!=='overdub';
  $('video-director-details').hidden=screen!=='export';
  $('video-director').hidden=screen!=='export';
  $('voice-lab').hidden = screen!=='voice';
  $('overdub-lab').hidden = screen!=='overdub';
  $('export-lab').hidden = screen!=='export';
  if(screen==='overdub')voiceLab?.refreshTimeline?.();
}

function dismissIntro() {
  introOpen=false;
  showStudioScreen();
}

function setPadEditMode(enabled) {
  padEditMode=Boolean(enabled);
  document.body.classList.toggle('pad-edit-mode',padEditMode);
  const button=$('pad-edit-mode');
  button.textContent=padEditMode?'Done editing':'Edit pads';
  button.setAttribute('aria-pressed',String(padEditMode));
  button.setAttribute('aria-label',padEditMode?'Switch to Play pads mode':'Switch to Edit pads mode');
  $('pad-help').textContent=padEditMode?'Tap a pad to edit its clip and trim. Select Done when finished.':'Hold an empty pad to open the camera, or tap + to choose a clip. Tap a loaded pad to play; hold to stop on release.';
  for(let id=0;id<16;id++)if(pads[id])renderPad(id);
}

function closeSampleEditor() {
  const dialog=$('sample-editor-dialog');
  if(!dialog.open)return;
  cancelOnsetAnalysis(false);
  $('region-preview').pause();
  dialog.close();
}

function openSampleEditor(id, trigger=null) {
  selectPad(id);
  if(location.hash!=='#sounds'){location.hash='#sounds';showStudioScreen();}
  $('sample-advanced').open=false;
  $('source-advanced').open=false;
  $('editor-sources').open=!mediaFiles.has(id);
  $('editor-sources-title').hidden=!mediaFiles.has(id);
  sampleEditorTrigger=trigger||$('pad-edit-mode');
  const dialog=$('sample-editor-dialog');
  if(!dialog.open)dialog.showModal();
  $('close-sample-editor').focus({preventScroll:true});
}

function startDemoBeat(){
  const hasPattern=project.pads.some(pad=>pad.steps.some(Boolean));
  audio.demoEnabled=true;
  project.demoEnabled=true;
  if(!hasPattern){
    const [kick,snare,hat]=project.pads;
    for(const step of [0,8])kick.steps[step]=true;
    for(const step of [4,12])snare.steps[step]=true;
    for(let step=0;step<16;step+=2)hat.steps[step]=true;
  }
  queueSave();
  for(const button of [$('demo-button'),$('quick-demo')]){
    button.classList.add('active');
    button.setAttribute('aria-pressed','true');
  }
  renderGrid();renderTrackGrid();renderControls();renderSteps();
  if(location.hash==='#beats')showStudioScreen();
  else location.hash='#beats';
  // The Beat Grid already explains that steps are editable. Keep this toast
  // compact so it does not cover the Play control on short phone viewports.
  notify(hasPattern?'Your beat is ready.':'Starter beat ready.');
}

function showVoiceTool(tool,{focus=false}={}) {
  const allowed=['transcript-title','melody-title','rap-title'];
  if(!allowed.includes(tool))return;
  if(activeVoiceTool==='melody-title'&&tool!=='melody-title')voiceLab?.stopTuner?.('Melody tool closed. Microphone is off.');
  activeVoiceTool=tool;
  for(const button of document.querySelectorAll('[data-voice-jump]')){
    button.setAttribute('aria-pressed',String(button.dataset.voiceJump===tool));
  }
  for(const card of document.querySelectorAll('#voice-lab .voice-card')){
    card.hidden=card.querySelector('h3')?.id!==tool;
  }
  if(focus){
    const heading=$(tool);
    heading.tabIndex=-1;
    heading.focus({preventScroll:true});
    heading.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});
  }
}

function updateTransportButton() {
  const running = transportActivity.phase!=='idle';
  $('studio-play').textContent = transportActivity.phase==='starting' ? '■ CANCEL START' : running ? '■ STOP' : sequenceView==='song'?'▶ PLAY SONG':'▶ PLAY LOOP';
  $('studio-play').setAttribute('aria-pressed',String(running));
  $('studio-play').classList.toggle('active',running);
  $('play-seq').textContent = transportActivity.phase==='starting' ? '■ CANCEL' : running ? '■ STOP' : sequenceView==='song'?'▶ PLAY SONG':'▶ PLAY';
  $('play-seq').setAttribute('aria-pressed',String(running));
  $('play-seq').classList.toggle('active',running);
}

function rememberTake(kind,blob,durationSeconds=null) {
  const previous = lastTakes[kind];
  if(previous)URL.revokeObjectURL(previous.url);
  const type=kind==='video'?'video':'audio';
  lastTakes[kind]={blob,durationSeconds:Number.isFinite(durationSeconds)?durationSeconds:null,url:URL.createObjectURL(blob),name:`madladpad-${kind}-${Date.now()}.${kind==='video'?extensionForMime(blob.type):extensionForAudioMime(blob.type)}`};
  const player=$(`export-${type}-preview`);
  player.src=lastTakes[kind].url;
  player.hidden=false;
  $(`export-${type}-empty`).hidden=true;
  $(`export-${type}-download`).disabled=false;
  if(kind==='audio')$('export-audio-wav').disabled=false;
  $('export-record-status').textContent=`${type==='video'?'Video':'Audio'} take ready. Review it here or download it again.`;
  if(blob.size<=120*1024*1024){
    putValue(`render:${kind}`,{blob,name:lastTakes[kind].name,durationSeconds:lastTakes[kind].durationSeconds}).catch(error=>notify(`Your take downloaded, but local render storage failed: ${error.message}`));
  } else notify('This take exceeds the 120 MB local render-cache limit. Keep the downloaded file.');
}

async function restoreSavedTakes(){
  for(const kind of ['video','audio']){
    try{
      const previous=await getValue(`render:${kind}`);
      if(previous?.blob instanceof Blob&&previous.blob.size){
        rememberTake(kind,previous.blob,previous.durationSeconds);
        lastTakes[kind].name=previous.name||lastTakes[kind].name;
      }
    }catch(error){console.warn('Local render restore unavailable',error);}
  }
}

function notify(message) {
  const toast = $('toast');
  toast.textContent = String(message);
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 5000);
}

function replaceProjectState(next) { Object.assign(project, next); }

function persistProject(revision, snapshot) {
  return putValue('project', snapshot).then(() => {
    if (revision === saveRevision) localStorage.removeItem(PROJECT_RECOVERY_KEY);
  }).catch(error => notify(`Could not save project: ${error.message}`));
}

function discardPendingProjectSave() {
  clearTimeout(saveTimer);
  saveTimer = undefined;
  saveRevision++;
  pendingProjectSnapshot = null;
  localStorage.removeItem(PROJECT_RECOVERY_KEY);
}

function flushSave() {
  if (saveTimer === undefined) return;
  clearTimeout(saveTimer);
  saveTimer = undefined;
  const revision = saveRevision;
  persistProject(revision, pendingProjectSnapshot);
}

function queueSave() {
  const revision = ++saveRevision;
  try {
    const serialized = JSON.stringify(project);
    pendingProjectSnapshot = JSON.parse(serialized);
    localStorage.setItem(PROJECT_RECOVERY_KEY, serialized);
  }
  catch (error) { notify(`Could not prepare project recovery: ${error.message}`); }
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = undefined;
    persistProject(revision, pendingProjectSnapshot || project);
  }, 300);
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushSave();
});
window.addEventListener('pagehide', flushSave);

function buildGrid() {
  const grid = $('pad-grid');
  for (let id = 0; id < 16; id++) {
    const cell = document.createElement('div');
    cell.className = 'pad-cell';
    cell.dataset.padId = id;
    const card = document.createElement('div');
    card.className = 'pad empty';
    card.dataset.id = id;
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'edit-pad';
    edit.setAttribute('aria-label', `Edit pad ${id+1}`);
    edit.innerHTML = '<span>EDIT</span>';
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
      <div class="pad-bottom-line"><span class="pad-title"></span></div>`;
    card.prepend(video,image);
    const hit=card.querySelector('.pad-hit');
    const openSource=()=>{
      selectPad(id);
      sourcePad=id;
      $('pad-source-title').textContent=`Add a sample to pad ${id+1}`;
      if(!$('pad-source-dialog').open)$('pad-source-dialog').showModal();
    };
    // Pointer down starts the sound without a click delay. A short tap lets the
    // one-shot finish; holding a loaded pad gates playback until release.
    let gesture=null,ignoreNextClick=false,recordTimer=null,longRecordReady=false;
    hit.addEventListener('pointerdown',event=>{
      if(event.button!==0||padEditMode)return;
      if(!mediaFiles.has(id)&&!audio.demoEnabled&&!project.pads[id].demoSound){
        recordTimer=setTimeout(()=>{
          recordTimer=null;
          longRecordReady=true;
          card.classList.add('record-ready');
        },550);
        return;
      }
      ignoreNextClick=true;
      gesture={start:performance.now(),released:false,elapsed:0};
      const current=gesture;
      try{hit.setPointerCapture(event.pointerId);}catch{}
      playPad(id,undefined,true).then(()=>{
        if(current.released&&current.elapsed>=240)audio.stopPadMomentary(id);
      });
    });
    const release=event=>{
      if(recordTimer!==null){clearTimeout(recordTimer);recordTimer=null;}
      if(longRecordReady){
        longRecordReady=false;card.classList.remove('record-ready');
        if(event.type!=='pointercancel'){
          ignoreNextClick=true;
          selectPad(id);
          openCamera(id);
        }
        return;
      }
      if(!gesture)return;
      const current=gesture;
      current.released=true;
      current.elapsed=performance.now()-current.start;
      if(current.elapsed>=240)audio.stopPadMomentary(id);
      gesture=null;
      if(hit.hasPointerCapture(event.pointerId))hit.releasePointerCapture(event.pointerId);
    };
    hit.addEventListener('pointerup',release);
    hit.addEventListener('pointercancel',release);
    hit.addEventListener('contextmenu',event=>event.preventDefault());
    hit.addEventListener('click',event=>{
      if(ignoreNextClick&&event.detail!==0){ignoreNextClick=false;return;}
      ignoreNextClick=false;
      if(padEditMode){openSampleEditor(id);return;}
      if(!mediaFiles.has(id)&&!audio.demoEnabled&&!project.pads[id].demoSound)openSource();
      else playPad(id);
    });
    edit.addEventListener('click', () => openSampleEditor(id, edit));
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
    cell.append(card,edit);
    grid.append(cell);
  }
}

function restoreSampleEditorFocus() {
  const trigger = sampleEditorTrigger;
  sampleEditorTrigger = null;
  requestAnimationFrame(()=>{
    if (trigger?.isConnected && !trigger.closest('[hidden]')) trigger.focus({preventScroll:true});
  });
}

function renderPad(id) {
  const config = project.pads[id];
  const {card,video,image} = pads[id];
  const hasMedia = mediaFiles.has(id);
  const demo=DEMO_SOUNDS.find(sound=>sound.id===config.demoSound);
  card.hidden = id >= PAD_COUNT[project.layout];
  card.classList.toggle('empty',!hasMedia);
  card.classList.toggle('demo',Boolean(demo)||audio.demoEnabled&&!hasMedia);
  card.classList.toggle('selected',selected===id);
  card.classList.toggle('editable',hasMedia);
  card.classList.toggle('playing', (activeUntil.get(id)||0)>performance.now());
  card.querySelector('.pad-title').textContent = hasMedia ? config.name : demo?.name || (audio.demoEnabled ? 'DEMO '+String(id+1).padStart(2,'0') : 'ADD SAMPLE');
  card.querySelector('.pad-hit').setAttribute('aria-label',`${hasMedia || demo || audio.demoEnabled ? 'Play' : 'Load'} ${config.name}`);
  if(padEditMode)card.querySelector('.pad-hit').setAttribute('aria-label',`Edit ${config.name}`);
  video.hidden = config.kind !== 'video';
  image.hidden = config.kind !== 'image';
  if (config.kind === 'image' && hasMedia) image.src = audio.sources.get(id)?.url || '';
}

function renderGrid() {
  $('pad-grid').className = `pad-grid layout-${project.layout}`;
  for (let id=0;id<16;id++) renderPad(id);
  renderBeatPadChoice();
}

function renderBeatPadChoice(){
  const picker=$('beat-pad-select'),count=PAD_COUNT[project.layout];
  if(!picker)return;
  for(let id=0;id<count;id++){
    let option=picker.options[id];
    if(!option){option=document.createElement('option');picker.append(option);}
    option.value=String(id);
    const demo=DEMO_SOUNDS.find(sound=>sound.id===project.pads[id].demoSound);
    const label=mediaFiles.has(id)?project.pads[id].name:demo?.name||(audio.demoEnabled?'Demo synth':'Empty pad');
    option.textContent=`${String(id+1).padStart(2,'0')} · ${label}`;
  }
  while(picker.options.length>count)picker.remove(picker.options.length-1);
  picker.value=String(selected);
}

function selectPad(id) {
  if (id >= PAD_COUNT[project.layout]) return;
  if(selected!==id)latestDetectedNote=null;
  selected=id;
  renderGrid(); renderControls(); renderSteps();
  syncRegionPreview();
}

function renderDemoSoundBank(){
  const category=$('demo-category').value;
  const host=$('demo-sound-options');host.replaceChildren();
  for(const sound of DEMO_SOUNDS.filter(item=>item.category===category)){
    const button=document.createElement('button');button.type='button';button.className='source-button demo-sound-option';
    button.textContent=sound.name;button.setAttribute('aria-label',`Use ${sound.name} ${sound.category.toLowerCase()} demo sound`);
    button.addEventListener('click',()=>assignDemoSound(sourcePad??selected,sound));host.append(button);
  }
}

function openDemoSoundBank(id){
  sourcePad=id;
  $('demo-category').value=DEMO_SOUNDS.find(sound=>sound.id===project.pads[id].demoSound)?.category||'Drums';
  renderDemoSoundBank();$('demo-bank-dialog').showModal();
}

function assignDemoSound(id,sound){
  if(!Number.isInteger(id)||!DEMO_SOUNDS.some(item=>item.id===sound.id))return;
  const pad=project.pads[id];pad.demoSound=sound.id;pad.name=sound.name;pad.fileName='';pad.kind='';pad.start=0;pad.end=2;
  selectPad(id);renderGrid();renderTrackGrid();renderControls();queueSave();
  if($('demo-bank-dialog').open)$('demo-bank-dialog').close();
  if($('pad-source-dialog').open)$('pad-source-dialog').close();
  notify(`${sound.name} added to pad ${id+1}.`);
}

function renderCopyTargets() {
  const select=$('copy-target'),previous=select.value;
  const empty=Array.from({length:PAD_COUNT[project.layout]},(_,id)=>id).filter(id=>id!==selected&&!mediaFiles.has(id));
  select.replaceChildren();
  for(const id of empty){
    const option=document.createElement('option');
    option.value=String(id);option.textContent=`Pad ${String(id+1).padStart(2,'0')}`;
    select.append(option);
  }
  if(empty.some(id=>String(id)===previous))select.value=previous;
  const canCopy=mediaFiles.has(selected)&&empty.length>0;
  select.disabled=!canCopy;
  $('copy-pad').disabled=!canCopy;
  $('copy-status').textContent=!mediaFiles.has(selected)?'Record or import a clip first.':!empty.length?'All visible pads already contain clips.':'Copy this raw clip and its trim, then edit a different moment on the new pad.';
}

async function copyPadToEmpty() {
  const sourceId=selected,targetId=Number($('copy-target').value),file=mediaFiles.get(sourceId);
  if(!file||!Number.isInteger(targetId)||targetId<0||targetId>=PAD_COUNT[project.layout]||mediaFiles.has(targetId)||targetId===sourceId)return;
  $('copy-pad').disabled=true;
  try{
    const sourceConfig=structuredClone(project.pads[sourceId]);
    await addMedia(targetId,file);
    // The destination pattern is intentionally not overwritten by the source.
    // Users can reuse one recording for several independent trimmed moments.
    project.pads[targetId]=copyPadSound(sourceConfig,project.pads[targetId]);
    const target=project.pads[targetId];
    audio.setPadPitch(targetId,target.pitch,target.speed);
    renderGrid();renderTrackGrid();renderVideoDirector();queueSave();
    openSampleEditor(targetId);
    notify(`Copied the clip to pad ${targetId+1}. Change its trim without affecting pad ${sourceId+1}.`);
  }catch(error){notify(`Could not copy the sample: ${error.message}`);renderCopyTargets();}
}

function renderRegion() {
  const enabled = Boolean(regionDraft && previewDuration > 0);
  for (const id of ['region-start','region-end','region-start-range','region-end-range','region-play','region-apply','region-reset']) $(id).disabled = !enabled;
  const timeline=$('region-timeline');timeline.hidden=!enabled;
  if (!enabled) return;
  for (const id of ['region-start','region-end','region-start-range','region-end-range']) $(id).max = previewDuration;
  $('region-start').value = $('region-start-range').value = regionDraft.start;
  $('region-end').value = $('region-end-range').value = regionDraft.end;
  const startPct=regionDraft.start/previewDuration*100,endPct=regionDraft.end/previewDuration*100;
  $('region-timeline-selection').style.left=`${startPct}%`;$('region-timeline-selection').style.width=`${endPct-startPct}%`;
  const stacked=(endPct-startPct)*timeline.clientWidth/100<48;timeline.style.height=stacked?'112px':'82px';
  $('region-timeline-start-time').textContent=`${regionDraft.start.toFixed(2)} s`;$('region-timeline-end-time').textContent=`${regionDraft.end.toFixed(2)} s`;
  for(const [id,value,min,max] of [['region-timeline-start-handle',regionDraft.start,0,Math.max(0,regionDraft.end-.05)],['region-timeline-end-handle',regionDraft.end,Math.min(previewDuration,regionDraft.start+.05),previewDuration]]){
    const handle=$(id);handle.style.left=`${value/previewDuration*100}%`;handle.style.top=stacked?(id.includes('start')?'17px':'63px'):'19px';handle.setAttribute('aria-valuemin',min.toFixed(2));handle.setAttribute('aria-valuemax',max.toFixed(2));handle.setAttribute('aria-valuenow',value.toFixed(2));handle.setAttribute('aria-valuetext',`${value.toFixed(2)} seconds`);
  }
  $('region-status').textContent = `Draft: ${regionDraft.start.toFixed(2)}–${regionDraft.end.toFixed(2)} s of ${previewDuration.toFixed(2)} s. Apply to save.`;
}

function moveRegionBoundary(key,value){
  if(!regionDraft||!previewDuration)return;
  const seconds=Math.round(value*100)/100;
  regionDraft=normaliseRegion(key==='start'?seconds:regionDraft.start,key==='end'?seconds:regionDraft.end,previewDuration,key);
  previewingRegion=false;$('region-preview').pause();$('region-preview').currentTime=key==='start'?regionDraft.start:regionDraft.end;renderRegion();
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
  onsetSuggestions=[];$('find-samples').disabled=video.hidden;$('analysis-status').textContent='Suggestions are opt-in and processed locally.';$('sample-suggestions').replaceChildren();renderSuggestionTimeline();
  renderRegion();
  if (!video.hidden) { previewUrl=URL.createObjectURL(file); video.src=previewUrl; video.load(); }
}

function cancelOnsetAnalysis(updateStatus=true){
  onsetMediaAnalysis?.cancel();
  onsetRun++;onsetWorker?.terminate();onsetWorker=null;
  if($('cancel-analysis'))$('cancel-analysis').hidden=true;
  if($('find-samples'))$('find-samples').disabled=!mediaFiles.has(selected);
  if(updateStatus&&$('analysis-status'))$('analysis-status').textContent='Analysis canceled. Manual region selection is still available.';
}

function chooseOnsetSuggestion(candidate){
  regionDraft=normaliseRegion(candidate.start,candidate.end,previewDuration);
  $('region-preview').pause();previewingRegion=false;$('region-preview').currentTime=regionDraft.start;renderRegion();
  $('analysis-status').textContent='Heuristic suggestion selected. Preview, adjust, apply or ignore it.';
}

function renderSuggestionTimeline(){
  const timeline=$('sample-timeline'),markers=$('sample-timeline-markers'),endLabel=$('sample-timeline-end');
  markers.replaceChildren();
  if(!onsetSuggestions.length||!previewDuration){timeline.hidden=true;return;}
  timeline.hidden=false;endLabel.textContent=`${previewDuration.toFixed(1)} s`;
  const width=timeline.clientWidth||300,minGap=46,laneEnds=[];
  const ordered=onsetSuggestions.map((candidate,index)=>({candidate,index})).sort((a,b)=>a.candidate.start-b.candidate.start);
  for(const {candidate,index} of ordered){
    const x=Math.max(23,Math.min(width-23,candidate.start/previewDuration*width));
    let lane=laneEnds.findIndex(last=>x-last>=minGap);if(lane<0)lane=laneEnds.length;laneEnds[lane]=x+minGap;
    const marker=document.createElement('button');marker.type='button';marker.className='sample-timeline-marker';marker.dataset.suggestionIndex=String(index);marker.textContent=String(index+1);
    marker.style.left=`${x/width*100}%`;marker.style.top=`${28+lane*42}px`;
    marker.setAttribute('aria-label',`Suggestion ${index+1}, ${candidate.start.toFixed(2)} to ${candidate.end.toFixed(2)} seconds`);
    marker.title=`Suggestion ${index+1} · ${candidate.start.toFixed(2)}–${candidate.end.toFixed(2)} s`;
    marker.addEventListener('click',()=>chooseOnsetSuggestion(candidate));markers.append(marker);
  }
  timeline.style.height=`${Math.max(74,72+(laneEnds.length-1)*42)}px`;
}
window.addEventListener('resize',()=>{if(onsetSuggestions.length)renderSuggestionTimeline();});

function showOnsetSuggestions(suggestions,token,source='decoded local audio'){
  if(token!==onsetRun)return;
  onsetWorker?.terminate();onsetWorker=null;$('cancel-analysis').hidden=true;
  const list=$('sample-suggestions');list.replaceChildren();
  onsetSuggestions=suggestions;
  if(!suggestions.length){renderSuggestionTimeline();$('analysis-status').textContent='No clear transients found. Keep choosing a region manually.';return;}
  suggestions.forEach((candidate,index)=>{
    const button=document.createElement('button');button.type='button';button.className='suggestion';button.textContent=`Suggestion ${index+1} · ${candidate.start.toFixed(2)}–${candidate.end.toFixed(2)} s · ${candidate.label||'clear onset'}`;
    button.addEventListener('click',()=>chooseOnsetSuggestion(candidate));list.append(button);
  });
  renderSuggestionTimeline();
  $('analysis-status').textContent=`Local heuristic candidates from ${source}. Scores rank transients; they do not judge musical quality.`;
}

function analyseVideoAudioDuringPlayback(file,token){
  return new Promise((resolve,reject)=>{
    const context=audio.context,element=document.createElement('video'),url=URL.createObjectURL(file),levels=[];
    let source,gain,timer,progress,settled=false;
    const cleanup=()=>{
      clearInterval(timer);clearInterval(progress);element.pause();element.removeAttribute('src');element.load();
      try{source?.disconnect();gain?.disconnect();}catch{}
      URL.revokeObjectURL(url);if(onsetMediaAnalysis?.token===token)onsetMediaAnalysis=null;
    };
    const finish=(error=null)=>{
      if(settled)return;settled=true;cleanup();
      if(error)reject(error);else resolve(token===onsetRun?Float32Array.from(levels):null);
    };
    const cancel=()=>finish();
    onsetMediaAnalysis={token,cancel};
    element.preload='auto';element.playsInline=true;element.src=url;
    element.onerror=()=>finish(new Error('The browser could not play this video to inspect its audio track.'));
    element.onended=()=>finish();
    element.onloadedmetadata=async()=>{
      try{
        if(!Number.isFinite(element.duration)||element.duration<=0||element.duration>120)throw new Error('Video playback analysis is limited to 120 seconds.');
        await context.resume();
        if(token!==onsetRun)return finish();
        const analyser=context.createAnalyser();analyser.fftSize=1024;
        source=context.createMediaElementSource(element);gain=context.createGain();gain.gain.value=0;
        source.connect(analyser);analyser.connect(gain);gain.connect(context.destination);
        const samples=new Float32Array(analyser.fftSize);
        timer=setInterval(()=>{
          if(token!==onsetRun)return cancel();
          analyser.getFloatTimeDomainData(samples);let sum=0;
          for(const sample of samples)sum+=sample*sample;
          levels.push(Math.sqrt(sum/samples.length));
          if(levels.length>=6000)finish();
        },20);
        progress=setInterval(()=>{if(token===onsetRun)$('analysis-status').textContent=`Listening to this video's audio locally… ${element.currentTime.toFixed(1)} s of ${element.duration.toFixed(1)} s. Keep this tab open or cancel.`;},500);
        await element.play();
      }catch(error){finish(error);}
    };
    element.load();
  });
}

async function findGoodSounds(){
  const token=++onsetRun,file=mediaFiles.get(selected),windowSeconds=Number($('suggestion-length').value);
  onsetWorker?.terminate();onsetWorker=null;onsetSuggestions=[];$('sample-suggestions').replaceChildren();renderSuggestionTimeline();
  if(!file||!file.type.match(/^(audio|video)\//))return $('analysis-status').textContent='Choose a local audio or video sample first.';
  if(!previewDuration)return $('analysis-status').textContent='Wait for the media duration to load before starting analysis.';
  if(file.size>32*1024*1024)return $('analysis-status').textContent='This file exceeds the 32 MB phone-analysis budget. Manual selection still works.';
  if(previewDuration>120)return $('analysis-status').textContent='Analysis is limited to 120 seconds. Manual selection still works.';
  $('cancel-analysis').hidden=false;$('find-samples').disabled=true;$('analysis-status').textContent='Reading this local file. The browser may not interrupt file decoding immediately; manual selection always remains available.';
  try{
    let mono,sampleRate,analysisSource='decoded local audio';
    try{
      const decoded=await audio.context.decodeAudioData(await file.arrayBuffer());
      if(token!==onsetRun)return;
      if(decoded.duration>120||decoded.length*decoded.numberOfChannels>8_000_000)throw new Error('Decoded audio exceeds the 120-second or 8-million-sample budget.');
      mono=new Float32Array(decoded.length);sampleRate=decoded.sampleRate;
      for(let channel=0;channel<decoded.numberOfChannels;channel++){const samples=decoded.getChannelData(channel);for(let i=0;i<mono.length;i++)mono[i]+=samples[i]/decoded.numberOfChannels;}
    }catch(error){
      if(token!==onsetRun)return;
      if(!file.type.startsWith('video/'))throw error;
      $('analysis-status').textContent='This browser cannot decode the video container directly. Trying its audio track through local playback…';
      mono=await analyseVideoAudioDuringPlayback(file,token);
      if(token!==onsetRun||!mono)return;
      sampleRate=50;analysisSource='video playback';
    }
    const worker=new Worker(new URL('./onsets-worker.js',import.meta.url),{type:'module'});onsetWorker=worker;
    worker.onmessage=event=>{if(token!==onsetRun)return;if(event.data.error){$('cancel-analysis').hidden=true;$('find-samples').disabled=false;$('analysis-status').textContent=`Analysis unavailable: ${event.data.error}. Manual selection still works.`;worker.terminate();onsetWorker=null;return;}showOnsetSuggestions(event.data.suggestions,token,analysisSource);$('find-samples').disabled=false;};
    worker.onerror=()=>{if(token!==onsetRun)return;$('cancel-analysis').hidden=true;$('find-samples').disabled=false;$('analysis-status').textContent='Local analysis failed in this browser. Manual selection still works.';worker.terminate();onsetWorker=null;};
    worker.postMessage({buffer:mono.buffer,sampleRate,windowSeconds},[mono.buffer]);$('analysis-status').textContent=`Finding ${windowSeconds}-second transient regions from ${analysisSource} locally…`;
  }catch(error){if(token===onsetRun){$('cancel-analysis').hidden=true;$('find-samples').disabled=false;$('analysis-status').textContent=`Suggestions unavailable for this media codec: ${error.message}. Manual selection still works.`;}}
}

function padIsAudible(id){return isPadAudible(project.pads.slice(0,PAD_COUNT[project.layout]),id);}
function releasePad(id,atTime=audio.context.currentTime){
  const now=audio.context.currentTime;
  audio.stopPadVoices(id,atTime);
  if(transportTimer)loopRestartAtStep.set(id,nextStep);
  if(atTime<=now){visualUntil.delete(id);activeUntil.delete(id);pads[id]?.card.classList.remove('playing');return;}
  const deadline=performance.now()+(atTime-now)*1000;
  if(visualUntil.has(id))visualUntil.set(id,Math.min(visualUntil.get(id),deadline));
  if(activeUntil.has(id))activeUntil.set(id,Math.min(activeUntil.get(id),deadline));
  setTimeout(()=>{if((activeUntil.get(id)||0)<=performance.now())pads[id]?.card.classList.remove('playing');},Math.max(0,(atTime-now)*1000)+20);
}
function stopInaudiblePadVoices(){
  const pads=project.pads.slice(0,PAD_COUNT[project.layout]),hasSolo=pads.some(pad=>pad.solo&&!pad.muted);
  for(const pad of pads)if(pad.muted||hasSolo&&!pad.solo)releasePad(pad.id);
}

function renderControls() {
  const config = project.pads[selected];
  const hasMedia=mediaFiles.has(selected);
  const demo=DEMO_SOUNDS.find(sound=>sound.id===config.demoSound);
  $('sample-inspector').classList.toggle('has-media',hasMedia);
  const sources=$('editor-sources');
  if(sources.dataset.mediaLoaded!==String(hasMedia)){
    sources.dataset.mediaLoaded=String(hasMedia);
    sources.open=!hasMedia;
    $('editor-sources-title').hidden=!hasMedia;
  }
  $('sample-inspector').classList.toggle('demo-enabled',Boolean(demo)||audio.demoEnabled&&!mediaFiles.has(selected));
  $('demo-bank-editor').hidden=hasMedia;
  renderCopyTargets();
  $('selected-number').textContent = `PAD ${String(selected+1).padStart(2,'0')}`;
  $('selected-circle').textContent = String(selected+1).padStart(2,'0');
  $('pad-name').value = config.name;
  $('sample-info').textContent = hasMedia ? `${config.fileName} · ${config.kind.toUpperCase()} · stored on this device` : demo ? `${demo.name} · generated locally. Choose another demo, record, or import a clip.` : audio.demoEnabled ? 'Demo synth ready to play. No clip is loaded: import or record your own sound to edit its trim, speed and pitch.' : 'No media loaded. Add a clip to get started.';
  $('clear-pad').textContent=hasMedia?'Clear sample':demo?'Clear demo':'Clear sample';
  $('clear-pad').disabled=!hasMedia&&!demo;
  $('volume').value = config.volume*100;
  $('pitch').value = config.pitch;
  const pitchAvailable=audio.canPitch(selected);
  $('pitch').disabled=!pitchAvailable;
  $('pitch-out').textContent=pitchAvailable?`${config.pitch>0?'+':''}${config.pitch} st`:'Unavailable';
  $('pitch-note').textContent=pitchAvailable?'Pitch is processed separately from Speed. Pitch shifting adds a short processing delay; sound quality varies by device.':!mediaFiles.has(selected)?'Load an audio or video sample to use independent Pitch.':audio.pitchReady?'Pitch is unavailable for this media source in this browser. Speed remains available.':'The local Pitch processor could not start in this browser. Speed remains available.';
  $('detect-note').disabled=!mediaFiles.has(selected)||project.pads[selected].kind==='image';
  $('tune-note').disabled=!pitchAvailable||latestDetectedNote?.id!==selected;
  $('tune-status').textContent=latestDetectedNote?.id===selected?`Detected ${latestDetectedNote.note.name} · ${latestDetectedNote.note.frequency.toFixed(1)} Hz · ${latestDetectedNote.note.cents>0?'+':''}${latestDetectedNote.note.cents} cents from A440 tuning. Review by ear before applying.`:'Pitch detection works on clearly pitched solo sounds, not chords, speech or percussion.';
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

function compactSequenceOverview(){return window.matchMedia('(max-width:740px)').matches;}

function updateSequenceFocusMixer(){
  const pad=project.pads[selected];
  for(const [key,id] of [['muted','sequence-focus-mute'],['solo','sequence-focus-solo']]){
    const button=$(id);button.setAttribute('aria-pressed',String(Boolean(pad[key])));
    button.classList.toggle('active',Boolean(pad[key]));
    button.textContent=pad[key]?(key==='muted'?'Unmute':'Unsolo'):(key==='muted'?'Mute':'Solo');
  }
  $('sequence-focus-volume').value=String(Math.round(pad.volume*100));
  $('sequence-focus-volume-out').textContent=`${Math.round(pad.volume*100)}%`;
  $('sequence-focus-playback').value=pad.stepPlaybackMode;
}

function openSequenceFocus(id){
  if(project.pads[id].sequenceMode==='notes'){openSampleNoteEditor(id);return;}
  if(!compactSequenceOverview()){selectPad(id);return;}
  selectPad(id);
  $('sequence-focus-title').textContent=`Pad ${id+1} · edit steps`;
  $('sequence-focus-steps').append($('steps'));
  $('steps').hidden=false;
  updateSequenceFocusMixer();
  const dialog=$('sequence-focus-dialog');if(!dialog.open)dialog.showModal();
}

function closeSequenceFocus(){
  const dialog=$('sequence-focus-dialog');if(!dialog.open)return;
  dialog.close();
  $('track-grid').before($('steps'));
  $('steps').hidden=trackGridVisible;
  document.querySelector(`.track-row[data-pad="${selected}"] .track-name`)?.focus();
}


function openSampleNoteEditor(id=selected){
  if($('sequence-focus-dialog').open)closeSequenceFocus();
  selectPad(id);
  selectedSampleNote=null;notePointer=null;
  $('sample-note-title').textContent='Pad '+(id+1)+' · draw sample notes';
  $('sample-note-dialog').showModal();
  renderSampleNoteEditor();
  $('note-grid').querySelector('[data-note-pitch="0"][data-note-step="0"]')?.scrollIntoView({block:'center',inline:'nearest'});
}
function renderSampleNoteEditor(){
  const pad=project.pads[selected],host=$('note-grid');
  host.replaceChildren();
  $('note-lane-mode').value=pad.sequenceMode;
  for(let pitch=12;pitch>=-12;pitch--){
    const row=document.createElement('div');row.className='sample-note-row';row.setAttribute('role','row');
    const label=document.createElement('span');label.className='sample-note-pitch';label.textContent=(pitch>0?'+':'')+pitch+' st';row.append(label);
    for(let step=0;step<16;step++){
      const held=pad.sampleNotes.find(note=>note.semitones===pitch&&note.step<=step&&step<note.step+note.length);
      const cell=document.createElement('button');cell.type='button';
      cell.className='sample-note-cell'+(held?' note-held':'')+(held?.step===step?' note-start':'')+(held?.step===selectedSampleNote?' selected':'');
      cell.dataset.noteStep=String(step);cell.dataset.notePitch=String(pitch);
      cell.textContent=held?.step===step?String(held.length):'';
      cell.setAttribute('aria-label',(pitch>0?'+':'')+pitch+' semitones, step '+(step+1)+(held?', note starts at step '+(held.step+1)+' and lasts '+held.length+' steps':', empty'));
      cell.addEventListener('pointerdown',event=>{
        if(event.button!==0)return;
        notePointer={pointerId:event.pointerId,start:step,end:step,pitch};
      });
      cell.addEventListener('click',event=>{
        if(event.detail!==0)return;
        if(held){selectedSampleNote=held.step;renderSampleNoteEditor();}
        else commitSampleNote(step,step,pitch);
      });
      row.append(cell);
    }
    host.append(row);
  }
  const active=pad.sampleNotes.find(note=>note.step===selectedSampleNote);
  $('note-length').disabled=!active;$('note-delete').disabled=!active;
  $('note-length').max=String(active?16-active.step:16);
  $('note-length').value=String(active?.length||1);
  $('note-status').textContent=pad.sampleNotes.length+' notes · '+(pad.sequenceMode==='notes'?'Notes playing':'Steps playing')+'. Tap a cell for one note, or drag right to join steps. Overlapping notes are replaced.';
}
function commitSampleNote(start,end,pitch){
  const pad=project.pads[selected];
  pad.sampleNotes=setSampleNote(pad.sampleNotes,{step:start,length:end-start+1,semitones:pitch});
  pad.sequenceMode='notes';selectedSampleNote=start;
  renderSampleNoteEditor();renderTrackGrid();queueSave();
}
function finishSampleNoteDrag(event){
  if(!notePointer||event.pointerId!==notePointer.pointerId)return;
  const {start,end,pitch}=notePointer;notePointer=null;
  const existing=project.pads[selected].sampleNotes.find(note=>note.semitones===pitch&&note.step<=start&&start<note.step+note.length);
  if(existing&&end===start){selectedSampleNote=existing.step;renderSampleNoteEditor();}
  else commitSampleNote(start,end,pitch);
}
function updateSampleNoteDrag(event){
  if(!notePointer||notePointer.pointerId!==event.pointerId)return;
  const el=document.elementFromPoint(event.clientX,event.clientY)?.closest('.sample-note-cell');
  if(!el||Number(el.dataset.notePitch)!==notePointer.pitch)return;
  notePointer.end=Math.max(notePointer.start,Number(el.dataset.noteStep));
  $('note-grid').querySelectorAll('.sample-note-cell').forEach(cell=>{
    cell.classList.toggle('drawing',Number(cell.dataset.notePitch)===notePointer.pitch&&Number(cell.dataset.noteStep)>=notePointer.start&&Number(cell.dataset.noteStep)<=notePointer.end);
  });
}

function setTrackView(allTracks){
  trackGridVisible=Boolean(allTracks);
  $('steps').hidden=trackGridVisible;
  $('track-grid').hidden=!trackGridVisible;
  const toggle=$('track-view');toggle.textContent=trackGridVisible?'FOCUS A PAD':'ALL TRACKS';
  toggle.setAttribute('aria-pressed',String(trackGridVisible));
  if(trackGridVisible)renderTrackGrid();
}

function gridStride(){return project.gridDivision==='1/4'?4:project.gridDivision==='1/8'?2:1;}

function renderSteps() {
  const holder = $('steps');
  holder.replaceChildren();
  const stride=gridStride(),positions=Array.from({length:16/stride},(_,index)=>index*stride);
  holder.style.gridTemplateColumns=`repeat(${positions.length},minmax(0,1fr))`;
  positions.forEach(i => {
    const enabled=project.pads[selected].steps[i];
    const button = document.createElement('button');
    button.type = 'button'; button.className = `step${enabled?' on':''}`;
    button.textContent = String(i+1).padStart(2,'0');
    button.dataset.step=String(i);
    button.setAttribute('aria-label',`Step ${i+1} ${enabled?'on':'off'} at ${project.gridDivision} grid`);
    button.setAttribute('aria-pressed',String(enabled));
    button.disabled=Boolean(patternRecording);
    button.addEventListener('click', () => {
      if(patternRecording)return;
      releasePad(selected);
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
  const holder=$('track-grid'),focused=holder.contains(document.activeElement)?{pad:document.activeElement.closest('.track-row')?.dataset.pad,step:document.activeElement.dataset.step,control:document.activeElement.dataset.control}:null,previousScroll=holder.querySelector('.track-steps')?.scrollLeft||0;holder.replaceChildren();
  const count=PAD_COUNT[project.layout],hasSolo=project.pads.slice(0,count).some(pad=>pad.solo);
  const compact=compactSequenceOverview();
  const stride=gridStride(),positions=Array.from({length:16/stride},(_,index)=>index*stride);
  for(let id=0;id<count;id++){
    const pad=project.pads[id],row=document.createElement('div');row.className=`track-row${pad.muted?' muted':''}${pad.solo?' solo':''}`;row.dataset.pad=id;row.setAttribute('role','group');
    const head=document.createElement('div');head.className='track-head';
    const demo=DEMO_SOUNDS.find(sound=>sound.id===pad.demoSound);
    const trackLabel=mediaFiles.has(id)?pad.name:demo?.name||(audio.demoEnabled?`Demo synth ${String(id+1).padStart(2,'0')}`:'Empty pad');
    const lanePositions=pad.sequenceMode==='notes'?Array.from({length:16},(_,step)=>step):positions;
    const enabledCount=pad.sequenceMode==='notes'?pad.sampleNotes.length:positions.filter(step=>pad.steps[step]).length;
    row.setAttribute('aria-label',compact?`Pattern lane ${id+1}: ${trackLabel}; ${enabledCount} of ${positions.length} steps active. Select lane name to edit.`:`Pattern lane ${id+1}: ${trackLabel}`);
    const name=document.createElement('button');name.type='button';name.dataset.control='name';name.className='track-name';name.textContent=`${String(id+1).padStart(2,'0')} · ${trackLabel}`;name.setAttribute('aria-label',compact?`Edit pattern for pad ${id+1}, ${trackLabel}`:`Select pad ${id+1}, ${trackLabel}`);name.addEventListener('click',()=>compact?openSequenceFocus(id):selectPad(id));head.append(name);
    const notesButton=document.createElement('button');notesButton.type='button';notesButton.dataset.control='notes';notesButton.className='track-note-edit';notesButton.textContent=pad.sequenceMode==='notes'?'NOTES ✓':'NOTES';notesButton.setAttribute('aria-label','Draw melodic notes for pad '+(id+1));notesButton.addEventListener('click',()=>openSampleNoteEditor(id));head.append(notesButton);
    const edit=document.createElement('button');edit.type='button';edit.dataset.control='edit';edit.className='track-edit';edit.textContent='EDIT';edit.setAttribute('aria-label',`Edit pad ${id+1}`);edit.addEventListener('click',()=>openSampleEditor(id));head.append(edit);
    for(const [key,label] of [['muted','M'],['solo','S']]){const button=document.createElement('button');button.type='button';button.dataset.control=key;button.className=`track-toggle${pad[key]?' active':''}`;button.textContent=label;button.setAttribute('aria-label',`${pad[key]?'Disable':'Enable'} ${key} for pad ${id+1}`);button.setAttribute('aria-pressed',String(pad[key]));button.addEventListener('click',()=>{pad[key]=!pad[key];stopInaudiblePadVoices();renderTrackGrid();queueSave();});head.append(button);}
    const gain=document.createElement('input');gain.type='range';gain.min='0';gain.max='150';gain.value=String(Math.round(pad.volume*100));gain.className='track-gain';gain.setAttribute('aria-label',`Volume for pad ${id+1}`);gain.addEventListener('input',()=>{pad.volume=Number(gain.value)/100;if(selected===id){$('volume').value=gain.value;$('volume-out').textContent=`${gain.value}%`;}queueSave();});head.append(gain);
    if(!compact){const mode=document.createElement('select');mode.dataset.control='playback';mode.className='track-playback';mode.setAttribute('aria-label',`Step playback mode for pad ${id+1}`);mode.title='Full sound can ring; one sound per step gates each cell; loop held steps sustains a contiguous run.';for(const [value,label] of [['full','FULL'],['one-step','ONE STEP'],['loop','LOOP HELD']]){const option=document.createElement('option');option.value=value;option.textContent=label;mode.append(option);}mode.value=pad.stepPlaybackMode;mode.addEventListener('change',()=>{releasePad(id);pad.stepPlaybackMode=['one-step','loop'].includes(mode.value)?mode.value:'full';if(selected===id)$('sequence-focus-playback').value=pad.stepPlaybackMode;if(pad.stepPlaybackMode==='loop'&&!audio.supportsSampleLoop(id))notify('This pad needs decoded local audio for seamless looping; it will play as a one-shot in this browser.');queueSave();});head.append(mode);}
    row.append(head);
    const cells=document.createElement('div');cells.className=compact?'track-steps compact-overview':'track-steps';cells.style.setProperty('--track-step-count',String(lanePositions.length));
    if(!compact)cells.addEventListener('scroll',()=>{for(const other of holder.querySelectorAll('.track-steps'))if(other!==cells&&other.scrollLeft!==cells.scrollLeft)other.scrollLeft=cells.scrollLeft;},{passive:true});
    lanePositions.forEach(index=>{
      const note=pad.sequenceMode==='notes'?pad.sampleNotes.find(item=>item.step<=index&&index<item.step+item.length):null;
      const enabled=pad.sequenceMode==='notes'?Boolean(note):pad.steps[index],step=document.createElement(compact?'span':'button');
      step.dataset.step=String(index);
      step.className=`${compact?'step-overview':'step'}${enabled?' on':''}${note&&note.step!==index?' note-held':''}${note&&note.step===index?' note-start':''}`;
      if(compact){step.setAttribute('aria-hidden','true');}
      else {
        step.type='button';step.textContent=note&&note.step===index?((note.semitones>0?'+':'')+note.semitones):String(index+1).padStart(2,'0');
        step.setAttribute('aria-label',pad.sequenceMode==='notes'?`Pad ${id+1}, melodic note ${note?'held':'empty'} at step ${index+1}; open Notes to edit`:`Pad ${id+1}, step ${index+1} ${enabled?'on':'off'} at ${project.gridDivision} grid`);
        step.setAttribute('aria-pressed',String(enabled));step.disabled=Boolean(patternRecording)||pad.sequenceMode==='notes';
        step.addEventListener('click',()=>{if(patternRecording)return;releasePad(id);patternUndoSnapshot=null;renderPatternRecordingState();pad.steps[index]=!pad.steps[index];pad.stepOffsets[index]=0;renderSteps();queueSave();});
      }
      cells.append(step);
    });row.append(cells);
    if(hasSolo&&!pad.solo)row.classList.add('solo-muted');holder.append(row);
  }
  if(focused?.pad!==undefined){
    const selector=focused.control?`data-control="${focused.control}"`:`data-step="${focused.step}"`;
    holder.querySelector(`.track-row[data-pad="${focused.pad}"] [${selector}]`)?.focus();
  }
  if(window.matchMedia('(max-width:740px)').matches){
    const activeSteps=focused?.pad!==undefined?holder.querySelector(`.track-row[data-pad="${focused.pad}"] .track-steps`):null;
    const scrollLeft=focused?.step!==undefined&&activeSteps?activeSteps.scrollLeft:previousScroll;
    for(const lane of holder.querySelectorAll('.track-steps'))lane.scrollLeft=scrollLeft;
  }
}

function renderSession() {
  $('project-title').value = project.title;
  $('layout-select').value = project.layout;
  $('bpm-input').value = project.bpm;
  $('quantize-select').value = project.quantize;
  $('grid-division').value=project.gridDivision;
  $('video-aspect').value = project.video.aspect;
  audio.demoEnabled=Boolean(project.demoEnabled);
  for(const button of [$('demo-button'),$('quick-demo')]){
    button.classList.toggle('active',audio.demoEnabled);
    button.setAttribute('aria-pressed',String(audio.demoEnabled));
  }
  renderGrid(); renderControls(); renderSteps(); setTrackView(trackGridVisible); renderScenes(); renderSong(); setSequenceView(sequenceView,false); renderVideoDirector();
  audio.setTransport(project.bpm,project.quantize);
  syncRegionPreview();
}

function renderVideoDirector(){
  const host=$('director-steps');host.replaceChildren();
  project.video.shots.forEach((shot,index)=>{
    const button=document.createElement('button');button.type='button';
    button.className=`director-step${index===directorEditStep?' selected':''}${index===directorPlayingStep?' current':''}`;
    button.textContent=String(index+1).padStart(2,'0');
    button.setAttribute('aria-label',`Video step ${index+1}: ${shot.mode}${shot.pads.length?` pads ${shot.pads.map(id=>id+1).join(', ')}`:''}`);
    button.setAttribute('aria-pressed',String(index===directorEditStep));
    button.addEventListener('click',()=>{directorEditStep=index;renderVideoDirector();});host.append(button);
  });
  const shot=project.video.shots[directorEditStep];
  $('director-mode').value=shot.mode;
  const padHost=$('director-pads');padHost.replaceChildren();
  for(let id=0;id<PAD_COUNT[project.layout];id++){
    const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.value=String(id);
    checkbox.checked=shot.pads.includes(id);checkbox.disabled=shot.mode==='auto'||shot.mode==='black';
    const label=document.createElement('label');label.append(checkbox,document.createTextNode(`${String(id+1).padStart(2,'0')} ${project.pads[id].name}`));
    checkbox.addEventListener('change',()=>{
      shot.pads=shot.mode==='solo'?(checkbox.checked?[id]:[]):checkbox.checked?[...new Set([...shot.pads,id])]:shot.pads.filter(padId=>padId!==id);
      queueSave();renderVideoDirector();
    });padHost.append(label);
  }
  $('director-status').textContent=`Step ${directorEditStep+1} · ${shot.mode==='auto'?'follow triggered pads':shot.mode==='black'?'black':shot.pads.length?`show pad${shot.pads.length>1?'s':''} ${shot.pads.map(id=>id+1).join(', ')}`:'choose at least one pad'}. Choose “Video Director” on Finish & Export to use these cuts.`;
}

function showDirectorPlayingStep(step){
  directorPlayingStep=step;
  for(const [index,element] of [...$('director-steps').children].entries())element.classList.toggle('current',index===step);
}

function sceneSnapshot(name,id=`scene-${Date.now()}-${Math.random().toString(36).slice(2,8)}`){
  return {id,name,gridDivision:project.gridDivision,pads:project.pads.map(pad=>({steps:[...pad.steps],stepOffsets:[...pad.stepOffsets],stepPlaybackMode:pad.stepPlaybackMode,sequenceMode:pad.sequenceMode,sampleNotes:pad.sampleNotes.map(note=>({...note}))})),videoShots:project.video.shots.map(shot=>({mode:shot.mode,pads:[...shot.pads]}))};
}


function setSequenceView(view,stopOnSwitch=true){
  const next=view==='song'?'song':'patterns';
  if(next!==sequenceView&&stopOnSwitch&&transportActivity.phase!=='idle')stopSequencer();
  sequenceView=next;
  $('pattern-view').setAttribute('aria-pressed',String(next==='patterns'));
  $('song-view').setAttribute('aria-pressed',String(next==='song'));
  $('sequence-pattern-content').hidden=next!=='patterns';
  $('song-arranger').hidden=next!=='song';
  if(next==='song')renderSong();
  updateTransportButton();
}
function editSong(mutator){
  if(transportActivity.phase!=='idle')stopSequencer();
  mutator(project.song.clips);
  renderSong();queueSave();
}
function renderSong(){
  const source=$('song-scene-select'),selectedId=source.value;
  source.replaceChildren();
  for(const scene of project.scenes){
    const option=document.createElement('option');option.value=scene.id;option.textContent=scene.name;source.append(option);
  }
  if(project.scenes.some(scene=>scene.id===selectedId))source.value=selectedId;
  const clips=project.song.clips,barCount=songTotalBars(project.song);
  $('song-add-section').disabled=!project.scenes.length||clips.length>=MAX_SONG_CLIPS||barCount>=MAX_SONG_BARS;
  const timeline=$('song-timeline'),editor=$('song-clip-editor');
  timeline.replaceChildren();editor.replaceChildren();
  let bar=1;
  for(const [index,clip] of clips.entries()){
    const scene=project.scenes.find(item=>item.id===clip.sceneId);
    const name=scene?.name||'Missing pattern';
    const start=bar,end=bar+clip.bars-1;
    const segment=document.createElement('button');
    segment.type='button';segment.className='song-section-clip';
    segment.style.width=(clip.bars*28)+'px';
    segment.style.flex='none';segment.dataset.songClip=clip.id;
    segment.textContent=(scene?name:'?')+' · '+clip.bars+' bars';
    segment.title=name+' · bars '+start+'–'+end;
    segment.setAttribute('aria-label',name+' in song from bar '+start+' through '+end+'; select section to edit');
    segment.addEventListener('click',()=>editor.querySelector('[data-song-section="'+clip.id+'"]')?.focus());
    timeline.append(segment);
    const row=document.createElement('div');row.className='song-section-editor';
    row.dataset.songSection=clip.id;
    row.tabIndex=-1;
    const heading=document.createElement('strong');heading.textContent=name+' · bars '+start+'–'+end;
    const label=document.createElement('label');label.textContent='LENGTH (BARS)';
    const bars=document.createElement('input');bars.type='number';bars.min='1';bars.max=String(Math.min(64,MAX_SONG_BARS-(barCount-clip.bars)));bars.step='1';bars.value=String(clip.bars);bars.setAttribute('aria-label','Length in bars for '+name+' section '+(index+1));
    bars.addEventListener('change',()=>{
      editSong(()=>{clip.bars=Math.round(clamp(bars.value,1,Number(bars.max)));});
    });label.append(bars);
    const action=(text,disabled,handler)=>{
      const button=document.createElement('button');button.type='button';button.className='quiet-button';button.textContent=text;button.disabled=disabled;
      button.addEventListener('click',handler);return button;
    };
    const left=action('←',index===0,()=>editSong(array=>{[array[index-1],array[index]]=[array[index],array[index-1]];}));
    left.setAttribute('aria-label','Move '+name+' section earlier');
    const right=action('→',index===clips.length-1,()=>editSong(array=>{[array[index+1],array[index]]=[array[index],array[index+1]];}));
    right.setAttribute('aria-label','Move '+name+' section later');
    const copy=action('DUPLICATE',clips.length>=MAX_SONG_CLIPS||barCount+clip.bars>MAX_SONG_BARS,()=>editSong(array=>array.splice(index+1,0,{...clip,id:'song-'+Date.now()+'-'+Math.random().toString(36).slice(2,7)})));
    const remove=action('REMOVE',false,()=>editSong(array=>array.splice(index,1)));
    row.append(heading,label,left,right,copy,remove);editor.append(row);
    bar+=clip.bars;
  }
  const seconds=barCount*4*60/clamp(project.bpm,40,240);
  const minutes=Math.floor(seconds/60),remain=Math.floor(seconds%60);
  $('song-status').textContent=clips.length
    ?clips.length+' sections · '+barCount+' bars · approx '+minutes+':'+String(remain).padStart(2,'0')+' at '+project.bpm+' BPM. Patterns remain linked to their saved scene.'
    :'No song sections yet. Save pattern A, B and C, then add each one in the order you want.';
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
  renderSong();
}

function applyScene(scene,atTime=audio.context.currentTime){
  for(const pad of project.pads)releasePad(pad.id,atTime);
  project.gridDivision=['1/4','1/8','1/16'].includes(scene.gridDivision)?scene.gridDivision:'1/16';
  $('grid-division').value=project.gridDivision;
  project.pads.forEach((pad,id)=>{
    const lane=scene.pads[id]||{};
    pad.steps=Array.from({length:16},(_,step)=>Boolean(lane.steps?.[step]));
    pad.stepOffsets=Array.from({length:16},(_,step)=>clamp(lane.stepOffsets?.[step]??0,0,.9999));
    pad.stepPlaybackMode=['one-step','loop'].includes(lane.stepPlaybackMode)?lane.stepPlaybackMode:'full';
    pad.sequenceMode=lane.sequenceMode==='notes'?'notes':'steps';
    pad.sampleNotes=normaliseSampleNotes(lane.sampleNotes);
  });
  if(Array.isArray(scene.videoShots))project.video.shots=scene.videoShots.map(shot=>({mode:shot.mode,pads:[...shot.pads]}));
  renderSteps();renderVideoDirector();queueSave();
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
  project.scenes[selectedSceneIndex]=sceneSnapshot(name,project.scenes[selectedSceneIndex].id);renderScenes();queueSave();notify(`Scene “${name}” updated.`);
}

function deleteScene(){
  if(selectedSceneIndex<0)return;
  const scene=project.scenes[selectedSceneIndex];
  if(project.song.clips.some(clip=>clip.sceneId===scene.id))return notify(`“${scene.name}” is used in the song. Remove its sections before deleting the pattern.`);
  if(!confirm(`Delete the saved scene “${scene.name}”?`))return;
  project.scenes.splice(selectedSceneIndex,1);
  if(pendingScene?.scene.name===scene.name)pendingScene=null;
  selectedSceneIndex=Math.min(selectedSceneIndex,project.scenes.length-1);renderScenes();queueSave();
}

function launchScene(){
  if(selectedSceneIndex<0)return;
  if(transportTimer&&sequenceView==='song')return notify('Stop song playback before launching a standalone scene.');
  const scene=JSON.parse(JSON.stringify(project.scenes[selectedSceneIndex]));
  if(transportTimer){
    const earliest=Math.max(audio.context.currentTime+.14,nextStepTime);
    pendingScene={scene,at:nextBarTime(earliest,audio.transportEpoch,project.bpm)};
    renderScenes();notify(`Scene “${scene.name}” queued for the next bar.`);
  } else {applyScene(scene);notify(`Scene “${scene.name}” loaded.`);}
}

async function playPad(id, scheduledAt, momentary=false) {
  if(!padIsAudible(id))return;
  await audio.unlock();
  audio.setTransport(project.bpm,project.quantize);
  if(!audio.demoEnabled&&!project.pads[id].demoSound&&!audio.sources.get(id)?.file){notify('This pad is empty. Add a clip or choose a demo sound.');return;}
  if(patternRecording)capturePatternTap(id);
  if (!audio.trigger(id,project.pads[id],flashPad,scheduledAt,{momentary})) {
    notify('This pad is empty. Add a clip or switch on demo sounds.');
  }
}

function renderPatternRecordingState(){
  const active=Boolean(patternRecording),button=$('record-pattern');
  button.textContent=active?'■ STOP TAKE':'● RECORD PATTERN';
  button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));
  $('pattern-take-mode').disabled=active;$('pattern-quantize').disabled=active;$('grid-division').disabled=active;
  $('auto-beat').disabled=active;$('clear-steps').disabled=active;
  $('undo-pattern').disabled=active||!patternUndoSnapshot;
  $('pattern-record-status').textContent=active
    ?`${patternRecording.mode==='replace'?'Replace':'Overdub'} · ${patternRecording.quantize==='nearest'?`nearest ${patternRecording.gridDivision}`:'free timing'}`
    :patternUndoSnapshot?'Take saved locally · undo available':'Ready to record pad taps into the 16-step loop.';
}

function capturePatternTap(id){
  const take=patternRecording,pad=project.pads[id];
  const elapsed=audio.context.currentTime-take.startedAt;
  if(elapsed<0)return;
  const position=captureStepPosition(elapsed,take.bpm,take.quantize,take.stride);
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
  patternRecording={startedAt,bpm:project.bpm,mode,quantize:$('pattern-quantize').value,gridDivision:project.gridDivision,stride:gridStride(),startsOnBar};
  renderSteps();renderPatternRecordingState();queueSave();
  $('record-pattern').blur();notify(`Recording ${mode==='replace'?'replacement':'overdub'} pattern${startsOnBar?' from the next bar':''}. Tap pads, then stop the take.`);
}

function undoPatternRecording(){
  if(!patternUndoSnapshot||patternRecording)return;
  audio.stopAllPadVoices();
  visualUntil.clear();activeUntil.clear();
  project.pads.forEach((pad,id)=>{pad.steps=[...patternUndoSnapshot[id].steps];pad.stepOffsets=[...patternUndoSnapshot[id].stepOffsets];});
  patternUndoSnapshot=null;renderSteps();renderPatternRecordingState();queueSave();notify('Last pattern take undone.');
}

function flashPad(id,maxDuration=null,looping=false) {
  const now=performance.now(),activeDeadline=looping?(maxDuration===Infinity?Infinity:now+Math.max(180,(maxDuration||0)*1000)):now+180;
  activeUntil.set(id,activeDeadline);
  const config=project.pads[id],duration=videoVisualDurationMs(config.start,config.end,config.speed);
  visualUntil.set(id,looping?(maxDuration===Infinity?Infinity:now+Math.max(0,maxDuration||0)*1000):now+(Number.isFinite(maxDuration)&&maxDuration>0?Math.min(duration,maxDuration*1000):duration));
  pads[id].card.classList.add('playing');
  if(Number.isFinite(activeDeadline))setTimeout(() => { if ((activeUntil.get(id)||0) <= performance.now()) pads[id].card.classList.remove('playing'); },Math.max(210,activeDeadline-now+20));
}

async function addMedia(id,file,persist=true) {
  if (!supportedMediaFile(file)) throw new Error(`${file?.name || 'File'} is not an audio, video or image file`);
  if (file.size > MAX_MEDIA_BYTES) throw new Error(`${file.name} is over the 80 MB per-clip limit. Please trim it first.`);
  const config=project.pads[id];
  const kind=file.type.split('/')[0];
  const previousFile=mediaFiles.get(id);
  if (persist) await putValue(`media:${id}`,file);
  let source;
  try { source=await audio.load(id,file,kind==='image'?null:pads[id].video); }
  catch(error) {
    if(persist){
      try { if(previousFile)await putValue(`media:${id}`,previousFile);else await deleteValue(`media:${id}`); }
      catch(restoreError){console.warn('Could not restore the previous local sample after import failed',restoreError);}
    }
    if(previousFile){try{await audio.load(id,previousFile,pads[id].video);}catch{audio.unload(id);}}
    else audio.unload(id);
    throw error;
  }
  mediaFiles.set(id,file);
  config.demoSound='';
  config.kind=kind;
  config.fileName=file.name;
  config.name=file.name.replace(/\.[^/.]+$/,'').slice(0,45) || `Pad ${id+1}`;
  config.start=0;
  durations.delete(id);
  if (source.buffer) durations.set(id,source.buffer.duration);
  config.end=Math.max(.05,Math.min(2,durations.get(id)||2));
  window.dispatchEvent(new Event('madladpad-media-change'));
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
  let cursor=0,previousDuration=0;
  const requestedCrossfade=Math.min(250,Math.max(0,Number(phrase.crossfadeMs??0)))/1000;
  const gap=requestedCrossfade?0:Math.min(500,Math.max(0,Number(phrase.gapMs??35)))/1000;
  const plan=clips.map((clip,index)=>{
    if(index){const overlap=Math.min(requestedCrossfade,previousDuration/2,clip.duration/2);cursor+=previousDuration+gap-overlap;}
    const position=cursor/secondsPerStep,step=Math.floor(position+1e-7),offset=position-step;
    if(step>=16||cursor+clip.duration>barDuration+1e-6)return null;
    previousDuration=clip.duration;
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
    replaceProjectState(normaliseProject(previousProject));
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
    catch(error) { notify(`Could not add ${accepted[i]?.name||'sample'}: ${error?.message||'the browser could not store this media on this device.'}`); }
  }
  selectPad(start);
  if(loaded)notify(`${loaded} sample${loaded===1?'':'s'} added and stored on this device. Tap a pad to play.`);
}

function startSequencer() {
  if(sequenceView==='song'){
    if(!project.song.clips.length)return notify('Add saved patterns to Song before playing.');
    if(project.song.clips.some(clip=>!project.scenes.some(scene=>scene.id===clip.sceneId)))
      return notify('A song section refers to a missing pattern. Remove or repair that section before playing.');
  }
  const playbackSong=sequenceView==='song'
    ?JSON.parse(JSON.stringify({song:project.song,scenes:project.scenes}))
    :null;
  const token = transportActivity.begin();
  if (token===null) return;
  updateTransportButton();
  audio.unlock().then(() => {
    if (!transportActivity.activate(token)) return;
    audio.setTransport(project.bpm,'off');
    const secondsPerStep=60/project.bpm/4;
    audio.setEpoch(audio.context.currentTime+.08);
    nextStepTime=audio.transportEpoch;
    nextStep=0;
    let priorSongClipId=null;
    const tick=() => {
      while (nextStepTime<audio.context.currentTime+.12) {
        const time=nextStepTime;
        if(!playbackSong&&pendingScene&&time>=pendingScene.at-1e-4){const queued=pendingScene;pendingScene=null;applyScene(queued.scene,time);renderScenes();notify(`Scene “${queued.scene.name}” launched.`);}
        const absoluteStep=nextStep;
        const section=playbackSong?songSectionAtStep(playbackSong.song,playbackSong.scenes,absoluteStep):null;
        if(playbackSong&&!section){
          clearInterval(transportTimer);transportTimer=null;
          songEndTimer=setTimeout(()=>{
            if(transportActivity.current(token)){stopSequencer();notify('Song finished. Recordings remain in this project.');}
          },Math.max(0,(time-audio.context.currentTime)*1000));
          return;
        }
        const step=section?.localStep??absoluteStep%16;
        const division=section?.scene?.gridDivision??project.gridDivision;
        const stride=division==='1/4'?4:division==='1/8'?2:1;
        if(section&&section.clip.id!==priorSongClipId){
          priorSongClipId=section.clip.id;
          for(const pad of project.pads.slice(0,PAD_COUNT[project.layout]))releasePad(pad.id,time);
        }
        project.pads.slice(0,PAD_COUNT[project.layout]).forEach(pad => {
          if(!padIsAudible(pad.id))return;
          const lane=section?section.scene?.pads?.[pad.id]:pad;
          if(!lane)return;
          if(lane.sequenceMode==='notes'){
            const note=sampleNoteAtStep(lane.sampleNotes,step);
            if(!note)return;
            const gate=note.length*secondsPerStep;
            const canLoop=audio.supportsSampleLoop(pad.id);
            const pitched={...pad,pitch:clamp(pad.pitch+note.semitones,-12,12)};
            audio.trigger(pad.id,pitched,flashPad,time,{maxDuration:gate,loop:canLoop});
            if(!canLoop&&!loopFallbackNotified.has(pad.id)){
              loopFallbackNotified.add(pad.id);
              notify('This pad can stop at the note end but cannot repeat this media seamlessly.');
            }
            return;
          }
          if(step%stride!==0||!lane.steps[step])return;
          const offset=lane.stepOffsets?.[step]||0,triggerAt=stepTriggerTime(time,project.bpm,offset);
          let maxDuration=lane.stepPlaybackMode==='one-step'?stepGateDuration(project.bpm,offset):null,loop=false;
          if(lane.stepPlaybackMode==='loop'){
            const initial=section?absoluteStep===(section.startBar-1)*16:absoluteStep===(loopRestartAtStep.get(pad.id)??0);
            const gate=stepLoopGateDuration(lane.steps,step,project.bpm,offset,initial);
            if(gate===null)return;
            loopRestartAtStep.delete(pad.id);
            if(audio.supportsSampleLoop(pad.id)){loop=true;maxDuration=Number.isFinite(gate)?gate:null;}
            else if(!loopFallbackNotified.has(pad.id)){loopFallbackNotified.add(pad.id);notify(`Pad ${pad.id+1} cannot loop seamlessly here; playing one full sound at the start of each held run.`);}
          }
          audio.trigger(pad.id,pad,flashPad,triggerAt,{maxDuration,loop});
        });
        voiceLab?.scheduleMelodyStep(absoluteStep,time,project.bpm);
        setTimeout(()=>{
          if(!transportActivity.current(token) || !transportTimer)return;
          showDirectorPlayingStep(step);
          voiceLab?.highlightRapBar(absoluteStep);
          updateBeatIndicator(Math.floor(step/stride));
          if(section){for(const node of $('song-timeline').querySelectorAll('.song-section-clip'))node.classList.toggle('current',node.dataset.songClip===section.clip.id);}
        },Math.max(0,(time-audio.context.currentTime)*1000));
        nextStep++;
        nextStepTime+=secondsPerStep;
      }
    };
    transportTimer=setInterval(tick,25);
    voiceLab?.transportStarted(audio.transportEpoch,project.bpm);
    tick();
    updateTransportButton();
    renderScenes();
  }).catch(error=>{
    if (!transportActivity.current(token)) return;
    stopSequencer();
    notify(`Could not start loop: ${error.message}`);
  });
}

function updateBeatIndicator(step) {
  if (!transportTimer) return;
  [...$('steps').children].forEach((el,i)=>el.classList.toggle('current',i===step));
  $('track-grid').querySelectorAll('.track-steps').forEach(lane=>[...lane.children].forEach((el,i)=>el.classList.toggle('current',i===step)));
}

function stopSequencer() {
  transportActivity.cancel();
  if(songEndTimer!==null){clearTimeout(songEndTimer);songEndTimer=null;}
  $('song-timeline').querySelectorAll('.current').forEach(node=>node.classList.remove('current'));
  clearInterval(transportTimer); transportTimer=null;
  loopRestartAtStep.clear();
  audio.stopAllPadVoices();
  visualUntil.clear();activeUntil.clear();
  voiceLab?.transportStopped();
  directorPlayingStep=null;
  $('director-steps').querySelectorAll('.current').forEach(node=>node.classList.remove('current'));
  if(pendingScene){pendingScene=null;renderScenes();notify('Queued scene canceled because the sequencer stopped.');}
  else renderScenes();
  updateTransportButton();
  [...$('steps').children].forEach(el=>el.classList.remove('current'));
  $('track-grid').querySelectorAll('.current').forEach(el=>el.classList.remove('current'));
}

function surpriseBeat() {
  const count=PAD_COUNT[project.layout];
  if (!count) return;
  for(const pad of project.pads.slice(0,count))releasePad(pad.id);
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

function drawMediaCover(context,media,x,y,width,height){
  const sourceWidth=media.videoWidth||media.naturalWidth,sourceHeight=media.videoHeight||media.naturalHeight;
  if(!sourceWidth||!sourceHeight)return;
  const scale=Math.max(width/sourceWidth,height/sourceHeight);
  const cropWidth=width/scale,cropHeight=height/scale;
  context.drawImage(media,(sourceWidth-cropWidth)/2,(sourceHeight-cropHeight)/2,cropWidth,cropHeight,x,y,width,height);
}

function drawPerformanceFrame() {
  if (!drawing) return;
  const canvas=$('capture-canvas');
  const context=canvas.getContext('2d');
  context.fillStyle='#0c100e';context.fillRect(0,0,canvas.width,canvas.height);
  const layout=$('record-layout').value,adaptive=layout!=='fixed';
  const triggered=[...visualUntil].filter(([,until])=>until>performance.now()).map(([id])=>id);
  const shot=project.video.shots[directorPlayingStep??directorEditStep];
  const active=layout==='directed'?directedPads(shot,triggered,PAD_COUNT[project.layout]):adaptive?triggered:Array.from({length:PAD_COUNT[project.layout]},(_,id)=>id);
  if(adaptive&&!active.length){
    if(!(layout==='directed'&&shot.mode==='black')){context.fillStyle='#d7fc5a';context.font='bold 28px sans-serif';context.textAlign='center';context.fillText('PLAY A PAD TO BEGIN',canvas.width/2,canvas.height/2);context.textAlign='left';}
    requestAnimationFrame(drawPerformanceFrame);return;
  }
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
      if(config.kind==='video' && source.video.readyState>=2) drawMediaCover(context,source.video,x,y,width,height);
      if(config.kind==='image' && source.image.complete && source.image.naturalWidth) drawMediaCover(context,source.image,x,y,width,height);
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

async function downloadAudioWavCopy() {
  const take=lastTakes.audio,button=$('export-audio-wav'),status=$('export-audio-wav-status');
  if(!take)return;
  button.disabled=true;status.textContent='Checking the audio take locally…';
  let url=null,media=null,timer=null;
  try{
    if(take.blob.size>MAX_WAV_SOURCE_BYTES)throw new Error('This take is too large for a phone-friendly WAV conversion. Download the original audio instead.');
    let duration=take.durationSeconds;
    if(!Number.isFinite(duration)){
      media=new Audio();media.preload='metadata';url=URL.createObjectURL(take.blob);
      duration=await new Promise((resolve,reject)=>{
        const fail=()=>reject(new Error('This browser could not read the take duration. The original audio remains available.'));
        media.onloadedmetadata=()=>Number.isFinite(media.duration)?resolve(media.duration):fail();
        media.onerror=fail;timer=setTimeout(fail,5000);media.src=url;media.load();
      });
      clearTimeout(timer);timer=null;
    }
    if(duration>MAX_WAV_TAKE_SECONDS)throw new Error(`WAV copy is limited to ${MAX_WAV_TAKE_SECONDS} seconds. Download the original audio for longer takes.`);
    const decoded=await audio.context.decodeAudioData(await take.blob.arrayBuffer());
    if(decoded.duration>MAX_WAV_TAKE_SECONDS)throw new Error(`WAV copy is limited to ${MAX_WAV_TAKE_SECONDS} seconds. Download the original audio for longer takes.`);
    if(44+decoded.length*Math.min(decoded.numberOfChannels,2)*2>MAX_WAV_OUTPUT_BYTES)throw new Error('The WAV copy would be too large for a phone-friendly download. The original audio remains available.');
    const wav=audioBufferToWav(decoded);
    if(wav.size>MAX_WAV_OUTPUT_BYTES)throw new Error('The WAV copy would be too large for a phone-friendly download. The original audio remains available.');
    download(wav,take.name.replace(/\.[^.]+$/,'.wav'));
    const channels=decoded.numberOfChannels===1?1:2;
    status.textContent=`Local WAV copy ready · ${decoded.duration.toFixed(1)} s · ${Math.round(decoded.sampleRate/1000)} kHz · ${channels} channel${channels===1?'':'s'}.`;
  }catch(error){status.textContent=error?.message||'WAV conversion is unavailable in this browser. The original audio remains available.';}
  finally{
    clearTimeout(timer);
    if(media){media.pause();media.removeAttribute('src');media.load();}
    if(url)URL.revokeObjectURL(url);
    button.disabled=!lastTakes.audio;
  }
}

function recorderMime(kind){
  const requested=$(kind==='video'?'record-video-format':'record-audio-format').value;
  if(requested==='auto')return kind==='video'?findRecorderMime():findAudioRecorderMime();
  const candidates=kind==='video'?{
    mp4:['video/mp4;codecs=avc1.42E01E,mp4a.40.2','video/mp4'],webm:['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm']
  }:{m4a:['audio/mp4;codecs=mp4a.40.2','audio/mp4'],webm:['audio/webm;codecs=opus','audio/webm'],ogg:['audio/ogg;codecs=opus','audio/ogg']};
  const mime=candidates[requested]?.find(type=>MediaRecorder.isTypeSupported(type));
  if(!mime)throw new Error(`${requested.toUpperCase()} recording is not supported by this browser. Choose another format.`);
  return mime;
}

function syncPerformanceRecordButton(){
  const button=$('studio-record');
  const starting=takeKind==='video'&&takeActivity.phase==='starting';
  const live=Boolean(recording&&recording.state!=='inactive');
  button.textContent=starting?'■ Cancel start':live?'■ Stop video':'● Record video';
  button.setAttribute('aria-label',starting?'Cancel video recording start':live?'Stop video performance recording':'Record video performance');
  button.setAttribute('aria-pressed',String(starting||live));
  button.classList.toggle('recording',live);
}

async function toggleSetRecording() {
  if (recording) { if(recording.state!=='inactive')recording.stop(); return; }
  if (takeActivity.phase!=='idle') {
    if (takeKind==='video' && takeActivity.phase==='starting') {
      takeActivity.cancel(); takeKind=null;
      $('start-record').classList.remove('recording');$('start-record').innerHTML='<span class="record-dot"></span> RECORD SET';
      $('start-record').setAttribute('aria-pressed','false');
      syncPerformanceRecordButton();
      notify('Audiovisual recording start canceled.');
    } else notify('Finish the current recording before starting an audiovisual set.');
    return;
  }
  if (!window.MediaRecorder || !$('capture-canvas').captureStream) return notify('Video recording is unavailable in this browser.');
  const token=takeActivity.begin();takeKind='video';
  $('start-record').textContent='■ CANCEL START';$('start-record').setAttribute('aria-pressed','true');
  syncPerformanceRecordButton();
  let canvasStream=null;
  try {
    await audio.unlock();
    if(!takeActivity.activate(token))return;
    const mime=recorderMime('video');
    const canvas=$('capture-canvas');
    const [width,height]=VIDEO_ASPECTS[project.video.aspect];
    canvas.width=width;canvas.height=height;
    canvasStream=canvas.captureStream(30);
    const stream=new MediaStream([...canvasStream.getVideoTracks(),...audio.recordOut.stream.getAudioTracks()]);
    const recorder=new MediaRecorder(stream,mime?{mimeType:mime}:undefined);
    const chunks=[];
    recorder.ondataavailable=event=>{ if(event.data.size)chunks.push(event.data); };
    recorder.onerror=event=>notify(`Recording failed: ${event.error?.message||'unknown error'}`);
    recorder.onstop=()=>{
      drawing=false;
      stream.getVideoTracks().forEach(track=>track.stop());
      const type=recorder.mimeType||mime||'video/webm';
      const blob=new Blob(chunks,{type});
      if(blob.size){rememberTake('video',blob);download(blob,lastTakes.video.name);}
      else notify('The browser did not capture video.');
      $('capture-canvas').hidden=true;
      recording=null;
      $('start-record').classList.remove('recording');$('start-record').innerHTML='<span class="record-dot"></span> RECORD SET';
      $('start-record').setAttribute('aria-pressed','false');
      takeActivity.cancel();takeKind=null;
      syncPerformanceRecordButton();
      if(blob.size)notify('Video saved. Open Video & Export to review or download it again.');
    };
    recording=recorder;drawing=true;$('capture-canvas').hidden=false;drawPerformanceFrame();recorder.start(200);
    $('start-record').classList.add('recording');$('start-record').textContent='■ STOP RECORDING';
    $('start-record').setAttribute('aria-pressed','true');
    syncPerformanceRecordButton();
    notify('Recording your audiovisual performance. Play pads here or on Sequence; stop with the Record video control.');
  } catch(error) {
    if(!takeActivity.current(token))return;
    takeActivity.cancel();takeKind=null;
    canvasStream?.getTracks().forEach(track=>track.stop());
    drawing=false;recording=null;$('capture-canvas').hidden=true;
    $('start-record').classList.remove('recording');$('start-record').innerHTML='<span class="record-dot"></span> RECORD SET';
    $('start-record').setAttribute('aria-pressed','false');
    syncPerformanceRecordButton();
    notify(error.message);
  }
}

async function toggleAudioRecording() {
  if(audioRecording){if(audioRecording.state!=='inactive')audioRecording.stop();return;}
  if(takeActivity.phase!=='idle'){
    if(takeKind==='audio' && takeActivity.phase==='starting'){
      takeActivity.cancel();takeKind=null;
      $('record-audio').textContent='♪ RECORD AUDIO MIX';$('record-audio').setAttribute('aria-pressed','false');
      notify('Audio recording start canceled.');
    } else notify('Finish the current recording before starting an audio-only mix.');
    return;
  }
  if(!window.MediaRecorder)return notify('Audio recording is unavailable in this browser.');
  const token=takeActivity.begin();takeKind='audio';
  $('record-audio').textContent='■ CANCEL START';$('record-audio').setAttribute('aria-pressed','true');
  try{
    await audio.unlock();
    if(!takeActivity.activate(token))return;
    const stream=audio.recordOut.stream;
    if(!stream.getAudioTracks().length)throw new Error('The audio mix stream is unavailable.');
    const mime=recorderMime('audio');
    const recorder=new MediaRecorder(stream,mime?{mimeType:mime}:undefined),chunks=[];
    recorder.ondataavailable=event=>{if(event.data.size)chunks.push(event.data);};
    recorder.onerror=event=>notify(`Audio recording failed: ${event.error?.message||'unknown error'}`);
    const startedAt=performance.now();
    recorder.onstop=()=>{
      const type=recorder.mimeType||mime||'audio/webm';
      const blob=new Blob(chunks,{type});
      if(blob.size){rememberTake('audio',blob,(performance.now()-startedAt)/1000);download(blob,lastTakes.audio.name);}
      else notify('The browser did not capture audio.');
      audioRecording=null;
      $('record-audio').classList.remove('recording');$('record-audio').textContent='♪ RECORD AUDIO MIX';
      $('record-audio').setAttribute('aria-pressed','false');
      takeActivity.cancel();takeKind=null;
    };
    audioRecording=recorder;recorder.start(200);
    $('record-audio').classList.add('recording');$('record-audio').textContent='■ STOP AUDIO TAKE';
    $('record-audio').setAttribute('aria-pressed','true');
    $('record-audio').blur();
    notify('Recording the master audio mix. Stop to download the supported audio format.');
  }catch(error){
    if(!takeActivity.current(token))return;
    takeActivity.cancel();takeKind=null;audioRecording=null;
    $('record-audio').classList.remove('recording');$('record-audio').textContent='♪ RECORD AUDIO MIX';
    $('record-audio').setAttribute('aria-pressed','false');
    notify(error.message);
  }
}

function updateCameraLengthHelp(){
  const target=$('camera-take-length').value;
  if(target==='manual'){$('camera-length-help').textContent='Manual one-shot · stop when ready. All takes stop by 30 seconds.';return;}
  const seconds=cameraTakeTargetSeconds(target,project.bpm,MAX_CAMERA_TAKE_SECONDS);
  $('camera-length-help').textContent=`${target} ${target==='1'?'bar':'bars'} in 4/4 at ${project.bpm} BPM · about ${seconds.toFixed(1)} seconds. Stop early if needed; all takes stop by 30 seconds.`;
}

function cameraReady() {
  const video=$('camera-preview');
  if(cameraUrl){URL.revokeObjectURL(cameraUrl);cameraUrl=null;}
  video.removeAttribute('src');video.srcObject=cameraStream;video.muted=true;video.controls=false;video.autoplay=true;
  video.play().catch(()=>{});
  $('camera-capture').hidden=false;$('camera-capture').disabled=!cameraStream;
  $('camera-take-length').disabled=false;
  updateCameraLengthHelp();
  $('camera-retake').hidden=true;$('camera-keep').hidden=true;
  $('camera-status').textContent='Camera and microphone active. Start recording when ready.';
  $('camera-review').hidden=true;
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

async function openCamera(target=selected,{autoStart=false}={}) {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return notify('Camera capture needs HTTPS and a supported browser.');
  const destination=await chooseCaptureTarget(target);
  if(destination===null)return;
  const token=cameraSession.begin(destination);
  if(token===null)return;
  $('camera-take-length').value='manual';
  $('camera-timing-options').open=false;
  $('camera-title').textContent=`Record on pad ${destination+1}`;
  updateCameraLengthHelp();
  $('camera-status').textContent='Requesting camera and microphone access…';
  $('camera-capture').disabled=true;$('camera-capture').hidden=false;
  $('camera-take-length').disabled=false;
  $('camera-retake').hidden=true;$('camera-keep').hidden=true;
  $('camera-dialog').showModal();
  try {
    const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'},audio:true});
    if(!cameraSession.current(token)){stream.getTracks().forEach(track=>track.stop());return;}
    if(!stream.getVideoTracks().length || !stream.getAudioTracks().length){stream.getTracks().forEach(track=>track.stop());throw new Error('Both camera and microphone are required.');}
    cameraStream=stream;cameraReady();
    if(autoStart){$('camera-status').textContent='Starting recording…';void captureCamera();}
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
  $('camera-take-length').disabled=false;
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
    if(!cameraSession.current(token) || cameraSession.phase!=='recording')return;
    const takeTarget=$('camera-take-length').value;
    const targetSeconds=cameraTakeTargetSeconds(takeTarget,project.bpm,MAX_CAMERA_TAKE_SECONDS);
    const mime=findRecorderMime();
    const recorder=new MediaRecorder(cameraStream,mime?{mimeType:mime}:undefined);
    cameraRecorder=recorder;
    const chunks=[],levels=[];
    let meterStartedAt=performance.now();
    recorder.ondataavailable=event=>{if(event.data.size)chunks.push(event.data);};
    recorder.onerror=event=>{if(cameraSession.current(token)){closeCamera();notify(`Recording failed: ${event.error?.message||'unknown error'}`);}};
    try {const analyser=audio.context.createAnalyser();analyser.fftSize=1024;cameraMeterSource=audio.context.createMediaStreamSource(cameraStream);cameraMeterSource.connect(analyser);const samples=new Float32Array(analyser.fftSize);cameraMeterTimer=setInterval(()=>{analyser.getFloatTimeDomainData(samples);let sum=0;for(const sample of samples)sum+=sample*sample;levels.push({time:(performance.now()-meterStartedAt)/1000,level:Math.sqrt(sum/samples.length)});},50);} catch { /* The full clip remains available when live metering is unsupported. */ }
    recorder.onstop=()=>{
      if(!cameraSession.current(token))return;
      $('camera-take-length').disabled=false;
      if(cameraRecorder===recorder)cameraRecorder=null;clearInterval(cameraMeterTimer);cameraMeterTimer=null;cameraMeterSource?.disconnect();cameraMeterSource=null;clearTimeout(cameraTimer);cameraTimer=null;
      const type=recorder.mimeType||mime||'';
      if(!chunks.length || !/^video\/(mp4|webm)(;|$)/i.test(type)){closeCamera();notify('This browser did not provide a supported recording format.');return;}
      try {
        const file=new File(chunks,`capture-${Date.now()}.${extensionForMime(type)}`,{type});
        if(file.size>MAX_MEDIA_BYTES)throw new Error('Recording exceeds the 80 MB per-clip limit. Try a shorter take.');
        if(!file.size || !cameraSession.review(token,file))throw new Error('No recording was captured.');
        cameraStream?.getTracks().forEach(track=>track.stop());cameraStream=null;
        const video=$('camera-preview');video.pause();video.srcObject=null;video.autoplay=false;cameraUrl=URL.createObjectURL(file);video.src=cameraUrl;video.muted=false;video.controls=true;video.load();
        const setReviewRegion=()=>{if(!cameraSession.current(token)||cameraSession.phase!=='review'||cameraRegion.end>0)return;const duration=Number.isFinite(video.duration)&&video.duration>0?video.duration:MAX_CAMERA_TAKE_SECONDS;const suggestion=suggestActiveRegion(levels,duration);cameraRegion=suggestion;$('camera-start').max=Math.max(0,duration-.05);$('camera-start').value=Math.min(suggestion.start,Number($('camera-start').max));$('camera-end').max=duration;$('camera-end').value=suggestion.end;updateCameraRegion();$('camera-keep').disabled=false;$('camera-status').textContent=captureRegionStatus(suggestion.detected);};
        $('camera-keep').disabled=true;video.addEventListener('loadedmetadata',setReviewRegion,{once:true});setTimeout(setReviewRegion,1200);
        $('camera-capture').hidden=true;$('camera-retake').hidden=false;$('camera-keep').hidden=false;
        $('camera-review').hidden=false;$('camera-status').textContent='Camera and microphone stopped. Preparing a trim suggestion…';
      } catch(error){closeCamera();notify(`Could not review take: ${error.message}`);}
    };
    meterStartedAt=performance.now();recorder.start(200);$('camera-capture').disabled=false;$('camera-capture').textContent='■ STOP RECORDING';$('camera-take-length').disabled=true;
    const targetLabel=takeTarget==='manual'?'One-shot · stop when ready':`${takeTarget} ${takeTarget==='1'?'bar':'bars'} at ${project.bpm} BPM · about ${targetSeconds.toFixed(1)} seconds`;
    $('camera-status').textContent=`Recording… ${targetLabel}. You can stop sooner; maximum ${MAX_CAMERA_TAKE_SECONDS} seconds.`;
    cameraTimer=setTimeout(()=>{if(recorder.state!=='inactive')recorder.stop();},targetSeconds*1000);
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
  $('camera-review').hidden=true;$('camera-capture').textContent='● START RECORDING';
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
    replaceProjectState(next);
    let loadError=null;
    try {pads[target].video.controls=false;await audio.load(target,take,pads[target].video);mediaFiles.set(target,take);durations.delete(target);}
    catch(error){loadError=error;}
    cameraSession.keep(token);closeCamera();selectPad(target);
    window.dispatchEvent(new Event('madladpad-media-change'));
    notify(loadError?'Take saved locally, but could not load. Reload to retry.':'Take saved on this device.');
  } catch(error){notify(`Could not save take: ${error.message}`);}
  finally {cameraSaving=false;$('camera-keep').disabled=false;$('camera-retake').disabled=false;$('camera-close').disabled=false;}
}

async function exportPack() {
  try {
    if (voiceLab?.isRecording()) throw new Error('Stop and save the active vocal take before exporting the project pack.');
    const media=await collectProjectMedia();
    const voiceMedia=await collectVoiceMedia(project.voice.layers);
    const videoMedia=await collectSongVideoMedia(project.voice.videoLayers);
    if(voiceMedia.some(item=>!item.file))throw new Error('A vocal layer raw take is missing. Export the take or remove that layer before making a pack.');
    if(videoMedia.some(item=>!item.file))throw new Error('A Song video source is missing. Remove that track before making a pack.');
    const bytes=[...media,...voiceMedia.map(item=>item.file),...videoMedia.map(item=>item.file)].reduce((sum,blob)=>sum+(blob?.size||0),0);
    if(bytes>MAX_MEDIA_BYTES) throw new Error('This pack exceeds 80 MB. Save smaller clips before exporting.');
    notify('Preparing a portable project with its media…');
    const contents=[];
    for(const blob of media) contents.push(blob?await blobAsDataUrl(blob):null);
    const voiceContents=[];
    for(const item of voiceMedia)voiceContents.push(await blobAsDataUrl(item.file));
    const videoContents=[];
    for(const item of videoMedia)videoContents.push(await blobAsDataUrl(item.file));
    const pack={format:'madladpad',version:1,project,media:contents,voiceMedia:voiceContents,videoMedia:videoContents};
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
    const rawVoice=Array.isArray(raw.voiceMedia)?raw.voiceMedia:[];
    if(rawVoice.length!==incoming.voice.layers.length)throw new Error('This pack is missing one or more vocal raw takes.');
    const voiceBlobs=rawVoice.map(data=>data?dataUrlAsBlob(data):null);
    if(voiceBlobs.some(blob=>!blob||!blob.type.startsWith('audio/')))throw new Error('Vocal layers must include local audio takes.');
    const blobs=raw.media.map(data=>data ? dataUrlAsBlob(data):null);
    if(blobs.some(blob=>blob && blob.size>MAX_MEDIA_BYTES)) throw new Error('A sample is larger than the 80 MB limit');
    const files=blobs.map((blob,i)=>blob ? new File([blob],incoming.pads[i].fileName||`sample-${i+1}`,{type:blob.type}) : null);
    const voiceFiles=voiceBlobs.map((blob,index)=>new File([blob],`vocal-take-${index+1}`,{type:blob.type}));
    const rawVideo=Array.isArray(raw.videoMedia)?raw.videoMedia:[];
    if(rawVideo.length!==incoming.voice.videoLayers.length)throw new Error('This pack is missing one or more Song video sources.');
    const videoBlobs=rawVideo.map(data=>data?dataUrlAsBlob(data):null);
    if(videoBlobs.some(blob=>!blob||!blob.type.startsWith('video/')))throw new Error('Song video tracks must include local video sources.');
    const videoFiles=videoBlobs.map((blob,index)=>new File([blob],`${incoming.voice.videoLayers[index].name||`video-track-${index+1}`}.${blob.type.includes('mp4')?'mp4':'webm'}`,{type:blob.type}));
    if([...files,...voiceFiles,...videoFiles].reduce((sum,file)=>sum+(file?.size||0),0)>MAX_MEDIA_BYTES)throw new Error('This pack exceeds the 80 MB local media limit.');
    if(voiceLab?.isRecording())throw new Error('Stop and save the active vocal take before importing a project pack.');
    if(!confirm('Replace your current local project? Export it first if you want a backup.')) return;
    patternRecording=null;patternUndoSnapshot=null;renderPatternRecordingState();
    // A single IndexedDB transaction prevents a partial replacement on quota or write failure.
    discardPendingProjectSave();
    try { await replaceProjectMedia(incoming,files,incoming.voice.layers.map((layer,index)=>({id:layer.id,file:voiceFiles[index]})),incoming.voice.videoLayers.map((layer,index)=>({id:layer.id,file:videoFiles[index]}))); }
    catch(error) { queueSave(); throw error; }
    stopSequencer();
    replaceProjectState(incoming);selected=0;
    audio.vocalSources.clear();await voiceLab?.reloadLayers();
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

function configureGoogleSources(){
  const configured=isGooglePickerConfigured();
  const sources=[
    ['google-drive','Google Drive','Choose files'],
    ['google-photos','Google Photos','Choose clips'],
    ['pad-google-drive','Google Drive','Choose files'],
    ['pad-google-photos','Google Photos','Choose clips']
  ];
  for(const [id,name,action] of sources){
    const button=$(id);
    button.disabled=!configured;
    button.hidden=!configured;
    const status=button.querySelector('small');
    if(status)status.textContent=configured?action:'Setup required';
    if(configured)button.removeAttribute('aria-label');
    else button.setAttribute('aria-label',`${name} import unavailable: optional setup required. Use Device / Files or Record on Pad.`);
    button.title=configured?`${name}: ${action}`:`${name} import is optional and not configured. Use Device / Files or Record on Pad.`;
  }
}

function bindControls() {
  configureGoogleSources();
  // Keep specialist video direction beside the capture choices it controls.
  $('export-lab').append($('video-director-details'));
  window.addEventListener('hashchange',showStudioScreen);
  document.addEventListener('pointerdown',event=>{
    if($('loop-settings').open&&!$('loop-settings').contains(event.target))$('loop-settings').open=false;
    if($('session-menu').open&&!$('session-menu').contains(event.target))$('session-menu').open=false;
  });
  window.addEventListener('scroll',()=>{
    const settings=$('loop-settings'),fields=settings.querySelector('.transport-settings');
    if(settings.open&&!fields.contains(document.activeElement))settings.open=false;
  },{passive:true});
  $('close-sample-editor').addEventListener('click',closeSampleEditor);
  $('sample-editor-dialog').addEventListener('close',restoreSampleEditorFocus);
  $('sample-editor-dialog').addEventListener('close',()=>{cancelOnsetAnalysis(false);$('region-preview').pause();});
  $('sample-editor-dialog').addEventListener('click',event=>{
    if(event.target===$('sample-editor-dialog'))$('sample-editor-dialog').close();
  });
  showStudioScreen();
  $('show-help').addEventListener('click',()=>{
    if(location.hash!=='#sounds')location.hash='#sounds';
    introOpen=!introOpen;
    showStudioScreen();
  });
  $('dismiss-intro').addEventListener('click',dismissIntro);
  $('pad-edit-mode').addEventListener('click',()=>setPadEditMode(!padEditMode));
  $('close-sample-editor').addEventListener('click',closeSampleEditor);
  $('sample-editor-dialog').addEventListener('close',()=>{cancelOnsetAnalysis(false);$('region-preview').pause();});
  $('copy-pad').addEventListener('click',copyPadToEmpty);
  showVoiceTool(activeVoiceTool);
  for(const button of document.querySelectorAll('[data-voice-jump]')){
    button.addEventListener('click',()=>showVoiceTool(button.dataset.voiceJump,{focus:true}));
  }
  $('beat-pad-select').addEventListener('change',event=>selectPad(Number(event.target.value)));
  $('studio-play').addEventListener('click',()=>transportActivity.phase!=='idle'?stopSequencer():startSequencer());
  $('director-mode').addEventListener('change',event=>{
    const shot=project.video.shots[directorEditStep];shot.mode=event.target.value;
    if(shot.mode==='solo'&&shot.pads.length>1)shot.pads=shot.pads.slice(0,1);
    queueSave();renderVideoDirector();
  });
  $('video-aspect').addEventListener('change',event=>{project.video.aspect=event.target.value;queueSave();});
  $('export-pack-action').addEventListener('click',()=>$('export-button').click());
  $('export-video-download').addEventListener('click',()=>{if(lastTakes.video)download(lastTakes.video.blob,lastTakes.video.name);});
  $('export-audio-download').addEventListener('click',()=>{if(lastTakes.audio)download(lastTakes.audio.blob,lastTakes.audio.name);});
  $('export-audio-wav').addEventListener('click',downloadAudioWavCopy);
  const preview=$('region-preview');
  const regionTimeline=$('region-timeline');
  let draggedBoundary=null;
  const boundaryAtPointer=(event,key)=>{
    const rect=regionTimeline.getBoundingClientRect();
    moveRegionBoundary(key,Math.max(0,Math.min(1,(event.clientX-rect.left)/rect.width))*previewDuration);
  };
  regionTimeline.addEventListener('pointerdown',event=>{
    if(!regionDraft||!previewDuration)return;
    const handle=event.target.closest('.region-timeline-handle');
    const startPosition=regionDraft.start/previewDuration,endPosition=regionDraft.end/previewDuration;
    const position=Math.max(0,Math.min(1,(event.clientX-regionTimeline.getBoundingClientRect().left)/regionTimeline.clientWidth));
    draggedBoundary=handle?.id.includes('start')?'start':handle?'end':Math.abs(position-startPosition)<=Math.abs(position-endPosition)?'start':'end';
    if(handle)handle.focus();else $(draggedBoundary==='start'?'region-timeline-start-handle':'region-timeline-end-handle').focus();
    regionTimeline.setPointerCapture(event.pointerId);event.preventDefault();boundaryAtPointer(event,draggedBoundary);
  });
  regionTimeline.addEventListener('pointermove',event=>{if(draggedBoundary)boundaryAtPointer(event,draggedBoundary);});
  for(const type of ['pointerup','pointercancel','lostpointercapture'])regionTimeline.addEventListener(type,()=>{draggedBoundary=null;});
  for(const [id,key] of [['region-timeline-start-handle','start'],['region-timeline-end-handle','end']])$(id).addEventListener('keydown',event=>{
    if(!regionDraft)return;
    const value=key==='start'?regionDraft.start:regionDraft.end,min=Number(event.currentTarget.getAttribute('aria-valuemin')),max=Number(event.currentTarget.getAttribute('aria-valuemax'));
    const step=event.key.startsWith('Page') ? .5 : .05;
    const next=event.key==='Home'?min:event.key==='End'?max:['ArrowRight','ArrowUp','PageUp'].includes(event.key)?Math.min(max,value+step):['ArrowLeft','ArrowDown','PageDown'].includes(event.key)?Math.max(min,value-step):null;
    if(next===null)return;event.preventDefault();moveRegionBoundary(key,next);
  });
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
      moveRegionBoundary(key,Number(event.target.value));
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
    renderGrid();renderControls();renderSteps();renderVideoDirector();syncRegionPreview();queueSave();
  });
  $('grid-division').addEventListener('change',event=>{
    if(patternRecording)return;
    project.gridDivision=['1/4','1/8','1/16'].includes(event.target.value)?event.target.value:'1/16';
    renderSteps();queueSave();
  });
  $('bpm-input').addEventListener('change',event=>{
    project.bpm=clamp(event.target.value,40,240);event.target.value=project.bpm;
    audio.setTransport(project.bpm,project.quantize);if(transportTimer){stopSequencer();startSequencer();}updateCameraLengthHelp();queueSave();
  });
  $('camera-take-length').addEventListener('change',updateCameraLengthHelp);
  $('quantize-select').addEventListener('change',event=>{project.quantize=event.target.value;audio.setTransport(project.bpm,project.quantize);queueSave();});
  $('project-title').addEventListener('input',event=>{project.title=event.target.value;queueSave();});
  $('pad-name').addEventListener('input',event=>{project.pads[selected].name=event.target.value;renderPad(selected);renderTrackGrid();renderVideoDirector();queueSave();});
  $('detect-note').addEventListener('click',async()=>{
    const id=selected,file=mediaFiles.get(id);
    if(!file)return;
    $('detect-note').disabled=true;$('tune-status').textContent='Analysing this sample locally…';
    try{
      const buffer=audio.sources.get(id)?.buffer||await audio.context.decodeAudioData(await file.arrayBuffer());
      const config=project.pads[id],start=Math.max(0,Math.floor(config.start*buffer.sampleRate));
      const end=Math.min(buffer.length,Math.max(start+1,Math.floor(Math.min(config.end,config.start+2)*buffer.sampleRate)));
      const length=end-start,pcm=new Float32Array(length);
      for(let c=0;c<buffer.numberOfChannels;c++){
        const source=buffer.getChannelData(c);
        for(let i=0;i<length;i++)pcm[i]+=source[start+i]/buffer.numberOfChannels;
      }
      const note=detectPitch(pcm,buffer.sampleRate);
      if(id!==selected)return;
      if(!note){latestDetectedNote=null;renderControls();$('tune-status').textContent='No reliable single musical note detected. Try a cleaner sustained sound or tune by ear.';return;}
      else latestDetectedNote={id,note};
      renderControls();
    }catch(error){if(id===selected)$('tune-status').textContent=`Pitch detection unavailable for this media codec: ${error.message}`;}
    finally{$('detect-note').disabled=!mediaFiles.has(selected);}
  });
  $('tune-note').addEventListener('click',()=>{
    if(latestDetectedNote?.id!==selected||!audio.canPitch(selected))return;
    const pad=project.pads[selected];
    pad.pitch=Math.round(clamp(pad.pitch+latestDetectedNote.note.correction,-12,12)*10)/10;
    audio.setPadPitch(selected,pad.pitch,pad.speed);renderControls();queueSave();notify(`Pitch adjusted toward ${latestDetectedNote.note.name} in A440 tuning. Check by ear.`);
  });
  for(const [id,key,convert] of [['volume','volume',v=>v/100],['pitch','pitch',Number],['speed','speed',Number],['trim-start','start',Number],['trim-end','end',Number]]) {
    $(id).addEventListener('input',event=>{
      const pad=project.pads[selected];pad[key]=convert(Number(event.target.value));
      if(key==='pitch'&&!audio.setPadPitch(selected,pad.pitch,pad.speed))notify('Pitch processing is unavailable for this pad in this browser.');
      if(key==='start' && pad.start>=pad.end)pad.end=Math.min(3600,pad.start+.05);
      if(key==='end' && pad.end<=pad.start)pad.start=Math.max(0,pad.end-.05);
      renderControls();queueSave();
    });
  }
  $('media-input').addEventListener('change',event=>{const target=fileTarget??selected;fileTarget=null;return processInputFiles(event,files=>placeFiles(files,target));});
  $('project-input').addEventListener('change',event=>processInputFiles(event,async files=>{if(files[0])await importPack(files[0]);}));
  $('quick-demo').addEventListener('click',()=>{dismissIntro();startDemoBeat();});
  $('quick-import').addEventListener('click',()=>{dismissIntro();$('add-file').click();});
  $('quick-record').addEventListener('click',()=>{dismissIntro();$('camera-button').click();});
  $('add-file').addEventListener('click',()=>{fileTarget=selected;$('media-input').click();});
  $('demo-bank-editor').addEventListener('click',()=>openDemoSoundBank(selected));
  $('import-project-button').addEventListener('click',()=>$('project-input').click());
  $('export-button').addEventListener('click',exportPack);
  $('camera-button').addEventListener('click',()=>openCamera(selected));
  $('pad-record').addEventListener('click',()=>{const target=sourcePad;$('pad-source-dialog').close();if(target!==null){void audio.unlock().catch(()=>{});void openCamera(target,{autoStart:true});}});
  $('pad-files').addEventListener('click',()=>{fileTarget=sourcePad;$('pad-source-dialog').close();$('media-input').click();});
  $('pad-demo-bank').addEventListener('click',()=>openDemoSoundBank(sourcePad??selected));
  $('demo-category').addEventListener('change',renderDemoSoundBank);
  $('demo-bank-cancel').addEventListener('click',()=>$('demo-bank-dialog').close());
  $('demo-bank-dialog').addEventListener('cancel',()=>{sourcePad=null;});
  for(const [button,picker] of [['pad-google-drive','google-drive'],['pad-google-photos','google-photos']]){
    $(button).addEventListener('click',()=>{$('pad-source-dialog').close();$(picker).click();});
  }
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
    const hasMedia=mediaFiles.has(selected),demo=project.pads[selected].demoSound;
    if(!hasMedia&&!demo)return;
    if(!confirm(hasMedia?'Remove this sample from local storage?':'Clear this demo sound from the pad?'))return;
    if(hasMedia){audio.unload(selected);mediaFiles.delete(selected);durations.delete(selected);}
    const previous=project.pads[selected],original=makeProject().pads[selected];
    project.pads[selected]={...original,steps:previous.steps,stepOffsets:previous.stepOffsets,stepPlaybackMode:previous.stepPlaybackMode,sequenceMode:previous.sequenceMode,sampleNotes:previous.sampleNotes,muted:previous.muted,solo:previous.solo};
    if(hasMedia)await deleteValue(`media:${selected}`);renderPad(selected);renderTrackGrid();renderControls();syncRegionPreview();queueSave();
  });
  $('demo-button').addEventListener('click',()=>{
    audio.demoEnabled=!audio.demoEnabled;
    project.demoEnabled=audio.demoEnabled;
    queueSave();
    for(const button of [$('demo-button'),$('quick-demo')]){button.classList.toggle('active',audio.demoEnabled);button.setAttribute('aria-pressed',String(audio.demoEnabled));}
    renderGrid();renderTrackGrid();renderControls();notify(audio.demoEnabled?'Demo synth sounds enabled on empty pads.':'Demo sounds off.');
  });
  $('play-seq').addEventListener('click',()=>transportActivity.phase!=='idle'?stopSequencer():startSequencer());
  $('sequence-pad-toggle').addEventListener('click',()=>{sequencePadsVisible=!sequencePadsVisible;showStudioScreen();});
  $('make-video').addEventListener('click',()=>{location.hash='#export';});
  $('auto-beat').addEventListener('click',surpriseBeat);
  $('clear-steps').addEventListener('click',()=>{releasePad(selected);project.pads[selected].steps.fill(false);project.pads[selected].stepOffsets.fill(0);patternUndoSnapshot=null;renderSteps();renderPatternRecordingState();queueSave();});
  $('record-pattern').addEventListener('click',togglePatternRecording);
  $('undo-pattern').addEventListener('click',undoPatternRecording);
  $('scene-select').addEventListener('change',event=>{selectedSceneIndex=Number(event.target.value);renderScenes();});
  $('scene-name').addEventListener('input',()=>{$('save-scene').disabled=project.scenes.length>=MAX_SCENES||!$('scene-name').value.trim();});
  $('save-scene').addEventListener('click',saveScene);
  $('update-scene').addEventListener('click',updateScene);
  $('launch-scene').addEventListener('click',launchScene);
  $('delete-scene').addEventListener('click',deleteScene);
  $('pattern-view').addEventListener('click',()=>setSequenceView('patterns'));
  $('song-view').addEventListener('click',()=>setSequenceView('song'));
  $('song-back-to-patterns').addEventListener('click',()=>{setSequenceView('patterns');$('beat-advanced').open=true;});
  $('song-add-section').addEventListener('click',()=>{
    const sceneId=$('song-scene-select').value,scene=project.scenes.find(item=>item.id===sceneId);
    if(!scene)return notify('Save a pattern first, then add it to the song.');
    const bars=Math.round(clamp($('song-bars').value,1,64));
    if(project.song.clips.length>=MAX_SONG_CLIPS||songTotalBars(project.song)+bars>MAX_SONG_BARS)return notify('Song capacity reached. Reduce bar lengths before adding another section.');
    editSong(clips=>clips.push({id:'song-'+Date.now()+'-'+Math.random().toString(36).slice(2,7),sceneId,bars}));
  });
  $('track-view').addEventListener('click',()=>{if(compactSequenceOverview()&&trackGridVisible){openSequenceFocus(selected);return;}setTrackView(!trackGridVisible);});
  $('sequence-focus-close').addEventListener('click',closeSequenceFocus);
  $('open-focused-notes').addEventListener('click',()=>openSampleNoteEditor(selected));
  $('sample-note-close').addEventListener('click',()=>$('sample-note-dialog').close());
  $('sample-note-dialog').addEventListener('close',()=>{notePointer=null;});
  $('sample-note-dialog').addEventListener('cancel',()=>{notePointer=null;});
  $('note-grid').addEventListener('pointermove',updateSampleNoteDrag);
  window.addEventListener('pointerup',finishSampleNoteDrag);
  window.addEventListener('pointercancel',()=>{if(notePointer){notePointer=null;renderSampleNoteEditor();}});
  $('note-lane-mode').addEventListener('change',event=>{
    project.pads[selected].sequenceMode=event.target.value==='notes'?'notes':'steps';
    releasePad(selected);renderSteps();renderSampleNoteEditor();queueSave();
  });
  $('note-length').addEventListener('change',event=>{
    const pad=project.pads[selected],old=pad.sampleNotes.find(note=>note.step===selectedSampleNote);
    if(!old)return;
    pad.sampleNotes=setSampleNote(pad.sampleNotes.filter(note=>note!==old),{...old,length:Math.round(clamp(event.target.value,1,16-old.step))});
    renderSampleNoteEditor();renderTrackGrid();queueSave();
  });
  $('note-delete').addEventListener('click',()=>{
    const pad=project.pads[selected];pad.sampleNotes=pad.sampleNotes.filter(note=>note.step!==selectedSampleNote);
    selectedSampleNote=null;renderSampleNoteEditor();renderTrackGrid();queueSave();
  });
  $('note-clear').addEventListener('click',()=>{
    if(!confirm('Remove all melodic notes from this pad? The old step pattern will remain saved.'))return;
    project.pads[selected].sampleNotes=[];selectedSampleNote=null;renderSampleNoteEditor();renderTrackGrid();queueSave();
  });

  $('sequence-focus-dialog').addEventListener('cancel',event=>{event.preventDefault();closeSequenceFocus();});
  for(const [key,id] of [['muted','sequence-focus-mute'],['solo','sequence-focus-solo']]){
    $(id).addEventListener('click',()=>{project.pads[selected][key]=!project.pads[selected][key];stopInaudiblePadVoices();renderTrackGrid();updateSequenceFocusMixer();queueSave();});
  }
  $('sequence-focus-volume').addEventListener('input',event=>{const value=Number(event.target.value);project.pads[selected].volume=value/100;$('sequence-focus-volume-out').textContent=`${value}%`;queueSave();});
  $('sequence-focus-volume').addEventListener('change',()=>{renderTrackGrid();renderControls();});
  $('sequence-focus-playback').addEventListener('change',event=>{releasePad(selected);project.pads[selected].stepPlaybackMode=['one-step','loop'].includes(event.target.value)?event.target.value:'full';if(project.pads[selected].stepPlaybackMode==='loop'&&!audio.supportsSampleLoop(selected))notify('This pad needs decoded local audio for seamless looping; it will play as a one-shot in this browser.');renderTrackGrid();queueSave();});
  window.matchMedia('(max-width:740px)').addEventListener?.('change',()=>{if(!compactSequenceOverview())closeSequenceFocus();renderTrackGrid();});
  $('start-record').addEventListener('click',toggleSetRecording);
  $('studio-record').addEventListener('click',toggleSetRecording);
  $('record-audio').addEventListener('click',toggleAudioRecording);
  $('google-drive').addEventListener('click',()=>pickFromDrive(files=>placeFiles(files)).catch(error=>notify(error.message)));
  $('google-photos').addEventListener('click',()=>pickFromPhotos(files=>placeFiles(files),notify).catch(error=>notify(error.message)));
  window.addEventListener('madladpad-error',event=>notify(event.detail));
  document.addEventListener('keydown',event=>{
    if(event.repeat || event.metaKey || event.ctrlKey || event.altKey || $('camera-dialog').open || $('pad-source-dialog').open || $('capture-target-dialog').open || $('sample-editor-dialog').open || ['INPUT','SELECT','TEXTAREA','BUTTON'].includes(document.activeElement?.tagName)) return;
    const key=event.key.toUpperCase();
    if(key===' '){event.preventDefault();transportActivity.phase!=='idle'?stopSequencer():startSequencer();return;}
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
    if(saved)replaceProjectState(normaliseProject(saved));
    try {
      const recovery=localStorage.getItem(PROJECT_RECOVERY_KEY);
      if(recovery){replaceProjectState(normaliseProject(JSON.parse(recovery)));queueSave();}
    } catch(error) { console.warn('Project recovery snapshot could not be restored',error); }
    renderSession();
    $('video-aspect').value=project.video.aspect;
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
    voiceLab=await initVoiceLab({ getProject: () => project, getMediaFiles: () => mediaFiles, getAudio: () => audio, getTransport: () => ({running:Boolean(transportTimer),epoch:audio.transportEpoch,bpm:project.bpm}), notify, save: queueSave, assignWordsToPads: assignVoiceWordsToPads });
    await restoreSavedTakes();
    if(restored)notify(`Restored ${restored} locally saved samples.`);
    if('serviceWorker' in navigator && (location.protocol==='https:'||location.hostname==='localhost'))navigator.serviceWorker.register('/sw.js').catch(()=>{});
    $('connection-indicator').textContent=navigator.onLine?'LOCAL STUDIO':'OFFLINE READY';
  } catch(error){notify(`Studio startup error: ${error.message}`);console.error(error);}
}

initialise();
