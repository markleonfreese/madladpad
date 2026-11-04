# MadLadPad

An installable, local-first audiovisual sampler inspired by Smule's MadPad and the looper/pitch-play ideas in [Mr Not So Brightside](https://github.com/markleonfreese/mr-not-so-brightside).

## MVP features

- Play 4, 12 or 16 audio, video and photo pads with touch, keyboard or optional Web MIDI.
- Record 3–30 second clips with the camera and microphone directly onto a pad. Review the suggested sound region, adjust its start and end, preview, retake, or keep it. When pads already contain media, choose a new empty pad or explicitly replace one.
- Import supported audio, video and image files from the device or Files app. Trim clips and optionally find candidate sound regions with local processing.
- Adjust per-pad volume and Speed. Independent Pitch shifting is available when the browser can start the local AudioWorklet processor; it supports semitone adjustment separately from Speed and adds a short processing delay. Pitch quality and performance vary by device.
- Compose per-pad patterns in a 16-step sequencer or multi-track grid. Record pattern taps, quantise them, save named scenes and load a scene on the next bar.
- Opt in to English speech transcription for a local audio/video pad. First use downloads about 65 MB total for the Whisper Tiny model and audio runtime; audio is processed on-device, timestamped words remain editable and can be arranged into reorderable sample phrases with either an adjustable silence gap or true overlap crossfades, matching local preview and standalone WAV export. Map a phrase into one-bar sequencer patterns by creating one local WAV pad per word; existing samples and patterns are preserved. The model does not provide word confidence, so review the draft.
- Write a melody with MIDI pitch, sixteenth-note position and length, preview it with local synthesis or assign phrase words to pitched sample cues, and add an editable harmony line at a chosen semitone interval. Export the complete melody and harmony as a standard A4 = 440 Hz MIDI file. The local oscillator preview also supports a 400–480 Hz tuning reference (default 440 Hz).
- Draft 16 rap bars at the session tempo with rough local syllable counts and rhyme-group prompts linked to the selected AABB, ABAB or AAAA shape. Hints are local spelling-based estimates. Export lyrics as a text file.
- Record independent microphone overdubs while the sequencer plays. Raw takes are retained as local project layers, aligned to editable sixteenth-note offsets, with per-layer gain, mute, solo and preview controls. Vocal takes are included in project-pack export and in the audio mix when the sequence plays. A master safety compressor reduces clipping peaks.
- Record an audiovisual performance with a fixed or active-pad-following video layout, or export an audio-only mix using a format supported by the browser.
- Install the PWA, work offline after the app shell is cached, and save projects in IndexedDB. Export and import portable `.madladpad` project packs with their media.
- Optionally import items the user explicitly picks from Google Drive or Google Photos. Local use does not require connecting an account.

**Privacy:** Media and projects stay in the browser's device storage unless the user exports a file. Transcription is an explicit opt-in; the speech model is downloaded from Hugging Face on first use and the selected audio is not uploaded. Vocal recording starts only after the user presses Record and grants microphone access; each raw take stays local. Google imports download only items the user selects and store local copies. The MVP has no backend database, analytics, or public media sharing. Clearing browser site data may erase local projects; export packs as backups.

## Local development and checks

```bash
npm install
npm test
npx playwright install chromium
npm run test:browser
npm run test:workers-runtime
npx wrangler dev
```

The browser smoke uses synthetic media and Chromium's fake camera/microphone. It checks the UI, persistence, exports and offline shell; it does not replace real Android/iOS camera, codec, touch, listening or accessibility acceptance. `test:workers-runtime` launches Wrangler locally and checks the configured static assets, canonical `/index.html` redirect and SPA navigation fallback without contacting Cloudflare.

Cloudflare Workers Static Assets serves `site/`; `wrangler.jsonc` configures the project. `npx wrangler deploy` publishes to the Cloudflare account selected by the authenticated CLI. Verify the account and target hostname before deployment.

## Google Picker setup (optional)

1. In Google Cloud Console, enable **Google Picker API**, **Google Drive API** and **Google Photos Picker API**. Configure OAuth consent and create a **Web application OAuth client**.
2. Add the exact production or preview origin to **Authorised JavaScript origins**. Create a restricted browser API key and restrict it to the required Picker and Drive APIs.
3. Copy `site/google-config.example.js` to `site/google-config.js` and enter the public OAuth client ID, restricted browser key and numeric Cloud project ID. Never put an OAuth client secret in the site.
4. The checked-in `google-config.js` has empty values. Configure and test Google imports on a real deployed HTTPS origin only if you want those optional providers.

Google Photos uses a Picker session and reads only approved selections; video downloads can take time. Drive uses the `drive.file` scope; Photos uses `photospicker.mediaitems.readonly`. iCloud Drive is available through the system Files picker on compatible Apple devices; Apple does not provide an equivalent generic iCloud Drive web picker.

## Browser and media boundaries

- Web MIDI availability and install prompts vary by browser. iOS Safari does not provide Web MIDI; touch input remains available.
- Video triggers use browser media elements and can have more latency than decoded audio. The app cannot promise zero-latency video playback.
- Pitch processing depends on browser AudioWorklet support and device capacity. The app disables Pitch when it cannot create a working route; Speed remains available.
- Recording uses the audio/video MIME types supported by the current browser (`.webm`, `.mp4`, `.m4a` or another reported type). Changing a file extension does **not** transcode media. Some browsers cannot record video.
- Physical Android/iOS camera, codec, performance, listening and accessibility acceptance must be checked separately from synthetic desktop tests.

## Original-source note

[`sifxtreme/madpad`](https://github.com/sifxtreme/madpad) and its [`madpad-archive-node`](https://github.com/sifxtreme/madpad-archive-node) variant are realtime collaborative **text pads**, not Smule's audiovisual MadPad. Their shared-editing idea could inform a future collaboration feature, but it does not fit this local-first MVP's current scope. Neither repository contains speech transcription, melody-writing or rap-writing code to reuse, and no code is copied from them. The uploaded prototype modules were reviewed as reference material; their unsupported MP4 and video-decoding assumptions were not carried forward.
