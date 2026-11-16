# MadLadPad device acceptance session — 16 November 2026

## Release under test

- Public app: <https://madladpad.pages.dev>
- Pages deployment: `fe11d6f0-86cd-4d25-a6da-94868e0f268d`, production branch `main`
- Published main commit: `8a31c9dd1efbf138487d10dcf37b72adfd64340a`; the deployed `site/` assets were SHA-256 verified against this checkout.
- Current-main Verify [run 43850967784](https://github.com/markleonfreese/madladpad/actions/runs/43850967784) passed all five stages (unit, Chromium/accessibility, Song media, WebKit and Workers runtime).
- Pages publish check: all 39 current `site/` files returned HTTP 200 and matched SHA-256; `/voices/` and `/rap/` returned the app shell. Post-publish record: [Issue #2 comment 6914278258](https://github.com/markleonfreese/madladpad/issues/2#issuecomment-6914278258). The app has **Playground → Beat Maker → Melody & Rhythm → Tracks → Export**.
- Upload contained only the static `site/` directory; no Functions, bindings, legacy Worker, domain, DNS or account configuration was changed. No paid service was used. Account-wide monthly spend is still not independently verified.

## Human/device status

**NOT TESTED; awaiting user-run device acceptance.** The user confirms access to both an Android Chrome device and an iPhone/iPad Safari device. Neither device has been tested yet. The deployment and Chromium smoke do not establish physical touch, mic/camera permission and capture, audio/video timing, installed-PWA/offline lifecycle, OS interruption, low-storage behavior, TalkBack/VoiceOver or human speech/music quality. Record each platform separately; do not mark device acceptance passed until observed results are recorded.

Run D1–D11 in the [`DEVICE-ACCEPTANCE-SESSION-2026-11-15.md`](DEVICE-ACCEPTANCE-SESSION-2026-11-15.md) matrix against this production release. Use the current five-stage paths even where the older matrix wording differs: D1 checks all five stages; D5 records from Tracks; D6 records in Tracks and reviews in Export; D10 checks Melody & Rhythm, Tracks and Export; D11 listens to the Export output. Current direct paths are: Playground for pad input; Beat Maker for patterns/Song; Melody & Rhythm for speech transcription, melody and rap; Tracks for local A/V arrangement and overdub; Export for final captures. Record device, OS/browser, exact observed result and sanitized evidence in [Issue #2](https://github.com/markleonfreese/madladpad/issues/2). Do not use private recordings in evidence.

## Added physical check for the shared Song ruler

On both devices, open Beat Maker, create or load a multi-bar Song, and check the shared ruler at portrait width. Use **Fit Song**, zoom in/out, tap a bar to seek, and confirm the playhead follows playback. At 320 CSS px where available, check that the compact overview and transport remain usable without horizontal page overflow. On a longer Song, scroll/seek near the final bars and verify the bar labels, section blocks and playhead stay aligned. Repeat one seek and one play/pause interaction with VoiceOver or TalkBack enabled. Record each platform independently; existing desktop viewport and synthetic long-Song checks do not count as device passes.

The older [`DEVICE-ACCEPTANCE-SESSION-2026-11-15.md`](DEVICE-ACCEPTANCE-SESSION-2026-11-15.md) records the previous release and navigation; keep it as historical evidence.
