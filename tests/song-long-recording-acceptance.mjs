// Opt-in real-time browser acceptance for long source playback and mix export.
// Defaults to four minutes; override MADLADPAD_CAPTURE_SECONDS for a short rehearsal.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { tmpdir } from 'node:os';

const seconds = Number(process.env.MADLADPAD_CAPTURE_SECONDS || 240);
assert.ok(Number.isFinite(seconds) && seconds >= 1 && seconds <= 300, 'capture duration must be from 1 to 300 seconds');

const root = resolve('site');
const mime = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.woff2':'font/woff2', '.webmanifest':'application/manifest+json', '.svg':'image/svg+xml', '.png':'image/png' };
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  const file = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
  if (!file.startsWith(`${root}/`)) { response.writeHead(403).end(); return; }
  try {
    response.setHeader('Content-Type', mime[extname(file)] || 'application/octet-stream');
    response.end(await readFile(file));
  } catch { response.writeHead(404).end(); }
});

function makeTone(duration) {
  const sampleRate = 16000, frames = sampleRate * duration, wav = Buffer.alloc(44 + frames * 2);
  wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24); wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < frames; i++) wav.writeInt16LE(Math.round(11000 * Math.sin(2 * Math.PI * 440 * i / sampleRate)), 44 + i * 2);
  return wav;
}

