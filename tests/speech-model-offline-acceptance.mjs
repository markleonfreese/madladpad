// Opt-in, macOS-only end-to-end check for real local speech-model and warm-offline use.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { extname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';

if (process.platform !== 'darwin') throw new Error('This opt-in acceptance command requires macOS `say` and ffmpeg.');
const run = (command, args) => {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.error) throw new Error(`Could not run ${command}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${command} exited ${result.status}: ${result.stderr || result.stdout}`);
};
const temporary = await mkdtemp(join(tmpdir(), 'madladpad-speech-acceptance-'));
const aiffPath = join(temporary, 'synthetic-speech.aiff');
const wavPath = join(temporary, 'synthetic-speech.wav');
const spokenText = 'The red drum keeps the rhythm steady. A warm bass line moves beneath the keys. We write a new verse and let the melody rise into the light.';
let speechFile, speechSeconds;
try {
  run('/usr/bin/say', ['-o', aiffPath, spokenText]);
  run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', aiffPath, '-af', 'apad=pad_dur=1', '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wavPath]);
  speechFile = await readFile(wavPath);
  for (let offset = 12; offset + 8 <= speechFile.length;) {
    const chunk = speechFile.toString('ascii', offset, offset + 4), size = speechFile.readUInt32LE(offset + 4);
    if (chunk === 'data') { speechSeconds = size / 32000; break; }
    offset += 8 + size + (size % 2);
  }
  if (!speechSeconds) throw new Error('ffmpeg output has no WAV data chunk');
  assert.ok(speechFile.length < 32 * 1024 * 1024, 'generated speech should fit the on-device transcription limit');
} catch (error) {
  await rm(temporary, { recursive: true, force: true });
  throw error;
}

