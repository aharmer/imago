import { env } from '@huggingface/transformers';

type OnnxEnv = { wasm: { wasmPaths?: unknown; numThreads?: number } };

export const onnxEnv = () => env.backends.onnx as OnnxEnv;

/**
 * Serve ONNX Runtime's WASM from our own origin (copied by scripts/copy-ort.mjs) rather than a CDN,
 * and only ever load models from the Hugging Face Hub. Call once at the top of a worker.
 */
export function configureOnnxRuntime() {
  env.allowLocalModels = false;
  const base = new URL(`${import.meta.env.BASE_URL}ort/`, self.location.origin).href;
  const variant = /^((?!chrome|android).)*safari/i.test(navigator.userAgent) ? 'ort-wasm-simd-threaded' : 'ort-wasm-simd-threaded.asyncify';
  onnxEnv().wasm.wasmPaths = { mjs: `${base}${variant}.mjs`, wasm: `${base}${variant}.wasm` };
}
