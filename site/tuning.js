// YIN-style local pitch estimate for a monophonic sample. No audio leaves the device.
export const noteNames=['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'];

export function frequencyToNote(hz, reference=440) {
  if(!Number.isFinite(hz)||hz<=0) return null;
  const midiFloat=69+12*Math.log2(hz/reference),midi=Math.round(midiFloat);
  return {frequency:hz,midi,name:`${noteNames[(midi%12+12)%12]}${Math.floor(midi/12)-1}`,
    cents:Math.round((midiFloat-midi)*100),correction:midi-midiFloat};
}

export function detectPitch(samples,sampleRate,{minHz=65,maxHz=1400}={}) {
  if(!(samples instanceof Float32Array)||!Number.isFinite(sampleRate)||sampleRate<4000||sampleRate>192000)throw new TypeError('Invalid PCM input');
  if(samples.length<sampleRate*.05)return null;
  // Work with a loud, bounded section to avoid the noise floor and long processing.
  const stride=Math.max(1,Math.floor(sampleRate/16000)),rate=sampleRate/stride;
  const windowSize=Math.min(4096,Math.floor(samples.length/stride));
  if(windowSize<512)return null;
  const frameSize=windowSize*stride;
  let best=0,bestEnergy=0;
  for(let start=0;start+frameSize<=samples.length;start+=Math.max(stride,Math.floor(frameSize/2))) {
    let sum=0;
    for(let i=start;i<start+frameSize;i+=stride){const value=samples[i];if(Number.isFinite(value))sum+=value*value;}
    if(sum>bestEnergy){bestEnergy=sum;best=start;}
  }
  if(bestEnergy/windowSize<.00004)return null;
  const frame=new Float32Array(windowSize);
  for(let i=0;i<windowSize;i++)frame[i]=Number.isFinite(samples[best+i*stride])?samples[best+i*stride]:0;
  const minLag=Math.max(2,Math.floor(rate/maxHz)),maxLag=Math.min(Math.floor(rate/minHz),Math.floor(windowSize/2));
  const differences=new Float64Array(maxLag+1);
  for(let lag=1;lag<=maxLag;lag++){
    let sum=0;
    for(let i=0;i<windowSize-maxLag;i++){const diff=frame[i]-frame[i+lag];sum+=diff*diff;}
    differences[lag]=sum;
  }
  let running=0,bestLag=0,bestScore=Infinity;
  for(let lag=1;lag<=maxLag;lag++){
    running+=differences[lag];
    const score=running?differences[lag]*lag/running:1;
    if(lag<minLag)continue;
    if(score<bestScore){bestScore=score;bestLag=lag;}
    if(score<.12 && differences[lag]<=differences[Math.min(maxLag,lag+1)]){bestLag=lag;bestScore=score;break;}
  }
  if(bestScore>.22||!bestLag)return null;
  const left=differences[bestLag-1],center=differences[bestLag],right=differences[bestLag+1];
  const denominator=left-2*center+right;
  const correction=Number.isFinite(denominator)&&Math.abs(denominator)>1e-12?Math.max(-.5,Math.min(.5,.5*(left-right)/denominator)):0;
  const hz=rate/(bestLag+correction);
  return { ...frequencyToNote(hz),confidence:Math.max(0,Math.min(1,1-bestScore)) };
}
