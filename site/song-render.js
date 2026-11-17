import {
  clamp,
  PAD_COUNT,
  isPadAudible,
  melodyClipNotesAtStep,
  sampleNoteAtStep,
  songVideoPositionAtStep,
  songLayerPlaybackEvents,
  songSectionAtStep,
  songTotalBars,
  stepGateDuration,
  stepLoopGateDuration
} from './core.js';

/**
 * Expand the saved Song into a stable, absolute-time event list for offline
 * renderers. This describes the arrangement; it does not encode media or
 * claim that live MediaRecorder capture is deterministic.
 */
export function buildSongRenderPlan(project, { padDurations = {}, vocalDurations = {}, videoDurations = {} } = {}) {
  const bars = songTotalBars(project?.song);
  if (!bars) throw new Error('Add saved patterns to Song before rendering.');
  for (const clip of project.song.clips) {
    if (!project.scenes.some(scene => scene.id === clip.sceneId)) {
      throw new Error(`Song section “${clip.id}” refers to a missing pattern.`);
    }
  }

  const bpm = clamp(project.bpm, 40, 240);
  const secondsPerStep = 60 / bpm / 4;
  const totalSteps = bars * 16;
  const activePads = project.pads.slice(0, PAD_COUNT[project.layout] || project.pads.length);
  const durationSeconds = totalSteps * secondsPerStep;
  const events = [];
  const sections = [];
  let lastSection = null;
  let sectionStart = 0;
  for (let step = 0; step < totalSteps; step++) {
    const section = songSectionAtStep(project.song, project.scenes, step);
    if (!section) throw new Error(`Song arrangement is incomplete at bar ${Math.floor(step / 16) + 1}.`);
    if (lastSection?.clip.id !== section.clip.id) {
      if (lastSection) sections.push({ sceneId: lastSection.scene.id, clipId: lastSection.clip.id, startStep: sectionStart, endStep: step });
      lastSection = section;
      sectionStart = step;
    }

    const lanes = section.scene.pads || [];
    const pattern = section.localStep;
    const division = section.scene.gridDivision || project.gridDivision;
    const stride = division === '1/4' ? 4 : division === '1/8' ? 2 : 1;
    activePads.forEach((pad, padId) => {
      if (!isPadAudible(activePads, padId)) return;
      const lane = lanes[padId];
      if (!lane) return;
      if (lane.sequenceMode === 'notes') {
        const note = sampleNoteAtStep(lane.sampleNotes, pattern);
        if (!note) return;
        const offset = lane.stepOffsets?.[pattern] || 0;
        events.push({
          kind: pad.kind === 'image' ? 'still' : 'sample', trackId: `pad-${padId}`, padId, startStep: step,
          startSeconds: step * secondsPerStep + offset * secondsPerStep,
          durationSeconds: note.length * secondsPerStep, sourceStartSeconds: pad.start,
          sourceEndSeconds: pad.end, gain: pad.volume, speed: pad.speed,
          semitones: clamp(pad.pitch + note.semitones, -12, 12), loop: true,
          noteMode: true
        });
        return;
      }
      if (pattern % stride !== 0 || !lane.steps?.[pattern]) return;
      const offset = lane.stepOffsets?.[pattern] || 0;
      let durationSeconds = null;
      let loop = false;
      if (lane.stepPlaybackMode === 'one-step') durationSeconds = stepGateDuration(bpm, offset);
      if (lane.stepPlaybackMode === 'loop') {
        const isClipStart = step === (section.startBar - 1) * 16;
        durationSeconds = stepLoopGateDuration(lane.steps, pattern, bpm, offset, isClipStart);
        if (durationSeconds === null) return;
        loop = true;
      }
      const sourceDuration = Number(padDurations[padId]) || 0;
      const sourceLength = Math.max(0, Math.min(pad.end, sourceDuration || pad.end) - pad.start);
      const naturalDuration = sourceLength / clamp(pad.speed, .5, 2);
      const indefinite = durationSeconds === Infinity;
      const eventStartSeconds = step * secondsPerStep + offset * secondsPerStep;
      if (indefinite) durationSeconds = Math.max(0, ((section.endBar - 1) * 16 * secondsPerStep) - eventStartSeconds);
      events.push({
        kind: pad.kind === 'image' ? 'still' : 'sample', trackId: `pad-${padId}`, padId, startStep: step,
        startSeconds: eventStartSeconds,
        durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : naturalDuration,
        sourceStartSeconds: pad.start, sourceEndSeconds: pad.end, gain: pad.volume,
        speed: pad.speed, semitones: pad.pitch, loop, indefinite,
        noteMode: false
      });
    });
  }
  if (lastSection) sections.push({ sceneId: lastSection.scene.id, clipId: lastSection.clip.id, startStep: sectionStart, endStep: totalSteps });

  for (const layer of project.voice?.layers || []) {
    if (layer.muted) continue;
    const hasSolo = project.voice.layers.some(item => item.solo && !item.muted);
    if (hasSolo && !layer.solo) continue;
    const duration = Number(vocalDurations[layer.id]) || 0;
    for (const [cycle, instance] of songLayerPlaybackEvents(layer, duration, bpm, bars).entries()) {
      events.push({
        kind: 'vocal', trackId: layer.id, name: layer.name, cycle,
        startStep: instance.startStep, startSeconds: instance.startStep * secondsPerStep,
        durationSeconds: instance.durationSec, sourceStartSeconds: instance.sourceStartSec,
        gain: clamp(layer.gain ?? 1, 0, 1.5), semitones: clamp(layer.pitch ?? 0, -12, 12),
        reverse: Boolean(layer.reverseEnabled)
      });
    }
  }

  for (const layer of project.voice?.videoLayers || []) {
    if (!layer.includeAudio) continue;
    const duration = Number(videoDurations[layer.id]) || 0;
    for (const [cycle, instance] of songLayerPlaybackEvents(layer, duration, bpm, bars).entries()) {
      events.push({
        kind: 'video-audio', trackId: layer.id, name: layer.name, cycle,
        startStep: instance.startStep, startSeconds: instance.startStep * secondsPerStep,
        durationSeconds: instance.durationSec, sourceStartSeconds: instance.sourceStartSec,
        gain: clamp(layer.audioGain ?? 1, 0, 1.5), semitones: 0, reverse: false
      });
    }
  }

  const melody = project.voice?.melody;
  if (melody?.followBeat) {
    const addNote = (note, trackId) => {
      if (note.step >= totalSteps) return;
      const noteSteps = Math.min(note.duration || 1, totalSteps - note.step);
      events.push({
        kind: 'midi', trackId, name: note.layer || 'lead', startStep: note.step,
        startSeconds: note.step * secondsPerStep, durationSeconds: noteSteps * secondsPerStep,
        midi: note.midi, velocity: clamp(note.velocity ?? 96, 1, 127), word: note.word || '',
        tuning: melody.tuning
      });
    };
    for (const note of melody.notes || []) addNote(note, 'melody');
    for (const [index, clip] of (melody.clips || []).entries()) {
      // Expanding by start step keeps the plan bounded by the Song's 4096-step cap.
      for (let step = 0; step < totalSteps; step++) {
        for (const note of melodyClipNotesAtStep(clip, step, bars)) addNote(note, `midi-${clip.id || index + 1}`);
      }
    }
  }

  events.sort((a, b) => a.startSeconds - b.startSeconds || a.kind.localeCompare(b.kind) || a.trackId.localeCompare(b.trackId));
  return { bpm, bars, totalSteps, durationSeconds, sections, events };
}

