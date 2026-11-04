// Run after installing Playwright and Chromium; uses disposable browser storage.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import assert from 'node:assert/strict';

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
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({headless:true});
  const context = await browser.newContext({acceptDownloads:true, serviceWorkers:'block'});
  await context.route('**/*', route => {
    const url = route.request().url();
    return url.startsWith(`${origin}/`) ? route.continue() : route.abort();
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin);
  await wait(page, '.pad-hit');
  assert.equal(await page.locator('.pad:not([hidden])').count(), 12);
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
  await page.waitForFunction(() => document.querySelector('#play-seq').textContent.includes('STOP'));
  await page.locator('#play-seq').click();
  await page.locator('#media-input').setInputFiles({name:'synthetic.wav',mimeType:'audio/wav',buffer:wav});
  await page.getByText(/synthetic.wav.*stored on this device/).waitFor();
  await page.locator('#project-title').fill('Smoke pack');
  await page.waitForTimeout(700); // App's 300ms debounced save must complete before reload.
  await page.reload();
  await page.getByText(/synthetic.wav.*stored on this device/).waitFor();
  assert.equal(await page.locator('#project-title').inputValue(), 'Smoke pack');
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
  assert.deepEqual(errors, []);
  console.log('Browser smoke passed: layouts, demo, sequencer, local WAV, reload and pack round-trip.');
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}
