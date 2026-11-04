// Run after installing Playwright and Chromium; uses disposable browser storage.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require=createRequire(import.meta.url);
const axePath=require.resolve('axe-core/axe.min.js');
const root = resolve('site');
const mime = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png'};
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  // Workers Static Assets redirects /index.html to /. Preserve that response
  // shape so the offline-shell test exercises the deployed runtime's route.
  if(pathname==='/index.html'){res.writeHead(307,{Location:'/'}).end();return;}
  const path = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
  if (!path.startsWith(`${root}/`)) { res.writeHead(403).end(); return; }
  try { res.setHeader('Content-Type', mime[extname(path)] || 'application/octet-stream'); res.end(await readFile(path)); }
  catch { res.writeHead(404).end(); }
});
const wait = (page, selector) => page.waitForSelector(selector, {timeout: 10000});
const wavSampleRate=8000,wavFrames=8000;
const wav=Buffer.alloc(44+wavFrames*2);
wav.write('RIFF',0);wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);
wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);
wav.writeUInt32LE(wavSampleRate,24);wav.writeUInt32LE(wavSampleRate*2,28);wav.writeUInt16LE(2,32);
wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wavFrames*2,40);
for(let frame=0;frame<wavFrames;frame++)wav.writeInt16LE(Math.round(12000*Math.sin(2*Math.PI*440*frame/wavSampleRate)),44+frame*2);
let browser;
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://localhost:${server.address().port}`;
  const executablePath=process.env.MADLADPAD_CHROMIUM_PATH;
  if(executablePath) await access(executablePath);
  browser = await chromium.launch({headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream'],...(executablePath?{executablePath}:{})});
  const context = await browser.newContext({acceptDownloads:true});
  await context.grantPermissions(['camera','microphone'],{origin});
  await context.route('**/*', route => {
    const url = route.request().url();
    return url.startsWith(`${origin}/`) ? route.continue() : route.abort();
  });
  const page = await context.newPage();
  const checkpoint=label=>console.log(`[smoke] ${label}`);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin);
  await wait(page, '.pad-hit');
  checkpoint('initial load');
  assert.equal(await page.locator('.pad:not([hidden])').count(), 12);
  await page.addScriptTag({path:axePath});
  const audit=await page.evaluate(async()=>axe.run(document));
  assert.deepEqual(audit.violations.map(violation=>violation.id),[], 'initial page should have no axe-core violations');
  checkpoint(`axe-core audit (${audit.passes.length} rules passed)`);
  for (const [value, count] of [['2x2',4],['4x4',16],['3x4',12]]) {
    await page.locator('#layout-select').selectOption(value);
    assert.equal(await page.locator('.pad:not([hidden])').count(), count);
  }
  await page.locator('#demo-button').click();
  await page.locator('.pad-hit').first().click();
  await page.waitForTimeout(250);
  assert.deepEqual(errors, [], 'demo pad should not produce a page error');
  await page.locator('#steps .step').first().click();
  assert.equal(await page.locator('#steps .step').first().getAttribute('aria-pressed'), 'true');
  await page.locator('#play-seq').click();
  checkpoint('layouts, demo and sequencer');
  await page.waitForFunction(() => document.querySelector('#play-seq').textContent.includes('STOP'));
  await page.locator('#play-seq').click();
  await page.keyboard.press('q');
  assert.deepEqual(errors, [], 'keyboard-triggered demo pad should not produce a page error');
  await page.locator('#clear-steps').click();
  await page.locator('#record-pattern').click();
  await page.locator('.pad-hit').first().click();
  await page.waitForFunction(()=>document.querySelector('#steps .step.on'));
  await page.locator('#record-pattern').click();
  assert.ok(await page.locator('#steps .step.on').count()>0,'a live pad tap should be captured into the pattern');
  await page.locator('#scene-name').fill('Smoke Intro');
  await page.locator('#save-scene').click();
  await page.locator('#clear-steps').click();
  await page.waitForFunction(()=>document.querySelectorAll('#steps .step.on').length===0);
  assert.equal(await page.locator('#steps .step.on').count(),0,'clear should remove the selected pattern');
  await page.locator('#launch-scene').click();
  await page.waitForFunction(()=>document.querySelector('#steps .step.on'));
  assert.ok(await page.locator('#steps .step.on').count()>0,'loading a saved scene should restore its pattern');
  assert.equal(await page.locator('#scene-select option').count(),1);
  checkpoint('live pattern capture and named scene round-trip');
  const recordingSupported=await page.evaluate(()=>Boolean(window.MediaRecorder&&HTMLCanvasElement.prototype.captureStream));
  if(recordingSupported){
    const setDownload=page.waitForEvent('download',{timeout:5000});
    await page.locator('#start-record').click();
    await page.locator('.pad-hit').first().click();
    await page.waitForTimeout(450);
    await page.locator('#start-record').click();
    const recording=await setDownload;
    const recordingPath=await recording.path();
    assert.ok(recordingPath,'set recording should produce a downloadable media file');
    const recordedVideo=await readFile(recordingPath);
    assert.ok(recordedVideo.length>100,'set recording should contain encoded media');
    await page.locator('.pad').nth(1).hover();
    await page.locator('.pad .edit-pad').nth(1).click();
    await page.locator('#media-input').setInputFiles({name:'synthetic-set.webm',mimeType:'video/webm',buffer:recordedVideo});
    await page.getByText(/synthetic-set\.webm.*stored on this device/).waitFor();
    await page.locator('.pad-hit').nth(1).click();
    await page.waitForTimeout(250);
    await page.locator('.pad').first().hover();
    await page.locator('.pad .edit-pad').first().click();
    checkpoint('audiovisual set recording and local WebM playback');
  }else{
    console.log('Skipped audiovisual set recording: MediaRecorder or canvas captureStream is unavailable.');
  }
  const audioRecordingSupported=await page.evaluate(()=>Boolean(window.MediaRecorder&&window.AudioContext));
  if(audioRecordingSupported){
    const audioDownload=page.waitForEvent('download',{timeout:5000});
    await page.locator('#record-audio').click();
    await page.locator('.pad-hit').first().click();
    await page.waitForTimeout(450);
    await page.locator('#record-audio').click();
    const mix=await audioDownload;
    assert.match(mix.suggestedFilename(),/\.(m4a|webm|mp4|ogg|wav)$/i,'audio export should use a supported audio extension');
    const mixPath=await mix.path();
    assert.ok(mixPath&& (await readFile(mixPath)).length>100,'audio-only export should contain encoded media');
    checkpoint('audio-only mix export');
  }else{
    console.log('Skipped audio-only mix export: MediaRecorder or AudioContext is unavailable.');
  }
  await page.locator('#media-input').setInputFiles({name:'synthetic.wav',mimeType:'audio/wav',buffer:wav});
  await page.getByText(/synthetic.wav.*stored on this device/).waitFor();
  await page.locator('#project-title').fill('Smoke pack');
  await page.waitForTimeout(700); // App's 300ms debounced save must complete before reload.
  await page.reload();
  await page.getByText(/synthetic.wav.*stored on this device/).waitFor();
  assert.equal(await page.locator('#project-title').inputValue(), 'Smoke pack');
  assert.equal(await page.locator('#scene-select option').count(),1,'named scenes should persist across reload');
  assert.ok(await page.locator('#steps .step.on').count()>0,'scene pattern should persist across reload');
  checkpoint('local audio import and reload');
  if(audioRecordingSupported){
    await page.waitForFunction(()=>!document.querySelector('#pitch').disabled);
    const fixtureRms=await page.evaluate(async encoded=>{const bytes=Uint8Array.from(atob(encoded),character=>character.charCodeAt(0));const context=new AudioContext();const decoded=await context.decodeAudioData(bytes.buffer);const samples=decoded.getChannelData(0);const rms=Math.sqrt(samples.reduce((sum,value)=>sum+value*value,0)/samples.length);await context.close();return {duration:decoded.duration,rms};},wav.toString('base64'));
    assert.ok(fixtureRms.rms>.2,`generated WAV should contain a 440 Hz tone, got ${JSON.stringify(fixtureRms)}`);
    const setRange=async(id,value)=>page.locator(id).evaluate((element,next)=>{element.value=String(next);element.dispatchEvent(new Event('input',{bubbles:true}));},value);
    await setRange('#pitch',0);
    const recordPitchMix=async()=>{
      const downloaded=page.waitForEvent('download',{timeout:8000});
      await page.locator('#record-audio').click();
      await page.waitForFunction(()=>document.querySelector('#record-audio').textContent.includes('STOP AUDIO TAKE'));
      await page.locator('.pad-hit').first().click();
      await page.waitForTimeout(1300);
      await page.locator('#record-audio').click();
      const file=await downloaded;
      return readFile(await file.path());
    };
    const analyzeMix=async audioBytes=>page.evaluate(async encoded=>{
      const bytes=Uint8Array.from(atob(encoded),character=>character.charCodeAt(0));
      const context=new AudioContext();
      try{
        const decoded=await context.decodeAudioData(bytes.buffer);
        const samples=decoded.getChannelData(0),block=Math.max(1,Math.floor(decoded.sampleRate*.01));
        const levels=[];
        for(let start=0;start<samples.length;start+=block){
          let energy=0;const end=Math.min(samples.length,start+block);
          for(let i=start;i<end;i++)energy+=samples[i]*samples[i];
          levels.push(Math.sqrt(energy/Math.max(1,end-start)));
        }
        const peak=Math.max(...levels),active=levels.map((level,index)=>level>peak*.1?index:-1).filter(index=>index>=0);
        let bestStart=0,bestRms=0;const window=Math.floor(decoded.sampleRate*.08);
        for(let start=0;start+window<samples.length;start+=block){
          let energy=0;for(let i=start;i<start+window;i++)energy+=samples[i]*samples[i];
          const rms=Math.sqrt(energy/window);if(rms>bestRms){bestRms=rms;bestStart=start;}
        }
        let crossings=0;for(let i=bestStart+1;i<bestStart+window;i++)if(samples[i-1]<=0&&samples[i]>0)crossings++;
        return {frequency:crossings*decoded.sampleRate/window,activeDuration:active.length*block/decoded.sampleRate,containerDuration:decoded.duration,peakRms:peak};
      }finally{await context.close();}
    },audioBytes.toString('base64'));
    const neutral=await analyzeMix(await recordPitchMix());
    assert.ok(neutral.peakRms>.02,`neutral audio playback should reach the recording mix, got ${JSON.stringify(neutral)}`);
    assert.ok(Math.abs(neutral.frequency-440)<25,`Pitch 0 should preserve the 440 Hz source, got ${neutral.frequency.toFixed(1)} Hz`);
    assert.ok(Math.abs(neutral.activeDuration-1)<.2,`Speed 1× should retain the one-second sample duration, got ${neutral.activeDuration.toFixed(2)} s`);
    await setRange('#pitch',4);
    const speedOne=await analyzeMix(await recordPitchMix());
    assert.ok(Math.abs(speedOne.frequency-554.4)<35,`Pitch +4 at Speed 1× should export near 554 Hz, got ${JSON.stringify(speedOne)}`);
    assert.ok(Math.abs(speedOne.activeDuration-1)<.2,`Pitch +4 should preserve the one-second duration at Speed 1×, got ${speedOne.activeDuration.toFixed(2)} s`);
    await setRange('#speed',2);
    const speedTwo=await analyzeMix(await recordPitchMix());
    assert.ok(Math.abs(speedTwo.frequency-554.4)<35,`Pitch +4 at Speed 2× should stay near 554 Hz, got ${JSON.stringify(speedTwo)}`);
    assert.ok(Math.abs(speedTwo.activeDuration-.5)<.2,`Speed 2× should halve the sample duration, got ${speedTwo.activeDuration.toFixed(2)} s`);
    checkpoint(`integrated Pitch export (${neutral.frequency.toFixed(0)} Hz neutral, ${speedOne.frequency.toFixed(0)} Hz at 1× and ${speedTwo.frequency.toFixed(0)} Hz at 2×)`);
  }else{
    console.log('Skipped integrated Pitch export: MediaRecorder or AudioContext is unavailable.');
  }
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#export-button').click();
  const download = await downloadPromise;
  const pack = JSON.parse(await readFile(await download.path(), 'utf8'));
  assert.equal(pack.format, 'madladpad');
  assert.ok(pack.media[0].startsWith('data:audio/'));
  if(recordingSupported)assert.ok(pack.media[1].startsWith('data:video/'),'portable pack should retain the synthetic video sample');
  await page.locator('#project-title').fill('Before restore');
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#project-input').setInputFiles({name:'smoke.madladpad',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(pack))});
  await page.getByText('Project restored with its media.').waitFor();
  assert.equal(await page.locator('#project-title').inputValue(), 'Smoke pack');
  await page.reload();
  await page.getByText(/synthetic.wav.*stored on this device/).waitFor();
  assert.equal(await page.locator('#project-title').inputValue(), 'Smoke pack');
  checkpoint('pack round-trip');
  const captureSupported=await page.evaluate(()=>Boolean(navigator.mediaDevices?.getUserMedia&&window.MediaRecorder));
  if(captureSupported){
    await page.locator('#camera-button').click();
    await page.locator('#capture-target-dialog').waitFor({state:'visible'});
    const captureTarget=Number(await page.locator('#capture-target-select').inputValue());
    assert.notEqual(captureTarget,0,'occupied pad media should remain protected until Keep');
    await page.locator('#capture-target-new').click();
    await page.locator('#camera-dialog').waitFor({state:'visible'});
    await page.locator('#camera-length').selectOption('3');
    await page.waitForFunction(()=>!document.querySelector('#camera-capture').disabled);
    await page.locator('#camera-capture').click();
    await page.waitForFunction(()=>document.querySelector('#camera-capture').textContent.includes('STOP'));
    await page.locator('#camera-keep').waitFor({state:'visible',timeout:7000});
    await page.waitForFunction(()=>!document.querySelector('#camera-keep').disabled);
    await page.locator('#camera-keep').click();
    await page.waitForFunction(()=>!document.querySelector('#camera-dialog').open&&document.querySelector('#sample-info').textContent.includes('stored on this device'));
    await page.reload();
    await page.getByText(/synthetic.wav.*stored on this device/).waitFor();
    const capturePackPromise=page.waitForEvent('download');
    await page.locator('#export-button').click();
    const capturePack=JSON.parse(await readFile(await (await capturePackPromise).path(),'utf8'));
    assert.ok(capturePack.media[0].startsWith('data:audio/'),'saving a new capture must preserve the occupied pad');
    assert.ok(capturePack.media[captureTarget]?.startsWith('data:video/'),'kept camera media should survive a project-pack export');
    checkpoint('fake camera capture and safe save-as-new');

    // Reuse the captured three-second sample to verify adaptive performance
    // composition as one, two, then three pads become active during a take.
    const longVideo=Buffer.from(capturePack.media[captureTarget].split(',')[1],'base64');
    for(const target of [3,4]){
      await page.locator('.pad').nth(target).hover();
      await page.locator('.pad .edit-pad').nth(target).click();
      await page.locator('#media-input').setInputFiles({name:'synthetic-long.webm',mimeType:'video/webm',buffer:longVideo});
      await page.getByText(/synthetic-long\.webm.*stored on this device/).waitFor();
    }
    await page.evaluate(()=>{
      const prototype=CanvasRenderingContext2D.prototype;
      const fillRect=prototype.fillRect;
      window.__adaptiveDraws=[];
      let tiles=0;
      prototype.fillRect=function(x,y,width,height){
        const canvas=this.canvas;
        if(x===0&&y===0&&width===canvas.width&&height===canvas.height){
          if(window.__adaptiveDraws.length||tiles)window.__adaptiveDraws.push(tiles);
          tiles=0;
        } else if(this.fillStyle==='#172219')tiles++;
        return fillRect.call(this,x,y,width,height);
      };
    });
    await page.locator('#record-layout').selectOption('follow-active');
    const performanceDownload=page.waitForEvent('download',{timeout:10000}).then(download=>({download}),error=>({error}));
    assert.ok((await page.locator('.pad video').nth(3).getAttribute('src'))||await page.locator('.pad video').nth(3).evaluate(v=>v.currentSrc),'pad four should have its local video source');
    assert.ok((await page.locator('.pad video').nth(4).getAttribute('src'))||await page.locator('.pad video').nth(4).evaluate(v=>v.currentSrc),'pad five should have its local video source');
    await page.locator('#start-record').click();
    await page.waitForFunction(()=>document.querySelector('#start-record').textContent.includes('STOP RECORDING'));
    await page.locator('.pad-hit').nth(captureTarget).click();
    await page.waitForFunction(()=>window.__adaptiveDraws.includes(1));
    await page.locator('.pad-hit').nth(3).click();
    await page.waitForFunction(()=>window.__adaptiveDraws.includes(2),null,{timeout:5000});
    await page.locator('.pad-hit').nth(4).click();
    await page.waitForFunction(()=>window.__adaptiveDraws.includes(3),null,{timeout:5000});
    await page.locator('#start-record').click();
    await page.waitForFunction(()=>document.querySelector('#start-record').textContent.includes('RECORD SET'),null,{timeout:5000});
    const performanceResult=await performanceDownload;
    assert.ok(performanceResult.download,`adaptive performance should download: ${performanceResult.error?.message||'no file'}`);
    const performance=performanceResult.download;
    assert.ok((await readFile(await performance.path())).length>100,'adaptive audiovisual performance should export encoded media');
    checkpoint('adaptive performance capture transitions one-to-two-to-three clips');
  }else{
    console.log('Skipped camera capture: getUserMedia or MediaRecorder is unavailable.');
  }
  await page.waitForFunction(async()=>{
    if(!('serviceWorker' in navigator))return false;
    const registrations=await navigator.serviceWorker.getRegistrations();
    return registrations.some(registration=>registration.active||registration.installing||registration.waiting);
  },null,{timeout:8000});
  await page.evaluate(async()=>{await navigator.serviceWorker.ready;});
  checkpoint('service worker ready');
  await page.reload();
  await page.waitForFunction(()=>Boolean(navigator.serviceWorker.controller));
  checkpoint('service worker controls page');
  await context.setOffline(true);
  await page.reload({waitUntil:'domcontentloaded',timeout:8000});
  await page.locator('#pad-grid').waitFor();
  assert.equal(await page.locator('#project-title').inputValue(),'Smoke pack','offline reopen should load the saved local project');
  checkpoint('offline reopen');
  await context.setOffline(false);
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,'mobile layout should not overflow horizontally');
  assert.deepEqual(errors, []);
  console.log('Browser smoke passed: layouts, demo/keyboard, live patterns/scenes, integrated Pitch/Speed audio exports, audio/video recording, adaptive one-to-three-clip composition, local media, pack round-trip, offline reopen and mobile overflow.');
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}
