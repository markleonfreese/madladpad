// Integrated A-B-C-A Song acceptance with generated local media only.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { resolve, extname, join } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { makeProject, normaliseProject, normaliseSong } from '../site/core.js';
import { buildSongRenderPlan, songRenderVisualsAtTime } from '../site/song-render.js';

const root=resolve('site');
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png'};
const server=createServer(async(req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  const path=resolve(root,`.${pathname==='/'?'/index.html':pathname}`);
  if(!path.startsWith(`${root}/`)){res.writeHead(403).end();return;}
  try{res.setHeader('Content-Type',mime[extname(path)]||'application/octet-stream');res.end(await readFile(path));}
  catch{res.writeHead(404).end();}
});
const wav=(seconds=240)=>{
  const rate=16000,frames=rate*seconds,bytes=Buffer.alloc(44+frames*2);
  bytes.write('RIFF',0);bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);
  bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);
  bytes.writeUInt32LE(rate,24);bytes.writeUInt32LE(rate*2,28);bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);
  bytes.write('data',36);bytes.writeUInt32LE(frames*2,40);
  for(let i=0;i<frames;i++)bytes.writeInt16LE(Math.round(11000*Math.sin(2*Math.PI*440*i/rate)),44+i*2);
  return bytes;
};
const audioFixture=wav();
const padFixture=wav(2);
const renderPattern=(id,name,step)=>{
  const pads=Array.from({length:16},()=>({steps:Array(16).fill(false),stepOffsets:Array(16).fill(0)}));
  pads[0].steps[step]=true;pads[1].steps[step]=true;
  return {id,name,pads};
};
const renderBase=makeProject();
const renderProject=normaliseProject({
  ...renderBase,bpm:90,
  pads:renderBase.pads.map((pad,index)=>index===0?{...pad,kind:'audio',fileName:'local-kick.wav',start:0,end:2,volume:.45,speed:1,pitch:0}
    :index===1?{...pad,kind:'image',fileName:'cover.png'}:pad),
  scenes:[renderPattern('render-a','A',0),renderPattern('render-b','B',4),renderPattern('render-c','C',8)],
  song:normaliseSong({clips:[{id:'render-intro',sceneId:'render-a',bars:8},{id:'render-verse',sceneId:'render-b',bars:16},{id:'render-hook',sceneId:'render-c',bars:24},{id:'render-outro',sceneId:'render-a',bars:24}]}),
  voice:{...renderBase.voice,
    layers:[{id:'render-vocal',name:'Lead vocal',startStep:0,trimStartSec:0,trimEndSec:2,repeatEnabled:true,repeatEveryBars:8,audibleLengthBars:2,placementEndBar:72}],
    videoLayers:[
      {id:'video-one',name:'Verse footage',startStep:0,trimStartSec:0,trimEndSec:2,durationSec:2},
      {id:'video-two',name:'Hook footage',startStep:0,trimStartSec:0,trimEndSec:2,durationSec:2,includeAudio:true,audioGain:.25,repeatEnabled:true,repeatEveryBars:4,audibleLengthBars:1,placementEndBar:72}
    ],
    melody:{...renderBase.voice.melody,followBeat:true,notes:[{midi:60,step:0,duration:4,velocity:100,layer:'lead'}]}
  }
});
const renderPlan=buildSongRenderPlan(renderProject,{padDurations:{0:2},vocalDurations:{'render-vocal':2},videoDurations:{'video-two':2}});
const renderFrameVisuals=songRenderVisualsAtTime(renderProject,renderPlan,.1);
let browser,temp;
try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://localhost:${server.address().port}`;
  temp=await mkdtemp(join(tmpdir(),'madladpad-song-journey-'));
  const tonePath=join(temp,'continuous-vocal.wav');
  const videoPath=resolve('tests/fixtures/webkit-stop-boundary.mp4');
  const videoBytes=await readFile(videoPath);
  await writeFile(tonePath,audioFixture);
  browser=await chromium.launch({headless:true,args:['--autoplay-policy=no-user-gesture-required','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream',`--use-file-for-audio-capture=${tonePath}`]});
  const context=await browser.newContext({acceptDownloads:true});
  await context.grantPermissions(['camera','microphone'],{origin});
  await context.route('**/*',route=>route.request().url().startsWith(`${origin}/`)?route.continue():route.abort());
  const page=await context.newPage();
  page.setDefaultTimeout(10000);
  await page.goto(origin);await page.locator('.pad-hit').first().waitFor();
  const offlineWav=await page.evaluate(async()=>{
    const {renderSongAudioWav}=await import('/song-render.js');
    const sourceContext=new AudioContext(),sample=sourceContext.createBuffer(1,12000,24000);
    const data=sample.getChannelData(0);
    for(let frame=0;frame<data.length;frame++)data[frame]=.35*Math.sin(2*Math.PI*220*frame/sample.sampleRate);
    const result=await renderSongAudioWav({durationSeconds:1,events:[
      {kind:'sample',trackId:'pad-0',padId:0,startSeconds:0,durationSeconds:.5,sourceStartSeconds:0,sourceEndSeconds:.5,gain:.8,speed:1,semitones:0},
      {kind:'midi',trackId:'melody',startSeconds:.5,durationSeconds:.5,midi:69,velocity:127,tuning:440,word:''}
    ]},{pads:new Map([[0,sample]])},{sampleRate:24000});
    const wavHeader=new DataView(await result.blob.arrayBuffer());
    const decoded=await sourceContext.decodeAudioData(await result.blob.arrayBuffer());
    const rms=Array.from({length:2},(_,channel)=>{
      const pcm=decoded.getChannelData(channel);let sum=0;
      for(const value of pcm)sum+=value*value;
      return Math.sqrt(sum/pcm.length);
    });
    await sourceContext.close();
    return {type:result.blob.type,bytes:result.blob.size,duration:decoded.duration,wavSampleRate:wavHeader.getUint32(24,true),rms};
  });
  assert.equal(offlineWav.type,'audio/wav','the offline Song audio render should be an explicit WAV artifact');
  assert.equal(offlineWav.wavSampleRate,24000,'the WAV header should preserve the selected render sample rate');
  assert.ok(Math.abs(offlineWav.duration-1)<.001,'the decoded offline mix should keep the exact planned Song duration');
  assert.ok(offlineWav.bytes>48000&&offlineWav.rms.every(level=>level>.03),'decoded audio samples should contain the local pad and generated MIDI mix');
  console.log(`Offline Song WAV acceptance passed: ${offlineWav.duration.toFixed(3)} s decoded, ${offlineWav.bytes} bytes, stereo RMS ${offlineWav.rms.map(level=>level.toFixed(3)).join('/')}.`);
  assert.equal(renderPlan.bars,72);
  assert.equal(renderPlan.durationSeconds,192);
  assert.deepEqual(renderFrameVisuals.map(tile=>tile.kind),['midi','still','video','video','waveform','waveform'],'the same Song timestamp must align a generated note, still, two videos and both audible waveform tracks');
  const fullSongWav=await page.evaluate(async plan=>{
    const {renderSongAudioWav}=await import('/song-render.js');
    const rate=44100,context=new AudioContext({sampleRate:rate});
    const makeTone=(frequency,amplitude)=>{
      const buffer=context.createBuffer(1,rate*2,rate),channel=buffer.getChannelData(0);
      for(let frame=0;frame<channel.length;frame++)channel[frame]=amplitude*Math.sin(2*Math.PI*frequency*frame/rate);
      return buffer;
    };
    const sources={pads:new Map([[0,makeTone(110,.2)]]),vocals:new Map([['render-vocal',makeTone(220,.16)]]),videos:new Map([['video-two',makeTone(330,.1)]])};
    try{
      const result=await renderSongAudioWav(plan,sources,{sampleRate:rate});
      const encoded=await result.blob.arrayBuffer(),header=new DataView(encoded);
      const decoded=await context.decodeAudioData(encoded.slice(0));
      const channel=decoded.getChannelData(0);let sum=0;
      for(const sample of channel)sum+=sample*sample;
      return {type:result.blob.type,bytes:result.blob.size,duration:decoded.duration,rate:header.getUint32(24,true),channels:decoded.numberOfChannels,rms:Math.sqrt(sum/channel.length)};
    }finally{await context.close();}
  },renderPlan);
  assert.equal(fullSongWav.type,'audio/wav');
  assert.equal(fullSongWav.duration,192,'the decoded artifact must span the complete 72-bar arrangement at 90 BPM');
  assert.equal(fullSongWav.rate,44100);
  assert.equal(fullSongWav.channels,2);
  assert.ok(fullSongWav.rms>.01,'the full-length artifact must contain mixed local pad, vocal, video-source and MIDI audio');
  assert.ok(fullSongWav.bytes<48*1024*1024,'the typical full-length song must fit the documented WAV size cap');
  console.log(`Full 72-bar Song WAV acceptance passed: ${fullSongWav.duration.toFixed(1)} s, ${fullSongWav.bytes} bytes, stereo RMS ${fullSongWav.rms.toFixed(3)}; timestamp shows two videos, a still and MIDI.`);
  await page.addInitScript(()=>{
    window.__songVideoFramesDrawn=0;window.__songVideoFirstSourceTime=null;
    const drawImage=CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage=function(media,...args){
      if(this.canvas?.id==='capture-canvas'&&media?.dataset?.songVideoTrack){
        window.__songVideoFramesDrawn++;
        window.__songVideoFirstSourceTime??=media.currentTime;
      }
      return drawImage.call(this,media,...args);
    };
  });
  const openDetails=async selector=>{const details=page.locator(selector);if(!await details.evaluate(el=>el.open))await details.locator('summary').click();};
  const openScreen=async screen=>{
    await page.locator(`[data-studio-screen="${screen}"]`).click();
    await page.waitForFunction(value=>document.body.dataset.screen===value,screen);
  };
  await openScreen('sounds');
  await page.locator('#media-input').setInputFiles({name:'render-pad.wav',mimeType:'audio/wav',buffer:padFixture});
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('madladpad-project-recovery-v1'))?.pads?.[0]?.fileName==='render-pad.wav');
  await openScreen('beats');
  await openDetails('#loop-settings');
  await page.locator('#bpm-input').fill('240');await page.locator('#bpm-input').press('Tab');
  await openScreen('beats');
  if(!await page.locator('#steps').isVisible())await page.locator('#track-view').click();
  await page.locator('#beat-advanced').evaluate(el=>{el.open=true;});
  assert.equal(await page.locator('#beat-advanced').evaluate(el=>el.open),true,'pattern and scene controls should be open');
  const sceneIds=[];
  for(const [index,name] of ['A','B','C'].entries()){
    await page.locator('#steps .step').nth(index).click();
    await page.locator('#scene-name').fill(name);await page.locator('#save-scene').click();
    sceneIds.push(await page.evaluate(()=>JSON.parse(localStorage.getItem('madladpad-project-recovery-v1'))?.scenes?.at(-1)?.id));
  }
  assert.ok(sceneIds.every(Boolean),'A, B and C should each be saved as stable local scenes');
  await openScreen('overdub');
  for(const [sceneId,bars] of [[sceneIds[0],'8'],[sceneIds[1],'16'],[sceneIds[2],'4'],[sceneIds[0],'8']]){
    await page.locator('#song-scene-select').selectOption(sceneId);await page.locator('#song-bars').selectOption(bars);await page.locator('#song-add-section').click();
  }
  assert.match(await page.locator('#song-status').textContent(),/36 bars/);
  await openScreen('overdub');
  await page.locator('#overdub-audio-input').setInputFiles({name:'continuous-vocal.wav',mimeType:'audio/wav',buffer:audioFixture});
  await page.waitForFunction(()=>document.querySelectorAll('#voice-overdub-layers .vocal-layer').length===1);
  assert.match(await page.locator('#voice-overdub-layers .vocal-layer-meta').textContent(),/240\.00 s audible/,'the imported source must decode as a full four-minute audio track');
  await page.locator('#overdub-video-input').setInputFiles({name:'verse-visual.mp4',mimeType:'video/mp4',buffer:videoBytes});
  await page.waitForFunction(()=>document.querySelectorAll('#song-video-layers .song-video-track').length===1);
  const audioId=await page.locator('#voice-overdub-layers .vocal-layer').first().getAttribute('data-layer');
  const videoId=await page.locator('#song-video-layers .song-video-track').first().getAttribute('data-video-layer');
  const reverseAudio=page.locator('#voice-overdub-layers [aria-label="Reverse audio track 1"]');
  await page.waitForFunction(()=>{const input=document.querySelector('#voice-overdub-layers [aria-label="Reverse audio track 1"]');return input&&!input.disabled;});
  await reverseAudio.check();
  const cycle=page.locator('#voice-overdub-layers .song-cycle-settings').first();
  await cycle.locator('summary').click();
  await cycle.locator('input[type="checkbox"]').check();
  const setCycleField=async(key,value)=>{const input=cycle.locator(`[data-cycle-field="${key}"]`);await input.fill(String(value));await input.press('Tab');};
  await setCycleField('repeatEveryBars',8);
  await setCycleField('audibleLengthBars',2);
  await setCycleField('placementEndBar',20);
  await page.waitForFunction(()=>document.querySelectorAll('#overdub-timeline [data-repeat-instance]').length===2,null,{timeout:5000});
  assert.equal(await cycle.locator('input[type="checkbox"]').isChecked(),true,'repeat is enabled for the imported audio clip');
  assert.equal(await cycle.locator('[data-cycle-field="repeatEveryBars"]').inputValue(),'8');
  assert.equal(await cycle.locator('[data-cycle-field="audibleLengthBars"]').inputValue(),'2');
  const videoCycle=page.locator('#song-video-layers .song-cycle-settings').first();
  await videoCycle.locator('summary').click();
  await videoCycle.locator('input[type="checkbox"]').check();
  for(const [key,value] of [['repeatEveryBars',8],['audibleLengthBars',2],['placementEndBar',20]]){
    const input=videoCycle.locator(`[data-cycle-field="${key}"]`);await input.fill(String(value));await input.press('Tab');
  }
  assert.ok(await page.locator('#overdub-timeline .overdub-video-clip.song-repeat-instance').count()>0,'video repeats are visible on the aligned Song ruler');
  assert.equal(await page.locator('[aria-label="Mix source audio for video track 1"]').isChecked(),false,'video source audio is muted by default');
  const before=await page.evaluate(async({audioId,videoId})=>{
    const {getValue}=await import('/storage.js');
    const audio=await getValue(`voice-layer:${audioId}`),video=await getValue(`video-layer:${videoId}`);
    const digest=async blob=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))).map(byte=>byte.toString(16).padStart(2,'0')).join('');
    return {audioBytes:audio?.size,videoBytes:video?.size,audioHash:await digest(audio),videoHash:await digest(video)};
  },{audioId,videoId});
  assert.equal(before.audioBytes,audioFixture.length,'the complete four-minute raw audio source is stored locally');
  assert.equal(before.videoBytes,videoBytes.length,'the original video bytes are stored locally');
  await page.locator('#session-menu > summary').click();
  const backupDownload=page.waitForEvent('download');await page.locator('#export-button').click();
  const backupPath=await (await backupDownload).path();
  const pack=JSON.parse(await readFile(backupPath,'utf8'));
  assert.deepEqual(pack.project.song.clips.map(clip=>clip.bars),[8,16,4,8]);
  assert.deepEqual(pack.project.song.clips.map(clip=>clip.sceneId),[...sceneIds.slice(0,3),sceneIds[0]]);
  assert.deepEqual([pack.project.voice.layers[0].repeatEveryBars,pack.project.voice.layers[0].audibleLengthBars,pack.project.voice.layers[0].placementEndBar],[8,2,20],'portable project packs preserve the independent cycle settings');
  assert.equal(pack.project.voice.layers[0].reverseEnabled,true,'portable project packs preserve the non-destructive reverse setting');
  assert.deepEqual([pack.project.voice.videoLayers[0].repeatEnabled,pack.project.voice.videoLayers[0].repeatEveryBars,pack.project.voice.videoLayers[0].audibleLengthBars,pack.project.voice.videoLayers[0].placementEndBar],[true,8,2,20],'portable project packs preserve the independent video cycle settings');
  assert.equal(pack.voiceMedia.length,1);assert.equal(pack.videoMedia.length,1);
  page.once('dialog',dialog=>dialog.accept());
  await page.locator('#project-input').setInputFiles({name:'full-song.madladpad',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(pack))});
  await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('Project restored'));
  await page.reload();await openScreen('sounds');await page.locator('.pad-hit').first().waitFor();await openScreen('overdub');
  await page.waitForFunction(()=>document.querySelectorAll('#song-timeline .song-section-clip').length===4,null,{timeout:10000});
  const after=await page.evaluate(async({audioId,videoId})=>{
    const {getValue}=await import('/storage.js');
    const audio=await getValue(`voice-layer:${audioId}`),video=await getValue(`video-layer:${videoId}`);
    const digest=async blob=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))).map(byte=>byte.toString(16).padStart(2,'0')).join('');
    return {audioBytes:audio?.size,videoBytes:video?.size,audioHash:await digest(audio),videoHash:await digest(video)};
  },{audioId,videoId});
  assert.deepEqual(after,before,'pack import and reload preserve both original local media blobs');
  assert.equal(await page.locator('#song-timeline .song-section-clip').count(),4,'restored Song sections remain on the shared timeline');
  await page.waitForFunction(()=>document.querySelectorAll('#voice-overdub-layers .vocal-layer').length===1&&document.querySelectorAll('#song-video-layers .song-video-track').length===1,null,{timeout:10000});
  assert.equal(await page.locator('#song-bar-ruler .song-bar-tick').last().getAttribute('title'),'Bar 240','the shared ruler must include the full imported media tail beyond the 36-bar arrangement');
  assert.equal(await page.locator('#voice-overdub-layers .vocal-layer').count(),1);
  assert.equal(await page.locator('#song-video-layers .song-video-track').count(),1);
  assert.equal(await page.locator('#voice-overdub-layers .song-cycle-settings input[type="checkbox"]').first().isChecked(),true,'reload restores the audio cycle setting');
  assert.equal(await page.locator('#voice-overdub-layers [aria-label="Reverse audio track 1"]').isChecked(),true,'reload restores the reverse playback setting');
  assert.equal(await page.locator('#voice-overdub-layers .song-cycle-settings [data-cycle-field="repeatEveryBars"]').first().inputValue(),'8');
  assert.equal(await page.locator('#overdub-timeline [data-repeat-instance]').count(),2,'the timeline restores only repeat instances before the explicit clip boundary');
  assert.deepEqual(await page.locator('#song-video-layers .song-cycle-settings input').evaluateAll(inputs=>inputs.map(input=>input.type==='checkbox'?input.checked:input.value)),[true,'8','0','2','20'],'reload restores all video cycle settings');
  assert.ok(await page.locator('#overdub-timeline .overdub-video-clip.song-repeat-instance').count()>0,'the video repeat layout survives pack import and reload');

  await openScreen('beats');
  await openScreen('overdub');
  assert.match(await page.locator('#studio-play').textContent(),/PLAY SONG/,'the microphone take should be captured against the arranged Song transport');
  await page.locator('#studio-play').click();
  await page.waitForFunction(()=>document.querySelector('#studio-play').textContent.includes('STOP'));
  // At 240 BPM the first eight-bar A section lasts eight seconds. Start the
  // synthetic microphone take after that boundary and verify it is placed on
  // the shared Song ruler rather than silently restarting at bar one.
  await page.waitForTimeout(8100);
  await openScreen('overdub');
  await page.locator('#voice-overdub-record').click();
  await page.waitForFunction(()=>document.querySelector('#voice-overdub-status').textContent.includes('Recording microphone audio'));
  await page.waitForTimeout(1300);
  await page.locator('#voice-overdub-stop').click();
  await page.waitForFunction(()=>document.querySelectorAll('#voice-overdub-layers .vocal-layer').length===2,null,{timeout:10000});
  const recordedTrack=page.locator('#voice-overdub-layers .vocal-layer').nth(1);
  const recordedId=await recordedTrack.getAttribute('data-layer');
  const recorded=await page.evaluate(async id=>{
    const {getValue,listInterruptedAudioRecordings}=await import('/storage.js');
    const file=await getValue(`voice-layer:${id}`);
    if(!file)throw new Error('The synthetic microphone take was not saved locally');
    const context=new AudioContext();
    try{
      const buffer=await context.decodeAudioData(await file.arrayBuffer());
      const samples=buffer.getChannelData(0);
      return {bytes:file.size,duration:buffer.duration,rms:Math.sqrt(samples.reduce((sum,value)=>sum+value*value,0)/samples.length),journals:(await listInterruptedAudioRecordings()).length};
    }finally{await context.close();}
  },recordedId);
  const recordedStartStep=await page.evaluate(()=>JSON.parse(localStorage.getItem('madladpad-project-recovery-v1'))?.voice?.layers?.[1]?.startStep);
  assert.ok(recordedStartStep>=128&&recordedStartStep<192,`the captured microphone take should begin in Song section B after bar 8, got step ${recordedStartStep}`);
  assert.ok(recorded.bytes>100&&recorded.duration>.5&&recorded.rms>.01,`the later-section microphone source should remain playable: ${JSON.stringify(recorded)}`);
  assert.equal(recorded.journals,0,'a saved later-section microphone take should clear its recovery journal');
  assert.match(await recordedTrack.locator('.vocal-layer-meta').textContent(),/starts at bar (9|10|11|12)/,'the visible track placement should match the later Song section');
  assert.match(await page.locator('#overdub-timeline .overdub-wave-row svg').nth(1).getAttribute('aria-label'),/from bar (9|10|11|12)/,'the waveform should expose the later Song placement');

  const firstTakeHash=await page.evaluate(async id=>{
    const {getValue}=await import('/storage.js');
    const file=await getValue(`voice-layer:${id}`);
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer()))).map(byte=>byte.toString(16).padStart(2,'0')).join('');
  },recordedId);
  await page.locator('#studio-play').click();
  await page.waitForFunction(()=>document.querySelector('#studio-play').textContent.includes('PLAY SONG'));
  await page.locator('#song-seek-bar').fill('17');
  await page.locator('#song-go-to-bar').click();
  await page.locator('#studio-play').click();
  await page.waitForFunction(()=>document.querySelector('#studio-play').textContent.includes('STOP'));
  assert.equal(await page.locator('#voice-overdub-record').isDisabled(),false,'a running Song should allow recording another vocal take');
  await page.locator('#voice-overdub-record').click();
  await page.waitForFunction(()=>{
    const status=document.querySelector('#voice-overdub-status').textContent;
    return status.includes('Recording microphone audio over the playing sequence')||status.startsWith('Could not start local vocal recording:')||status.includes('Start the sequencer before recording');
  });
  assert.match(await page.locator('#voice-overdub-status').textContent(),/Recording microphone audio over the playing sequence/,`the selected-bar retake should start successfully, got: ${await page.locator('#voice-overdub-status').textContent()}`);
  await page.waitForTimeout(1300);
  await page.locator('#voice-overdub-stop').click();
  await page.waitForFunction(()=>document.querySelectorAll('#voice-overdub-layers .vocal-layer').length===3,null,{timeout:10000});
  const secondRecordedTrack=page.locator('#voice-overdub-layers .vocal-layer').nth(2);
  const secondRecordedId=await secondRecordedTrack.getAttribute('data-layer');
  const secondTake=await page.evaluate(async({firstId,secondId})=>{
    const {getValue,listInterruptedAudioRecordings}=await import('/storage.js');
    const [first,second]=await Promise.all([getValue(`voice-layer:${firstId}`),getValue(`voice-layer:${secondId}`)]);
    const digest=async file=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer()))).map(byte=>byte.toString(16).padStart(2,'0')).join('');
    const project=JSON.parse(localStorage.getItem('madladpad-project-recovery-v1'));
    return {firstHash:await digest(first),secondBytes:second?.size,secondStartStep:project?.voice?.layers?.find(item=>item.id===secondId)?.startStep,layerCount:project?.voice?.layers?.length,journals:(await listInterruptedAudioRecordings()).length};
  },{firstId:recordedId,secondId:secondRecordedId});
  assert.equal(secondTake.layerCount,3,'recording another verse take should append a new track and preserve the original');
  assert.ok(secondTake.secondBytes>100,'the second synthetic vocal take should have its own locally saved media');
  assert.ok(secondTake.secondStartStep>=256&&secondTake.secondStartStep<288,`the second take should start at the selected bar 17 within one bar of capture alignment, got step ${secondTake.secondStartStep}`);
  assert.equal(secondTake.firstHash,firstTakeHash,'recording a retake must not rewrite the first raw take');
  assert.equal(secondTake.journals,0,'saving the second take should clear its recovery journal');
  assert.match(await secondRecordedTrack.locator('.vocal-layer-meta').textContent(),/starts at bar (17|18)/,'the second raw take should show its selected later-bar placement');

  await page.locator('#overdub-video-record').click();
  await page.waitForFunction(()=>document.querySelector('#song-video-status').textContent.includes('Recording camera and microphone locally over the Song'));
  await page.waitForTimeout(1300);
  await page.locator('#overdub-video-stop').click();
  await page.waitForFunction(()=>document.querySelectorAll('#song-video-layers .song-video-track').length===2,null,{timeout:15000});
  const recordedVideoTrack=page.locator('#song-video-layers .song-video-track').nth(1);
  const recordedVideoId=await recordedVideoTrack.getAttribute('data-video-layer');
  const recordedVideo=await page.evaluate(async id=>{
    const {getValue,listInterruptedVideoRecordings}=await import('/storage.js');
    const file=await getValue(`video-layer:${id}`);
    const project=JSON.parse(localStorage.getItem('madladpad-project-recovery-v1'));
    const layer=project?.voice?.videoLayers?.find(item=>item.id===id);
    return {bytes:file?.size,type:file?.type,startStep:layer?.startStep,journals:(await listInterruptedVideoRecordings()).length};
  },recordedVideoId);
  assert.ok(recordedVideo.bytes>100&&recordedVideo.type.startsWith('video/'),`the camera take should be saved as local video: ${JSON.stringify(recordedVideo)}`);
  assert.ok(recordedVideo.startStep>=256&&recordedVideo.startStep<288,`the camera take should follow the selected bar 17 start, got step ${recordedVideo.startStep}`);
  assert.equal(recordedVideo.journals,0,'a saved section-B camera take should clear its recovery journal');
  assert.match(await recordedVideoTrack.locator('.song-video-meta').textContent(),/bar (?:9|1[0-9]|2[0-4])\b/,'the visible camera track placement should match section B');
  assert.match(await page.locator('#overdub-timeline .overdub-wave-row[data-video-layer]').nth(1).locator('.overdub-video-clip').first().getAttribute('aria-label'),/video repeat 1 from bar (?:9|1[0-9]|2[0-4])\b/,'the timeline should expose the section-B camera placement');

  const audioDownload=page.waitForEvent('download',{timeout:10000});
  await openScreen('export');await page.locator('#record-audio').click();
  await page.waitForFunction(()=>document.querySelector('#record-audio').textContent.includes('STOP AUDIO TAKE'));
  await page.waitForTimeout(8300);await page.locator('#record-audio').click();
  const mix=await audioDownload;const audioBytes=await readFile(await mix.path());
  assert.ok(audioBytes.length>100,'the restored continuous Song audio produces an audio mix export');
  const mixStats=await page.evaluate(async encoded=>{
    const data=Uint8Array.from(atob(encoded),ch=>ch.charCodeAt(0));const context=new AudioContext();
    try{const buffer=await context.decodeAudioData(data.buffer);const samples=buffer.getChannelData(0);return {rms:Math.sqrt(samples.reduce((sum,value)=>sum+value*value,0)/samples.length),duration:buffer.duration};}
    finally{await context.close();}
  },audioBytes.toString('base64'));
  assert.ok(mixStats.rms>.01,`the exported audio should contain the imported vocal tone (RMS ${mixStats.rms})`);
  assert.ok(mixStats.duration>=8,`the exported mix should continue across the first eight-bar section boundary, got ${mixStats.duration} seconds`);
  await openScreen('beats');
  if(await page.locator('#studio-play').getAttribute('aria-pressed')==='true'){
    await page.locator('#studio-play').click();
    await page.waitForFunction(()=>document.querySelector('#studio-play').getAttribute('aria-pressed')==='false');
  }
  const offlineDownload=page.waitForEvent('download',{timeout:30000});
  await openScreen('export');
  assert.equal(await page.locator('#render-song-audio').isEnabled(),true,'a stopped Song with local sources exposes its offline WAV action');
  await page.locator('#render-song-audio').click();
  await page.waitForFunction(()=>document.querySelector('#render-song-audio-status').textContent.includes('Offline Song mix ready'),null,{timeout:30000});
  const offlineArtifact=await offlineDownload;
  const offlineBytes=await readFile(await offlineArtifact.path());
  assert.equal(offlineBytes.toString('ascii',0,4),'RIFF','the export action downloads an actual WAV file');
  const uiRender=await page.evaluate(async encoded=>{
    const bytes=Uint8Array.from(atob(encoded),character=>character.charCodeAt(0));
    const context=new AudioContext();
    try{const buffer=await context.decodeAudioData(bytes.buffer);const samples=buffer.getChannelData(0);return {duration:buffer.duration,rms:Math.sqrt(samples.reduce((sum,value)=>sum+value*value,0)/samples.length),channels:buffer.numberOfChannels};}
    finally{await context.close();}
  },offlineBytes.toString('base64'));
  assert.ok(Math.abs(uiRender.duration-36)<.02,`the downloaded Song WAV should match all 36 bars at 240 BPM, got ${uiRender.duration}s`);
  assert.equal(uiRender.channels,2);
  assert.ok(uiRender.rms>.01,`the offline action should mix the imported pad and vocal audio, got RMS ${uiRender.rms}`);
  assert.match(await page.locator('#export-audio-preview').getAttribute('src'),/blob:/,'the generated WAV is available in the app preview');
  await page.locator('#studio-play').click();
  await page.waitForFunction(()=>document.querySelector('#studio-play').getAttribute('aria-pressed')==='true');
  await openScreen('export');
  const videoDownload=page.waitForEvent('download',{timeout:15000}).then(download=>({download}),error=>({error}));
  await page.locator('#start-record').click();
  await page.waitForFunction(()=>document.querySelector('#start-record').textContent.includes('STOP RECORDING'));
  await page.waitForFunction(()=>window.__songVideoFramesDrawn>0,null,{timeout:10000});
  assert.ok(await page.evaluate(()=>window.__songVideoFirstSourceTime)>=0,'the restored video track reaches the Song export composition');
  await page.waitForTimeout(1000);await page.locator('#start-record').click();
  const videoResult=await videoDownload;
  assert.ok(videoResult.download,`the restored Song video should export: ${videoResult.error?.message||'no download'}`);
  const videoExport=await readFile(await videoResult.download.path());
  assert.ok(videoExport.length>100,'the restored Song video produces an audiovisual export');
  const decodedVideo=await page.evaluate(encoded=>new Promise((resolve,reject)=>{
    const bytes=Uint8Array.from(atob(encoded),character=>character.charCodeAt(0));
    const element=document.createElement('video'),url=URL.createObjectURL(new Blob([bytes],{type:'video/webm'}));
    const timer=setTimeout(()=>reject(new Error('video export metadata timed out')),5000);
    element.muted=true;
    element.onloadeddata=()=>{clearTimeout(timer);URL.revokeObjectURL(url);resolve({duration:element.duration,width:element.videoWidth,height:element.videoHeight,readyState:element.readyState});};
    element.onerror=()=>{clearTimeout(timer);URL.revokeObjectURL(url);reject(new Error('video export could not be decoded'));};
    element.src=url;
  }),videoExport.toString('base64'));
  assert.ok(decodedVideo.width>0&&decodedVideo.height>0&&decodedVideo.readyState>=2,`the audiovisual export should decode a video frame, got ${JSON.stringify(decodedVideo)}`);
  await openScreen('beats');await page.locator('#studio-play').click();
  await page.waitForFunction(()=>document.querySelector('#studio-play').getAttribute('aria-pressed')==='false');
  console.log(`Song journey browser acceptance passed: 36-bar A-B-C-A, offline WAV ${uiRender.duration.toFixed(1)} s / ${offlineBytes.length} bytes / RMS ${uiRender.rms.toFixed(3)}, four-minute local audio/video pack recovery, synthetic microphone take ${recorded.duration.toFixed(2)} s from Song step ${recordedStartStep}, camera clip ${recordedVideo.bytes} bytes from Song step ${recordedVideo.startStep}, decoded 8+ second live mix RMS ${mixStats.rms.toFixed(3)}, and a decoded ${decodedVideo.width}×${decodedVideo.height} video frame.`);
  await context.close();
}finally{
  if(browser)await browser.close();
  if(temp)await rm(temp,{recursive:true,force:true});
  await new Promise(resolve=>server.close(resolve));
}
