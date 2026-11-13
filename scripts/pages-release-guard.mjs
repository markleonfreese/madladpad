export function pagesReleaseGuardError({ branch, sha, upstreamSha, dirty }) {
  if (branch !== 'main') return `expected branch main, found ${branch || '(detached HEAD)'}`;
  if (dirty) return 'the checkout has uncommitted or untracked files';
  if (!sha || !upstreamSha || sha !== upstreamSha) {
    return `HEAD ${sha || '(unknown)'} does not match origin/main ${upstreamSha || '(unknown)'}; fetch and fast-forward first`;
  }
  return null;
}

export function pagesDeployEnvironment(baseEnvironment, accountId) {
  if (!/^[a-f\d]{32}$/i.test(accountId || '')) throw new Error('wrangler.jsonc must contain one valid 32-character account_id');
  return { ...baseEnvironment, CLOUDFLARE_ACCOUNT_ID: accountId };
}
