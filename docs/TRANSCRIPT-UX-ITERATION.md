# MadLadPad transcript UX follow-up — 11 November 2026

Status: review candidate; **not deployed**. This follows the 16-minute in-person UX discussion and the first Playground-first release. The goal is a shorter record → play → sequence → share path without changing the audio engine, project schema, recorded media, or optional labs.

## Changes in this candidate

| User observation | Follow-up | Evidence to collect |
| --- | --- | --- |
| Recording video should not hide the live pads (15:24) | A Record video toggle stays in the shared transport on Playground, Sequence and Export; both existing and new controls use the same recorder | Begin on Playground, tap pads, switch screens, stop, then review the downloaded video |
| Too much scrolling between Sequence and pads (13:26) | Sequence opens on its 16-step controls; a labelled, keyboard-accessible Show performance pads disclosure reveals the extra pad grid only when requested | Check 320/390 px portrait, keyboard and screen-reader states, and preservation of beat steps |
| One clip should supply multiple pads (01:48) | Copy to pad is available directly after the primary trim controls and opens the copied pad for an independent trim | Import a sample, copy to two empty pads, trim independently, reload and export/reimport a pack |
| Editing should prioritise the chosen sound (07:07) | Record/Files and secondary sources collapse behind Replace this clip when a pad already contains media | Opening a populated pad shows the trim first; empty pads still show their source choices |
| Empty-pad hold should clearly suggest recording (03:40) | The Playground instructions now explain the hold-for-camera gesture and the tap-for-file alternative | Test tap, long hold, cancellation, permission denial, no unintended overwrites |

## Deliberate limits

- Long-press still **opens a camera preview**, and recording requires an explicit Start then Keep; it does not secretly activate a microphone or overwrite a pad. This preserves the existing permission and save transaction.
- Copying is manual and uses the existing independent media slots. Automatic multi-region splitting and a shared clip library are **not yet implemented**.
- Pad layouts remain 4/12/16. Automatically growing by rows of three would require a separate project-layout and migration decision.
- This candidate does not change Voice Lab, Overdub, MIDI, codecs, export formats, billing, account configuration, or production.

## Verification / release gate

1. Unit tests, JavaScript syntax, build and `git diff --check` pass.
2. Chromium/browser accessibility, WebKit mobile, and Workers runtime smoke pass on the **exact candidate head** in an environment permitted to launch browsers and local servers. Verify the new persistent recording control in real downloadable video, not just its button state.
3. Physical Android Chrome and iOS Safari: camera permission, touch-hold, one-shot/gated playback, recording during pad taps, trim/copy, 320/390-width overflow, modal focus, offline reopen, project pack restore. TalkBack/VoiceOver and human audio/video review are still required before calling it device-accepted.
4. Do not merge or deploy solely on the strength of unit tests or a PR report. The current Pages release remains the rollback point.
