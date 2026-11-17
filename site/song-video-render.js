export const SONG_VIDEO_FRAME_RATE = 24;
export const SONG_VIDEO_MAX_SECONDS = 240;
export const SONG_VIDEO_MAX_BYTES = 48 * 1024 * 1024;
export const SONG_VIDEO_BITRATE = 900_000;

const ASPECTS = {
  '16:9': [640, 360],
  '9:16': [360, 640],
  '4:3': [480, 360],
  '1:1': [480, 480]
};

export function songVideoDimensions(aspect = '16:9') {
  const size = ASPECTS[aspect];
  if (!size) throw new Error('Choose a supported Song video aspect ratio.');
  return { width: size[0], height: size[1] };
}

function fitRect(sourceWidth, sourceHeight, x, y, width, height) {
  const scale = Math.min(width / Math.max(1, sourceWidth), height / Math.max(1, sourceHeight));
  const drawWidth = sourceWidth * scale, drawHeight = sourceHeight * scale;
  return { x: x + (width - drawWidth) / 2, y: y + (height - drawHeight) / 2, width: drawWidth, height: drawHeight };
}

function aborted(signal) {
  return Boolean(signal?.aborted);
}

function abortError() {
  return new Error('Song video render cancelled. Your original project media is unchanged.');
}

async function chooseEncoder(Media, format, dimensions, sampleRate) {
  if (!['auto', 'mp4', 'webm'].includes(format)) throw new Error('Choose Auto, MP4 or WebM for the Song video format.');
  const candidates = format === 'mp4' ? ['mp4'] : format === 'webm' ? ['webm'] : ['mp4', 'webm'];
  const failures = [];
  for (const candidate of candidates) {
    const mp4 = candidate === 'mp4';
    const config = {
      video: { codec: mp4 ? 'avc' : 'vp9', width: dimensions.width, height: dimensions.height,
        bitrate: SONG_VIDEO_BITRATE, framerate: SONG_VIDEO_FRAME_RATE },
      audio: { codec: mp4 ? 'aac' : 'opus', numberOfChannels: 2, sampleRate, bitrate: 128_000 }
    };
    try {
      const [video, audio] = await Promise.all([
        Media.canEncodeVideo(config.video.codec, config.video),
        Media.canEncodeAudio(config.audio.codec, config.audio)
      ]);
      if (video && audio) return { candidate, config };
      failures.push(`${candidate.toUpperCase()} ${video ? 'audio encoder unavailable' : 'video encoder unavailable'}`);
    } catch (error) {
      failures.push(`${candidate.toUpperCase()} capability check failed`);
    }
  }
  throw new Error(`This browser cannot encode the requested Song video${failures.length ? ` (${failures.join('; ')})` : ''}. Try another device or export the WAV mix.`);
}

function drawLabel(ctx, text, x, y, width, height, fontSize) {
  ctx.save();
  ctx.fillStyle = 'rgba(5, 8, 14, .82)';
  ctx.fillRect(x, y, width, height);
  ctx.fillStyle = '#f4f1e9';
  ctx.font = `600 ${fontSize}px system-ui, sans-serif`;
  ctx.textBaseline = 'middle';
  const safe = String(text || 'Track').slice(0, 56);
  ctx.fillText(safe, x + 8, y + height / 2, Math.max(8, width - 16));
  ctx.restore();
}

function drawWaveform(ctx, buffer, sourceSeconds, x, y, width, height, color) {
  const channel = buffer?.getChannelData?.(0);
  if (!channel?.length) return false;
  const center = y + height / 2;
  const radius = Math.max(1, Math.floor(buffer.sampleRate * .025));
  const centerFrame = Math.max(0, Math.min(channel.length - 1, Math.floor(sourceSeconds * buffer.sampleRate)));
  const count = Math.max(1, Math.floor(width / 2));
  ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.beginPath();
  for (let i = 0; i < count; i++) {
    const frame = Math.max(0, Math.min(channel.length - 1, centerFrame - Math.floor(radius / 2) + Math.floor(i * radius / count)));
    const amp = Math.min(1, Math.abs(channel[frame] || 0));
    const px = x + (i / Math.max(1, count - 1)) * width;
    const dy = amp * Math.max(2, height * .43);
    ctx.moveTo(px, center - dy); ctx.lineTo(px, center + dy);
  }
  ctx.stroke();
  return true;
}

