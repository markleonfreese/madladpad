# MadLadPad device and listening acceptance

Use this checklist to close the physical-device and human-review gates recorded in [GitHub Issue #2](https://github.com/markleonfreese/madladpad/issues/2). It supplements [`tests/BROWSER-SMOKE.md`](../tests/BROWSER-SMOKE.md), which is synthetic desktop Chromium evidence.

## Current published app — 13 November 2026

- **Test this URL:** <https://madladpad.pages.dev>. Read-only Wrangler Pages listing confirms deployment `083c57d9-5697-4abc-9044-007509cb264b` is Production on branch `main`, source `01eb4f6f70b4ed0760985ec2881c0242129c052c` (PR #172, PWA shell v18). The app is published as static Pages assets; this repository has no Pages Functions source. `/`, `/audio.js`, `/app.js`, `/sw.js`, and `/voice-inference-worker.bundle.js` returned HTTP 200; the deployed `/audio.js` hash matches the release checkout. No Pages Functions, Worker or Cloudflare configuration changed.
- **Current published-shell check:** hosted Chromium at 320×720 and 390×844 found 12 visible pads, no horizontal overflow, and no page errors. A fresh hosted PWA session activated `madladpad-shell-v18`, confirmed the cached `/audio.js` includes the #170 `pendingStarts` fallback fix, then reopened offline at 320×720 with 12 pads and no page errors. This is a synthetic browser install/offline check, not a physical installed-PWA test. Details: [Issue #2](https://github.com/markleonfreese/madladpad/issues/2#issuecomment-6852799144).
- **Capture-target behavior previously verified on #168:** hosted Chromium at 390×844 confirmed the manual, 1-bar, 2-bar and 4-bar options, no page errors or horizontal overflow. The exact live core helper returns 2/4/8 seconds for 1/2/4 bars at 120 BPM and 24 seconds for four bars at 40 BPM; the `madladpad-shell-v17` cache contains the served app/core. Local fake-camera Chromium separately verified the two-bar 4-second timer. These are synthetic desktop/browser checks, not physical capture or human acceptance. Details: [Issue #9](https://github.com/markleonfreese/madladpad/issues/9#issuecomment-6851449271).
- **Current-source offline speech check:** on Pages source `01eb4f6` / shell v18, a fresh hosted desktop Chromium session imported a local macOS TTS WAV, opted in, and ran the real Whisper Tiny English ONNX/WASM worker. It drafted 16 timestamped words; one out-of-clip word was explicitly omitted. After the first online model load, the same local clip transcribed again after switching offline and reloading the app, with the same 16-word status. `app.js` SHA-256 matched the local release checkout; there were no page errors or non-GET requests. This is synthetic hosted-browser evidence, not physical installed-PWA or phone acceptance, and it does not establish human speech accuracy. Review wording and timing; confidence is not supplied. Details: [Issue #2](https://github.com/markleonfreese/madladpad/issues/2#issuecomment-6853213557).
- **Previously verified UI checks:** hosted Chromium checks for the rap hints/syllable estimates and melody note names, pitch picker and bar/beat labels are recorded below and in earlier Issue #2 entries. They verify browser behavior at the tested desktop viewport, not phone usability, assistive technology or musical/listening acceptance.
- **Earlier rap hint check:** hosted Chromium at 390×844 verified that an unknown `move` ending no longer suggests false `love` family rhymes, while curated `cat` matches include `bat`, `flat`, and `mat`. Synthetic UI only; no human rap/listening assessment.
- **Earlier rap syllable check:** hosted Chromium at 390×844 showed 6 estimates for `wishes boxes dances`, 4 for `wanted needed`, and 2 for `played waved`. The local spelling heuristic remains approximate; human performance/listening review is open.
- **Earlier melody checks:** hosted Chromium checked note names, the 85-note pitch picker, and bar/beat labels at 320/390 px. This does not establish phone readability, assistive technology, or human musical/listening acceptance.
- The older **Workers production URL** <https://madladpad.markleonfreese.workers.dev/> is unchanged and serves an older bundle (`/voice.js` returns 404). Do not use it to accept current `main`; use the Pages URL above. A recent read-only check returned 200 for the legacy shell and `/app.js`, but that does not change its stale release state or establish a cause for the earlier 503 report.
- First-use speech transcription downloads about 65 MB of model/runtime files from Hugging Face. Plan the first speech test on an appropriate connection; the selected audio remains local.
- PR #84 remains a review-only draft hosted preview and is not for merging. Use the Pages production URL above as the primary target. Before each acceptance session, record the currently served source SHA in Issue #2; keep physical-device, screen-reader and listening results separate from hosted browser evidence.

## Before testing

- Test the HTTPS Pages URL above after confirming the production source SHA. Record both the URL and Git SHA. The current `workers.dev` URL is known to serve an older bundle; do not use it as evidence for current `main` until its release ID is verified.
- Use current Android Chrome and iOS Safari on physical devices. Record device model, OS version, browser version, screen size, and whether the PWA is installed.
- Test in a fresh browser profile for first-run/model download, then in the same profile for warm/offline use. Allow a separate pass with an existing project.
- Use consenting testers and recordings. Do not commit or upload raw personal recordings, transcripts, or private project packs. Record only outcomes, timings, approximate file sizes, and sanitized error text.
- Mark each check **Pass**, **Fail**, or **Blocked**. A simulator or desktop mobile emulation does not count as a physical-device pass.

## 1. Install, storage, and offline use

- Install the PWA where supported, launch it, and confirm all five studio stages are reachable.
- On Playground, confirm Edit pads is the only toolbar action and the global Demo sounds preference starts collapsed inside Settings. Toggle it on/off, reload, and verify the preference persists; confirm an individually assigned pad sound remains usable independently of this fallback setting.
- Open Project and tap outside the menu; confirm it closes. Reopen Project, navigate to Sequence or Video & Export, and confirm the menu closes without covering the new screen's controls.
- Expand Lab on the current main release. Confirm Voice Lab and Overdub appear in a visible popup, are announced as named links, and remain tappable at phone and desktop widths.
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

- **Issue #134 pad playback/retrigger matrix:** import or capture a long (~3 s) audio sample on pad A and a short (~0.5 s) sample on pad B. Tap A, then B about 200 ms later; confirm B starts while A continues to its trim end. Repeat with video media so the browser uses its media-element path where applicable. Rapidly tap A twice and confirm exactly one attack per gesture and a clean single restart; press and hold A then release and confirm that same voice stops, including after `pointercancel`. Confirm the generated click after touch does not add a hit. Repeat at 1× and changed Speed/Pitch, with keyboard input, during audiovisual recording, and after Stop/reload. Record device/browser, media type, timings, and sanitized errors; do not upload recordings. Keep AudioBuffer and HTMLMediaElement results separate.

- Load three different samples. At 120 BPM, enable distinct steps in all three lanes and confirm simultaneous playback. Change between 1/4, 1/8, and 1/16 grids; confirm hidden finer steps are preserved.
- Check each lane's volume, mute, solo, edit-to-Sounds action, and pattern capture/quantisation. Save two named scenes and launch one while playing; confirm it changes on the next bar and restores after reload.
- Compare each pad's default **Play full sound** with optional **One sound per step** and **Loop across held steps**. One-step starts the trim at each active cell and gates at the next 16th boundary after its offset. Loop starts once for a contiguous run, joins steps 15→0, and loops short decoded audio until the run ends; an all-on pattern sustains across bars until Stop. Scene changes release at the bar boundary. Video/unsupported media and generated demos play one full sound and show a limitation. Verify project-pack reload and scene round-trip on the published SHA above.
- Load a sample longer than one step. Compare **Play full sound** (the legacy default, allowed to ring) with **One sound per step** (retrigger each active cell and stop at the next 16th boundary). Repeat with a short clip, nonzero step offset, 1/4 and 1/8 grid, mute/solo, transport Stop, and saved-scene round-trip; confirm no late hit after Stop and that each lane's setting persists independently.
- For **Loop across held steps**, test a short and long decoded audio file, a nonzero offset, 3-cell run and gap, steps 15→0 wrap, all 16 steps held, 1×/2× Speed, mute/solo, pattern edits, Stop, scene launch, reload, and portable pack import. Confirm it starts once per run, loops only a short selected trim, releases at a gap or scene boundary, and never restarts at step 0 during a wrapped run. Confirm video/unsupported media gives the one-shot limitation notice.
- Record an audiovisual set with one active video pad, then two and three. Check the composition changes without frozen/stale frames, audio remains aligned, and fixed-grid/Video Director modes behave as selected.
- Record and replay the audio-only mix and video take. Check the downloaded file's actual format matches its extension and that playback works in the device browser or a standard local player.

## 4. Speech, melody, rap, and overdub

- In Voice Lab, read the opt-in notice and explicitly start transcription of a consenting human speech clip. Record cold download time/approximate bytes, transcript edits required, and inference time. Confirm the audio is not sent to an application endpoint; only model assets may download.
- With the model cached, turn off networking and repeat a short transcription. Edit words and timestamps, reorder a phrase, preview it, export its WAV, reload, and confirm the edit persists.
- Map a phrase word to a melody note. Preview the note, add/edit a short melody and harmony, export MIDI, and open it in a MIDI-capable app if available. Note whether pitch, timing, and playback are musically usable.
- In the note-name pitch picker, choose pitches across low, middle and high octaves, check that the displayed tuning reference agrees, and confirm the selected notes survive reload and MIDI export.
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
