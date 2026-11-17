# MadLadPad device acceptance session — 17 November 2026

## Release under test

- Public app: <https://madladpad.pages.dev>
- Pages deployment: `c9d01e7d-e779-42e7-98a1-3d5aa6367959`, production branch `main`
- Published main commit: `46ae5d9af24cc72ff2b8088ec20c1508b45885c5`; all 42 built `site/` files were verified byte-for-byte against the public alias.
- Current-main post-merge Verify [run 44060066244](https://github.com/markleonfreese/madladpad/actions/runs/44060066244) passed all six stages. That source is `b3fa9ce` and **is newer than the production release under test**; its video export is not available at this production URL.
- Publish evidence: [Issue #2 comment 6943838860](https://github.com/markleonfreese/madladpad/issues/2#issuecomment-6943838860). Static Pages assets only; no Function, Worker, DNS, binding, domain or account configuration was changed. No paid service was used. Account-wide monthly spend remains unverified.

## Human/device status

**NOT TESTED; awaiting user-run device acceptance.** The user confirms an Android Chrome device and an iPhone/iPad Safari device are both available. Neither has been physically tested. Hosted Chromium/WebKit and CI do not establish physical touch, mic/camera permission and capture, audio/video timing, installed-PWA/offline lifecycle, OS interruption, low-storage behavior, TalkBack/VoiceOver, or human speech/music quality. Record each platform independently; do not mark acceptance passed until observed results are recorded.

Use the D1–D11 matrix in [`DEVICE-ACCEPTANCE-SESSION-2026-11-15.md`](DEVICE-ACCEPTANCE-SESSION-2026-11-15.md), with current five-stage paths: Playground, Beat Maker, Melody & Rhythm, Tracks and Export. D1 checks all stages; D5 records from Tracks; D6 records in Tracks and reviews in Export; D10 checks Melody & Rhythm, Tracks and Export; D11 listens to Export output. The older 15 November release/session is reference material; use the current production URL above.

On both devices, also open Beat Maker, create or load a multi-bar Song, and check the shared ruler at portrait width. Use **Fit Song**, zoom, tap a bar to seek, and confirm the playhead follows playback. At 320 CSS px where available, verify the compact overview and transport without horizontal page overflow. On a longer Song, seek near the final bars and check alignment among bar labels, section blocks and playhead. Repeat one seek and play/pause interaction with VoiceOver or TalkBack enabled.

The offline full-song video export from PR #265 is in merged main `b3fa9ce`, **not this production release**. Do not record video-export device acceptance against this URL. When a separately authorized test URL provides that source, use the video checklist in [`DEVICE-ACCEPTANCE.md`](DEVICE-ACCEPTANCE.md).

Record device, OS/browser, installed-PWA or tab mode, exact observed result and sanitized evidence in [Issue #2](https://github.com/markleonfreese/madladpad/issues/2). Do not upload private recordings or include them in the issue.
