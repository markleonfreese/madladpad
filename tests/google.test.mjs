import test from 'node:test';
import assert from 'node:assert/strict';
import { isGooglePickerConfigured, waitForPhotosSelection } from '../site/google.js';

test('Google pickers require every non-placeholder public browser identifier',()=>{
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'window');
  try{
    globalThis.window={MADLADPAD_GOOGLE:{clientId:'',apiKey:'',appId:''}};
    assert.equal(isGooglePickerConfigured(),false,'blank optional config stays unavailable');
    for(const config of [
      {clientId:'client.apps.googleusercontent.com',apiKey:'key',appId:'123456789'},
      {clientId:'client.apps.googleusercontent.com',apiKey:'key',appId:123456789}
    ]){
      globalThis.window.MADLADPAD_GOOGLE=config;
      assert.equal(isGooglePickerConfigured(),true,'complete public identifiers enable the pickers');
    }
    for(const config of [
      {clientId:'YOUR_CLIENT_ID',apiKey:'key',appId:'123456789'},
      {clientId:'client.apps.googleusercontent.com',apiKey:'YOUR_API_KEY',appId:'123456789'},
      {clientId:'client.apps.googleusercontent.com',apiKey:'key',appId:' '},
      {clientId:'client.apps.googleusercontent.com',apiKey:'\t',appId:'123456789'}
    ]){
      globalThis.window.MADLADPAD_GOOGLE=config;
      assert.equal(isGooglePickerConfigured(),false,'partial or placeholder identifiers stay unavailable');
    }
  }finally{
    if(descriptor)Object.defineProperty(globalThis,'window',descriptor);
    else delete globalThis.window;
  }
});

test('Google Photos polling respects the server timeout instead of waiting for the app cap',async()=>{
  let elapsed=0,requests=0;
  const session=await waitForPhotosSelection(
    {mediaItemsSet:false,pollingConfig:{pollInterval:'3s',timeoutIn:'2s'}},
    async()=>{requests++;return {mediaItemsSet:false,pollingConfig:{pollInterval:'3s',timeoutIn:'2s'}};},
    {now:()=>elapsed,sleep:async ms=>{elapsed+=ms;}}
  );
  assert.equal(session.mediaItemsSet,false);
  assert.equal(requests,1);
  assert.equal(elapsed,2000);
});

test('Google Photos polling stops on selection and does not make another status request',async()=>{
  let requests=0,elapsed=0;
  const session=await waitForPhotosSelection(
    {mediaItemsSet:false,pollingConfig:{pollInterval:'1s',timeoutIn:'20s'}},
    async()=>{requests++;return {mediaItemsSet:true};},
    {now:()=>elapsed,sleep:async ms=>{elapsed+=ms;}}
  );
  assert.equal(session.mediaItemsSet,true);
  assert.equal(requests,1);
  assert.equal(elapsed,1000);
});
