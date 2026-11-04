# Browser smoke (experimental)

This script is an **unverified draft**, not a passing CI gate. It depends on the demo and pack fixes in PR #3. It uses a disposable Chromium profile, synthetic silent WAV, an ephemeral local HTTP server, and blocks off-origin requests. It does not touch the live service or real media.

From the repository root with Node and npm installed:

```sh
npm install --no-save playwright@1.64.1
npx playwright install chromium
node tests/browser-smoke.mjs
```

The intended checks are layout changes, demo triggering without page errors, sequencer start/stop, local WAV import, IndexedDB reload, and pack export/import. This has only passed `node --check`; execution stopped before launch because Chromium was unavailable and its download returned an invalid archive in the development environment. Selectors, timing, codec support, and the complete flow need validation on a working browser before introducing CI. Video, recordings, actual quota errors, service-worker offline behaviour, mobile touch and iOS Safari are not covered.

## Deployment preparation (no deploy)

The existing `wrangler.jsonc` selects `site/` for Workers Static Assets. From a clean checkout install the repository's dev dependencies, then run:

```sh
CI=1 WRANGLER_SEND_METRICS=false npx wrangler deploy --dry-run
```

Wrangler 4.157.0 read 14 assets and exited successfully in this environment. A local `wrangler dev --local --port 8788` attempt failed here with `uv_interface_addresses` system error; local runtime and response equivalence remain unverified. A dry run is not a deployment, a staging check, or proof that native static assets match the currently deployed bundled Worker. No CI deployment, Cloudflare resources, credentials or permissions are configured here. Before any separately approved deployment, verify target account, preserve a known-good release and test static assets, headers, PWA/service worker behaviour, imports and rollback on an appropriate staging setup.

Reference: https://developers.cloudflare.com/workers/wrangler/commands/workers/ (the `--dry-run` option compiles without deploying).
