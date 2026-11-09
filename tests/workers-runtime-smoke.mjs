// Exercise the checked-in Workers Static Assets configuration without contacting Cloudflare.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { resolve } from 'node:path';

const reserve=createServer();
await new Promise((resolveListen,reject)=>{
  reserve.once('error',reject);
  reserve.listen(0,'127.0.0.1',resolveListen);
});
const {port}=reserve.address();
await new Promise(resolveClose=>reserve.close(resolveClose));

const cli=resolve('node_modules/wrangler/bin/wrangler.js');
const worker=spawn(process.execPath,[cli,'dev','--local','--port',String(port),'--ip','127.0.0.1'],{
  cwd:process.cwd(),
  env:{...process.env,CI:'1',WRANGLER_SEND_METRICS:'false'},
  stdio:['ignore','pipe','pipe']
});
let logs='';
worker.stdout.on('data',chunk=>{logs+=chunk;});
worker.stderr.on('data',chunk=>{logs+=chunk;});
const origin=`http://127.0.0.1:${port}`;
const fetchReady=async()=>{
  const deadline=Date.now()+30000;
  while(Date.now()<deadline){
    if(worker.exitCode!==null)throw new Error(`Wrangler exited before serving requests.\n${logs}`);
    try{
      const response=await fetch(origin,{signal:AbortSignal.timeout(1500)});
      if(response.ok)return response;
    }catch{}
    await new Promise(resolveDelay=>setTimeout(resolveDelay,250));
  }
  throw new Error(`Timed out waiting for Wrangler.\n${logs}`);
};

try{
  const home=await fetchReady();
  const html=await home.text();
  assert.match(html,/<title>MadLadPad · Remix your world<\/title>/);
  assert.match(html,/id="record-audio"/);

  const index=await fetch(`${origin}/index.html`,{redirect:'manual'});
  assert.equal(index.status,307,'Workers Static Assets should canonicalize /index.html');
  assert.equal(index.headers.get('location'),'/');

  for(const [path,type] of [['/app.js','javascript'],['/voice.js','javascript'],['/sw.js','javascript'],['/manifest.webmanifest','json'],['/voice-inference-worker.bundle.js','javascript'],['/ort-wasm-simd-threaded.mjs','javascript'],['/credits.html','html'],['/licenses/Apache-2.0.txt','text'],['/licenses/MIT-OpenAI-Whisper.txt','text'],['/licenses/MIT-ONNX-Runtime.txt','text']]){
    const response=await fetch(`${origin}${path}`);
    assert.equal(response.status,200,`${path} should be served by the configured assets directory`);
    assert.match(response.headers.get('content-type')||'',new RegExp(type==='json'?'json':type));
    assert.ok((await response.arrayBuffer()).byteLength>100,`${path} should not be empty`);
  }
  const credits=await fetch(`${origin}/credits.html`);
  const creditsHtml=await credits.text();
  assert.match(creditsHtml,/Xenova\/whisper-tiny\.en/,'model credits should identify the selected English Whisper model');
  assert.match(creditsHtml,/ONNX Runtime Web/,'model credits should identify the inference runtime');
  const wasm=await fetch(`${origin}/ort-wasm-simd-threaded.wasm`);
  assert.equal(wasm.status,200,'on-device inference WASM should be served as a static asset');
  const wasmBytes=(await wasm.arrayBuffer()).byteLength;
  assert.ok(wasmBytes>10_000_000&&wasmBytes<25*1024*1024,'single-threaded inference WASM should be complete and remain below the per-file asset limit');

  const fallback=await fetch(`${origin}/runtime-smoke-route`,{headers:{'Sec-Fetch-Mode':'navigate'}});
  assert.equal(fallback.status,200,'SPA navigation should receive the app shell');
  assert.match(await fallback.text(),/<title>MadLadPad · Remix your world<\/title>/);
  console.log('Workers runtime smoke passed: root, /index.html redirect, app/service-worker/inference assets, WASM engine, and SPA navigation fallback.');
}finally{
  if(worker.exitCode===null){
    worker.kill('SIGINT');
    await Promise.race([
      new Promise(resolveExit=>worker.once('exit',resolveExit)),
      new Promise(resolveTimeout=>setTimeout(resolveTimeout,5000))
    ]);
    if(worker.exitCode===null)worker.kill('SIGTERM');
  }
}