/** Return the local media and note tiles that should be drawn at one render timestamp. */
export function songRenderVisualsAtTime(project, plan, seconds) {
  if (!Number.isFinite(seconds) || seconds < 0 || seconds >= plan.durationSeconds) return [];
  const secondsPerStep = 60 / plan.bpm / 4;
  const step = seconds / secondsPerStep;
  const visuals = [];
  for (const layer of project.voice?.videoLayers || []) {
    const sourceSeconds = songVideoPositionAtStep(layer, step, plan.bpm, plan.bars);
    if (sourceSeconds !== null) visuals.push({ kind: 'video', trackId: layer.id, name: layer.name, sourceSeconds });
  }
  for (const event of plan.events) {
    if (seconds < event.startSeconds || seconds >= event.startSeconds + event.durationSeconds) continue;
    if (event.kind === 'sample' || event.kind === 'still') {
      const pad = project.pads[event.padId];
      const sourceSeconds = event.sourceStartSeconds + (seconds - event.startSeconds) * event.speed;
      if (event.kind === 'still' || pad?.kind === 'image') visuals.push({ kind: 'still', trackId: event.trackId, name: pad.name, sourceSeconds: 0 });
      else if (pad?.kind === 'video' && sourceSeconds < event.sourceEndSeconds) visuals.push({ kind: 'video-pad', trackId: event.trackId, name: pad.name, sourceSeconds });
      else if (pad?.kind === 'audio') visuals.push({ kind: 'waveform', trackId: event.trackId, name: pad.name, sourceSeconds });
    } else if (event.kind === 'vocal') {
      visuals.push({ kind: 'waveform', trackId: event.trackId, name: event.name, sourceSeconds: event.sourceStartSeconds + seconds - event.startSeconds });
    } else if (event.kind === 'midi') {
      visuals.push({ kind: 'midi', trackId: event.trackId, name: event.name, midi: event.midi, velocity: event.velocity, sourceSeconds: seconds - event.startSeconds });
    }
  }
  return visuals.sort((a, b) => a.kind.localeCompare(b.kind) || a.trackId.localeCompare(b.trackId));
}
