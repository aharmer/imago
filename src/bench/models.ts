import type { ModelConfig } from './protocol';

// Download sizes are the encoder + decoder ONNX files for each precision, from the Hugging Face repos.
//
// The image encoder is the heavy part (once per image); the mask decoder is tiny (once per click).
// GPU configs run only the encoder on WebGPU and keep the decoder on the CPU: it is already fast
// there, avoids a GPU round trip per click, and sidesteps fp16 shader bugs on some integrated GPUs.
export const MODELS: ModelConfig[] = [
  // CPU (WebAssembly): what every machine can run.
  { key: 'slimsam-q8-cpu', family: 'SlimSAM-77', repo: 'Xenova/slimsam-77-uniform', device: 'wasm', dtype: 'q8', decoderDtype: 'q8', downloadMB: 13, defaultOn: true },
  { key: 'slimsam-fp32-cpu', family: 'SlimSAM-77', repo: 'Xenova/slimsam-77-uniform', device: 'wasm', dtype: 'fp32', decoderDtype: 'fp32', downloadMB: 38, defaultOn: false },
  { key: 'sam21t-q8-cpu', family: 'SAM 2.1 tiny', repo: 'onnx-community/sam2.1-hiera-tiny-ONNX', device: 'wasm', dtype: 'q8', decoderDtype: 'q8', downloadMB: 59, defaultOn: true },
  { key: 'sam21t-fp32-cpu', family: 'SAM 2.1 tiny', repo: 'onnx-community/sam2.1-hiera-tiny-ONNX', device: 'wasm', dtype: 'fp32', decoderDtype: 'fp32', downloadMB: 149, defaultOn: true },
  { key: 'sam21s-q8-cpu', family: 'SAM 2.1 small', repo: 'onnx-community/sam2.1-hiera-small-ONNX', device: 'wasm', dtype: 'q8', decoderDtype: 'q8', downloadMB: 67, defaultOn: false },

  // GPU (WebGPU): discrete or integrated graphics.
  { key: 'slimsam-fp32-gpu', family: 'SlimSAM-77', repo: 'Xenova/slimsam-77-uniform', device: 'webgpu', dtype: 'fp32', decoderDtype: 'fp32', downloadMB: 38, defaultOn: true },
  { key: 'sam21t-fp16-gpu', family: 'SAM 2.1 tiny', repo: 'onnx-community/sam2.1-hiera-tiny-ONNX', device: 'webgpu', dtype: 'fp16', decoderDtype: 'fp32', downloadMB: 85, defaultOn: true, needsF16: true },
  { key: 'sam21t-fp32-gpu', family: 'SAM 2.1 tiny', repo: 'onnx-community/sam2.1-hiera-tiny-ONNX', device: 'webgpu', dtype: 'fp32', decoderDtype: 'fp32', downloadMB: 149, defaultOn: false },
  { key: 'sam21s-fp16-gpu', family: 'SAM 2.1 small', repo: 'onnx-community/sam2.1-hiera-small-ONNX', device: 'webgpu', dtype: 'fp16', decoderDtype: 'fp32', downloadMB: 99, defaultOn: true, needsF16: true },
  {
    key: 'sam3-q4f16-gpu',
    family: 'SAM 3 tracker',
    repo: 'onnx-community/sam3-tracker-ONNX',
    device: 'webgpu',
    dtype: 'q4f16',
    decoderDtype: 'fp32',
    downloadMB: 306,
    defaultOn: false,
    needsF16: true,
    note: 'Large download; best quality, likely slow without a dedicated GPU.',
  },
];

export const deviceLabel = (m: ModelConfig) => (m.device === 'wasm' ? 'CPU' : 'GPU');
