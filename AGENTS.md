# Agent instructions — MadLadPad

## Project and scope
MadLadPad is a local-first audiovisual sampler, song arranger and recording PWA. Read `README.md`, `package.json`, and the issue/PR you were assigned before making changes. The target GitHub issue is the authoritative executable work packet; do not expand its scope or treat unverified issue notes as current implementation truth.

Shared coordination and decisions are kept separately in `markleonfreese/Agent-Vault` (project: `madladpad`). You may not have access to that private repository: do not request credentials, infer its contents, or block a self-contained task solely because it is inaccessible. Ask for specific missing decisions in the issue/PR.

## Implementation principles
- Preserve the existing local-first design. Audio, video, transcripts and project media remain on the user's device unless the user explicitly exports or imports them. Do not introduce new telemetry, accounts, external processing or cloud storage without separate approval.
- Prefer the smallest maintainable change. Follow existing browser, Web Audio, IndexedDB, PWA, accessibility and test patterns; do not add frameworks, backend services or dependencies without a reason documented in the PR.
- Preserve project packs, persisted data and existing user-facing behaviour unless the issue explicitly authorises a migration or change.
- Treat physical phone/browser behaviour, real microphone and camera timing, human listening, screen-reader acceptance and cloud billing as separate acceptance gates. Synthetic browser tests do not prove those outcomes.
- Never commit credentials or personal data. Do not run paid experiments or introduce material IAM/security/billing changes.
- Do not merge PRs, deploy to Cloudflare Pages/Workers or alter production configuration. Do not use `npm run deploy`, `npm run deploy:pages`, or `wrangler deploy` without separate explicit authorisation. Prefer draft PRs for review.

## Validation
- Inspect `package.json` for authoritative commands. Install using the lockfile (`npm ci`) where available.
- For code changes, run relevant tests, including `npm test` and applicable browser/WebKit/Workers smoke tests: `npm run test:browser`, `npm run test:song-browser`, `npm run test:webkit`, `npm run test:workers-runtime`. Report commands run, exact results and skipped checks; do not claim unexecuted tests passed.
- Longer or opt-in tasks such as `npm run test:song-long-recording` and `npm run test:speech-model` should be selected only when relevant, available and within the agreed execution budget.
- GitHub Actions checks, especially workflows requiring manual approval, are evidence only when they actually run on the exact PR head. A runner failure before steps execute is not a failed app test and not a successful validation.

## Handover
Submit changes in a focused, reviewable PR. In its description provide: issue reference; files changed; what is implemented vs only proposed; exact tests/CI evidence; outstanding device, accessibility, security and release risks; and the next action. An agent's report and PR creation are not sufficient evidence of completion.
