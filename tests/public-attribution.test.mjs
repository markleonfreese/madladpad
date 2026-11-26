import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../site/index.html', import.meta.url), 'utf8');
const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');

test('public app footer links to the author, source, and feedback', () => {
  const footer = html.match(/<footer>([\s\S]*?)<\/footer>/)?.[1] ?? '';
  assert.match(footer, /aria-label="Project links"/);
  assert.match(footer, /href="https:\/\/markfreese\.com"[^>]*>Mark Freese<\/a>/);
  assert.match(footer, /href="https:\/\/github\.com\/markleonfreese\/madladpad"[^>]*>Source<\/a>/);
  assert.match(footer, /href="https:\/\/github\.com\/markleonfreese\/madladpad\/issues\/new"[^>]*>Feedback<\/a>/);
  assert.match(footer, /V0\.1 · LOCAL-FIRST PWA/);
});

test('README gives an accurate maturity label and the same public links', () => {
  assert.match(readme, /\*\*Maturity:\*\* prototype · local-first PWA with a public static demo/);
  assert.match(readme, /Created by \[Mark Freese\]\(https:\/\/markfreese\.com\)/);
  assert.match(readme, /\[live demo\]\(https:\/\/madladpad\.pages\.dev\)/);
  assert.match(readme, /\[source\]\(https:\/\/github\.com\/markleonfreese\/madladpad\)/);
  assert.match(readme, /\[feedback\]\(https:\/\/github\.com\/markleonfreese\/madladpad\/issues\/new\)/);
});
