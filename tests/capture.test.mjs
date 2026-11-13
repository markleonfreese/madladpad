import test from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../site/core.js';
import * as storage from '../site/storage.js';

test('take stays bound to its original pad until explicitly kept', () => {
  assert.equal(typeof core.CaptureSession, 'function');
  const capture = new core.CaptureSession();
  const token = capture.begin(3);
  assert.equal(capture.start(token), true);
  const take = {name:'take'};
  assert.equal(capture.review(token,take), true);
  assert.equal(capture.phase, 'review');
  assert.deepEqual(capture.keep(token), {target:3,take});
  assert.equal(capture.phase, 'idle');
});

test('capture analysis offers active sound with trim handles and silence fallback', () => {
  const region=core.suggestActiveRegion([0,.002,.003,.1,.16,.07,.001,.002],4);
  assert.ok(region.start>0&&region.start<1.5);
  assert.ok(region.end>2&&region.end<4);
  assert.equal(region.detected,true);
  assert.deepEqual(core.suggestActiveRegion([0,0,0],3),{start:0,end:3,detected:false});
  assert.deepEqual(core.suggestActiveRegion([],0),{start:0,end:.05,detected:false});
});

test('capture review distinguishes silence or unavailable metering from detected sound',()=>{
  assert.equal(core.suggestActiveRegion([0,0,0],3).detected,false);
  assert.equal(core.suggestActiveRegion([],3).detected,false);
  assert.equal(core.suggestActiveRegion([.002,.002,.012,.01,.008,.002],2).detected,true);
  assert.equal(core.captureRegionStatus(false),'No clear sound detected. The full take is selected; adjust manually, preview or keep.');
  assert.equal(core.captureRegionStatus(true),'Sound detected. Suggested trim surrounds it; adjust, preview or keep.');
});

test('capture analysis finds quiet sounds above a local noise floor', () => {
  const quiet=Array(40).fill(.002);
  quiet[10]=.012;quiet[11]=.01;quiet[12]=.008;
  const quietRegion=core.suggestActiveRegion(quiet,2);
  assert.ok(quietRegion.start>.2&&quietRegion.start<.6);
  assert.ok(quietRegion.end>.5&&quietRegion.end<1);

  const noisy=Array(40).fill(.01);
  noisy[20]=.05;noisy[21]=.04;
  const noisyRegion=core.suggestActiveRegion(noisy,2);
  assert.ok(noisyRegion.start>.8&&noisyRegion.start<1.2);
  assert.ok(noisyRegion.end>1.1&&noisyRegion.end<1.5);
});

test('capture analysis uses measured sample times when the audio meter timer jitters', () => {
  const levels=[0,.5,1,1.5,3.5,4,4.5,5,5.2,8,8.5,9.5].map((time,index)=>({time,level:index===6||index===7?.1:.001}));
  const region=core.suggestActiveRegion(levels,10);
  assert.ok(region.start>4.3&&region.start<4.5,`trim should follow the measured onset, got ${region.start}`);
  assert.ok(region.end>5.1&&region.end<5.3,`trim should follow the measured end, got ${region.end}`);
  assert.equal(region.detected,true);
});

test('retake discards only the pending take; cancel invalidates late recording', () => {
  const capture = new core.CaptureSession();
  const token = capture.begin(8);
  assert.equal(capture.start(token),true);
  assert.equal(capture.review(token,{name:'first'}),true);
  assert.equal(capture.retake(token),true);
  assert.equal(capture.phase,'ready');
  assert.equal(capture.keep(token),null);
  assert.equal(capture.start(token),true);
  capture.cancel();
  assert.equal(capture.review(token,{name:'late'}),false);
  assert.equal(capture.keep(token),null);
});

test('invalid targets and stale permission results cannot replace an active capture', () => {
  const capture=new core.CaptureSession();
  assert.equal(capture.begin(16),null);
  const first=capture.begin(3);
  assert.equal(capture.begin(5),null);
  capture.cancel();
  const second=capture.begin(5);
  assert.equal(capture.current(first),false);
  assert.equal(capture.start(first),false);
  assert.equal(capture.start(second),true);
  assert.equal(capture.target,5);
});

test('a failed capture save leaves previous project and media unchanged', async () => {
  assert.equal(typeof storage.saveCapturedPad,'function');
  const saved=new Map([['project','old'],['media:3','old media']]);
  globalThis.indexedDB={open(){const request={};queueMicrotask(()=>{
    request.result={close(){},transaction(){
      const pending=new Map(saved);
      const tx={error:new Error('quota exceeded'),objectStore(){return {put(value,key){
        if(key==='project'){queueMicrotask(()=>tx.onabort());return;}
        pending.set(key,value);
      }};}};
      return tx;
    }};request.onsuccess();
  });return request;}};
  try {
    await assert.rejects(storage.saveCapturedPad(3,'new media','new project'),/quota exceeded/);
    assert.deepEqual([...saved],[['project','old'],['media:3','old media']]);
  } finally {delete globalThis.indexedDB;}
});

test('capture save commits its project and media in one transaction', async () => {
  const saved=new Map();let transactions=0;
  globalThis.indexedDB={open(){const request={};queueMicrotask(()=>{
    request.result={close(){},transaction(){
      transactions++;
      const pending=new Map(saved);
      const tx={objectStore(){return {put(value,key){pending.set(key,value);}};}};
      queueMicrotask(()=>{saved.clear();for(const entry of pending)saved.set(...entry);tx.oncomplete();});
      return tx;
    }};request.onsuccess();
  });return request;}};
  try {
    await storage.saveCapturedPad(3,'new media','new project');
    assert.equal(transactions,1);
    assert.deepEqual([...saved],[['media:3','new media'],['project','new project']]);
  } finally {delete globalThis.indexedDB;}
});
