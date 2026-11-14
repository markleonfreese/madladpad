// Integrated A-B-C-A Song acceptance with generated local media only.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { resolve, extname, join } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';

const root=resolve('site');
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png'};
const server=createServer(async(req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  const path=resolve(root,`.${pathname==='/'?'/index.html':pathname}`);
  if(!path.startsWith(`${root}/`)){res.writeHead(403).end();return;}
  try{res.setHeader('Content-Type',mime[extname(path)]||'application/octet-stream');res.end(await readFile(path));}
  catch{res.writeHead(404).end();}
});
const wav=()=>{
  const rate=16000,frames=rate*240,bytes=Buffer.alloc(44+frames*2);
  bytes.write('RIFF',0);bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);
  bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);
  bytes.writeUInt32LE(rate,24);bytes.writeUInt32LE(rate*2,28);bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);
  bytes.write('data',36);bytes.writeUInt32LE(frames*2,40);
  for(let i=0;i<frames;i++)bytes.writeInt16LE(Math.round(11000*Math.sin(2*Math.PI*440*i/rate)),44+i*2);
  return bytes;
};
const audioFixture=wav();
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
  await page.goto(origin);await page.locator('.pad-hit').first().waitFor();
  const openDetails=async selector=>{const details=page.locator(selector);if(!await details.evaluate(el=>el.open))await details.locator('summary').click();};
  const openScreen=async screen=>{
    if(screen==='overdub'){
      const menu=page.locator('#studio-more-tools');if(!await menu.evaluate(el=>el.open))await menu.locator('summary').click();
    }
    await page.locator(`[data-studio-screen="${screen}"]`).click();
    await page.waitForFunction(value=>document.body.dataset.screen===value,screen);
  };
  await openScreen('beats');
  await openDetails('#loop-settings');
  await page.locator('#bpm-input').fill('240');await page.locator('#bpm-input').press('Tab');
  await page.locator('#pattern-view').click();
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
  await page.locator('#song-view').click();
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
  assert.equal(pack.voiceMedia.length,1);assert.equal(pack.videoMedia.length,1);
  page.once('dialog',dialog=>dialog.accept());
  await page.locator('#project-input').setInputFiles({name:'full-song.madladpad',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(pack))});
  await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('Project restored'));
  await page.reload();await openScreen('sounds');await page.locator('.pad-hit').first().waitFor();await openScreen('overdub');
  await page.waitForFunction(()=>document.querySelectorAll('#overdub-timeline .overdub-song-section').length===4,null,{timeout:10000});
  const after=await page.evaluate(async({audioId,videoId})=>{
    const {getValue}=await import('/storage.js');
    const audio=await getValue(`voice-layer:${audioId}`),video=await getValue(`video-layer:${videoId}`);
    const digest=async blob=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))).map(byte=>byte.toString(16).padStart(2,'0')).join('');
    return {audioBytes:audio?.size,videoBytes:video?.size,audioHash:await digest(audio),videoHash:await digest(video)};
  },{audioId,videoId});
  assert.deepEqual(after,before,'pack import and reload preserve both original local media blobs');
  assert.equal(await page.locator('#overdub-timeline .overdub-song-section').count(),4,'restored overdubs remain on the four-section Song timeline');
  assert.equal(await page.locator('#voice-overdub-layers .vocal-layer').count(),1);
  assert.equal(await page.locator('#song-video-layers .song-video-track').count(),1);

  await page.locator('#play-seq').click();
  await page.waitForFunction(()=>document.querySelector('#play-seq').textContent.includes('STOP'));
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
  if((await page.locator('#play-seq').textContent()).includes('STOP')){await openScreen('beats');await page.locator('#play-seq').click();}

  await openScreen('beats');
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
  console.log(`Song journey browser acceptance passed: 36-bar A-B-C-A, four-minute local audio/video pack recovery, decoded 8+ second mix RMS ${mixStats.rms.toFixed(3)}, and a decoded ${decodedVideo.width}×${decodedVideo.height} video frame.`);
  await context.close();
}finally{
  if(browser)await browser.close();
  if(temp)await rm(temp,{recursive:true,force:true});
  await new Promise(resolve=>server.close(resolve));
}
