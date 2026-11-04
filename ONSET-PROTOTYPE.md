# Onset heuristic prototype — not integrated

This code is a small deterministic experiment, not a user-facing analyser. It accepts **already-decoded mono Float32 PCM**, calculates 20 ms RMS energy rises, penalises heavily clipped frames, and ranks up to eight 0.3-second candidate windows with at least 0.3 seconds between onsets. These are heuristic transient candidates, not a judgement of musical quality. Silence returns none. Analysis is capped at 120 seconds and eight million samples; no media is uploaded.

`npm test` exercises synthetic silence, separated transients, clipping penalties, invalid sample rates and duration budget. It does not test real recordings, tempo, speech, stereo downmix, musical usefulness, progress, cancellation or mobile CPU/memory. The synchronous function **must not be called on the UI thread for long audio**; a worker, progress/cancellation, memory safeguards and profiling are needed before product integration.

## Possible local decoding path

With explicit user action, a future integration can try browser-native decoding of a selected, bounded audio file and downmix channels locally, then run this code in a worker. `decodeAudioData` codec/container support varies; it is not safe to assume it accepts video files such as MP4. If audio track extraction or decoding fails, show "analysis unavailable for this file" and keep manual video selection available. A byte-size limit alone does not guarantee decoded PCM fits in memory; check duration/channel/sample budgets before allocation where possible. Do not send media to a server or add FFmpeg.js without separate review. None of this decoding or fallback UI is implemented in this prototype.

Next: validate ranking against consented local audio fixtures; test representative codecs and browsers, loudness/silence, impulses, steady speech, repeated rhythms, clipping and edge-of-file windows; provide markers and explicit preview/accept only after those checks. Keep issue #4 open.
