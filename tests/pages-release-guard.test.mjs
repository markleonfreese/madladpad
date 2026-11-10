import test from 'node:test';
import assert from 'node:assert/strict';
import { pagesReleaseGuardError } from '../scripts/pages-release-guard.mjs';

test('Pages release guard requires main, a clean tree, and the current origin/main commit', () => {
  assert.equal(pagesReleaseGuardError({ branch: 'feature/demo', sha: 'a', upstreamSha: 'a', dirty: '' }), 'expected branch main, found feature/demo');
  assert.equal(pagesReleaseGuardError({ branch: 'main', sha: 'a', upstreamSha: 'a', dirty: ' M site/app.js' }), 'the checkout has uncommitted or untracked files');
  assert.equal(pagesReleaseGuardError({ branch: 'main', sha: 'a', upstreamSha: 'b', dirty: '' }), 'HEAD a does not match origin/main b; fetch and fast-forward first');
  assert.equal(pagesReleaseGuardError({ branch: 'main', sha: 'a', upstreamSha: 'a', dirty: '' }), null);
});
