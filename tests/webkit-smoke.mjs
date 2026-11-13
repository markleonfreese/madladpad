// iOS-adjacent browser smoke. This is desktop WebKit, not physical iOS Safari.
import { webkit } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import assert from 'node:assert/strict';

const root=resolve('site');
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png'};
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
const blockedFontProviderRequests=[];
try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://localhost:${server.address().port}`;
  browser=await webkit.launch({headless:true});
  context=await browser.newContext({viewport:{width:390,height:844}});
  await context.route('**/*',route=>{
    const url=route.request().url();
    if(url.startsWith(`${origin}/`))return route.continue();
    if(/https:\/\/fonts\.(?:googleapis|gstatic)\.com\//.test(url))blockedFontProviderRequests.push(url);
    return route.abort();
  });
  const page=await context.newPage();
  page.on('pageerror',error=>errors.push(error.message));
  const response=await page.goto(origin);
  assert.equal(response.status(),200,'local Worker-assets shell should load');
  await page.locator('.pad-hit').first().waitFor({timeout:10000});
  const loadedFontFaces=await page.evaluate(async()=>{
    const loaded=await Promise.all([
      document.fonts.load('400 16px "DM Sans"','MadLadPad'),
      document.fonts.load('800 16px "DM Sans"','MadLadPad'),
      document.fonts.load('400 12px "DM Mono"','MadLadPad'),
      document.fonts.load('500 12px "DM Mono"','MadLadPad'),
      document.fonts.load('400 16px "DM Sans"','Māori')
    ]);
    return loaded.map(faces=>faces.length);
  });
  assert.ok(loadedFontFaces.every(count=>count>0),`local DM Sans and DM Mono faces should load in WebKit: ${JSON.stringify(loadedFontFaces)}`);

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
  await page.locator('#pad-edit-mode').click();
  await page.locator('#pad-grid .pad-hit').first().click();
  assert.equal(await page.locator('#sample-editor-dialog').evaluate(dialog=>dialog.open),true,'WebKit edit mode should open the focused sample editor');
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
  await page.waitForFunction(()=>document.querySelector('#sample-info')?.textContent.includes('webkit-synthetic.wav · AUDIO · stored on this device'),null,{timeout:15000});
  const restored=await page.evaluate(async()=>{
    const {getValue}=await import('/storage.js');
    const file=await getValue('media:0');
    return file instanceof File&&file.name==='webkit-synthetic.wav'&&file.size>44;
  });
  assert.equal(restored,true,'the imported local File should survive a WebKit page reload');

  const canPlayTestVideo=await page.evaluate(()=>Boolean(document.createElement('video').canPlayType('video/mp4; codecs="avc1.42E01E, mp4a.40.2"')));
  if(canPlayTestVideo){
    const sampleEditor=page.locator('#sample-editor-dialog');
    const openSampleEditor=async()=>{
      if(!await sampleEditor.evaluate(dialog=>dialog.open)){
        if(await page.locator('#pad-edit-mode').getAttribute('aria-pressed')!=='true')await page.locator('#pad-edit-mode').click();
        await page.locator('#pad-grid .pad-hit').nth(1).click();
        await page.waitForFunction(()=>document.querySelector('#sample-editor-dialog').open);
      }
    };
    const closeSampleEditor=async()=>{
      if(await sampleEditor.evaluate(dialog=>dialog.open)){
        await page.locator('#close-sample-editor').click();
        await page.waitForFunction(()=>!document.querySelector('#sample-editor-dialog').open);
      }
      if(await page.locator('#pad-edit-mode').getAttribute('aria-pressed')==='true')await page.locator('#pad-edit-mode').click();
    };
    const videoFixture=await readFile(resolve('tests/fixtures/webkit-stop-boundary.mp4'));
    assert.ok(videoFixture.length>100,'the deterministic synthetic video fixture should be present');
    console.log(`WebKit synthetic video fixture: video/mp4 (${videoFixture.length} bytes).`);
    await openSampleEditor();
    page.once('dialog',dialog=>dialog.accept());
    const extension='mp4';
    await page.locator('#media-input').setInputFiles({name:`webkit-playback.${extension}`,mimeType:'video/mp4',buffer:videoFixture});
    await page.getByText(new RegExp(`webkit-playback\\.${extension}.*stored on this device`,'i')).waitFor({timeout:15000});
    await page.waitForFunction(()=>{const video=document.querySelectorAll('.pad video')[1];return Boolean(video&&(video.readyState>=2||video.error!==null));},null,{timeout:15000});
    const video=page.locator('.pad video').nth(1);
    const decoded=await video.evaluate(element=>({readyState:element.readyState,duration:element.duration,error:element.error&&{code:element.error.code,message:element.error.message},networkState:element.networkState,src:element.currentSrc}));
    assert.ok(decoded.readyState>=2&&Number.isFinite(decoded.duration)&&decoded.duration>=1.5,`WebKit should decode its generated video before the stop-boundary check: ${JSON.stringify(decoded)}`);
    await page.evaluate(()=>{
      const nativePlay=HTMLMediaElement.prototype.play;
      window.__webkitSmokeNativePlay=nativePlay;
      HTMLMediaElement.prototype.play=function(...args){
        if(!this.closest('.pad'))return nativePlay.apply(this,args);
        return new Promise((resolve,reject)=>setTimeout(()=>nativePlay.apply(this,args).then(resolve,reject),500));
      };
    });
    if(!await page.locator('#sample-advanced').evaluate(element=>element.open))await page.locator('#sample-advanced > summary').click();
    const playback=[];
    for(const speed of [1,2]){
      await openSampleEditor();
      await page.locator('#speed').evaluate((element,value)=>{element.value=String(value);element.dispatchEvent(new Event('input',{bubbles:true}));},speed);
      await closeSampleEditor();
      await video.evaluate(element=>{element.pause();element.currentTime=0;});
      await page.locator('.pad-hit').nth(1).click();
      await page.waitForFunction(()=>{const element=document.querySelectorAll('.pad video')[1];return element?.paused&&element.currentTime>.1;},null,{timeout:7000});
      const result=await video.evaluate(element=>({duration:element.duration,currentTime:element.currentTime,playbackRate:element.playbackRate,paused:element.paused}));
      assert.ok(result.currentTime>=result.duration-.12,`WebKit video should play the selected region to its end at Speed ${speed}×, got ${JSON.stringify(result)}`);
      playback.push({speed,...result});
    }
    console.log(`WebKit media stop boundary passed: ${JSON.stringify(playback)}.`);

    await openSampleEditor();
    await page.waitForFunction(()=>!document.querySelector('#region-start').disabled,'',{timeout:10000});
    await page.locator('#region-start').fill('0.40');
    await page.locator('#region-end').fill('0.45');
    await page.locator('#region-apply').click();
    await page.evaluate(()=>{
      if(window.__webkitSmokeNativePlay)HTMLMediaElement.prototype.play=window.__webkitSmokeNativePlay;
      delete window.__webkitSmokeNativePlay;
    });
    await video.evaluate(element=>{
      const addNativeListener=element.addEventListener.bind(element);
      element.addEventListener=(type,...args)=>{
        if(type==='timeupdate')return;
        return addNativeListener(type,...args);
      };
      element.addEventListener('playing',()=>{
        element.dataset.smokeDidPlay='true';
        element.dataset.smokePlayingAt=String(performance.now());
        element.dataset.smokePlayingPosition=String(element.currentTime);
      });
      element.addEventListener('pause',()=>{
        if(element.dataset.smokeDidPlay==='true'){
          element.dataset.smokeDidPause='true';
          element.dataset.smokePausedAt=String(performance.now());
        }
      });
    });
    const trimmedPlayback=[];
    for(const speed of [1,2]){
      await openSampleEditor();
      await page.locator('#speed').evaluate((element,value)=>{element.value=String(value);element.dispatchEvent(new Event('input',{bubbles:true}));},speed);
      await closeSampleEditor();
      await video.evaluate(element=>{
        element.pause();element.currentTime=0;element.dataset.smokeDidPlay='false';element.dataset.smokeDidPause='false';
        element.dataset.smokePlayingAt='';element.dataset.smokePausedAt='';element.dataset.smokePlayingPosition='';
      });
      await page.locator('.pad-hit').nth(1).click();
      await page.waitForFunction(()=>{
        const element=document.querySelectorAll('.pad video')[1];
        return element?.dataset.smokeDidPlay==='true'&&element.dataset.smokeDidPause==='true';
      },null,{timeout:7000});
      const result=await video.evaluate(element=>({
        duration:element.duration,currentTime:element.currentTime,playbackRate:element.playbackRate,paused:element.paused,
        playingPosition:Number(element.dataset.smokePlayingPosition),
        playedForMs:Number(element.dataset.smokePausedAt)-Number(element.dataset.smokePlayingAt)
      }));
      assert.equal(result.paused,true,`WebKit should pause the 50 ms selected region at Speed ${speed}×`);
      assert.ok(result.playingPosition>=.35&&result.playingPosition<=.50,`WebKit should start the selected region at 0.40 s at Speed ${speed}×, got ${JSON.stringify(result)}`);
      assert.ok(result.currentTime>=.40&&result.currentTime<result.duration-.05,`WebKit should stop the short trim before natural playback ends at Speed ${speed}×, got ${JSON.stringify(result)}`);
      assert.ok(result.playedForMs>=10&&result.playedForMs<500,`WebKit should play briefly then stop without the old one-second grace period at Speed ${speed}×, got ${JSON.stringify(result)}`);
      trimmedPlayback.push({speed,...result});
    }
    console.log(`WebKit short-trim boundary passed: ${JSON.stringify(trimmedPlayback)}.`);
  }else console.log('Skipped WebKit video stop-boundary check: this Playwright WebKit build reports no H.264/AAC MP4 playback support.');

  assert.deepEqual(errors,[],'the tested WebKit journeys should not produce uncaught page errors');
  assert.deepEqual(blockedFontProviderRequests,[],'WebKit should not request Google Fonts or gstatic');
  console.log('WebKit smoke passed: 320/390px overflow, secondary navigation state, Rap focus, WAV import and IndexedDB File reload.');
}finally{
  await context?.close();
  await browser?.close();
  await new Promise(resolve=>server.close(resolve));
}
