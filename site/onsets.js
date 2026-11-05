// Experimental mono PCM heuristic. It ranks local transients, not musical quality.
export function findCandidates(samples, sampleRate, windowSeconds=.8) {
  if (!(samples instanceof Float32Array)) throw new TypeError('Expected mono Float32Array PCM');
  if (!Number.isFinite(sampleRate) || sampleRate < 1 || sampleRate > 192000) throw new RangeError('Invalid sample rate');
  if (!Number.isFinite(windowSeconds) || windowSeconds < .2 || windowSeconds > 2) throw new RangeError('Suggestion window must be between 0.2 and 2 seconds');
  if (samples.length / sampleRate > 120) throw new RangeError('Analysis limited to 120 seconds');
  if (samples.length > 8_000_000) throw new RangeError('Analysis exceeds the PCM sample budget');
  const frame=Math.max(1,Math.round(sampleRate*.02)),duration=samples.length/sampleRate,peaks=[];
  let previous=0;
  for(let offset=0;offset<samples.length;offset+=frame){
    const stop=Math.min(samples.length,offset+frame);let sum=0,clipped=0;
    for(let i=offset;i<stop;i++){const x=Number.isFinite(samples[i])?Math.max(-1,Math.min(1,samples[i])):0;sum+=x*x;if(Math.abs(x)>=.99)clipped++;}
    const rms=Math.sqrt(sum/(stop-offset)),onset=Math.max(0,rms-previous),score=onset*2+rms*.25-clipped/(stop-offset)*1.5;
    if(rms>.01&&onset>.01&&score>0)peaks.push({time:offset/sampleRate,score});
    previous=rms;
  }
  peaks.sort((a,b)=>b.score-a.score||a.time-b.time);
  const result=[];
  const contextBefore=Math.min(.06,windowSeconds*.1),minimumPeakSpacing=windowSeconds*.6;
  for(const peak of peaks){if(result.some(candidate=>Math.abs(candidate.onset-peak.time)<minimumPeakSpacing))continue;const start=Math.max(0,peak.time-contextBefore);result.push({start,end:Math.min(duration,start+windowSeconds),onset:peak.time,score:peak.score});if(result.length===8)break;}
  return result;
}
