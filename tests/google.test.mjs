import test from 'node:test';
import assert from 'node:assert/strict';
import { isGooglePickerConfigured } from '../site/google.js';

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
