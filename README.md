# MadLadPad

An installable audiovisual sampler inspired by Smule's MadPad and the looper / pitch-play ideas in [Mr Not So Brightside](https://github.com/markleonfreese/mr-not-so-brightside).

## First playable release (MVP)

- 12 video/audio/photo pads (or 2×2 / 4×4), touch, keyboard and optional Web MIDI input.
- Record short clips with the camera and microphone, or import multiple files from the device / Files app.
- Set pad trim, pitch, volume and trigger quantisation. Video and audio playback uses the browser media pipeline; decoded audio files use Web Audio buffer scheduling.
- 16-step beat sequencer, tempo, random beat starter, real-time audiovisual performance capture.
- Offline install, local IndexedDB project storage, and portable `.madladpad` export / import with media.
- Optional Google Drive and Google Photos pickers using explicit OAuth. No third-party account connection is necessary for local use.

**Privacy:** Media and projects remain in the browser's device storage unless the user exports a file. Importing from Google downloads only items the user explicitly picks, then stores local copies. No backend/database, analytics or public media sharing in the MVP. Clearing browser site data may erase local projects, so export backups.

## Local development / Cloudflare

```bash
npm test
npx wrangler dev
```

Cloudflare Workers Static Assets serves `site/` as a PWA; `wrangler.jsonc` configures the project. `npx wrangler deploy` publishes to the Cloudflare account selected by the authenticated CLI. Do not deploy without checking the account and target hostname.

## Google Picker setup (optional)

1. In Google Cloud Console, enable **Google Picker API**, **Google Drive API** and **Google Photos Picker API**. Set up the OAuth consent screen, add test users while in testing, and create a **Web application OAuth client**.
2. Add your exact Cloudflare production/preview origin to **Authorised JavaScript origins**. Create a restricted browser API key and add the site origin plus `https://docs.google.com/*` for the Picker iframe. Restrict that key to the Google Picker and Drive APIs.
3. Copy `site/google-config.example.js` to `site/google-config.js` and enter the *public* OAuth client ID, restricted browser key and numeric Cloud project ID. Do not put an OAuth client **secret** here.
4. The checked-in `google-config.js` has empty values, so the Google buttons explain setup rather than misleading users. After configuring, test the Google consent screen, one Drive video, and one Photos video from a real deployed HTTPS origin.

Google Photos uses a Picker session and reads only approved selections; its video downloads can take time. The `drive.file` scope is used for Drive; Photos uses `photospicker.mediaitems.readonly`. iCloud Drive is available through the system **Files** picker on compatible Apple devices; Apple does not provide an equivalent generic iCloud Drive web Picker SDK.

## Browser and format boundaries

- Web MIDI availability and install prompts vary by browser. iOS Safari does not provide Web MIDI; touch works everywhere.
- Browsers cannot promise zero-latency video rendering. For low-latency audio-only samples the app uses decoded Web Audio buffers; video clips play through a media element routed to the mix bus.
- Performance recording exports the format the browser actually supports (`.webm` or `.mp4`); changing a file extension does **not** transcode it. Some browsers cannot record video; that feature will show an error.
- Loop recording/overdub tracks, collaborative cloud packs, durable account sync, WebCodecs-based video optimisation and richer effects are later phases. The MVP sequencer is the first layer of repeatable rhythm creation.

## Original-source note

[`sifxtreme/madpad-archive-node`](https://github.com/sifxtreme/madpad-archive-node) is a realtime collaborative **text editor**, unrelated to Smule's audiovisual MadPad. No code is copied from it. The uploaded prototype modules were reviewed as reference material; their unsupported MP4 and video-decoding assumptions were not carried forward.
