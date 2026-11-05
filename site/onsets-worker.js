import {findCandidates} from './onsets.js';
self.onmessage=event=>{
  try{const {buffer,sampleRate,windowSeconds}=event.data;const suggestions=findCandidates(new Float32Array(buffer),sampleRate,windowSeconds);self.postMessage({suggestions});}
  catch(error){self.postMessage({error:error.message||'Audio analysis failed'});}
};
