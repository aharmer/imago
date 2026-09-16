// Copies the ONNX Runtime WebAssembly files into public/ort so imago serves them
// itself instead of fetching them from a CDN at runtime (works offline, no third party).
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// Resolve onnxruntime-web from Transformers.js so we copy the exact version it was built against.
const transformersRequire = createRequire(join(root, 'node_modules', '@huggingface', 'transformers', 'package.json'));
// (onnxruntime-web's "exports" hide package.json, so search the lookup paths directly.)
const ortPackage = transformersRequire.resolve
  .paths('onnxruntime-web')
  .map((dir) => join(dir, 'onnxruntime-web'))
  .find((dir) => existsSync(join(dir, 'package.json')));
if (!ortPackage) throw new Error('onnxruntime-web not found. Run npm install first.');
const ortDist = join(ortPackage, 'dist');
const dest = join(root, 'public', 'ort');

mkdirSync(dest, { recursive: true });
for (const variant of ['ort-wasm-simd-threaded', 'ort-wasm-simd-threaded.asyncify']) {
  for (const ext of ['.mjs', '.wasm']) {
    copyFileSync(join(ortDist, variant + ext), join(dest, variant + ext));
  }
}
console.log(`Copied ONNX Runtime WASM files to ${dest}`);
