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
  assert.deepEqual(errors,[],'the tested WebKit journeys should not produce uncaught page errors');
  console.log('WebKit smoke passed: 320/390px overflow, secondary navigation state, Rap focus, WAV import and IndexedDB File reload.');
}finally{
  await context?.close();
  await browser?.close();
  await new Promise(resolve=>server.close(resolve));
}
