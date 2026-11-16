# MadLadPad device acceptance session — 16 November 2026

## Release under test

- Public app: <https://madladpad.pages.dev>
- Pages deployment: `82311a0e-fabc-4984-bf59-15750138da1e`, production branch `main`
- Published main commit: `11838b1e8baafb4121796703c3c876090f233ed6`; the deployed `site/` asset tree is unchanged from app-source commit `dfe52bbe665aee59e410062944e76a05bf3adc55`
- Current-main Verify [run 43759203352](https://github.com/markleonfreese/madladpad/actions/runs/43759203352) passed all five stages (unit, Chromium/accessibility, Song media, WebKit and Workers runtime).
- Pages publish check: all 39 current `site/` files returned HTTP 200 and matched SHA-256; `/voices/` and `/rap/` returned the app shell. Post-publish synthetic speech → Melody → Rap evidence is in [Issue #2 comment 6905144599](https://github.com/markleonfreese/madladpad/issues/2#issuecomment-6905144599). The app has **Playground → Beat Maker → Melody & Rhythm → Tracks → Export**.
- Upload contained only the static `site/` directory; no Functions, bindings, legacy Worker, domain, DNS or account configuration was changed. No paid service was used. Account-wide monthly spend is still not independently verified.

## Human/device status

**NOT TESTED; awaiting user-run device acceptance.** The user confirms access to both an Android Chrome device and an iPhone/iPad Safari device. Neither device has been tested yet. The deployment and Chromium smoke do not establish physical touch, mic/camera permission and capture, audio/video timing, installed-PWA/offline lifecycle, OS interruption, low-storage behavior, TalkBack/VoiceOver or human speech/music quality. Record each platform separately; do not mark device acceptance passed until observed results are recorded.

Run D1–D11 in the [`DEVICE-ACCEPTANCE-SESSION-2026-11-15.md`](DEVICE-ACCEPTANCE-SESSION-2026-11-15.md) matrix against this production release. Use the current five-stage paths even where the older matrix wording differs: D1 checks all five stages; D5 records from Tracks; D6 records in Tracks and reviews in Export; D10 checks Melody & Rhythm, Tracks and Export; D11 listens to the Export output. Current direct paths are: Playground for pad input; Beat Maker for patterns/Song; Melody & Rhythm for speech transcription, melody and rap; Tracks for local A/V arrangement and overdub; Export for final captures. Record device, OS/browser, exact observed result and sanitized evidence in [Issue #2](https://github.com/markleonfreese/madladpad/issues/2). Do not use private recordings in evidence.

The older [`DEVICE-ACCEPTANCE-SESSION-2026-11-15.md`](DEVICE-ACCEPTANCE-SESSION-2026-11-15.md) records the previous release and navigation; keep it as historical evidence.
