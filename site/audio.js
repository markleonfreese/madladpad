import { clamp, nextQuantizedTime } from './core.js';
import { effectivePitchSemitones } from './pitch-dsp.js';

export class SamplerAudio {
  constructor() {
    this.context = new (window.AudioContext || window.webkitAudioContext)();
    this.master = this.context.createGain();
    this.limiter = this.context.createDynamicsCompressor();
    this.limiter.threshold.value = -1.5;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = .003;
    this.limiter.release.value = .08;
    this.recordOut = this.context.createMediaStreamDestination();
    this.master.connect(this.limiter);
    this.limiter.connect(this.context.destination);
    this.limiter.connect(this.recordOut);
    this.sources = new Map();
    this.vocalSources = new Map();
    this.vocalPlayback = new Map();
    this.transportEpoch = this.context.currentTime;
    this.bpm = 120;
    this.quantize = 'off';
    this.demoEnabled = false;
    this.pitchReady = false;
  }

  async initPitchProcessor(){
    if(!this.context.audioWorklet||typeof AudioWorkletNode==='undefined')return false;
    try{await this.context.audioWorklet.addModule(new URL('./pitch-shifter.js',import.meta.url));this.pitchReady=true;return true;}
    catch(error){console.warn('Independent pitch processor unavailable',error);return false;}
  }

