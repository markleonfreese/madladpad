# MadLadPad current-main phone acceptance preview — 13 November 2026

PR #84 is a review-only, non-production preview and is **not for merging**. Its refreshed branch is based on current repository `main` `935b52d9bd5d5c02c5bdf933568e7fcd5a59cb78`; the deployed app source is `dff483d89c8400bea7b888de2097ffd14fced737` plus UAT documentation only. Before using it, confirm the latest PR #84 **Verify** and **Workers Builds** checks passed on the same head; use the Workers Builds preview link as the test URL. Pages production is deployment `30b8c66c-4e71-4402-91a5-9f9cb0d24802` from app source `dff483d`. This preview update does not change production.

First-use speech transcription downloads about 65 MB of model/runtime files. The selected speech clip stays on-device; use consenting testers and never attach raw recordings, transcripts, or private project packs.

Review checklist (see [DEVICE-ACCEPTANCE.md](DEVICE-ACCEPTANCE.md) for detailed test steps):

- [ ] On Android Chrome and iOS Safari, note device/OS/browser/PWA state; check 320–390px portrait, primary navigation, More tools, and no page overflow.
- [ ] Start with a demo beat, edit a step, play it, then open Video & Export. Try local import and recording; Drive/Photos should remain unavailable without configured Google identifiers.
- [ ] Open Sounds and Beat Grid editors; verify selection, sample editing and lane editing.
- [ ] Use three tracks at 120 BPM, scene launch, one-step playback, held-step loop behavior, and audiovisual composition. Confirm touch, timing, and audio/video alignment.
- [ ] Record a camera sample on an empty pad and save-as-new on an occupied pad. Include leading/trailing silence around a clear event; compare suggested bounds with the event, adjust, preview and listen. Try quiet speech, room noise, silence, permission denial, Retake, Cancel and rotation. Report if mobile timing jitter moves the suggestion.
- [ ] Test Speech, Melody and Rap: explicitly opt into transcription; review/edit word text and timing; edit/reorder a phrase and export WAV; choose A4 and confirm 440 Hz; set a note to step 16 and confirm “Bar 2 · Beat 1 · 16th 1”; add harmony and export MIDI; write ABAB bars, use a rhyme chip, edit syllable flow, audition and export lyrics. Record human usefulness/listening notes.
- [ ] Check warm offline model use, local project/pack persistence, microphone/camera indicator release, and TalkBack/VoiceOver.
- [ ] Add sanitized results, URL, tested SHA, device/browser, and failures to Issue #2. Synthetic desktop and hosted CI checks do not count as physical-device or listening acceptance.
