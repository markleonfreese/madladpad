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

The suite checks initial load with axe-core 4.12.1, 12/4/16 pad layouts, demo and keyboard playback, sequencer start/stop, local WAV import, IndexedDB reload, pack export/import, MediaRecorder set capture and importing/playing the generated WebM as a local sample, service-worker offline reopen, and 390px horizontal overflow. It passed locally with Playwright 1.64.1 and managed Chrome for Testing 152.0.7977.82. This is desktop headless Chromium evidence. It does not establish camera/microphone permissions, arbitrary video codec coverage, real IndexedDB quota failures, physical touch behaviour, or iOS Safari. Run `npm test` separately for the Node regression suite.

The test initially used `127.0.0.1`; the app only registers its service worker for HTTPS or the `localhost` hostname. It now binds the ephemeral server on loopback and navigates through `localhost`, exercising the installable/offline path without changing application trust rules.

## Deployment preparation (no deploy)

The existing `wrangler.jsonc` selects `site/` for Workers Static Assets. From a clean checkout install the repository's dev dependencies, then run:

```sh
CI=1 WRANGLER_SEND_METRICS=false npx wrangler deploy --dry-run
```

Wrangler 4.157.0 read 14 assets and exited successfully in this environment. A local `wrangler dev --local --port 8788` attempt failed here with `uv_interface_addresses` system error; local runtime and response equivalence remain unverified. A dry run is not a deployment, a staging check, or proof that native static assets match the currently deployed bundled Worker. No CI deployment, Cloudflare resources, credentials or permissions are configured here. Before any separately approved deployment, verify target account, preserve a known-good release and test static assets, headers, PWA/service worker behaviour, imports and rollback on an appropriate staging setup.

Reference: https://developers.cloudflare.com/workers/wrangler/commands/workers/ (the `--dry-run` option compiles without deploying).
