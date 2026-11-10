export function pagesReleaseGuardError({ branch, sha, upstreamSha, dirty }) {
  if (branch !== 'main') return `expected branch main, found ${branch || '(detached HEAD)'}`;
  if (dirty) return 'the checkout has uncommitted or untracked files';
  if (!sha || !upstreamSha || sha !== upstreamSha) {
    return `HEAD ${sha || '(unknown)'} does not match origin/main ${upstreamSha || '(unknown)'}; fetch and fast-forward first`;
  }
  return null;
}
