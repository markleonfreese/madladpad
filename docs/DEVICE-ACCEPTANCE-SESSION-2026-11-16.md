# MadLadPad device acceptance session — 16 November 2026

## Release under test

- Public app: <https://madladpad.pages.dev>
- Pages deployment: `ca45f0aa-42fe-47da-8317-2928ecca027b`, production branch `main`
- Source: `47d188d1949ff59c7e83a023f1360ca94e30b317`
- GitHub post-merge Verify: [run 43739511443](https://github.com/markleonfreese/madladpad/actions/runs/43739511443), success at this exact source across unit, browser/accessibility, Song media, WebKit and Workers runtime.
- Pages publish check: all 39 built static files returned HTTP 200 and matched SHA-256; `/voices/` and `/rap/` returned the app shell. The user's normal Chrome session reloaded the app and showed **Playground → Beat Maker → Melody & Rhythm → Tracks → Export**.
- Upload contained only the static `site/` directory; no Functions, bindings, legacy Worker, domain, DNS or account configuration was changed. No paid service was used. Account-wide monthly spend is still not independently verified.

## Human/device status

**NOT TESTED / BLOCKED pending a person with a physical device.** The deployment and Chromium smoke do not establish Android Chrome or iOS Safari touch, real mic/camera permission and capture, audio/video timing, installed-PWA/offline lifecycle, OS interruption, low-storage behavior, TalkBack/VoiceOver or human speech/music quality. Do not mark the MVP device-accepted from this release evidence.

Run D1–D11 in the [`DEVICE-ACCEPTANCE-SESSION-2026-11-15.md`](DEVICE-ACCEPTANCE-SESSION-2026-11-15.md) matrix against this production release. Use the current five-stage paths even where the older matrix wording differs: D1 checks all five stages; D5 records from Tracks; D6 records in Tracks and reviews in Export; D10 checks Melody & Rhythm, Tracks and Export; D11 listens to the Export output. Current direct paths are: Playground for pad input; Beat Maker for patterns/Song; Melody & Rhythm for speech transcription, melody and rap; Tracks for local A/V arrangement and overdub; Export for final captures. Record device, OS/browser, exact observed result and sanitized evidence in [Issue #2](https://github.com/markleonfreese/madladpad/issues/2). Do not use private recordings in evidence.

The older [`DEVICE-ACCEPTANCE-SESSION-2026-11-15.md`](DEVICE-ACCEPTANCE-SESSION-2026-11-15.md) records the previous release and navigation; keep it as historical evidence.