function drawMidi(ctx, visual, x, y, width, height, time) {
  const midi = Number(visual.midi) || 60;
  const hue = (midi * 17) % 360;
  ctx.fillStyle = `hsla(${hue}, 82%, 61%, .92)`;
  const barWidth = Math.max(12, width * Math.min(.9, (Number(visual.velocity) || 96) / 127));
  const pulse = .78 + .22 * Math.sin((time + (visual.sourceSeconds || 0)) * Math.PI * 2);
  const barHeight = Math.max(4, height * .22 * pulse);
  ctx.fillRect(x + 12, y + height * .55 - barHeight / 2, Math.min(barWidth, width - 24), barHeight);
  ctx.fillStyle = '#f4f1e9'; ctx.font = '700 15px system-ui, sans-serif';
  ctx.fillText(`MIDI ${midi}`, x + 12, y + height * .31);
}

async function loadVisualAsset(trackId, file, Media, inputs, images) {
  if (!file) throw new Error(`The local visual source for “${trackId}” is missing.`);
  if (file.type?.startsWith('image/')) {
    if (typeof createImageBitmap !== 'function') throw new Error('This browser cannot decode local artwork for Song video export.');
    const bitmap = await createImageBitmap(file);
    images.set(trackId, bitmap);
    return;
  }
  if (!file.type?.startsWith('video/')) throw new Error(`The visual source for “${trackId}” is not a supported local image or video.`);
  const input = new Media.Input({ source: new Media.BlobSource(file), formats: [Media.MP4, Media.QTFF, Media.WEBM] });
  const track = await input.getPrimaryVideoTrack();
  if (!track) throw new Error(`The local video for “${trackId}” has no decodable video track.`);
  inputs.set(trackId, { input, sink: new Media.VideoSampleSink(track) });
}

