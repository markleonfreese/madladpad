export function effectivePitchSemitones(pitch,speed){
  const boundedSpeed=Math.min(2,Math.max(.5,Number(speed)||1));
  return Math.min(24,Math.max(-24,(Number(pitch)||0)-12*Math.log2(boundedSpeed)));
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
