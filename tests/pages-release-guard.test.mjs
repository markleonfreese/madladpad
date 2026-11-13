import test from 'node:test';
import assert from 'node:assert/strict';
import { pagesDeployEnvironment, pagesReleaseGuardError } from '../scripts/pages-release-guard.mjs';

test('Pages release guard requires main, a clean tree, and the current origin/main commit', () => {
  assert.equal(pagesReleaseGuardError({ branch: 'feature/demo', sha: 'a', upstreamSha: 'a', dirty: '' }), 'expected branch main, found feature/demo');
  assert.equal(pagesReleaseGuardError({ branch: 'main', sha: 'a', upstreamSha: 'a', dirty: ' M site/app.js' }), 'the checkout has uncommitted or untracked files');
  assert.equal(pagesReleaseGuardError({ branch: 'main', sha: 'a', upstreamSha: 'b', dirty: '' }), 'HEAD a does not match origin/main b; fetch and fast-forward first');
  assert.equal(pagesReleaseGuardError({ branch: 'main', sha: 'a', upstreamSha: 'a', dirty: '' }), null);
});

test('Pages deploy selects only the account pinned by Wrangler config', () => {
  const environment = pagesDeployEnvironment({ KEEP_ME: 'yes', CLOUDFLARE_ACCOUNT_ID: 'wrong' }, 'aa47e1616d2696f07fc0565d19ed96a8');
  assert.deepEqual(environment, { KEEP_ME: 'yes', CLOUDFLARE_ACCOUNT_ID: 'aa47e1616d2696f07fc0565d19ed96a8' });
  assert.throws(() => pagesDeployEnvironment({}, 'ambiguous'), /valid 32-character account_id/);
});