async function drawFrame({ ctx, canvas, Media, inputs, images, visualFiles, waveformBuffers, visuals, time, plan }) {
  const width = canvas.width, height = canvas.height;
  ctx.fillStyle = '#0d1018'; ctx.fillRect(0, 0, width, height);
  const headerHeight = Math.max(28, Math.round(height * .11));
  ctx.fillStyle = '#171c28'; ctx.fillRect(0, 0, width, headerHeight);
  const step = time / (60 / plan.bpm / 4);
  ctx.fillStyle = '#f4f1e9'; ctx.font = `700 ${Math.max(13, Math.round(height * .04))}px system-ui, sans-serif`;
  ctx.textBaseline = 'middle'; ctx.fillText(`BAR ${Math.floor(step / 16) + 1}  ·  ${plan.bpm} BPM`, 12, headerHeight / 2);
  ctx.fillStyle = '#8d96a8'; ctx.textAlign = 'right'; ctx.fillText(`${Math.floor(time / 60)}:${String(Math.floor(time % 60)).padStart(2, '0')}`, width - 12, headerHeight / 2); ctx.textAlign = 'left';

  const active = visuals.slice(0, 16);
  const count = Math.max(1, active.length), columns = Math.ceil(Math.sqrt(count * width / Math.max(1, height - headerHeight)));
  const rows = Math.ceil(count / columns), gap = Math.max(3, Math.round(width * .008));
  const tileWidth = (width - gap * (columns + 1)) / columns;
  const tileHeight = (height - headerHeight - gap * (rows + 1)) / rows;
  for (let index = 0; index < active.length; index++) {
    const visual = active[index];
    const x = gap + (index % columns) * (tileWidth + gap);
    const y = headerHeight + gap + Math.floor(index / columns) * (tileHeight + gap);
    ctx.fillStyle = '#202738'; ctx.fillRect(x, y, tileWidth, tileHeight);
    const labelHeight = Math.max(16, Math.round(tileHeight * .2));
    const contentY = y + labelHeight, contentHeight = Math.max(1, tileHeight - labelHeight);
    if (visual.kind === 'video' || visual.kind === 'video-pad') {
      let source = inputs.get(visual.trackId);
      if (!source) {
        await loadVisualAsset(visual.trackId, visualFiles.get(visual.trackId), Media, inputs, images);
        source = inputs.get(visual.trackId);
      }
      if (!source) throw new Error(`The local video for “${visual.name || visual.trackId}” is missing.`);
      const sample = await source.sink.getSample(Math.max(0, visual.sourceSeconds || 0));
      if (!sample) throw new Error(`The local video for “${visual.name || visual.trackId}” could not decode at ${Number(visual.sourceSeconds || 0).toFixed(2)} s.`);
      try {
        const rect = fitRect(sample.displayWidth, sample.displayHeight, x, contentY, tileWidth, contentHeight);
        sample.draw(ctx, rect.x, rect.y, rect.width, rect.height);
      } finally { sample.close(); }
    } else if (visual.kind === 'still') {
      let bitmap = images.get(visual.trackId);
      if (!bitmap) {
        await loadVisualAsset(visual.trackId, visualFiles.get(visual.trackId), Media, inputs, images);
        bitmap = images.get(visual.trackId);
      }
      if (!bitmap) throw new Error(`The local artwork for “${visual.name || visual.trackId}” is missing.`);
      const rect = fitRect(bitmap.width, bitmap.height, x, contentY, tileWidth, contentHeight);
      ctx.drawImage(bitmap, rect.x, rect.y, rect.width, rect.height);
    } else if (visual.kind === 'waveform') {
      const hue = (index * 71 + 188) % 360;
      const buffer = waveformBuffers.get(visual.trackId);
      if (!drawWaveform(ctx, buffer, visual.sourceSeconds || 0, x + 8, contentY + 4, tileWidth - 16, contentHeight - 8, `hsl(${hue} 78% 62%)`)) {
        throw new Error(`The local waveform for “${visual.name || visual.trackId}” is unavailable.`);
      }
    } else if (visual.kind === 'midi') {
      drawMidi(ctx, visual, x, contentY, tileWidth, contentHeight, time);
    }
    drawLabel(ctx, `${visual.name || visual.trackId}${visual.kind === 'midi' ? ` · MIDI ${visual.midi}` : ''}`, x, y, tileWidth, labelHeight, Math.max(9, Math.round(height * .025)));
  }
  if (visuals.length > active.length) {
    ctx.fillStyle = '#f4f1e9'; ctx.font = '12px system-ui, sans-serif';
    ctx.fillText(`+${visuals.length - active.length} more active tracks`, 12, height - 7);
  }
}

