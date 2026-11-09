# Browser smoke

This local Chromium smoke suite depends on the demo and pack fixes in PR #3. It uses a disposable browser context, synthetic audio, an ephemeral local HTTP server, and blocks off-origin requests. It does not touch the live service or real media.

From the repository root with Node and npm installed, install the locked dependencies and the Playwright Chromium build once:

```sh
npm ci --ignore-scripts
npx playwright install chromium
npm run test:browser
```

The browser executable can also be supplied when it is already installed locally:

```sh
MADLADPAD_CHROMIUM_PATH="/path/to/chrome-or-chromium" npm run test:browser
```

The suite checks initial load with axe-core 4.12.1, 12/4/16 pad layouts, demo and keyboard playback, sequencer start/stop, three-lane editing and isolation in the all-tracks grid, mute/solo controls, live pattern capture with overdub preservation and undo, named scene save/clear/load/reload, local WAV import, IndexedDB reload, pack export/import including patterns in separate lanes, audiovisual `MediaRecorder` set capture and generated WebM playback, audio-only mix export, and service-worker offline reopen. Its fake camera capture verifies the acquired audio/video tracks are stopped after keep/cancel and preserves the existing sample on canceled capture. It checks that active synthetic capture reports detected sound and that forced-silent metering leaves the full take selected with clear manual-trim guidance. The local region flow selects, previews and applies a later media interval, exercises suggestions and persists the selected sample. It records generated 440 Hz audio through the app and checks neutral/Pitch +4 exports at Speed 1×/2×; it also checks the video-element Pitch route. The 320px and 390px viewports audit all five studio stages with axe-core and check Beat Grid overflow/touch dimensions. Its temporary server redirects `/index.html` to `/` to match Workers Static Assets and catch offline fallback errors. On the last recorded run the initial axe audit passed 40 rules with zero violations, and each stage passed its viewport audit. It passed locally with Playwright 1.64.1 and managed Chrome for Testing 156.0.8078.4. This is synthetic desktop Chromium evidence. It does not establish physical camera/microphone permissions, arbitrary device codecs, real IndexedDB quota behavior, physical touch/rotation, Android Chrome, or iOS Safari. Run `npm test` separately for the Node regression suite.

The public repository's `.github/workflows/verify.yml` runs the locked Node suite and this browser smoke suite on pull requests to `main` and pushes to `main`. It uses standard `ubuntu-24.04` runners; GitHub documents standard hosted runners as free for public repositories. It uses no secrets, deployment steps or stored artifacts.

The test initially used `127.0.0.1`; the app only registers its service worker for HTTPS or the `localhost` hostname. It now binds the ephemeral server on loopback and navigates through `localhost`, exercising the installable/offline path without changing application trust rules.

## Deployment preparation (no deploy)

The existing `wrangler.jsonc` selects `site/` for Workers Static Assets. From a clean checkout install the repository's dev dependencies, then run:

```sh
CI=1 WRANGLER_SEND_METRICS=false npx wrangler deploy --dry-run
```

Wrangler 4.157.0 read 27 files from `site/`, found no bindings and exited successfully without deploying. The checked-in `npm run test:workers-runtime` also passed locally: it started Wrangler with this config and verified `/`, the `/index.html` redirect, app/service-worker/inference assets including WASM, and SPA navigation fallback. These are local packaging/runtime checks, not proof that the configured production Worker matches this output. No Cloudflare deployment or production resource change occurred. Before any separately budget-approved production release, verify account cost, preserve a known-good release and check deployed assets, headers, PWA/service-worker behavior, imports and rollback.

Reference: https://developers.cloudflare.com/workers/wrangler/commands/workers/ (the `--dry-run` option compiles without deploying).
