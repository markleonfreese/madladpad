# MadLadPad device and listening acceptance

Use this checklist to close the physical-device and human-review gates recorded in [GitHub Issue #2](https://github.com/markleonfreese/madladpad/issues/2). It supplements [`tests/BROWSER-SMOKE.md`](../tests/BROWSER-SMOKE.md), which is synthetic desktop Chromium evidence.

## Current published app — 13 November 2026

- **Test this URL:** <https://madladpad.pages.dev>. Cloudflare Pages deployment `7774a174-6f15-4208-a5a3-278ec4af9024` is on production branch `main`, source `42517be1ed696cfffed0fc9ca3487bd7e1a963a8`. The app is published as static Pages assets; this repository has no Pages Functions source.
- **Verified after publish:** GitHub main Verify `43381600687` passed after merge. Local exact-main checks passed 90/90 unit tests, Chromium plus axe, WebKit, Workers runtime and `git diff --check`. Production `/core.js`, `/voice.js` and `/styles.css` SHA-256 hashes match the merged build. Hosted headless Chromium at 390×844 changed step 16 to `Bar 2 · Beat 1 · 16th 1`; at 320×720 it showed the note row with no horizontal overflow or page errors. This is synthetic hosted desktop/emulation evidence, not device or human acceptance.
- **Hosted evidence on this release:** app, service worker, Voice Lab, inference worker, ONNX WASM and MIDI/rap workflows were fetched or exercised successfully. Hosted Chromium at 390×844 verified local Whisper transcription and warm full-shell offline reload with actual inference, melody/MIDI export and ABAB rap/TXT export. The imported speech clip remained local; the model's out-of-clip final word was omitted with a recovery notice. Details are in [Issue #2](https://github.com/markleonfreese/madladpad/issues/2#issuecomment-6776507338). This remains synthetic desktop evidence, not physical-device, human listening or screen-reader acceptance.
- **Rap hint regression on this release:** production headless Chromium at 390×844 verified that an unknown `move` ending no longer suggests false `love` family rhymes, while the curated `cat` family still suggests `bat`, `flat`, and `mat`. No page errors or horizontal overflow. This is hosted synthetic UI evidence; it does not assess rap quality through human performance or listening.
- **Rap syllable estimate regression on this release:** production headless Chromium at 390×844 showed 6 estimates for `wishes boxes dances`, 4 for `wanted needed`, and 2 for `played waved`, with no page errors or horizontal overflow. The endings use local spelling heuristics; these counts remain approximate and need human performance/listening review.
- **Melody note names on this release:** production headless Chromium at 390×844 added MIDI 69 and displayed `A4 · 440.0 Hz`; no page errors or horizontal overflow. This confirms the visible label and browser behavior, not the musical usefulness of a complete melody or human listening acceptance.
- **Melody pitch picker on this release:** after PR #161, production headless Chromium confirmed the octave-grouped note picker offers all 85 MIDI pitches from 24 through 108, selecting MIDI 69 displays `A4 · 440.0 Hz`, and the control remains 153×44 px with no page overflow at 320 px. `voice.js` and `core.js` served SHA-256 hashes match the deployed build. This is hosted synthetic evidence, not physical-device, screen-reader or listening acceptance.
- **Melody rhythm position on this release:** after PR #163, production headless Chromium showed step 16 as `Bar 2 · Beat 1 · 16th 1` and step 0 as `Bar 1 · Beat 1 · 16th 1`. At 320×720, the full note row stayed within the 320 px page; no page errors were observed. This does not establish physical-device readability or human musical/listening acceptance.
- The older **Workers production URL** <https://madladpad.markleonfreese.workers.dev/> is unchanged and serves an older bundle (`/voice.js` returns 404). Do not use it to accept current `main`; use the Pages URL above. A recent read-only check returned 200 for the legacy shell and `/app.js`, but that does not change its stale release state or establish a cause for the earlier 503 report.
- First-use speech transcription downloads about 65 MB of model/runtime files from Hugging Face. Plan the first speech test on an appropriate connection; the selected audio remains local.
- PR #84 remains a review-only, draft hosted preview and is not for merging. Its app source matches the current `main` SHA; use the Pages production URL above as the primary target and retain the preview as a non-production fallback. After testing, record the Pages URL and tested `main` SHA in Issue #2. Keep physical-device, screen-reader and listening results separate from hosted browser evidence.

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
- Expand Experimental on the current main release. Confirm Voice Lab and Overdub appear in a visible popup, are announced as named links, and remain tappable at phone and desktop widths.
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