/** Deterministically render plan timestamps into a local, muxed MP4 or WebM. */
export async function renderSongVideo(plan, { audioBuffer, visualFiles = new Map(), waveformBuffers = new Map(), visualsAtTime }, {
  Media,
  format = 'auto',
  aspect = '16:9',
  signal,
  onProgress = () => {},
  documentRef = globalThis.document,
  maxSeconds = SONG_VIDEO_MAX_SECONDS,
  maxBytes = SONG_VIDEO_MAX_BYTES
} = {}) {
  if (typeof visualsAtTime !== 'function') throw new Error('Song video visuals are unavailable.');
  if (!Number.isFinite(plan?.durationSeconds) || plan.durationSeconds <= 0) throw new Error('The Song has no renderable duration.');
  if (plan.durationSeconds > maxSeconds) throw new Error(`Offline Song video rendering is limited to ${maxSeconds / 60} minutes on this device.`);
  if (!audioBuffer || Math.abs(audioBuffer.duration - plan.durationSeconds) > 1 / audioBuffer.sampleRate) throw new Error('The local Song mix duration does not match the arrangement.');
  if (audioBuffer.numberOfChannels < 1) throw new Error('The Song mix has no audio channels.');
  if (!['auto', 'mp4', 'webm'].includes(format)) throw new Error('Choose Auto, MP4 or WebM for the Song video format.');
  if (!Media) throw new Error('The local video encoder is unavailable. Connect once to download the renderer, then try the export again offline.');
  const dimensions = songVideoDimensions(aspect);
  const encoded = await chooseEncoder(Media, format, dimensions, audioBuffer.sampleRate);
  const expectedBytes = Math.ceil((SONG_VIDEO_BITRATE + 128_000) * plan.durationSeconds / 8 * 1.12);
  if (expectedBytes > maxBytes) throw new Error('This Song video would exceed the 48 MB local export limit. Shorten the arrangement or choose a lower-resolution aspect.');
  if (typeof documentRef?.createElement !== 'function') throw new Error('This browser cannot create local video frames.');
  if (aborted(signal)) throw abortError();

  const canvas = documentRef.createElement('canvas');
  canvas.width = dimensions.width; canvas.height = dimensions.height;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('This browser cannot render the local video canvas.');
  const target = new Media.BufferTarget();
  const outputFormat = encoded.candidate === 'mp4' ? new Media.Mp4OutputFormat() : new Media.WebMOutputFormat();
  const output = new Media.Output({ format: outputFormat, target });
  const video = new Media.CanvasSource(canvas, { ...encoded.config.video, latencyMode: 'quality' });
  const audio = new Media.AudioBufferSource(encoded.config.audio);
  output.addVideoTrack(video, { frameRate: SONG_VIDEO_FRAME_RATE });
  output.addAudioTrack(audio);
  const inputs = new Map(), images = new Map();
  try {
    await output.start();
    const frameCount = Math.ceil(plan.durationSeconds * SONG_VIDEO_FRAME_RATE);
    for (let frame = 0; frame < frameCount; frame++) {
      if (aborted(signal)) throw abortError();
      const timestamp = frame / SONG_VIDEO_FRAME_RATE;
      await drawFrame({ ctx, canvas, Media, inputs, images, visualFiles, waveformBuffers,
        visuals: visualsAtTime(timestamp), time: timestamp, plan });
      await video.add(timestamp, Math.min(1 / SONG_VIDEO_FRAME_RATE, plan.durationSeconds - timestamp));
      if (frame % SONG_VIDEO_FRAME_RATE === 0 || frame + 1 === frameCount) {
        onProgress({ frames: frame + 1, totalFrames: frameCount, seconds: Math.min(plan.durationSeconds, (frame + 1) / SONG_VIDEO_FRAME_RATE), durationSeconds: plan.durationSeconds });
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }
    if (aborted(signal)) throw abortError();
    await audio.add(audioBuffer);
    await output.finalize();
    if (!target.buffer?.byteLength) throw new Error('The local encoder produced an empty video file.');
    if (target.buffer.byteLength > maxBytes) throw new Error('The encoded Song video exceeds the 48 MB local export limit.');
    const blob = new Blob([target.buffer], { type: outputFormat.mimeType });
    return { blob, durationSeconds: plan.durationSeconds, format: encoded.candidate, codec: encoded.config.video.codec,
      width: dimensions.width, height: dimensions.height, frameRate: SONG_VIDEO_FRAME_RATE };
  } catch (error) {
    if (output.state === 'started' || output.state === 'finalizing') await output.cancel().catch(() => {});
    throw error;
  } finally {
    for (const bitmap of images.values()) bitmap.close?.();
    for (const { input } of inputs.values()) input.dispose();
  }
}
