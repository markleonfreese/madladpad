export function effectivePitchSemitones(pitch,speed){
  const boundedSpeed=Math.min(2,Math.max(.5,Number(speed)||1));
  return Math.min(24,Math.max(-24,(Number(pitch)||0)-12*Math.log2(boundedSpeed)));
}

/** Pitch-process PCM into same-length output, compensating the live worklet's 40ms look-ahead. */
export async function pitchShiftPcm({channels,sampleRate,semitones,frames,readFrame,outputChannels}){
  if(!Number.isInteger(channels)||channels<1||!Number.isInteger(frames)||frames<0||!Number.isFinite(sampleRate)||sampleRate<1||typeof readFrame!=='function'||!Array.isArray(outputChannels)||outputChannels.length<channels)throw new TypeError('Pitch rendering needs valid PCM channels, a sample rate, and a frame reader.');
  const outputFrames=outputChannels.slice(0,channels).map(channel=>channel.length);
  if(outputFrames.some(length=>length!==frames))throw new RangeError('Pitch render output channels must have the requested frame count.');
  const amount=Math.max(-24,Math.min(24,Number(semitones)||0));
  if(Math.abs(amount)<=.01){for(let channel=0;channel<channels;channel++)for(let frame=0;frame<frames;frame++)outputChannels[channel][frame]=readFrame(channel,frame);return outputChannels;}
  const shifter=new GranularPitchShifter(sampleRate,channels),latency=Math.round(sampleRate*.04),blockSize=128;
  const yieldEveryFrames=Math.max(blockSize,Math.floor(sampleRate*.25/blockSize)*blockSize);
  const input=Array.from({length:channels},()=>new Float32Array(blockSize)),output=Array.from({length:channels},()=>new Float32Array(blockSize));
  for(let offset=0;offset<frames+latency;offset+=blockSize){
    const count=Math.min(blockSize,frames+latency-offset);
    for(let channel=0;channel<channels;channel++){
      const inChannel=input[channel];
      for(let index=0;index<count;index++)inChannel[index]=offset+index<frames?readFrame(channel,offset+index)||0:0;
      inChannel.fill(0,count);
    }
    shifter.process(input,output,amount);
    for(let index=0;index<count;index++){
      const target=offset+index-latency;
      if(target<0||target>=frames)continue;
      for(let channel=0;channel<channels;channel++)outputChannels[channel][target]=output[channel][index];
    }
    if(offset&&offset%yieldEveryFrames===0)await new Promise(resolve=>setTimeout(resolve,0));
  }
  return outputChannels;
}

export class GranularPitchShifter {
  constructor(sampleRate,channels=2){
    this.sampleRate=sampleRate;this.channels=channels;
    this.grain=Math.max(128,Math.round(sampleRate*.08));
    this.minimumDelay=Math.max(128,Math.round(sampleRate*.04));
    this.size=Math.ceil(sampleRate*.3);
    this.rings=[];this.write=0;this.phase=0;
  }
  read(ring,delay){
    const position=(this.write-delay+this.size)%this.size,index=Math.floor(position),fraction=position-index,next=(index+1)%this.size;
    return ring[index]*(1-fraction)+ring[next]*fraction;
  }
  process(input,output,semitones=0){
    const frames=output[0]?.length||0,channels=output.length;
    for(let channel=0;channel<channels;channel++)if(!this.rings[channel])this.rings[channel]=new Float32Array(this.size);
    if(!input?.length){for(const out of output)out.fill(0);return true;}
    for(let frame=0;frame<frames;frame++){
      const amount=Array.isArray(semitones)||ArrayBuffer.isView(semitones)?semitones[frame]??0:semitones;
      const pitch=Math.max(-24,Math.min(24,Number(amount)||0));
      const ratio=2**(pitch/12),shifted=Math.abs(pitch)>.01;
      const phaseA=this.phase,phaseB=(this.phase+.5)%1;
      const windowA=shifted?0.5-0.5*Math.cos(2*Math.PI*phaseA):1;
      const windowB=shifted?0.5-0.5*Math.cos(2*Math.PI*phaseB):0;
      for(let channel=0;channel<channels;channel++){
        const ring=this.rings[channel],inChannel=input[Math.min(channel,input.length-1)];
        ring[this.write]=inChannel?.[frame]||0;
        if(!shifted){output[channel][frame]=ring[this.write];continue;}
        const delayA=this.minimumDelay+phaseA*this.grain,delayB=this.minimumDelay+phaseB*this.grain;
        const total=windowA+windowB||1;
        output[channel][frame]=(this.read(ring,delayA)*windowA+this.read(ring,delayB)*windowB)/total;
      }
      if(shifted)this.phase=((this.phase+(1-ratio)/this.grain)%1+1)%1;
      this.write=(this.write+1)%this.size;
    }
    return true;
  }
}