const root = resolve('site');
const mime = { '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript', '.css':'text/css', '.wasm':'application/wasm', '.json':'application/json', '.woff2':'font/woff2', '.webmanifest':'application/manifest+json', '.svg':'image/svg+xml', '.png':'image/png' };
const server = createServer(async (request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  const path = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
  if (!path.startsWith(`${root}/`)) { response.writeHead(403).end(); return; }
  try {
    response.setHeader('Content-Type', mime[extname(path)] || 'application/octet-stream');
    response.end(await readFile(path));
  } catch { response.writeHead(404).end(); }
});
let browser, context, serverStarted = false;
try {
  const configuredUrl = process.env.MADLADPAD_SPEECH_ACCEPTANCE_URL;
  let baseUrl = configuredUrl;
  if (!baseUrl) {
    await new Promise((accept, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', accept);
    });
    serverStarted = true;
    baseUrl = `http://localhost:${server.address().port}`;
  }
  const appOrigin = new URL(baseUrl).origin;
  browser = await chromium.launch({ headless: true });
  context = await browser.newContext({ acceptDownloads: true, serviceWorkers: 'allow' });
  const network = { blocked: [], modelRequests: [], modelResponses: [], nonGet: [], offlineOffOrigin: [], offlineOffOriginResponses: [], failures: [] };
  let offline = false;
  const isModelHost = hostname => hostname === 'huggingface.co' || hostname.endsWith('.huggingface.co') || hostname === 'hf.co' || hostname.endsWith('.hf.co');
  context.on('request', request => {
    const url = new URL(request.url());
    if (request.method() !== 'GET') network.nonGet.push({ method: request.method(), url: `${url.origin}${url.pathname}` });
    if (isModelHost(url.hostname)) network.modelRequests.push(`${url.origin}${url.pathname}`);
    if (offline && /^https?:$/.test(url.protocol) && url.origin !== appOrigin) network.offlineOffOrigin.push(`${url.origin}${url.pathname}`);
  });
  context.on('response', response => {
    const url = new URL(response.url());
    if (isModelHost(url.hostname)) network.modelResponses.push({ status: response.status(), url: `${url.origin}${url.pathname}` });
    if (offline && /^https?:$/.test(url.protocol) && url.origin !== appOrigin) network.offlineOffOriginResponses.push(`${url.origin}${url.pathname}`);
  });
  context.on('requestfailed', request => network.failures.push({ url: request.url(), error: request.failure()?.errorText }));
  await context.route('**/*', route => {
    const request = route.request(), url = new URL(request.url());
    if (request.method() === 'GET' && url.origin === appOrigin) return route.continue();
    if (request.method() === 'GET' && isModelHost(url.hostname)) return route.continue();
    network.blocked.push({ method: request.method(), url: `${url.origin}${url.pathname}` });
    return route.abort();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  const browserErrors = [];
  page.on('pageerror', error => browserErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') browserErrors.push(message.text()); });
  const transcribe = async () => {
    await page.locator('#voice-transcribe').click();
    await page.waitForFunction(() => /Draft transcript|Could not download|Transcription unavailable|No usable|could not start|failed/i.test(document.querySelector('#voice-status')?.textContent || ''), null, { timeout: 240000, polling: 250 });
    const status = await page.locator('#voice-status').textContent();
    assert.match(status, /Draft transcript/, `on-device transcription failed: ${status}`);
    return page.locator('#voice-word-list input[type="text"]').evaluateAll(inputs => inputs.map(input => input.value));
  };

  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.locator('.pad-hit').first().waitFor();
  await page.locator('#media-input').setInputFiles({ name: 'synthetic-speech.wav', mimeType: 'audio/wav', buffer: speechFile });
  await page.waitForFunction(() => [...document.querySelectorAll('#voice-source-pad option')].some(option => option.value));
  await page.locator('#studio-nav [data-studio-screen="voice"]').click();
  await page.waitForFunction(() => document.body.dataset.screen === 'voice');
  const sourcePad = await page.locator('#voice-source-pad option').evaluateAll(options => options.filter(option => option.value).at(-1)?.value);
  assert.ok(sourcePad, 'the local synthetic speech file should appear as a Voice Lab source');
  await page.locator('#voice-source-pad').selectOption(sourcePad);
  await page.locator('#voice-consent').check();
  const words = await transcribe();
  assert.ok(words.length >= 12, `expected a useful timestamped synthetic transcript, got ${JSON.stringify(words)}`);
  const transcriptText = words.join(' ').toLowerCase();
  for (const expected of ['red', 'drum', 'rhythm', 'melody', 'light']) assert.ok(transcriptText.includes(expected), `transcript should include “${expected}”: ${transcriptText}`);

  await page.locator('#voice-word-list input[type="checkbox"]').evaluateAll(inputs => inputs.slice(0, Math.min(5, inputs.length)).forEach(input => input.click()));
  await page.locator('#voice-make-phrase').click();
  await page.waitForFunction(() => document.querySelectorAll('#voice-phrases .voice-phrase').length === 1);
  const phraseDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export Phrase 1 as WAV' }).click();
  const phraseBytes = await readFile(await (await phraseDownload).path());
  const phraseAudio = await page.evaluate(async encoded => {
    const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
    const audio = new AudioContext();
    try {
      const buffer = await audio.decodeAudioData(bytes.buffer), samples = buffer.getChannelData(0);
      return { duration: buffer.duration, rms: Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length) };
    } finally { await audio.close(); }
  }, phraseBytes.toString('base64'));
  assert.ok(phraseAudio.duration > 0.2 && phraseAudio.rms > 0.01, `phrase export should contain decoded audio: ${JSON.stringify(phraseAudio)}`);

  await page.locator('[data-voice-jump="melody-title"]').click();
  await page.locator('#melody-add').click();
  const firstWord = words[0];
  await page.locator('#melody-notes select[aria-label^="Assign phrase word to"]').selectOption({ label: firstWord });
  const midiDownload = page.waitForEvent('download');
  await page.locator('#melody-export').click();
  const midi = await readFile(await (await midiDownload).path());
  assert.equal(midi.subarray(0, 4).toString(), 'MThd', 'Melody should export a Standard MIDI file');

  await page.locator('[data-voice-jump="rap-title"]').click();
  const rapLine = words.slice(0, Math.min(8, words.length)).join(' ');
  await page.locator('#rap-bars textarea').first().fill(rapLine);
  const lyricsDownload = page.waitForEvent('download');
  await page.locator('#rap-export').click();
  const lyrics = await readFile(await (await lyricsDownload).path(), 'utf8');
  assert.ok(lyrics.includes(rapLine), 'Rap export should include the authored bar');

  await page.reload();
  await page.locator('#voice-lab').waitFor({ state: 'visible' });
  await page.waitForFunction(() => document.querySelectorAll('#voice-word-list input[type="text"]').length >= 5 && document.querySelectorAll('#voice-phrases .voice-phrase').length === 1);
  await page.locator('[data-voice-jump="melody-title"]').click();
  assert.equal(await page.locator('#melody-notes select[aria-label^="Assign phrase word to"]').inputValue(), firstWord, 'melody word cue should survive reload');
  await page.locator('[data-voice-jump="rap-title"]').click();
  assert.equal(await page.locator('#rap-bars textarea').first().inputValue(), rapLine, 'authored rap should survive reload');
  await page.locator('[data-voice-jump="transcript-title"]').click();

  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await context.setOffline(true);
  offline = true;
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 10000 });
  await page.locator('#voice-lab').waitFor({ state: 'visible' });
  await page.waitForFunction(() => document.querySelectorAll('#voice-word-list input[type="text"]').length >= 5);
  await page.locator('#voice-source-pad').selectOption(sourcePad);
  if (!await page.locator('#voice-consent').isChecked()) await page.locator('#voice-consent').check();
  const offlineWords = await transcribe();
  assert.deepEqual(offlineWords, words, 'warm offline transcription should match the original model output');
  assert.equal(network.blocked.length, 0, `unexpected network request was blocked: ${JSON.stringify(network.blocked)}`);
  assert.equal(network.nonGet.length, 0, `unexpected non-GET request: ${JSON.stringify(network.nonGet)}`);
  assert.equal(network.offlineOffOrigin.length, 0, `offline phase attempted an off-origin request: ${JSON.stringify(network.offlineOffOrigin)}`);
  assert.equal(network.offlineOffOriginResponses.length, 0, `offline phase received an off-origin response: ${JSON.stringify(network.offlineOffOriginResponses)}`);
  assert.equal(browserErrors.length, 0, `browser errors: ${JSON.stringify(browserErrors)}`);
  assert.ok(network.modelResponses.length > 0 && network.modelResponses.every(response => response.status < 400), `first-use model responses should succeed: ${JSON.stringify(network.modelResponses)}`);

  const cacheSummary = await page.evaluate(async () => ({ caches: await caches.keys(), modelEntries: await (await caches.open('transformers-cache')).keys().then(keys => keys.length) }));
  assert.ok(cacheSummary.modelEntries > 0, `Whisper assets should remain in the model cache: ${JSON.stringify(cacheSummary)}`);
  console.log(JSON.stringify({
    result: 'PASS',
    target: configuredUrl ? 'configured Pages URL' : 'local source checkout',
    syntheticSpeechSeconds: Number(speechSeconds.toFixed(2)),
    speechBytes: speechFile.length,
    onlineWords: words.length,
    phraseBytes: phraseBytes.length,
    phraseAudio,
    midiBytes: midi.length,
    midiHeader: midi.subarray(0, 4).toString(),
    rapLine,
    modelResponseCount: network.modelResponses.length,
    modelHosts: [...new Set(network.modelResponses.map(response => new URL(response.url).hostname))],
    cacheSummary,
    offlineWords: offlineWords.length,
    offlineNetworkFallbacks: network.failures.filter(failure => { try { return new URL(failure.url).origin === appOrigin && failure.error === 'net::ERR_INTERNET_DISCONNECTED'; } catch { return false; } }).length,
    blocked: network.blocked,
    nonGet: network.nonGet,
    browserErrors
  }, null, 2));
} finally {
  await context?.close();
  await browser?.close();
  if (serverStarted) await new Promise(resolveClose => server.close(resolveClose));
  await rm(temporary, { recursive: true, force: true });
}
