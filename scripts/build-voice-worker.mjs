import { build } from 'esbuild';
import { copyFile, mkdir } from 'node:fs/promises';

await mkdir(new URL('../site/', import.meta.url), { recursive: true });
await build({
  entryPoints: [new URL('../site/voice-inference-worker.js', import.meta.url).pathname],
  outfile: new URL('../site/voice-inference-worker.bundle.js', import.meta.url).pathname,
  bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true,
  sourcemap: false, legalComments: 'none'
});
await copyFile(
  new URL('../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm', import.meta.url),
  new URL('../site/ort-wasm-simd-threaded.wasm', import.meta.url)
);
