# MadLadPad mobile UX preview acceptance — refreshed 10 November 2026

This review-only preview serves current `main` at `eb051c14a3812f919ec5176fb3acdfcab8acfc83`. The PR #84 branch contains the same application source and changes only these acceptance notes. Before testing, verify that the latest `Verify` and `Workers Builds` checks passed for the displayed PR head; use the preview link on that Workers Builds check. The stable preview URL is listed in PR #84. No production configuration or release was changed.

Review checklist (see [DEVICE-ACCEPTANCE.md](DEVICE-ACCEPTANCE.md) for detailed scenarios):

- [ ] Open the exact-head HTTPS preview on Android Chrome and iOS Safari at approximately 390px; verify no horizontal overflow, the primary Sounds / Beat Grid / Video & Export navigation is usable, and More tools exposes Voice Lab and Overdub.
- [ ] First use: start with a demo beat, edit a step, play it, and follow the Video & Export step. Then try importing a local clip or recording one. With the checked-in blank Google config, confirm Drive/Photos are disabled with “Setup required” and no sign-in prompt; local import/recording should remain available.
- [ ] Tap Edit from Sounds and Beat Grid; verify the selected pad opens in Sounds and sample editing is discoverable.
- [ ] Open Beat Grid and verify the sequencer appears before the pad gallery in visual and reading order. Change the editing-pad picker and verify it selects the matching lane; check that pads remain comfortable to tap.
- [ ] At 320px and 390px, open All Tracks. Confirm lane labels and controls remain visible above each horizontally scrollable step row; steps are at least 44 × 44px, scrolling stays aligned across lanes, and the page itself does not overflow horizontally. Repeat with touch on a phone.
- [ ] Load a local audio/video sample; check trimming and pitch controls appear only when media is present.
- [ ] Record an active take and confirm the meter reports sound detected. For silence or unavailable metering, confirm the full take remains selected with a clear no-sound message; adjust trim, preview, then keep or retake without uploading private clips.
- [ ] Switch Voice Lab between Speech, Melody, and Rap; confirm only the selected tool is shown and announced. Explicitly start and stop the tuner and confirm it stops when leaving Melody.
- [ ] Load a short local spoken test phrase, explicitly opt in to Speech, and run on-device transcription. Confirm words and timestamps are editable, review spelling (especially names), and verify manual entry/retry remains available if model download fails; the clip must remain local.
- [ ] After opening Voice Lab or Overdub from More tools, confirm the selected destination remains identifiable to keyboard/screen-reader users when the disclosure closes. Check the core flow one-handed in portrait.
- [ ] At 320px and 390px, open Overdub and verify the vocal harmony action wraps within the viewport without horizontal page scrolling.
- [ ] Test microphone/camera prompts, offline reopen, local persistence/backup, export, and human listening.
- [ ] Record preview URL, source commit, device/OS/browser, results, and failures without attaching private clips or token values. Synthetic desktop and hosted CI results do not count as phone or listening acceptance.

Production remains on an older shell (`v4`; current `main` is `v13`). The latest read-only checks returned HTTP 200 but did not reproduce or explain the earlier intermittent 503. Keep production unchanged until account spend is verified within A$5/month and a supported production write route is available. Preview URLs may be publicly accessible.
