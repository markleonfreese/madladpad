import {findCandidates} from './onsets.js';
self.onmessage=event=>{
  try{const {buffer,sampleRate}=event.data;const suggestions=findCandidates(new Float32Array(buffer),sampleRate);self.postMessage({suggestions});}
  catch(error){self.postMessage({error:error.message||'Audio analysis failed'});}
};
