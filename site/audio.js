import { clamp, nextQuantizedTime } from './core.js';

export class SamplerAudio {
  constructor() {
    this.context = new (window.AudioContext || window.webkitAudioContext)();
    this.master = this.context.createGain();
    this.recordOut = this.context.createMediaStreamDestination();
    this.master.connect(this.context.destination);
    this.master.connect(this.recordOut);
    this.sources = new Map();
    this.transportEpoch = this.context.currentTime;
    this.bpm = 120;
    this.quantize = 'off';
    this.demoEnabled = false;
  }

  async unlock() { if (this.context.state !== 'running') await this.context.resume(); }
  setTransport(bpm, quantize) { this.bpm = bpm; this.quantize = quantize; }
  setEpoch(epoch) { this.transportEpoch = epoch; }

  async load(id, file, mediaElement) {
    const previous = this.sources.get(id);
    previous?.element?.pause();
    if (previous?.url) URL.revokeObjectURL(previous.url);
    // AudioBuffer decoding is reliable for supported audio files, NOT arbitrary MP4 video containers.
    let buffer = null;
    if (file.type.startsWith('audio/')) {
      try { buffer = await this.context.decodeAudioData(await file.arrayBuffer()); }
      catch { /* Browser codec unavailable: fall back to HTMLMediaElement. */ }
    }
    const url = URL.createObjectURL(file);
    const source = {file, url, buffer, element:mediaElement, mediaNode:previous?.mediaNode, gain:previous?.gain};
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
          source.mediaNode.connect(source.gain).connect(this.master);
        } catch (error) { console.warn('Browser media routing unavailable', error); }
      }
      mediaElement.muted = Boolean(buffer);
    }
    return source;
  }

  unload(id) {
    const source = this.sources.get(id);
    if (!source) return;
    source.element?.pause();
    URL.revokeObjectURL(source.url);
    // Preserve media element routing to avoid a second createMediaElementSource on the same DOM node.
    this.sources.set(id, {...source, file:null, url:null, buffer:null});
    source.element?.removeAttribute('src');
    source.element?.load();
  }

  trigger(id, pad, onVisual, scheduledAt) {
    const source = this.sources.get(id);
    const now = this.context.currentTime;
    const when = scheduledAt ?? nextQuantizedTime(now, this.transportEpoch, this.bpm, this.quantize);
    if (!source?.file && !this.demoEnabled) return false;
    if (!source?.file && this.demoEnabled) {
      this.playDemo(id, when, pad.volume);
      setTimeout(() => onVisual?.(id), delay);
      return true;
    }
    const delay = Math.max(0, (when - now) * 1000);
    const start = Math.max(0, pad.start);
    const end = Math.max(start + 0.02, pad.end);
    const rate = Math.pow(2, pad.pitch / 12);
    if (source.buffer) {
      const audio = this.context.createBufferSource();
      audio.buffer = source.buffer;
      audio.playbackRate.setValueAtTime(rate, when);
      const gain = this.context.createGain();
      const attack = Math.min(0.008, Math.max(.002, (end-start)/10));
      const offset = Math.min(start, Math.max(0, source.buffer.duration-.02));
      const duration = Math.max(.01, Math.min(end-start, source.buffer.duration-offset));
      gain.gain.setValueAtTime(0, when);
      gain.gain.linearRampToValueAtTime(clamp(pad.volume,0,1.5), when+attack);
      gain.gain.setValueAtTime(clamp(pad.volume,0,1.5), when+Math.max(attack,duration/rate-.006));
      gain.gain.linearRampToValueAtTime(0, when+duration/rate);
      audio.connect(gain).connect(this.master);
      audio.start(when, offset, duration);
    } else if (source.element && pad.kind !== 'image') {
      setTimeout(() => {
        if (this.sources.get(id)?.file !== source.file) return;
        const element = source.element;
        element.pause();
        element.currentTime = Math.min(start, Number.isFinite(element.duration) ? Math.max(0, element.duration-.01) : start);
        element.playbackRate = clamp(rate,.5,2);
        element.muted = false;
        if (source.gain) source.gain.gain.value = clamp(pad.volume, 0, 1.5);
        element.play().catch(() => {});
        const thisFile = source.file;
        setTimeout(() => { if (this.sources.get(id)?.file === thisFile) element.pause(); }, ((end-start)/rate)*1000);
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
    return this.context.close();
  }
}
