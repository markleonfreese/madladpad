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
  const path = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
  if (!path.startsWith(`${root}/`)) { res.writeHead(403).end(); return; }
  try { res.setHeader('Content-Type', mime[extname(path)] || 'application/octet-stream'); res.end(await readFile(path)); }
  catch { res.writeHead(404).end(); }
});
const wait = (page, selector) => page.waitForSelector(selector, {timeout: 10000});
const wav = Buffer.alloc(44 + 1600);
wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(1600, 40);
let browser;
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://localhost:${server.address().port}`;
  const executablePath=process.env.MADLADPAD_CHROMIUM_PATH;
  if(executablePath) await access(executablePath);
  browser = await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
  const context = await browser.newContext({acceptDownloads:true});
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
  const recordingSupported=await page.evaluate(()=>Boolean(window.MediaRecorder&&HTMLCanvasElement.prototype.captureStream));
  if(recordingSupported){
    const setDownload=page.waitForEvent('download',{timeout:5000});
    await page.locator('#start-record').click();
    await page.locator('.pad-hit').first().click();
    await page.waitForTimeout(450);
    await page.locator('#start-record').click();
    const recording=await setDownload;
    assert.ok(await recording.path(),'set recording should produce a downloadable media file');
    checkpoint('audiovisual set recording');
  }else{
    console.log('Skipped audiovisual set recording: MediaRecorder or canvas captureStream is unavailable.');
  }
  await page.locator('#media-input').setInputFiles({name:'synthetic.wav',mimeType:'audio/wav',buffer:wav});
  await page.getByText(/synthetic.wav.*stored on this device/).waitFor();
  await page.locator('#project-title').fill('Smoke pack');
  await page.waitForTimeout(700); // App's 300ms debounced save must complete before reload.
  await page.reload();
  await page.getByText(/synthetic.wav.*stored on this device/).waitFor();
  assert.equal(await page.locator('#project-title').inputValue(), 'Smoke pack');
  checkpoint('local audio import and reload');
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#export-button').click();
  const download = await downloadPromise;
  const pack = JSON.parse(await readFile(await download.path(), 'utf8'));
  assert.equal(pack.format, 'madladpad');
  assert.ok(pack.media[0].startsWith('data:audio/'));
  await page.locator('#project-title').fill('Before restore');
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#project-input').setInputFiles({name:'smoke.madladpad',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(pack))});
  await page.getByText('Project restored with its media.').waitFor();
  assert.equal(await page.locator('#project-title').inputValue(), 'Smoke pack');
  await page.reload();
  await page.getByText(/synthetic.wav.*stored on this device/).waitFor();
  assert.equal(await page.locator('#project-title').inputValue(), 'Smoke pack');
  checkpoint('pack round-trip');
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
  console.log('Browser smoke passed: layouts, demo/keyboard playback, sequencer, recording, local WAV, IndexedDB, pack round-trip, offline reopen and mobile overflow.');
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}
