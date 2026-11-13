# MadLadPad release runbook

## Current production app

The current static app is served from Cloudflare Pages at <https://madladpad.pages.dev>. The verified production deployment is `9cba1b04-2231-4414-afa0-78149ade6661`, source commit `6f4687f6c53420be891d31c70505bb0c12cca641` on `main`. It is a static Pages release with no Functions source or runtime binding in this repository. See [Issue #2](https://github.com/markleonfreese/madladpad/issues/2) and the [device acceptance checklist](docs/DEVICE-ACCEPTANCE.md) for hosted evidence and remaining human/device gates.

The Pages app and the older Workers app are separate releases. <https://madladpad.markleonfreese.workers.dev/> still serves an older bundled release; it is not updated by the current Pages publish. Do not use it to accept current `main` or deploy to it as a way to fix the Pages app. The cause of an earlier 503 report on that URL was not established; a later read-only check returned 200 for its legacy shell and `/app.js`.

## Cost and account boundary

- The current Pages release contains static assets and no Pages Functions, database, AI service or paid add-on. Cloudflare documents that Workers Static Asset requests are free and unlimited, and asset storage has no additional cost ([static asset billing](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/)). This describes the static assets only; it does not verify the account's other products or total bill.
- Keep all work within the A$5/month project budget. Do not add paid services, enable functions or bindings, or change an account plan. The account-wide billing total is not visible to this repository.
- No Cloudflare configuration change is required for a code or documentation change. Treat publishing a new production release as a distinct action; verify the exact artifact and budget before publishing.

## Verify a Pages release

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

The previous known-good production target is deployment `8996bdb8-855e-476c-928f-048db46074c8`, branch `main`, source `f44e50aeb5d814f24556a7b1285c85fe14bd361d`. Check the deployment ID, production environment, and source SHA in the dashboard before selecting it. Do not roll back to the legacy Workers release.

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
