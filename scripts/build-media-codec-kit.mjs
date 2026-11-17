import { build } from 'esbuild';
import { mkdir, stat } from 'node:fs/promises';

const outfile = new URL('../site/media-codec-kit.bundle.js', import.meta.url).pathname;
await mkdir(new URL('../site/', import.meta.url), { recursive: true });
await build({
  entryPoints: [new URL('./media-codec-kit-entry.js', import.meta.url).pathname],
  outfile,
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  treeShaking: true,
  sourcemap: false,
  legalComments: 'none'
});
const { size } = await stat(outfile);
console.log(`Built local media codec kit: ${size} bytes`);
