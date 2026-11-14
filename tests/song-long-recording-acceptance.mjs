// Opt-in real-time browser acceptance for long source playback and mix export.
// Defaults to four minutes; override MADLADPAD_CAPTURE_SECONDS for a short rehearsal.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
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
  browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  context = await browser.newContext({ acceptDownloads: true });
  await context.route('**/*', route => {
    const request = route.request();
    if (request.url().startsWith(`${origin}/`) && request.method() === 'GET') return route.continue();
    blockedRequests.push(request.url());
    if (request.method() !== 'GET') nonGetRequests.push(`${request.method()} ${request.url()}`);
    return route.abort();
  });

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

  await openScreen('export');
  const downloadReady = page.waitForEvent('download', { timeout: (seconds + 30) * 1000 });
  await page.locator('#record-audio').click();
  await page.waitForFunction(() => document.querySelector('#record-audio').textContent.includes('STOP AUDIO TAKE'));
  await openScreen('sounds');
  await page.locator('.pad-hit').first().click();
  await page.waitForFunction(() => window.__madladpadLongCaptureSources.length > 0, null, { timeout: 20000 });
  const source = await page.evaluate(() => window.__madladpadLongCaptureSources[0]);
  assert.ok(source.duration >= seconds - 0.1, `the actual audio source should span the selected ${seconds} seconds: ${JSON.stringify(source)}`);
  await page.waitForFunction(() => window.__madladpadLongCaptureEnded > 0, null, { timeout: (seconds + 15) * 1000 });
  await page.waitForTimeout(300);
  await openScreen('export');
  await page.locator('#record-audio').click();

  const download = await downloadReady;
  const encoded = await readFile(await download.path());
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
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(blockedRequests, [], 'the long capture should not require any off-origin request');
  assert.deepEqual(nonGetRequests, [], 'the long capture should not send data to any server');
  console.log(`Long audio capture acceptance passed: ${source.duration.toFixed(2)} s source, ${decoded.duration.toFixed(2)} s decoded mix, ${encoded.length} bytes, RMS ${decoded.rms.toFixed(3)}.`);
} finally {
  if (context) await context.close();
  if (browser) await browser.close();
  await new Promise(resolveClose => server.close(resolveClose));
  if (temporaryProfile) await rm(temporaryProfile, { recursive: true, force: true });
}
