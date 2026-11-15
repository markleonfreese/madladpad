# MadLadPad release runbook

## Current production app

The published static app is served at <https://madladpad.pages.dev>. The **current Cloudflare Pages production deployment** is `ffb580d0-9759-4665-a535-faab36f56907`, source commit `7f2069df3344c155653cc615b6b526cf3cb8a6f7` on `main` (PR #231), deployed 15 November 2026. Read-only Pages API confirmed **success**, production environment, branch `main`; the recorded deployment check found **no Pages Functions**. Post-publish verification matched all **39/39 built static assets** (15,442,143 bytes, HTTP 200 and SHA-256 parity) and exercised real deployed browser routes using generated media; details are in [Issue #2](https://github.com/markleonfreese/madladpad/issues/2) and [device acceptance checklist](docs/DEVICE-ACCEPTANCE.md). The assets include the Song arrangement and recording-journal recovery improvements merged before this release. **These automated browser checks do not represent physical Android/iOS or human listening acceptance.**


### Release decision — 15 November 2026

**Decision: retain the already-published release `7f2069d` (no new deployment).** This is a recorded review of an existing production release, **not** an instruction to publish, merge or roll back anything. Read-only GitHub comparison of release `7f2069d` to verified `main` `5650917` shows only `docs/DEVICE-ACCEPTANCE.md` changes (three subsequent documentation commits), so a new application deployment would provide no new functionality. The recovery-code changes in `site/storage.js` and `site/voice.js` were merged **before** `7f2069d` and are already in the published release. Do not accidentally classify them as unreleased work.

**Evidence supporting retention:** [deployment `ffb580d0`](https://ffb580d0.madladpad.pages.dev) is successful; existing 39-file asset parity was recorded; release-source and post-merge GitHub Verify passed; post-deploy synthetic Chromium checked Song microphone recording, recovery-journal cleanup, audio decoding, online/offline speech and exports. This supports retaining the static release. **Do not call MVP/user-device acceptance complete:** real Android/iOS mic/camera, installed PWA, OS interruption, storage pressure, audio/video sync, screen readers and human listening still need operator evidence. The total account bill remains unverified: read-only `GET /accounts/{account_id}/billable-usage` returned **HTTP 403 (Billing Read unavailable)** on 15 November; no billing setting or permission was changed.

**Next release/rollback gate:** keep production unchanged unless a tested functional change is approved, a verified regression requires rollback, or physical-device findings justify a targeted fix. The immediate previous known successful production is `5deedea7-a57c-462d-b389-4c3b4e8b16e7` (source `4f0ba320b74f8914aec352a740c0160afd291f75`). A rollback requires a separate decision after checking the current live deployment and the likely loss of later recording-recovery improvements. Use the [dated device session protocol](docs/DEVICE-ACCEPTANCE-SESSION-2026-11-15.md) to gather the missing real-device evidence.


The Pages app and the older Workers app are separate releases. <https://madladpad.markleonfreese.workers.dev/> still serves an older bundled release; it is not updated by the current Pages publish. Do not use it to accept current `main` or deploy to it as a way to fix the Pages app. The cause of an earlier 503 report on that URL was not established; a later read-only check returned 200 for its legacy shell and `/app.js`.

## Cost and account boundary

- The current Pages release contains static assets and no Pages Functions, database, AI service or paid add-on. Cloudflare documents that Workers Static Asset requests are free and unlimited, and asset storage has no additional cost ([static asset billing](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/)). This describes the static assets only; it does not verify the account's other products or total bill.
- Keep all work within the A$5/month project budget. Do not add paid services, enable functions or bindings, or change an account plan. The account-wide billing total is not visible to this repository.
- No Cloudflare configuration change is required for a code or documentation change. Treat publishing a new production release as a distinct action; verify the exact artifact and budget before publishing.

## Verify a Pages release

This section applies **only to a future explicitly approved deployment**, not to the 15 November release-retention decision. Do not publish docs-only commits merely to align Pages and GitHub SHAs. Compare effective app assets first.

For a new release, record the exact `main` commit and the Pages production deployment ID in [Issue #2](https://github.com/markleonfreese/madladpad/issues/2). Confirm the deployment's source commit and production branch in Cloudflare Pages, and confirm that Pages Functions remain absent unless separately reviewed and approved. Verify the public app URL and its app shell, service worker, Voice Lab assets, ONNX WASM and nested-route behavior. Compare the served artifacts with the built assets for the published commit.

After the exact `main` commit has passed GitHub Verify and is accepted for release, publish it from a clean, up-to-date `main` checkout:

```sh
git fetch origin
git switch main
git merge --ff-only origin/main
npm run deploy:pages
```

The command refuses to publish from another branch, a dirty checkout, or a `main` commit that differs from `origin/main`. It builds the Voice Lab assets, then runs Wrangler Pages Direct Upload for project `madladpad`, branch `main`, with the Git SHA and commit subject attached. It selects the account ID pinned in `wrangler.jsonc`, so a multi-account login cannot choose another account. Wrangler needs Pages write permission for that account. It publishes the Pages app; it does not deploy the legacy Worker. Do not replace it with `npm run deploy`.

After publishing, verify the new production deployment with `npx wrangler pages deployment list --project-name madladpad` and fetch the app URL plus key assets. Record deployment ID and source SHA in Issue #2. Keep Pages Functions absent and do not change domains, DNS or account configuration as part of this release.

## Roll back the Pages app

Cloudflare's [Pages rollback procedure](https://developers.cloudflare.com/pages/configuration/rollbacks/) uses the Pages project's Deployments page. Open `madladpad` → **Deployments** → **All deployments**, identify a successful **Production** deployment, and choose **Rollback to this deployment** from its actions menu. Confirm only when intentionally restoring production; preview deployments are not valid rollback targets.

The immediately previous successful production target (as at 15 November 2026) is deployment `5deedea7-a57c-462d-b389-4c3b4e8b16e7`, branch `main`, source `4f0ba320b74f8914aec352a740c0160afd291f75`. It predates subsequent recording-recovery updates. Check the deployment ID, production environment, and source SHA in the dashboard before selecting it. Do not roll back to the legacy Workers release.

After rollback, refresh the deployment list and verify `https://madladpad.pages.dev` plus `/app.js`, `/sw.js`, `/voice.js`, `/voice-inference-worker.js`, and `/ort-wasm-simd-threaded.wasm`. Record the resulting production deployment ID and source SHA in Issue #2. This procedure was documented only; no rollback was performed.

The repository checks are:

```sh
npm ci
npm test
npx playwright install chromium
npm run test:browser
npm run test:workers-runtime
git diff --check
```

These checks cover repository code and synthetic browser/runtime behavior. They do not prove Cloudflare production deployment, physical Android/iOS behavior, screen-reader operation, listening quality or human acceptance. Use [DEVICE-ACCEPTANCE.md](docs/DEVICE-ACCEPTANCE.md) to record those separately.

## Separate legacy Workers path

[`wrangler.jsonc`](wrangler.jsonc) configures a Workers Static Assets deployment using the same `site/` directory and pins the account that owns the legacy Worker. `npm run deploy` runs `wrangler deploy` and targets that Worker; it does **not** update `madladpad.pages.dev`. Keep this legacy path unchanged unless there is a separately approved decision to replace or retire the Worker. A Wrangler dry run only checks packaging and is not evidence about Pages or a production release.
