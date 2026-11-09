// iOS-adjacent browser smoke. This is desktop WebKit, not physical iOS Safari.
import { webkit } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import assert from 'node:assert/strict';

const root=resolve('site');
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png'};
const server=createServer(async(req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  if(pathname==='/index.html'){res.writeHead(307,{Location:'/'}).end();return;}
  const path=resolve(root,`.${pathname==='/'?'/index.html':pathname}`);
  if(!path.startsWith(`${root}/`)){res.writeHead(403).end();return;}
  try{res.setHeader('Content-Type',mime[extname(path)]||'application/octet-stream');res.end(await readFile(path));}
  catch{res.writeHead(404).end();}
});

function makeWav(){
  const sampleRate=8000,frames=sampleRate,bytes=Buffer.alloc(44+frames*2);
  bytes.write('RIFF',0);bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);
  bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);
  bytes.writeUInt32LE(sampleRate,24);bytes.writeUInt32LE(sampleRate*2,28);bytes.writeUInt16LE(2,32);
  bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(frames*2,40);
  for(let frame=0;frame<frames;frame++)bytes.writeInt16LE(Math.round(12000*Math.sin(2*Math.PI*440*frame/sampleRate)),44+frame*2);
  return bytes;
}

let browser,context;
const errors=[];
try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://localhost:${server.address().port}`;
  browser=await webkit.launch({headless:true});
  context=await browser.newContext({viewport:{width:390,height:844}});
  await context.route('**/*',route=>route.request().url().startsWith(`${origin}/`)?route.continue():route.abort());
  const page=await context.newPage();
  page.on('pageerror',error=>errors.push(error.message));
  const response=await page.goto(origin);
  assert.equal(response.status(),200,'local Worker-assets shell should load');

  for(const width of [320,390]){
    await page.setViewportSize({width,height:844});
    const dimensions=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth}));
    assert.ok(dimensions.document<=dimensions.viewport,`document should not overflow at ${width}px: ${JSON.stringify(dimensions)}`);
  }
  assert.equal(await page.locator('#studio-nav > a').count(),3,'the three core destinations should stay primary');

  const more=page.locator('#studio-more-tools');
  if(!await more.evaluate(element=>element.open))await more.locator('summary').click();
  await page.locator('[data-studio-screen="voice"]').click();
  await page.waitForFunction(()=>document.body.dataset.screen==='voice');
  assert.match(await more.locator('summary').textContent(),/Voice Lab/,'hidden specialist navigation should retain the selected screen label');
  assert.equal(await more.locator('summary').getAttribute('aria-current'),'page');
  await page.locator('[data-voice-jump="rap-title"]').click();
  assert.equal(await page.locator('#voice-rap-tool').isVisible(),true,'Rap & Flow should open in the focused Voice Lab');
  assert.equal(await page.locator('[data-voice-jump="rap-title"]').getAttribute('aria-pressed'),'true');

  await page.locator('[data-studio-screen="sounds"]').click();
  const wav=makeWav();
  await page.locator('#media-input').setInputFiles({name:'webkit-synthetic.wav',mimeType:'audio/wav',buffer:wav});
  await page.getByText(/webkit-synthetic\.wav.*stored on this device/i).waitFor({timeout:15000});
  const saved=await page.evaluate(async()=>{
    const {getValue}=await import('/storage.js');
    const file=await getValue('media:0');
    return {isFile:file instanceof File,name:file.name,type:file.type,size:file.size};
  });
  assert.equal(saved.isFile,true,'WebKit should persist a File object to IndexedDB');
  assert.equal(saved.name,'webkit-synthetic.wav');
  assert.ok(['audio/wav','audio/x-wav'].includes(saved.type),`WebKit may normalize WAV MIME, got ${saved.type}`);
  assert.equal(saved.size,wav.length);

  await page.reload({waitUntil:'networkidle'});
  await page.getByText(/webkit-synthetic\.wav.*stored on this device/i).waitFor({timeout:15000});
  const restored=await page.evaluate(async()=>{
    const {getValue}=await import('/storage.js');
    const file=await getValue('media:0');
    return file instanceof File&&file.name==='webkit-synthetic.wav'&&file.size>44;
  });
  assert.equal(restored,true,'the imported local File should survive a WebKit page reload');

  const videoFixture=await page.evaluate(async()=>{
    const mime=['video/mp4','video/webm;codecs=vp8,opus','video/webm'].find(type=>MediaRecorder.isTypeSupported(type));
    if(!mime||!HTMLCanvasElement.prototype.captureStream)return null;
    const audio=new AudioContext();await audio.resume();
    const oscillator=audio.createOscillator(),gain=audio.createGain(),audioStream=audio.createMediaStreamDestination();
    oscillator.frequency.value=440;gain.gain.value=.18;oscillator.connect(gain).connect(audioStream);oscillator.start();
    const canvas=document.createElement('canvas');canvas.width=160;canvas.height=90;
    const paint=canvas.getContext('2d');let frame=0;
    const timer=setInterval(()=>{paint.fillStyle=frame++%2?'#193b25':'#487b30';paint.fillRect(0,0,canvas.width,canvas.height);},33);
    const videoStream=canvas.captureStream(30),stream=new MediaStream([...videoStream.getVideoTracks(),...audioStream.stream.getAudioTracks()]);
    const recorder=new MediaRecorder(stream,{mimeType:mime}),chunks=[];
    recorder.ondataavailable=event=>{if(event.data.size)chunks.push(event.data);};
    const stopped=new Promise(resolve=>recorder.onstop=()=>resolve(new Blob(chunks,{type:recorder.mimeType||mime})));
    recorder.start(100);await new Promise(resolve=>setTimeout(resolve,2000));recorder.stop();
    const blob=await stopped;clearInterval(timer);oscillator.stop();stream.getTracks().forEach(track=>track.stop());await audio.close();
    const bytes=new Uint8Array(await blob.arrayBuffer());let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);
    return {mime:blob.type,size:bytes.length,base64:btoa(binary)};
  });
  if(videoFixture){
    assert.ok(videoFixture.size>100,'WebKit should produce a playable synthetic video fixture');
    await page.locator('.pad').nth(1).hover();
    await page.locator('.pad .edit-pad').nth(1).click();
    page.once('dialog',dialog=>dialog.accept());
    const extension=videoFixture.mime.includes('mp4')?'mp4':'webm';
    await page.locator('#media-input').setInputFiles({name:`webkit-playback.${extension}`,mimeType:videoFixture.mime,buffer:Buffer.from(videoFixture.base64,'base64')});
    await page.getByText(new RegExp(`webkit-playback\\.${extension}.*stored on this device`,'i')).waitFor({timeout:15000});
    await page.waitForFunction(()=>{const video=document.querySelectorAll('.pad video')[1];return video?.readyState>=2&&Number.isFinite(video.duration)&&video.duration>=1.5;},{timeout:15000});
    const video=page.locator('.pad video').nth(1);
    await page.evaluate(()=>{
      const nativePlay=HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play=function(...args){
        if(!this.closest('.pad'))return nativePlay.apply(this,args);
        return new Promise((resolve,reject)=>setTimeout(()=>nativePlay.apply(this,args).then(resolve,reject),500));
      };
    });
    if(!await page.locator('#sample-advanced').evaluate(element=>element.open))await page.locator('#sample-advanced > summary').click();
    const playback=[];
    for(const speed of [1,2]){
      await page.locator('#speed').evaluate((element,value)=>{element.value=String(value);element.dispatchEvent(new Event('input',{bubbles:true}));},speed);
      await video.evaluate(element=>{element.pause();element.currentTime=0;});
      await page.locator('.pad-hit').nth(1).click();
      await page.waitForFunction(()=>{const element=document.querySelectorAll('.pad video')[1];return element?.paused&&element.currentTime>.1;},null,{timeout:7000});
      const result=await video.evaluate(element=>({duration:element.duration,currentTime:element.currentTime,playbackRate:element.playbackRate,paused:element.paused}));
      assert.ok(result.currentTime>=result.duration-.12,`WebKit video should play the selected region to its end at Speed ${speed}×, got ${JSON.stringify(result)}`);
      playback.push({speed,...result});
    }
    console.log(`WebKit media stop boundary passed: ${JSON.stringify(playback)}.`);
  }else console.log('Skipped WebKit video stop-boundary check: MediaRecorder or canvas captureStream is unavailable.');

  assert.deepEqual(errors,[],'the tested WebKit journeys should not produce uncaught page errors');
  console.log('WebKit smoke passed: 320/390px overflow, secondary navigation state, Rap focus, WAV import and IndexedDB File reload.');
}finally{
  await context?.close();
  await browser?.close();
  await new Promise(resolve=>server.close(resolve));
}
