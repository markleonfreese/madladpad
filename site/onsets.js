// Experimental mono PCM heuristic. Does not decode media or measure musical quality.
export function findCandidates(samples, sampleRate) {
  if (!(samples instanceof Float32Array)) throw new TypeError('Expected mono Float32Array PCM');
  if (!Number.isFinite(sampleRate) || sampleRate < 1 || sampleRate > 192000) throw new RangeError('Invalid sample rate');
  if (samples.length / sampleRate > 120) throw new RangeError('Analysis limited to 120 seconds');
  if (samples.length > 8_000_000) throw new RangeError('Analysis exceeds the PCM sample budget');
  const frame = Math.max(1, Math.round(sampleRate * .02));
  const duration = samples.length / sampleRate;
  const peaks = [];
  let previous = 0;
  for (let offset=0; offset<samples.length; offset+=frame) {
    const stop = Math.min(samples.length, offset+frame);
    let sum=0, clipped=0;
    for(let i=offset;i<stop;i++) {
      const x=Number.isFinite(samples[i]) ? Math.max(-1,Math.min(1,samples[i])) : 0;
      sum+=x*x;
      if(Math.abs(x)>=.99)clipped++;
    }
    const rms=Math.sqrt(sum/(stop-offset));
    const onset=Math.max(0,rms-previous);
    const score=onset*2 + rms*.25 - clipped/(stop-offset)*1.5;
    if(rms>.01 && onset>.01 && score>0) peaks.push({time:offset/sampleRate,score});
    previous=rms;
  }
  peaks.sort((a,b)=>b.score-a.score || a.time-b.time);
  const result=[];
  for(const peak of peaks) {
    if(result.some(c=>Math.abs(c.onset-peak.time)<.3))continue;
    const start=Math.max(0,peak.time-.04);
    result.push({start,end:Math.min(duration,start+.3),onset:peak.time,score:peak.score});
    if(result.length===8)break;
  }
  return result;
}
