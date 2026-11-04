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
const regionFrames=wavSampleRate*4,regionWav=Buffer.alloc(44+regionFrames*2);
regionWav.write('RIFF',0);regionWav.writeUInt32LE(regionWav.length-8,4);regionWav.write('WAVEfmt ',8);
regionWav.writeUInt32LE(16,16);regionWav.writeUInt16LE(1,20);regionWav.writeUInt16LE(1,22);
regionWav.writeUInt32LE(wavSampleRate,24);regionWav.writeUInt32LE(wavSampleRate*2,28);regionWav.writeUInt16LE(2,32);
regionWav.writeUInt16LE(16,34);regionWav.write('data',36);regionWav.writeUInt32LE(regionFrames*2,40);
for(const second of [.5,2,3.5])for(let i=0;i<80;i++)regionWav.writeInt16LE(Math.round(18000*Math.sin(i*.8)),44+Math.round(second*wavSampleRate+i)*2);
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
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(url, options) {
        if (String(url).includes('voice-inference-worker')) {
          const source = `self.onmessage=event=>{if(event.data.type==='transcribe')setTimeout(()=>self.postMessage({type:'result',words:[{text:'Hello',start:0,end:.25},{text:'from',start:.3,end:.55},{text:'MadLadPad',start:.6,end:1}]}),20)};`;
          super(URL.createObjectURL(new Blob([source], {type:'text/javascript'})));
        } else super(url, options);
      }
    };
  });
  const checkpoint=label=>console.log(`[smoke] ${label}`);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin);
  await wait(page, '.pad-hit');
  checkpoint('initial load');
  assert.equal(await page.locator('.pad:not([hidden])').count(), 12);
  await page.addScriptTag({path:axePath});
  const audit=await page.evaluate(async()=>axe.run(document));
  assert.deepEqual(audit.violations.map(violation=>violation.id),[], `initial page should have no axe-core violations: ${JSON.stringify(audit.violations.map(({id,nodes})=>({id,nodes:nodes.map(node=>({target:node.target,summary:node.failureSummary}))})))}`);
  checkpoint(`axe-core audit (${audit.passes.length} rules passed)`);
  for (const [value, count] of [['2x2',4],['4x4',16],['3x4',12]]) {
    await page.locator('#layout-select').selectOption(value);
    assert.equal(await page.locator('.pad:not([hidden])').count(), count);
  }
  await page.locator('#demo-button').click();
  await page.locator('.pad-hit').first().click();
  await page.waitForTimeout(250);
  assert.deepEqual(errors, [], 'demo pad should not produce a page error');
  await page.locator('#track-view').click();
  assert.equal(await page.locator('#track-grid .track-row').count(),12,'all-tracks view should expose each lane in the 12-pad layout');
  assert.ok((await page.locator('#track-grid .track-row').first().locator('.track-name').textContent()).includes('Demo synth 01'),'demo-enabled empty lanes should be identified as demo synths');
  await page.locator('#demo-button').click();
  assert.ok((await page.locator('#track-grid .track-row').first().locator('.track-name').textContent()).includes('Empty pad'),'turning demo sounds off should refresh visible lane labels');
  await page.locator('#demo-button').click();
  assert.ok((await page.locator('#track-grid .track-row').first().locator('.track-name').textContent()).includes('Demo synth 01'),'turning demo sounds back on should restore lane labels');
  assert.equal(await page.locator('#track-grid .track-row').first().locator('.track-steps .step').count(),16);
  for(const [pad,step] of [[0,0],[1,4],[2,8]])await page.locator(`.track-row[data-pad="${pad}"] [data-step="${step}"]`).click();
  for(const [pad,step] of [[0,0],[1,4],[2,8]])assert.equal(await page.locator(`.track-row[data-pad="${pad}"] [data-step="${step}"]`).getAttribute('aria-pressed'),'true',`pad ${pad+1} should retain its own step`);
  await page.locator('.track-row[data-pad="1"] [data-control="muted"]').click();
  await page.locator('.track-row[data-pad="2"] [data-control="solo"]').click();
  assert.equal(await page.locator('.track-row[data-pad="1"]').evaluate(row=>row.classList.contains('muted')&&row.classList.contains('solo-muted')),true,'mute and solo should update independent lane states');
  await page.locator('.track-row[data-pad="1"] [data-control="muted"]').click();
  await page.locator('.track-row[data-pad="2"] [data-control="solo"]').click();
  await page.locator('.track-row[data-pad="0"] [data-step="0"]').click();
  await page.locator('#track-view').click();
  assert.equal(await page.locator('#steps .step').first().getAttribute('aria-pressed'),'false');
  await page.locator('#steps .step').nth(1).click();
  assert.equal(await page.locator('#steps .step').nth(1).getAttribute('aria-pressed'),'true','selected-lane editing should update the focused lane');
  assert.equal(await page.locator('.track-row[data-pad="1"] [data-step="4"]').getAttribute('aria-pressed'),'true','editing one lane should preserve the other lanes');
  assert.equal(await page.locator('.track-row[data-pad="2"] [data-step="8"]').getAttribute('aria-pressed'),'true','editing one lane should preserve the other lanes');
  await page.locator('.pad-hit').first().click();
  await page.waitForTimeout(250);
  checkpoint('multi-track grid edits three independent lanes');
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
  await page.locator('#voice-consent').check();
  await page.locator('#voice-transcribe').click();
  await page.waitForFunction(()=>document.querySelectorAll('#voice-word-list .voice-word').length===3);
  assert.match(await page.locator('#voice-status').textContent(),/Confidence is not provided/);
  await page.locator('#voice-word-list .voice-word').nth(0).locator('input[type=checkbox]').check();
  await page.locator('#voice-word-list .voice-word').nth(2).locator('input[type=checkbox]').check();
  await page.locator('#voice-make-phrase').click();
  await page.locator('#voice-phrases .phrase-words button[aria-label="Move later Hello"]').click();
  assert.match(await page.locator('#voice-phrases').textContent(),/MadLadPad.*Hello/,'discontiguous words should be selectable and reordered into a phrase');
  await page.locator('#voice-phrases input[aria-label="Phrase 1 gap"]').fill('100');
  await page.locator('#voice-phrases input[aria-label="Phrase 1 gap"]').press('Tab');
  await page.locator('#voice-phrases input[aria-label="Phrase 1 crossfade"]').fill('50');
  await page.locator('#voice-phrases input[aria-label="Phrase 1 crossfade"]').press('Tab');
  const phraseDownload=page.waitForEvent('download');
  await page.locator('#voice-phrases button[aria-label="Export Phrase 1 as WAV"]').click();
  const phraseFile=await phraseDownload;
  assert.match(phraseFile.suggestedFilename(),/\.wav$/);
  const phraseBytes=await readFile(await phraseFile.path());
  assert.equal(phraseBytes.toString('ascii',0,4),'RIFF','phrase export should produce a local WAV file');
  const phraseSampleRate=phraseBytes.readUInt32LE(24);
  assert.equal(await page.locator('#voice-phrases input[aria-label="Phrase 1 gap"]').inputValue(),'0','choosing a crossfade should clear the silence gap');
  assert.ok(Math.abs((phraseBytes.length-44)/(phraseSampleRate*4)-.6)<.002,'phrase WAV should include a true 50 ms overlap');
  await page.evaluate(()=>{window.__phrasePreviewDurations=[];const native=AudioBufferSourceNode.prototype.start;AudioBufferSourceNode.prototype.start=function(...args){if(this.buffer)window.__phrasePreviewDurations.push(this.buffer.duration);return native.apply(this,args);};});
  const preview=page.locator('#voice-phrases button[aria-label="Preview Phrase 1"]');
  await preview.click();
  await page.waitForFunction(()=>window.__phrasePreviewDurations.some(duration=>Math.abs(duration-.6)<.002), null, {timeout:5000});
  await page.waitForFunction(()=>!document.querySelector('#voice-phrases button[aria-label="Preview Phrase 1"]')?.disabled, null, {timeout:3000});
  await page.locator('#voice-phrases button[aria-label="Map Phrase 1 words to pads and steps"]').click();
  await page.waitForFunction(()=>[...document.querySelectorAll('.pad-title')].filter(node=>/Phrase 1 · (?:MadLadPad|Hello)/.test(node.textContent)).length===2);
  const mappedPadIds=await page.locator('.pad-title').evaluateAll(nodes=>nodes.flatMap((node,index)=>node.textContent.includes('Phrase 1 ·')?[index]:[]));
  assert.equal(mappedPadIds.length,2,'the reordered phrase should allocate one pad per selected word');
  assert.match(await page.locator('.pad').nth(1).locator('.pad-title').textContent(),/synthetic-set/,'mapping should preserve already occupied pads');
  assert.match(await page.locator('.pad').nth(mappedPadIds[0]).locator('.pad-title').textContent(),/MadLadPad/,'reordered phrase word one should become its own local pad sample');
  assert.match(await page.locator('.pad').nth(mappedPadIds[1]).locator('.pad-title').textContent(),/Hello/,'reordered phrase word two should become its own local pad sample');
  if(await page.locator('#track-grid').isHidden())await page.locator('#track-view').click();
  assert.equal(await page.locator(`.track-row[data-pad="${mappedPadIds[0]}"] [data-step="0"]`).getAttribute('aria-pressed'),'true','first phrase word should start at pattern step one');
  assert.equal(await page.locator(`.track-row[data-pad="${mappedPadIds[1]}"] [data-step="2"]`).getAttribute('aria-pressed'),'true','second phrase word should overlap the first word at the saved crossfade timing');
  assert.match(await page.locator('#toast').textContent(),/word samples mapped to pads and the 16-step pattern/);
  await page.locator('#melody-add').click();
  await page.locator('#melody-notes input[aria-label="Note 1 MIDI pitch"]').fill('69');
  await page.locator('#melody-notes input[aria-label="Note 1 MIDI pitch"]').press('Tab');
  await page.locator('#melody-notes select[aria-label="Assign phrase word to note 1"]').selectOption('MadLadPad');
  await page.locator('#melody-play').click();
  await page.locator('#rap-bars textarea').nth(0).fill('Hello from the other side');
  assert.match(await page.locator('#rap-bars .rap-bar small').first().textContent(),/estimated syllables/);
  await page.locator('#rap-scheme').selectOption('ABAB');
  await page.locator('#rap-bars textarea').nth(0).fill('I caught the light');
  await page.locator('#rap-bars textarea').nth(2).fill('We take the flight');
  assert.match(await page.locator('#rap-bars .rap-bar').nth(2).locator('small').textContent(),/A rhyme.*match bar 1 “light”/,'ABAB should link bars 1 and 3 by their ending words');
  await page.locator('#rap-scheme').selectOption('AABB');
  assert.match(await page.locator('#rap-bars .rap-bar').nth(2).locator('small').textContent(),/B rhyme/,'AABB should regroup bars 3 and 4');
  await page.locator('#rap-bars textarea').nth(0).fill('Hello from the other side');
  const midiDownload=page.waitForEvent('download');
  await page.locator('#melody-export').click();
  assert.match((await midiDownload).suggestedFilename(),/\.mid$/);
  const lyricDownload=page.waitForEvent('download');
  await page.locator('#rap-export').click();
  assert.match((await lyricDownload).suggestedFilename(),/\.txt$/);
  await page.waitForTimeout(500);
  await page.reload();
  await page.getByText(/synthetic\.wav.*stored on this device/).waitFor();
  await page.waitForFunction(()=>document.querySelectorAll('#voice-word-list .voice-word input[type=text]').length===3);
  assert.deepEqual(await page.locator('#voice-word-list .voice-word input[type=text]').evaluateAll(inputs=>inputs.map(input=>input.value)),['Hello','from','MadLadPad'],'transcribed words should persist locally');
  assert.match(await page.locator('#voice-phrases').textContent(),/MadLadPad.*Hello/,'ordered phrases should persist locally');
  assert.equal(await page.locator('#voice-phrases input[aria-label="Phrase 1 gap"]').inputValue(),'0','crossfade mode should persist without a conflicting silence gap');
  assert.equal(await page.locator('#voice-phrases input[aria-label="Phrase 1 crossfade"]').inputValue(),'50','phrase crossfade should persist locally');
  assert.match(await page.locator('.pad').nth(1).locator('.pad-title').textContent(),/synthetic-set/,'pre-existing sample should remain unchanged after reload');
  assert.match(await page.locator('.pad').nth(mappedPadIds[0]).locator('.pad-title').textContent(),/MadLadPad/,'mapped word pad and source WAV should persist locally');
  assert.match(await page.locator('.pad').nth(mappedPadIds[1]).locator('.pad-title').textContent(),/Hello/,'the following mapped word pad should persist locally');
  if(await page.locator('#track-grid').isHidden())await page.locator('#track-view').click();
  assert.equal(await page.locator(`.track-row[data-pad="${mappedPadIds[1]}"] [data-step="2"]`).getAttribute('aria-pressed'),'true','mapped crossfade timing should persist locally');
  assert.equal(await page.locator('#melody-notes .melody-note').count(),1,'melody note data should persist locally');
  assert.equal(await page.locator('#rap-bars textarea').nth(0).inputValue(),'Hello from the other side','rap bars should persist locally');
  assert.equal(await page.locator('#rap-scheme').inputValue(),'AABB','rap rhyme shape should persist locally');
  checkpoint('local speech transcription mock, phrase selection/order, melody and rap persistence/exports');
  checkpoint('local audio import and reload');
  await page.locator('.pad').nth(11).hover();
  await page.locator('.pad .edit-pad').nth(11).click();
  await page.locator('#media-input').setInputFiles({name:'synthetic-region.wav',mimeType:'audio/wav',buffer:regionWav});
  await page.getByText(/synthetic-region\.wav.*stored on this device/).waitFor();
  await page.waitForFunction(()=>!document.querySelector('#region-start').disabled&&Number(document.querySelector('#region-end').max)>=4);
  await page.locator('#region-end').fill('2.25');
  await page.locator('#region-start').fill('1.85');
  assert.match(await page.locator('#region-status').textContent(),/Draft: 1\.85–2\.25 s of 4\.00 s/);
  await page.locator('#region-play').click();
  await page.waitForFunction(()=>{const preview=document.querySelector('#region-preview');return preview.paused&&preview.currentTime>=2.2;},null,{timeout:5000});
  await page.locator('#region-apply').click();
  assert.equal(await page.locator('#trim-start').inputValue(),'1.85');
  assert.equal(await page.locator('#trim-end').inputValue(),'2.25');
  await page.locator('#find-samples').click();
  await page.waitForFunction(()=>document.querySelectorAll('#sample-suggestions .suggestion').length>=2||document.querySelector('#analysis-status').textContent.includes('unavailable'),null,{timeout:10000});
  assert.ok(await page.locator('#sample-suggestions .suggestion').count()>=2,'local analysis should return multiple transient candidates');
  await page.locator('#sample-suggestions .suggestion').first().click();
  assert.match(await page.locator('#analysis-status').textContent(),/Heuristic suggestion selected/);
  await page.waitForTimeout(500);
  await page.reload();
  await page.locator('.pad').nth(11).hover();
  await page.locator('.pad .edit-pad').nth(11).click();
  await page.getByText(/synthetic-region\.wav.*stored on this device/).waitFor();
  assert.equal(await page.locator('#trim-start').inputValue(),'1.85','manual region start should persist after reload');
  assert.equal(await page.locator('#trim-end').inputValue(),'2.25','manual region end should persist after reload');
  await page.locator('.pad').first().hover();
  await page.locator('.pad .edit-pad').first().click();
  checkpoint('manual later-region preview/apply, local suggestions and reload persistence');
  if(audioRecordingSupported){
    await page.waitForFunction(()=>!document.querySelector('#pitch').disabled);
    const fixtureRms=await page.evaluate(async encoded=>{const bytes=Uint8Array.from(atob(encoded),character=>character.charCodeAt(0));const context=new AudioContext();const decoded=await context.decodeAudioData(bytes.buffer);const samples=decoded.getChannelData(0);const rms=Math.sqrt(samples.reduce((sum,value)=>sum+value*value,0)/samples.length);await context.close();return {duration:decoded.duration,rms};},wav.toString('base64'));
    assert.ok(fixtureRms.rms>.2,`generated WAV should contain a 440 Hz tone, got ${JSON.stringify(fixtureRms)}`);
    const setRange=async(id,value)=>page.locator(id).evaluate((element,next)=>{element.value=String(next);element.dispatchEvent(new Event('input',{bubbles:true}));},value);
    await setRange('#pitch',0);
    const recordPitchMix=async(padIndex=0,recordMs=1300)=>{
      const downloaded=page.waitForEvent('download',{timeout:8000});
      await page.locator('#record-audio').click();
      await page.waitForFunction(()=>document.querySelector('#record-audio').textContent.includes('STOP AUDIO TAKE'));
      await page.locator('.pad-hit').nth(padIndex).click();
      await page.waitForTimeout(recordMs);
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
        const activeStart=active[0]*block,activeEnd=(active.at(-1)+1)*block;
        const window=Math.min(Math.floor(decoded.sampleRate*.3),Math.floor((activeEnd-activeStart)*.6));
        const bestStart=Math.floor(activeStart+((activeEnd-activeStart-window)/2));
        let crossings=0;for(let i=bestStart+1;i<bestStart+window;i++)if(samples[i-1]<=0&&samples[i]>0)crossings++;
        return {frequency:crossings*decoded.sampleRate/window,activeDuration:active.length*block/decoded.sampleRate,containerDuration:decoded.duration,peakRms:peak};
      }finally{await context.close();}
    },audioBytes.toString('base64'));
    const neutral=await analyzeMix(await recordPitchMix());
    assert.ok(neutral.peakRms>.02,`neutral audio playback should reach the recording mix, got ${JSON.stringify(neutral)}`);
    assert.ok(Math.abs(neutral.frequency-440)<10,`Pitch 0 should preserve the 440 Hz source, got ${neutral.frequency.toFixed(1)} Hz`);
    assert.ok(Math.abs(neutral.activeDuration-1)<.2,`Speed 1× should retain the one-second sample duration, got ${neutral.activeDuration.toFixed(2)} s`);
    await setRange('#pitch',4);
    const speedOne=await analyzeMix(await recordPitchMix());
    assert.ok(Math.abs(speedOne.frequency-554.4)<10,`Pitch +4 at Speed 1× should export near 554 Hz, got ${JSON.stringify(speedOne)}`);
    assert.ok(Math.abs(speedOne.activeDuration-1)<.2,`Pitch +4 should preserve the one-second duration at Speed 1×, got ${speedOne.activeDuration.toFixed(2)} s`);
    await setRange('#speed',2);
    const speedTwo=await analyzeMix(await recordPitchMix());
    assert.ok(Math.abs(speedTwo.frequency-554.4)<10,`Pitch +4 at Speed 2× should stay near 554 Hz, got ${JSON.stringify(speedTwo)}`);
    assert.ok(Math.abs(speedTwo.activeDuration-.5)<.2,`Speed 2× should halve the sample duration, got ${speedTwo.activeDuration.toFixed(2)} s`);
    assert.ok(Math.abs(speedOne.frequency-speedTwo.frequency)<10,`Pitch should stay stable across Speed values, got ${speedOne.frequency.toFixed(1)} Hz at 1× and ${speedTwo.frequency.toFixed(1)} Hz at 2×`);
    checkpoint(`integrated Pitch export (${neutral.frequency.toFixed(1)} Hz neutral, ${speedOne.frequency.toFixed(1)} Hz at 1× and ${speedTwo.frequency.toFixed(1)} Hz at 2×)`);

    if(recordingSupported){
      const videoTone=await page.evaluate(async()=>{
        const mime=['video/webm;codecs=vp8,opus','video/webm'].find(type=>MediaRecorder.isTypeSupported(type));
        if(!mime||!HTMLCanvasElement.prototype.captureStream)return null;
        const context=new AudioContext();await context.resume();
        const oscillator=context.createOscillator(),gain=context.createGain(),audioStream=context.createMediaStreamDestination();
        oscillator.frequency.value=440;gain.gain.value=.18;oscillator.connect(gain).connect(audioStream);oscillator.start();
        const canvas=document.createElement('canvas');canvas.width=160;canvas.height=90;
        const paint=canvas.getContext('2d');let frame=0;
        const timer=setInterval(()=>{paint.fillStyle=frame++%2?'#193b25':'#487b30';paint.fillRect(0,0,canvas.width,canvas.height);},33);
        const videoStream=canvas.captureStream(30),stream=new MediaStream([...videoStream.getVideoTracks(),...audioStream.stream.getAudioTracks()]);
        const recorder=new MediaRecorder(stream,{mimeType:mime}),chunks=[];
        recorder.ondataavailable=event=>{if(event.data.size)chunks.push(event.data);};
        const stopped=new Promise(resolve=>recorder.onstop=()=>resolve(new Blob(chunks,{type:recorder.mimeType||mime})));
        recorder.start(100);await new Promise(resolve=>setTimeout(resolve,2000));recorder.stop();
        const blob=await stopped;clearInterval(timer);oscillator.stop();stream.getTracks().forEach(track=>track.stop());await context.close();
        const bytes=new Uint8Array(await blob.arrayBuffer());let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);
        return {mime,base64:btoa(binary),size:bytes.length};
      });
      if(videoTone){
        assert.ok(videoTone.size>100,'synthetic video-tone fixture should contain recorded media');
        await page.locator('.pad-hit').nth(1).click();
        await page.locator('.pad').nth(1).hover();
        await page.locator('.pad .edit-pad').nth(1).click();
        page.once('dialog',dialog=>dialog.accept());
        await page.locator('#media-input').setInputFiles({name:'synthetic-pitch-video.webm',mimeType:'video/webm',buffer:Buffer.from(videoTone.base64,'base64')});
        await page.getByText(/synthetic-pitch-video\.webm.*stored on this device/).waitFor();
        await page.locator('.pad-hit').nth(1).click();
        await page.waitForFunction(()=>{const video=document.querySelectorAll('.pad video')[1];return video?.readyState>=2&&Number.isFinite(video.duration)&&video.duration>1.5;},null,{timeout:10000});
        await page.locator('.pad video').nth(1).evaluate(video=>{video.pause();video.currentTime=0;});
        await setRange('#pitch',4);await setRange('#speed',1);
        const videoOne=await analyzeMix(await recordPitchMix(1,2300));
        assert.ok(Math.abs(videoOne.frequency-554.4)<10,`video Pitch +4 at Speed 1× should export near 554 Hz, got ${JSON.stringify(videoOne)}`);
        assert.ok(Math.abs(videoOne.activeDuration-2)<.3,`video should play for about two seconds at Speed 1×, got ${videoOne.activeDuration.toFixed(2)} s`);
        await setRange('#speed',2);
        const videoTwo=await analyzeMix(await recordPitchMix(1,2300));
        assert.ok(Math.abs(videoTwo.frequency-554.4)<10,`video Pitch +4 at Speed 2× should stay near 554 Hz, got ${JSON.stringify(videoTwo)}`);
        assert.ok(Math.abs(videoTwo.activeDuration-1)<.25,`video should play for about one second at Speed 2×, got ${videoTwo.activeDuration.toFixed(2)} s`);
        assert.ok(Math.abs(videoOne.frequency-videoTwo.frequency)<10,`video Pitch should stay stable across Speed values, got ${videoOne.frequency.toFixed(1)} Hz at 1× and ${videoTwo.frequency.toFixed(1)} Hz at 2×`);
        checkpoint(`video-element Pitch export (${videoOne.frequency.toFixed(1)} Hz at 1× and ${videoTwo.frequency.toFixed(1)} Hz at 2×)`);
      }else{
        console.log('Skipped video Pitch export: synthetic VP8/Opus MediaRecorder format is unavailable.');
      }
    }
  }else{
    console.log('Skipped integrated Pitch export: MediaRecorder or AudioContext is unavailable.');
  }
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#export-button').click();
  const download = await downloadPromise;
  const pack = JSON.parse(await readFile(await download.path(), 'utf8'));
  assert.equal(pack.format, 'madladpad');
  assert.ok(pack.media[0].startsWith('data:audio/'));
  assert.equal(pack.project.pads[1].steps[4],true,'project pack should preserve the second lane pattern');
  assert.equal(pack.project.pads[2].steps[8],true,'project pack should preserve the third lane pattern');
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
    const longVideoTargets=await page.locator('.pad').evaluateAll(cards=>cards.flatMap((card,index)=>card.classList.contains('empty')&&!card.hidden?[index]:[]).slice(0,2));
    assert.equal(longVideoTargets.length,2,'two empty pads should remain available for adaptive composition fixtures');
    for(const target of longVideoTargets){
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
    for(const target of longVideoTargets)assert.ok((await page.locator('.pad video').nth(target).getAttribute('src'))||await page.locator('.pad video').nth(target).evaluate(v=>v.currentSrc),`pad ${target+1} should have its local video source`);
    await page.locator('#start-record').click();
    await page.waitForFunction(()=>document.querySelector('#start-record').textContent.includes('STOP RECORDING'));
    await page.locator('.pad-hit').nth(captureTarget).click();
    await page.waitForFunction(()=>window.__adaptiveDraws.includes(1));
    await page.locator('.pad-hit').nth(longVideoTargets[0]).click();
    await page.waitForFunction(()=>window.__adaptiveDraws.includes(2),null,{timeout:5000});
    await page.locator('.pad-hit').nth(longVideoTargets[1]).click();
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
  await page.waitForFunction(()=>document.querySelector('#project-title').value==='Smoke pack',null,{timeout:8000});
  assert.equal(await page.locator('#project-title').inputValue(),'Smoke pack','offline reopen should load the saved local project');
  checkpoint('offline reopen');
  await context.setOffline(false);
  await page.setViewportSize({width:390,height:844});
  const mobileLayout=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,overflow:[...document.querySelectorAll('body *')].filter(el=>el.getBoundingClientRect().right>innerWidth+1).slice(0,12).map(el=>({tag:el.tagName,id:el.id,className:typeof el.className==='string'?el.className:'',right:el.getBoundingClientRect().right}))}));
  assert.equal(mobileLayout.scroll<=mobileLayout.width,true,`mobile layout should not overflow horizontally: ${JSON.stringify(mobileLayout)}`);
  assert.deepEqual(errors, []);
  console.log('Browser smoke passed: layouts, demo/keyboard, live patterns/scenes, integrated Pitch/Speed audio exports, audio/video recording, adaptive one-to-three-clip composition, local media, pack round-trip, offline reopen and mobile overflow.');
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}