let browser, context, temporaryProfile;
const pageErrors = [], blockedRequests = [], nonGetRequests = [];
try {
  await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
  const origin = `http://localhost:${server.address().port}`;
  temporaryProfile = await mkdtemp(`${tmpdir()}/madladpad-long-capture-`);
  const microphoneFixture = resolve(temporaryProfile, 'synthetic-microphone.wav');
  await writeFile(microphoneFixture, makeTone(seconds));
  browser = await chromium.launch({ headless: true, args: [
    '--autoplay-policy=no-user-gesture-required',
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    `--use-file-for-audio-capture=${microphoneFixture}`
  ] });
  context = await browser.newContext({ acceptDownloads: true });
  await context.route('**/*', route => {
    const request = route.request();
    if (request.url().startsWith(`${origin}/`) && request.method() === 'GET') return route.continue();
    blockedRequests.push(request.url());
    if (request.method() !== 'GET') nonGetRequests.push(`${request.method()} ${request.url()}`);
    return route.abort();
  });

  await context.grantPermissions(['microphone'], { origin });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.addInitScript(() => {
    window.__madladpadLongCaptureSources = [];
    window.__madladpadLongCaptureEnded = 0;
    const nativeStart = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args) {
      window.__madladpadLongCaptureSources.push({ duration: this.buffer?.duration, args });
      this.addEventListener('ended', () => window.__madladpadLongCaptureEnded++);
      return nativeStart.apply(this, args);
    };
  });
  await page.goto(origin);
  const openScreen = async screen => {
    await page.locator(`[data-studio-screen="${screen}"]`).click();
    await page.waitForFunction(value => document.body.dataset.screen === value, screen);
  };

  await openScreen('sounds');
  await page.locator('.pad').first().hover();
  await page.locator('.pad-cell .edit-pad').first().click();
  await page.locator('#media-input').setInputFiles({ name: 'local-long-tone.wav', mimeType: 'audio/wav', buffer: makeTone(seconds) });
  await page.waitForFunction(duration => Number(document.querySelector('#region-end')?.max) >= duration - 0.1, seconds, { timeout: 30000 });
  const advanced = page.locator('#sample-advanced');
  if (!await advanced.evaluate(element => element.open)) await advanced.locator('summary').click();
  await page.locator('#trim-start').fill('0');
  await page.locator('#trim-end').fill(String(seconds));
  await page.locator('#trim-end').press('Tab');
  assert.equal(Number(await page.locator('#trim-end').inputValue()), seconds, 'the complete imported source is selected for playback');
  await page.locator('#close-sample-editor').click();

  await openScreen('beats');
  const loopSettings = page.locator('#loop-settings');
  if (!await loopSettings.evaluate(element => element.open)) await loopSettings.locator('summary').click();
  await page.locator('#bpm-input').fill('40');
  await page.locator('#bpm-input').press('Tab');
  if (!await page.locator('#steps').isVisible()) await page.locator('#track-view').click();
  await page.locator('#beat-advanced').evaluate(element => { element.open = true; });
  await page.locator('#scene-name').fill('Long Take');
  await page.locator('#save-scene').click();
  const sceneId = await page.evaluate(() => JSON.parse(localStorage.getItem('madladpad-project-recovery-v1'))?.scenes?.at(-1)?.id);
  assert.ok(sceneId, 'a stable empty scene should provide the long Song transport timeline');
  await openScreen('overdub');
  await page.locator('#song-scene-select').selectOption(sceneId);
  await page.locator('#song-bars').selectOption('64');
  await page.locator('#song-add-section').click();
  assert.match(await page.locator('#song-status').textContent(), /64 bars/);
  await page.locator('#studio-play').click();
  await page.waitForFunction(() => document.querySelector('#studio-play').textContent.includes('STOP'));

  await openScreen('overdub');
  await page.locator('#voice-overdub-record').click();
  await page.waitForFunction(() => document.querySelector('#voice-overdub-status').textContent.includes('Recording microphone audio'));
  const downloadReady = page.waitForEvent('download', { timeout: (seconds + 30) * 1000 }).then(download => ({ download }), error => ({ error }));
  await openScreen('export');
  await page.locator('#record-audio').click();
  await page.waitForFunction(() => document.querySelector('#record-audio').textContent.includes('STOP AUDIO TAKE'));
  await openScreen('sounds');
  await page.locator('.pad-hit').first().click();
  await page.waitForFunction(() => window.__madladpadLongCaptureSources.length > 0, null, { timeout: 20000 });
  const source = await page.evaluate(() => window.__madladpadLongCaptureSources[0]);
  assert.ok(source.duration >= seconds - 0.1, `the actual audio source should span the selected ${seconds} seconds: ${JSON.stringify(source)}`);
  await page.waitForFunction(() => window.__madladpadLongCaptureEnded > 0, null, { timeout: (seconds + 15) * 1000 });
  await page.waitForTimeout(300);
  await openScreen('overdub');
  await page.locator('#voice-overdub-stop').click();
  await page.waitForFunction(() => document.querySelectorAll('#voice-overdub-layers .vocal-layer').length === 1, null, { timeout: 20000 });
  const track = page.locator('#voice-overdub-layers .vocal-layer').first();
  const trackId = await track.getAttribute('data-layer');
  const overdub = await page.evaluate(async id => {
    const { getValue, listInterruptedAudioRecordings } = await import('/storage.js');
    const file = await getValue(`voice-layer:${id}`);
    if (!file) throw new Error('The generated long microphone take was not saved locally');
    const context = new AudioContext();
    try {
      const buffer = await context.decodeAudioData(await file.arrayBuffer());
      const samples = buffer.getChannelData(0);
      return { bytes:file.size, type:file.type, duration:buffer.duration, rms:Math.sqrt(samples.reduce((sum,value)=>sum+value*value,0)/samples.length), journals:(await listInterruptedAudioRecordings()).length };
    } finally { await context.close(); }
  }, trackId);
  assert.ok(overdub.bytes > 100 && overdub.duration >= seconds - 1, `the full ${seconds}-second synthetic microphone take should be stored and decodable: ${JSON.stringify(overdub)}`);
  assert.ok(overdub.rms > 0.01, `the synthetic microphone track should contain its tone signal: ${JSON.stringify(overdub)}`);
  overdub.startStep = Number(await track.locator('.vocal-layer-start input').inputValue());
  assert.ok(overdub.startStep >= 0 && overdub.startStep < 16, `the long take should remain aligned to the Song start: ${JSON.stringify(overdub)}`);
  assert.equal(overdub.journals, 0, 'the successfully saved long microphone take should clear its recovery journal');
  const trackMeta = await track.locator('.vocal-layer-meta').textContent();
  const displayedDuration = Number(trackMeta.match(/([0-9]+\.[0-9]+) s audible/)?.[1]);
  assert.ok(Number.isFinite(displayedDuration) && Math.abs(displayedDuration - overdub.duration) < .15, `the saved track should display its decoded duration: ${trackMeta}`);

  await openScreen('export');
  await page.locator('#record-audio').click();
  const downloadResult = await downloadReady;
  assert.ok(downloadResult.download, `the four-minute master mix should export: ${downloadResult.error?.message || 'no download'}`);
  const encoded = await readFile(await downloadResult.download.path());
  const decoded = await page.evaluate(async base64 => {
    const bytes = Uint8Array.from(atob(base64), character => character.charCodeAt(0));
    const audio = new AudioContext();
    try {
      const buffer = await audio.decodeAudioData(bytes.buffer);
      const samples = buffer.getChannelData(0);
      let energy = 0;
      for (const sample of samples) energy += sample * sample;
      return { duration: buffer.duration, sampleRate: buffer.sampleRate, channels: buffer.numberOfChannels, rms: Math.sqrt(energy / samples.length) };
    } finally { await audio.close(); }
  }, encoded.toString('base64'));
  assert.ok(decoded.duration >= seconds - 0.5, `decoded mix must contain the full take: ${JSON.stringify(decoded)}`);
  assert.ok(decoded.rms > 0.01, `decoded mix must contain the generated source signal: ${JSON.stringify(decoded)}`);
  await openScreen('beats');
  if ((await page.locator('#studio-play').textContent()).includes('STOP')) await page.locator('#studio-play').click();
  await page.reload();
  await openScreen('sounds');
  await page.locator('.pad-hit').first().waitFor();
  await openScreen('overdub');
  await page.waitForFunction(() => document.querySelectorAll('#voice-overdub-layers .vocal-layer').length === 1, null, { timeout: 20000 });
  const restoredTrack = page.locator('#voice-overdub-layers .vocal-layer').first();
  const restoredStartStep = Number(await restoredTrack.locator('.vocal-layer-start input').inputValue());
  assert.equal(restoredStartStep, overdub.startStep, 'the long Song placement should survive reload');
  const restoredSize = await page.evaluate(async id => (await (await import('/storage.js')).getValue(`voice-layer:${id}`))?.size, trackId);
  assert.equal(restoredSize, overdub.bytes, 'the complete long microphone source should survive reload');
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(blockedRequests, [], 'the long capture should not require any off-origin request');
  assert.deepEqual(nonGetRequests, [], 'the long capture should not send data to any server');
  console.log(`Long Song acceptance passed: ${source.duration.toFixed(2)} s pad source, ${overdub.duration.toFixed(2)} s local microphone overdub (${overdub.bytes} bytes from step ${overdub.startStep}), ${decoded.duration.toFixed(2)} s decoded mix, ${encoded.length} bytes, RMS ${decoded.rms.toFixed(3)}.`);
} finally {
  if (context) await context.close();
  if (browser) await browser.close();
  await new Promise(resolveClose => server.close(resolveClose));
  if (temporaryProfile) await rm(temporaryProfile, { recursive: true, force: true });
}