  createPitchNode(){
    if(!this.pitchReady)return null;
    try{return new AudioWorkletNode(this.context,'madladpad-pitch-shifter',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2],channelCount:2,channelCountMode:'max'});}
    catch(error){console.warn('Could not create independent pitch node',error);return null;}
  }

  canPitch(id){
    if(!this.pitchReady)return false;
    const source=this.sources.get(id);
    return source?.pitchAvailable!==false&&(!source?.file||Boolean(source.buffer||source.mediaNode));
  }

  setPadPitch(id,semitones,speed,atTime=this.context.currentTime){
    const source=this.sources.get(id);if(!source||!this.canPitch(id))return false;
    source.pitch=clamp(semitones,-12,12);
    source.speed=clamp(speed??source.speed??1,.5,2);
    if(source.buffer||!source.mediaNode)return true;
    return this.routeMediaPitch(source,atTime);
  }

  mediaPitchSemitones(source){
    const property=['preservesPitch','webkitPreservesPitch','mozPreservesPitch'].find(key=>source.element&&key in source.element);
    if(property){
      try{source.element[property]=true;if(source.element[property])return source.pitch||0;}catch{}
    }
    return effectivePitchSemitones(source.pitch||0,source.speed||1);
  }

  routeMediaPitch(source,atTime=this.context.currentTime){
    if(!source.mediaNode||!source.gain)return false;
    const semitones=this.mediaPitchSemitones(source);
    const usePitch=Math.abs(semitones)>.01&&this.pitchReady;
    if(usePitch&&!source.pitchNode)source.pitchNode=this.createPitchNode();
    const node=usePitch?source.pitchNode:null;
    if(usePitch&&!node){source.pitchAvailable=false;return false;}
    if(source.mediaRoute===(node?'pitch':'direct')){
      if(node)node.parameters.get('semitones').setValueAtTime(semitones,atTime);
      return true;
    }
    source.mediaNode.disconnect();source.pitchNode?.disconnect();
    if(node){node.parameters.get('semitones').setValueAtTime(semitones,atTime);source.mediaNode.connect(node);node.connect(source.gain);source.mediaRoute='pitch';}
    else{source.mediaNode.connect(source.gain);source.mediaRoute='direct';}
    return true;
  }

  async unlock() { if (this.context.state !== 'running') await this.context.resume(); }
  setTransport(bpm, quantize) { this.bpm = bpm; this.quantize = quantize; }
  setEpoch(epoch) { this.transportEpoch = epoch; }

  async load(id, file, mediaElement) {
    const previous = this.sources.get(id);
    previous?.stopPlayback?.();
    previous?.element?.pause();
    if (previous?.url) URL.revokeObjectURL(previous.url);
    // Prefer AudioBuffer playback for decodable audio to retain low-latency,
    // polyphonic triggering. Arbitrary video containers still use the media element.
    let buffer = null;
    if (file.type.startsWith('audio/')) {
      try { buffer = await this.context.decodeAudioData(await file.arrayBuffer()); }
      catch { /* Browser codec unavailable: fall back to HTMLMediaElement. */ }
    }
    const url = URL.createObjectURL(file);
    const source = {file,url,buffer,element:mediaElement,mediaNode:previous?.mediaNode,gain:previous?.gain,pitchNode:previous?.pitchNode,pitch:previous?.pitch||0,speed:previous?.speed||1,mediaRoute:'',pitchAvailable:true};
    this.sources.set(id, source);
    if (!mediaElement && previous?.element) {
      previous.element.removeAttribute('src');
      previous.element.load();
    }
    if (mediaElement) {
      mediaElement.pause();
      mediaElement.src = url;
      mediaElement.load();
      // One MediaElementSource can attach to a given element only once. Reuse on replacement.
      if (!source.mediaNode && !file.type.startsWith('image/')) {
        try {
          source.mediaNode = this.context.createMediaElementSource(mediaElement);
          source.gain = this.context.createGain();
          source.gain.connect(this.master);
        } catch (error) { console.warn('Browser media routing unavailable', error); }
      }
      mediaElement.muted = Boolean(buffer);
      if(source.mediaNode)this.routeMediaPitch(source);
    }
    return source;
  }

  unload(id) {
    const source = this.sources.get(id);
    if (!source) return;
    source.stopPlayback?.();
    source.element?.pause();
    URL.revokeObjectURL(source.url);
    // Preserve media element routing to avoid a second createMediaElementSource on the same DOM node.
    this.sources.set(id, {...source, file:null, url:null, buffer:null, pitchAvailable:true});
    source.element?.removeAttribute('src');
    source.element?.load();
  }

  async loadVocalLayer(id, file) {
    try {
      const buffer = await this.context.decodeAudioData(await file.arrayBuffer());
      this.vocalSources.set(id, {file, buffer});
      return true;
    } catch (error) {
      this.vocalSources.set(id, {file, buffer:null, error});
      return false;
    }
  }

  playVocalLayers(layers, epoch, bpm) {
    this.stopVocalLayers();
    const secondsPerStep = 60 / clamp(bpm, 40, 240) / 4;
    const hasSolo = layers.some(layer => layer.solo && !layer.muted);
    for (const layer of layers) {
      const source = this.vocalSources.get(layer.id);
      if (!source?.buffer || layer.muted || (hasSolo && !layer.solo)) continue;
      const intended = epoch + clamp(layer.startStep, 0, 4096) * secondsPerStep;
      const now = this.context.currentTime, offset = Math.max(0, now - intended);
      if (offset >= source.buffer.duration) continue;
      this.startVocalLayer(layer.id,source.buffer,Math.max(now+.005,intended),offset,layer.gain,layer.pitch);
    }
  }

  startVocalLayer(id,buffer,start,offset=0,gainValue=1,pitch=0){
    if(Math.abs(pitch)>.01&&!this.pitchReady)return false;
    const node=this.context.createBufferSource(),gain=this.context.createGain();
    const pitchNode=Math.abs(pitch)>.01?this.createPitchNode():null;
    if(Math.abs(pitch)>.01&&!pitchNode)return false;
    node.buffer=buffer;
    gain.gain.setValueAtTime(clamp(gainValue,0,1.5),start);
    if(pitchNode){pitchNode.parameters.get('semitones').setValueAtTime(clamp(pitch,-12,12),start);node.connect(pitchNode);pitchNode.connect(gain);}
    else node.connect(gain);
    gain.connect(this.master);
    const playback={node,gain,pitchNode,layerId:id};
    this.vocalPlayback.set(id,playback);
    node.onended=()=>{
      node.disconnect();pitchNode?.disconnect();gain.disconnect();
      if(this.vocalPlayback.get(id)===playback)this.vocalPlayback.delete(id);
    };
    node.start(start,offset);
    return true;
  }

  previewVocalLayer(id, gainValue = 1, pitch = 0) {
    const source = this.vocalSources.get(id);
    if (!source?.buffer) return false;
    this.stopVocalLayer(id);
    return this.startVocalLayer(id,source.buffer,this.context.currentTime+.005,0,gainValue,pitch);
  }

  updateVocalLayerStates(layers) {
    const hasSolo = layers.some(layer => layer.solo && !layer.muted);
    const byId = new Map(layers.map(layer => [layer.id, layer]));
    for (const [id, playback] of this.vocalPlayback) {
      const layer = byId.get(id);
      if (!layer) continue;
      const audible = !layer.muted && (!hasSolo || layer.solo);
      const gain = audible ? clamp(layer.gain, 0, 1.5) : 0;
      playback.gain.gain.cancelScheduledValues(this.context.currentTime);
      playback.gain.gain.setTargetAtTime(gain, this.context.currentTime, .008);
    }
  }

  stopVocalLayer(id) {
    const playback = this.vocalPlayback.get(id);
    if (!playback) return;
    this.vocalPlayback.delete(id);
    try { playback.node.stop(); } catch {}
    playback.node.disconnect();playback.pitchNode?.disconnect();playback.gain.disconnect();
  }

  stopVocalLayers() {
    for (const id of [...this.vocalPlayback.keys()]) this.stopVocalLayer(id);
  }

  trigger(id, pad, onVisual, scheduledAt) {
    const source = this.sources.get(id);
    const now = this.context.currentTime;
    const when = scheduledAt ?? nextQuantizedTime(now, this.transportEpoch, this.bpm, this.quantize);
    const delay = Math.max(0, (when - now) * 1000);
    if (!source?.file && !this.demoEnabled) return false;
    if (!source?.file && this.demoEnabled) {
      this.playDemo(id, when, pad.volume);
      setTimeout(() => onVisual?.(id), delay);
      return true;
    }
    const start = Math.max(0, pad.start);
    const end = Math.max(start + 0.02, pad.end);
    const rate = clamp(pad.speed ?? 1, .5, 2);
    this.setPadPitch(id,pad.pitch??0,rate,when);
    if (source.buffer) {
      const audio = this.context.createBufferSource();
      audio.buffer = source.buffer;
      audio.playbackRate.setValueAtTime(rate, when);
      const gain = this.context.createGain();
      const pitchSemitones=effectivePitchSemitones(pad.pitch??0,rate),needsPitch=Math.abs(pitchSemitones)>.01,pitchNode=needsPitch?this.createPitchNode():null;
      if(needsPitch&&!pitchNode){source.pitchAvailable=false;if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent('madladpad-error',{detail:'Independent pitch processing could not start for this sample. Speed remains available.'}));}
      if(pitchNode)pitchNode.parameters.get('semitones').setValueAtTime(pitchSemitones,when);
      const latency=pitchNode?.parameters?Math.round(this.context.sampleRate*.04)/this.context.sampleRate:0;
      const attack = Math.min(0.008, Math.max(.002, (end-start)/10));
      const offset = Math.min(start, Math.max(0, source.buffer.duration-.02));
      const duration = Math.max(.01, Math.min(end-start, source.buffer.duration-offset));
      const audibleStart=when+latency;
      gain.gain.setValueAtTime(0,audibleStart);
      gain.gain.linearRampToValueAtTime(clamp(pad.volume,0,1.5),audibleStart+attack);
      gain.gain.setValueAtTime(clamp(pad.volume,0,1.5),audibleStart+Math.max(attack,duration/rate-.006));
      gain.gain.linearRampToValueAtTime(0,audibleStart+duration/rate);
      if(pitchNode){audio.connect(pitchNode);pitchNode.connect(gain);}else audio.connect(gain);
      gain.connect(this.master);audio.onended=()=>{audio.disconnect();pitchNode?.disconnect();gain.disconnect();};
      // Let the processor drain its look-ahead ring after the selected clip
      // ends. The gain envelope still ends at the requested trim boundary.
      audio.start(when, offset, duration + (pitchNode ? latency * rate : 0));
    } else if (source.element && pad.kind !== 'image') {
      setTimeout(() => {
        if (this.sources.get(id)?.file !== source.file) return;
        const element = source.element;
        source.stopPlayback?.();
        element.pause();
        element.currentTime = Math.min(start, Number.isFinite(element.duration) ? Math.max(0, element.duration-.01) : start);
        element.playbackRate = clamp(rate,.5,2);
        const pitchPreservation=['preservesPitch','webkitPreservesPitch','mozPreservesPitch'].find(key=>key in element);
        if(pitchPreservation)element[pitchPreservation]=true;
        else if(rate!==1&&(!this.pitchReady||source.pitchAvailable===false)&&typeof window!=='undefined')window.dispatchEvent(new CustomEvent('madladpad-error',{detail:'This browser may change perceived pitch when Speed changes because Pitch processing is unavailable.'}));
        element.muted = false;
        if (source.gain) source.gain.gain.value = clamp(pad.volume, 0, 1.5);
        const thisFile = source.file;
        let finished=false,stopTimer=null;
        const cleanup=pause=>{
          if(finished)return;
          finished=true;
          element.removeEventListener('timeupdate',stopAtBoundary);
          element.removeEventListener('ended',stopAtBoundary);
          if(stopTimer!==null)clearTimeout(stopTimer);
          if(source.stopPlayback===stopPlayback){source.stopPlayback=null;if(pause)element.pause();}
        };
        const stopPlayback=()=>cleanup(true);
        const stopAtBoundary=()=>{
          if(element.ended||element.currentTime>=end-.015)stopPlayback();
        };
        source.stopPlayback=stopPlayback;
        element.addEventListener('timeupdate',stopAtBoundary);
        element.addEventListener('ended',stopAtBoundary);
        try{
          Promise.resolve(element.play()).then(()=>{
            if(this.sources.get(id)?.file!==thisFile||source.stopPlayback!==stopPlayback){cleanup(false);return;}
            stopAtBoundary();
            if(source.stopPlayback===stopPlayback){
              const remaining=Math.max(0,(end-element.currentTime)/rate);
              stopTimer=setTimeout(stopPlayback,remaining*1000+1000);
            }
          },()=>cleanup(true));
        }catch{cleanup(true);}
      }, delay);
    }
    setTimeout(() => onVisual?.(id), delay);
    return true;
  }

  playDemo(id, when, volume) {
    const ctx = this.context;
    const length = .14 + (id % 4) * .055;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(.0001, when);
    gain.gain.exponentialRampToValueAtTime(Math.max(.001, volume * .35), when + .008);
    gain.gain.exponentialRampToValueAtTime(.0001, when + length);
    gain.connect(this.master);
    if (id % 3 === 2) {
      const frames = Math.ceil(ctx.sampleRate * length);
      const noise = ctx.createBuffer(1, frames, ctx.sampleRate);
      const channel = noise.getChannelData(0);
      for (let i=0; i<frames; i++) channel[i] = Math.random()*2-1;
      const node = ctx.createBufferSource();
      node.buffer = noise;
      const filter = ctx.createBiquadFilter();
      filter.type = 'highpass'; filter.frequency.value = 2400 + id * 130;
      node.connect(filter).connect(gain); node.start(when); node.stop(when+length);
    } else {
      const oscillator = ctx.createOscillator();
      oscillator.type = id % 3 === 0 ? 'sine':'triangle';
      oscillator.frequency.setValueAtTime(80 + id * 48, when);
      oscillator.frequency.exponentialRampToValueAtTime(42 + id*14, when+length);
      oscillator.connect(gain); oscillator.start(when); oscillator.stop(when+length);
    }
  }

  destroy() {
    for (const [id] of this.sources) this.unload(id);
    this.stopVocalLayers();
    return this.context.close();
  }
}
