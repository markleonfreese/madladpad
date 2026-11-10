#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { pagesReleaseGuardError } from './pages-release-guard.mjs';

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function fail(message) {
  console.error(`Pages release stopped: ${message}`);
  process.exit(1);
}

let branch, sha, commitMessage, upstreamSha, dirty;
try {
  branch = git('branch', '--show-current');
  sha = git('rev-parse', 'HEAD');
  commitMessage = git('log', '-1', '--format=%s');
  upstreamSha = git('rev-parse', '--verify', 'origin/main');
  dirty = git('status', '--porcelain');
} catch (error) {
  fail(`Git preflight failed: ${error.message}`);
}

const guardError = pagesReleaseGuardError({ branch, sha, upstreamSha, dirty });
if (guardError) fail(guardError);

const build = spawnSync('npm', ['run', 'build'], { stdio: 'inherit' });
if (build.status !== 0) process.exit(build.status ?? 1);

console.log(`Publishing Pages project madladpad from main ${sha}`);
const deploy = spawnSync('node_modules/.bin/wrangler', [
  'pages', 'deploy', 'site',
  '--project-name', 'madladpad',
  '--branch', 'main',
  '--commit-hash', sha,
  '--commit-message', commitMessage,
], { stdio: 'inherit' });
process.exit(deploy.status ?? 1);
