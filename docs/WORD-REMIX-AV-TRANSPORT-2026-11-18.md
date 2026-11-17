# Word Remix — source-linked video transport
18 November 2026 (AWST) · draft / not published

## Intent
The user can record/import one video of somebody speaking or rapping, transcribe it locally, correct word boundaries, and place repeated words on the existing four-bar Word Remix grid. Beat Maker or Song transport plays the words and shows the original speaking footage at those timestamps. Pitch adjusts via the existing local AudioWorklet without changing playback speed.

## Implementation in this candidate
- Reuses `voice.wordRemix.events`, transcript word IDs and immutable imported audio/video media. No cropped per-word WAV/video files are created.
- Video-backed cues can enable the same Beat/Song follow-transport switch as WAV cues, limited to **one video source** at a time. Other audio source cues can coexist.
- A single read-only floating speaker monitor is shared across the five stages, only visible when a video cue is playing. It shows the source person's original frames and selected word text, not a separate editor.
- HTMLVideoElement's audio is connected through Web Audio's MediaElementAudioSourceNode to MadLadPad's existing master/recording bus, with pad gain/mute/solo and optional +/−12 semitone local time-preserving pitch.
- Each video cue is scheduled from the audio clock into the UI's video event loop. Video is monophonic: an incoming word hard-cuts the previous frame/word. Playback Stop, opt-out and source replacement release pending timers, video, gain and object URLs.
- Keeps existing local transcription opt-in, manual timestamps, audio-backed word cues and project pack persistence unchanged.

## Explicit limitations
- **Audio onset and lip sync for video sources are best-effort**, not sample-accurate: seeking/decoding and autoplay policies vary by browser and real device. Very short stutters may finish before a decoded video frame is displayed. This does not substitute video pre-render and measured A/V correction.
- The four-bar pattern repeats over Beat/Song; individual video-word placements across an arbitrary Song length and video-word participation in the deterministic offline Song render/export remain follow-on engine work.
- One original video source at a time. Combining words from two different source videos in one pattern requires a more robust decoder/renderer.
- A browser without MediaElementAudioSourceNode or working AudioWorklet cannot promise a pitched video-word track; fail closed with a clear error rather than producing a silent export.
- No backend, new paid service, cloud speech processing, merge or production deployment.

## Acceptance
- Source video and source audio are never rewritten to make a word event. Inspect project pack after repeat and pitch edits.
- Synthetic browser: manually align `visible` word in a locally recorded video, place it twice in Bar 1, choose +5 semitones and 50% word length, enable follow transport, then hear and see both original video triggers from one local blob source; Stop pauses video and hides its monitor.
- Run `npm test`, `npm run test:browser`, `npm run test:song-browser`, `npm run test:webkit`, `npm run test:workers-runtime`; record exact-head CI and feature preview, and check real phone latency separately.
- Real Android Chrome and iOS Safari/PWA acceptance must listen for pitch and measure whether repeated short words show expected frames. Add user-visible latency limits when established.

Links: [source issue #10](https://github.com/markleonfreese/madladpad/issues/10), [clip engine #247](https://github.com/markleonfreese/madladpad/issues/247), [full-Song A/V render #248](https://github.com/markleonfreese/madladpad/issues/248).
