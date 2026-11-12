# MadLadPad device and listening acceptance

Use this checklist to close the physical-device and human-review gates recorded in [GitHub Issue #2](https://github.com/markleonfreese/madladpad/issues/2). It supplements [`tests/BROWSER-SMOKE.md`](../tests/BROWSER-SMOKE.md), which is synthetic desktop Chromium evidence.

## Current published app — 12 November 2026

- **Test this URL:** <https://madladpad.pages.dev>. Cloudflare Pages deployment `37447fcd-120b-4d5b-a0e8-02e815ac82d1` is on production branch `main`, source `926b41f6fd0919f706407284344c674fa421894b`. It is a static deployment with no Pages Functions.
- **Verified after publish:** GitHub main Verify `43208189654` passed before deployment. The production root, `/app.js`, and `/sw.js` return HTTP 200. SHA-256 of live `/`, app.js, styles.css, sw.js, voice.js, inference worker, ONNX WASM and bundle matched the build from that source commit. This is hosted HTTP/artifact verification, not device or human acceptance.
- **Hosted evidence on this release:** app, service worker, Voice Lab, inference worker, ONNX WASM and MIDI/rap workflows were fetched or exercised successfully. Hosted Chromium at 390×844 verified local Whisper transcription and warm full-shell offline reload with actual inference, melody/MIDI export and ABAB rap/TXT export. The imported speech clip remained local; the model's out-of-clip final word was omitted with a recovery notice. Details are in [Issue #2](https://github.com/markleonfreese/madladpad/issues/2#issuecomment-6776507338). This remains synthetic desktop evidence, not physical-device, human listening or screen-reader acceptance.
- The older **Workers production URL** <https://madladpad.markleonfreese.workers.dev/> is unchanged and serves an older bundle (`/voice.js` returns 404). Do not use it to accept current `main`; use the Pages URL above. A recent read-only check returned 200 for the legacy shell and `/app.js`, but that does not change its stale release state or establish a cause for the earlier 503 report.
- First-use speech transcription downloads about 65 MB of model/runtime files from Hugging Face. Plan the first speech test on an appropriate connection; the selected audio remains local.
- PR #84 is a review-only preview branch, explicitly not for merging, and currently conflicts with `main`. Do not use it as the primary test target. After testing, record the Pages URL and tested `main` SHA in Issue #2. Keep physical-device, screen-reader and listening results separate from hosted browser evidence.

## Before testing

- Test a trusted HTTPS preview that serves the exact `main` commit under review. Record both the URL and Git SHA. The current `workers.dev` URL is known to serve an older bundle; do not use it as evidence for current `main` until its release ID is verified.
- Use current Android Chrome and iOS Safari on physical devices. Record device model, OS version, browser version, screen size, and whether the PWA is installed.
- Test in a fresh browser profile for first-run/model download, then in the same profile for warm/offline use. Allow a separate pass with an existing project.
- Use consenting testers and recordings. Do not commit or upload raw personal recordings, transcripts, or private project packs. Record only outcomes, timings, approximate file sizes, and sanitized error text.
- Mark each check **Pass**, **Fail**, or **Blocked**. A simulator or desktop mobile emulation does not count as a physical-device pass.

## 1. Install, storage, and offline use

- Install the PWA where supported, launch it, and confirm all five studio stages are reachable.
- On Playground, confirm Edit pads is the only toolbar action and the global Demo sounds preference starts collapsed inside Settings. Toggle it on/off, reload, and verify the preference persists; confirm an individually assigned pad sound remains usable independently of this fallback setting.
- Open Project and tap outside the menu; confirm it closes. Reopen Project, navigate to Sequence or Video & Export, and confirm the menu closes without covering the new screen's controls.
- Create a project, change its name and a pad, close/reload immediately, and confirm the edits survive.
- Export a project pack, clear site data only after retaining the exported pack, import it, and confirm media, pad settings, patterns, transcript, melody, rap, and overdub metadata restore. Include a captured video whose MIME type has a comma-separated codec list, and confirm its media restores too.
- After the shell and speech model have loaded once, enable airplane mode, relaunch, reopen the project, and confirm cached workflows still work. Record which operations appropriately require network access, such as the first model download.

## 2. Sounds, region selection, and capture

- Import a local video longer than 30 seconds and choose a region well after time zero. Preview it, adjust both boundaries by touch, apply it, play the pad, reload, and repeat after pack export/import.
- Try **Find samples** on a supported clip. Select, preview, edit, and apply a suggestion; reject it and verify manual selection still works. Try a codec the browser cannot analyse and confirm the app explains the limitation without disabling manual trim.
- On each device, grant camera and microphone permission, record a short take on an empty pad, review the proposed trim, adjust it, preview it, and keep it. Repeat on an occupied pad using **Save as new** and confirm the old pad remains unchanged. Cancel one take and deny permission on another; confirm no empty/old pad is replaced and camera/mic indicators stop after close/keep/cancel.
- Rotate the device during preview and capture. Note layout, playback, and recording behavior. Test quiet speech/instrument input, room noise, and silence; compare suggested bounds by listening.
- Set Speed and Pitch independently on a pitched sample. Confirm Speed changes clip duration while Pitch changes audible note without moving the video timeline. Record any unsupported-device explanation or audible artifacts.

## 3. Beat Grid and performance recording

- Load three different samples. At 120 BPM, enable distinct steps in all three lanes and confirm simultaneous playback. Change between 1/4, 1/8, and 1/16 grids; confirm hidden finer steps are preserved.
- Check each lane's volume, mute, solo, edit-to-Sounds action, and pattern capture/quantisation. Save two named scenes and launch one while playing; confirm it changes on the next bar and restores after reload.
- Load a sample longer than one step. Compare **Play full sound** (the legacy default, allowed to ring) with **One sound per step** (retrigger each active cell and stop at the next 16th boundary). Repeat with a short clip, nonzero step offset, 1/4 and 1/8 grid, mute/solo, transport Stop, and saved-scene round-trip; confirm no late hit after Stop and that each lane's setting persists independently.
- Record an audiovisual set with one active video pad, then two and three. Check the composition changes without frozen/stale frames, audio remains aligned, and fixed-grid/Video Director modes behave as selected.
- Record and replay the audio-only mix and video take. Check the downloaded file's actual format matches its extension and that playback works in the device browser or a standard local player.

## 4. Speech, melody, rap, and overdub

- In Voice Lab, read the opt-in notice and explicitly start transcription of a consenting human speech clip. Record cold download time/approximate bytes, transcript edits required, and inference time. Confirm the audio is not sent to an application endpoint; only model assets may download.
- With the model cached, turn off networking and repeat a short transcription. Edit words and timestamps, reorder a phrase, preview it, export its WAV, reload, and confirm the edit persists.
- Map a phrase word to a melody note. Preview the note, add/edit a short melody and harmony, export MIDI, and open it in a MIDI-capable app if available. Note whether pitch, timing, and playback are musically usable.
- Draft a short ABAB rap. Assess whether the rhyme and syllable hints help or mislead; edit flow steps, audition the flow, export lyrics, and verify the text file.
- Record a short vocal overdub against a beat. Preview it and the resulting mix; listen for clipping, doubled monitoring, latency, and timing drift. Reload and confirm the take remains available.

## 5. Touch and assistive technology

- Use TalkBack on Android and VoiceOver on iOS to navigate each stage, pad grid, region controls, sequencer, transcript editor, melody/rap controls, and export actions. Confirm names, roles, values, focus order, and state changes are announced.
- Complete primary flows without relying on hover or precise taps. Record controls that are hard to reach, obscured by the keyboard, clipped, or difficult to operate in portrait/landscape.
- Repeat the key controls with a hardware keyboard on a tablet/desktop browser where available, especially region start/end and sequencer navigation.

## Results template

Copy this section into the Issue #2 acceptance record for each device. Keep private media out of the issue.

```text
Date/time:
Tester:
Device / OS / browser:
Installed PWA or browser tab:
Preview URL / verified Git SHA:
Network: cold online / warm online / offline

Install/storage/offline: Pass / Fail / Blocked — evidence:
Playground/settings/Project menu: Pass / Fail / Blocked — evidence:
Import/region/suggestions: Pass / Fail / Blocked — evidence:
Camera/mic permissions and direct capture: Pass / Fail / Blocked — evidence:
Touch/rotation/codecs: Pass / Fail / Blocked — evidence:
Beat Grid/performance/audio-video sync: Pass / Fail / Blocked — evidence:
Speech transcription and privacy: Pass / Fail / Blocked — latency/edit notes:
Melody/MIDI: Pass / Fail / Blocked — listening notes:
Rap/rhyme/flow/export: Pass / Fail / Blocked — review notes:
Overdub/mix: Pass / Fail / Blocked — listening notes:
TalkBack / VoiceOver: Pass / Fail / Blocked — evidence:

Failures or sanitized errors:
Follow-up needed:
```

Keep automated Chromium, hosted CI, physical-device behavior, and human/listening judgments as separate evidence. Do not mark production acceptance complete until the tested URL is verified against the intended deployed commit.
