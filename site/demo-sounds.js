// Rights-safe instruments generated entirely in the local Web Audio graph.
// Shared by live playback and offline Song rendering so the presets stay aligned.
export const DEMO_SOUND_SPECS=Object.freeze({
  kick:{kind:'sweep',wave:'sine',from:150,to:42,length:.16,level:.65},
  snare:{kind:'noise',filter:'bandpass',cutoff:1900,length:.17,level:.42,tone:185},
  hat:{kind:'noise',filter:'highpass',cutoff:6200,length:.065,level:.28},
  clap:{kind:'noise',filter:'bandpass',cutoff:1250,length:.2,level:.38,bursts:true},
  tom:{kind:'sweep',wave:'triangle',from:210,to:82,length:.22,level:.5},
  'sub-bass':{kind:'sweep',wave:'sine',from:58,to:48,length:.42,level:.55},
  'pluck-bass':{kind:'tone',wave:'sawtooth',frequency:110,length:.24,level:.3,filter:1100},
  chord:{kind:'chord',frequencies:[261.63,329.63,392],length:.48,level:.22},
  bell:{kind:'tone',wave:'sine',frequency:880,length:.48,level:.28},
  sweep:{kind:'sweep',wave:'sawtooth',from:180,to:1100,length:.42,level:.2,filter:2600}
});
