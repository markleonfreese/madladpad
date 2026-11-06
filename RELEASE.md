# MadLadPad release runbook

The production Worker is `madladpad` at <https://madladpad.markleonfreese.workers.dev/>. The repo deploys `site/` through Workers Static Assets using [`wrangler.jsonc`](wrangler.jsonc); this is different from the older bundled Worker currently serving production. A successful local test or dry run does not prove the deployed asset version is live.

## Cost and account boundary

- `wrangler.jsonc` pins the Worker to the account that owns this hostname, so a multi-account CLI login cannot silently select another account.
- This project defines no Worker code entry point, bindings, database, AI service, or paid add-on. Cloudflare documents that Workers Static Asset requests are free and unlimited and asset storage has no additional cost ([static asset billing](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/)). This is the expected marginal cost of this static-only release, not evidence of the account's other subscriptions or total bill.
- Do not enable caching, functions, bindings, or another paid service as part of this release. Cloudflare's Workers Paid plan has a US$5/month minimum ([Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)), which can exceed the A$5 project budget. Account-wide spend is not visible to this repo; verify it in the owner's billing view before changing account plans or adding billable services.

## Preflight

Run from a clean checkout of the exact `main` commit to publish:

```sh
npm ci
npm run build
npm test
npx playwright install chromium
npm run test:browser
npm run test:workers-runtime
npm run deploy -- --dry-run
git diff --check
```

The browser suite uses synthetic Chromium media. The Workers runtime smoke checks the repo's static-asset config locally, but may not reproduce Cloudflare's production edge. The Wrangler dry run checks packaging only; it neither uploads nor stages the assets.

Before a real publish, confirm the credential, account pin and Worker name:

```sh
npx wrangler whoami
npx wrangler deployments status --name madladpad
```

The authenticated CLI must show `workers:write` and the target account ID in `wrangler.jsonc`. If the scope is absent, refresh Wrangler's OAuth authorization through `npx wrangler login`; do not copy tokens into files, environment dumps, or chat.

## Publish and verify

`npm run deploy` runs the canonical `build` script before `wrangler deploy`. Wrangler's default deploy publishes a new version to 100% of production traffic, so run it only after the exact `main` commit and its checks are accepted. Until Workers Builds is verified, there is no configured staging Worker or preview hostname. When connecting Workers Builds, use `npm run build` for both main and previews, `npx wrangler versions upload` for the production-branch deploy command (uploads without promotion), and `npx wrangler preview` for other branches. Promote only an explicitly accepted version.

After publishing:

1. Run `npx wrangler deployments status --name madladpad` and save the new deployment/version ID alongside the Git SHA.
2. Request the production root, `/index.html`, `/voice-inference-worker.js`, `/sw.js` and a valid nested route. Confirm HTTP success, app shell/model assets, SPA fallback, expected behavior and no unexpected redirects.
3. Compare the production deployment's version ID to the CLI report. The old bundled Worker includes an `X-MadLadPad-Release` header; the native static-asset config does not define that header, so absence of the old header alone does not mean the publish failed.
4. Check the live app on Android Chrome and iOS Safari, especially camera/microphone permission, capture, audio/video codecs, touch, offline reload, transcription model load and export. Browser automation is not device acceptance.

## Roll back

Use the Cloudflare dashboard's Workers & Pages → `madladpad` → Deployments, or the documented Wrangler rollback command. First inspect the deployment list and identify the known-good version; rollback immediately redirects production traffic and should not use an unverified version. For the previously verified bundled release, the known-good version was `14b2394b-7532-4601-ae46-48bce711bc4d` (verify it is still available before use):

```sh
npx wrangler rollback 14b2394b-7532-4601-ae46-48bce711bc4d --name madladpad
```

Verify the new rollback deployment and live HTTP response afterward. See Cloudflare's [rollback documentation](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/) for the behavior and limits.
