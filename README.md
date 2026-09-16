# imago

**Free, browser-based image annotation with one-click segmentation, for training deep learning models.**

imago runs entirely in your browser: open a folder of images, click an object to segment it, assign a class, and export annotations in common training formats (COCO, YOLO, Pascal VOC). Images never leave your computer, and there is nothing to install.

> **Status:** early development. The annotation app is not built yet. What exists today is the **segmentation benchmark** (phase 0), used to choose which segmentation model imago ships with.

## Roadmap

| Phase | Scope |
|---|---|
| **0. Model benchmark** ← *now* | Measure candidate SAM models on CPU and GPU across the team's machines |
| 1. Core | Open a folder, image list, zoom/pan, manual boxes and polygons, classes, autosave, per-image status and resume |
| 2. One-click segmentation | SAM in a background worker, include/exclude points, background pre-encoding, segment-the-visible-area when zoomed |
| 3. Export and import | COCO, YOLO (detect and seg), Pascal VOC, CSV; import COCO/YOLO |
| 4. Polish | Undo/redo, shortcuts, dark mode, offline support, public release |

## Segmentation benchmark

The benchmark page times one-click segmentation models in your browser on your hardware:

- **Encode:** the heavy step, run once per image.
- **Click:** the time from a click to a mask, run on every click.

Please run it on the computers you'd annotate on, then send the copied results back.

1. Open the benchmark in **Chrome or Microsoft Edge** (URL to follow once deployed; or run it locally, see below).
2. Give the machine a name, and optionally choose one of your own typical images.
3. Click **Run benchmark**. The first run downloads the models (a few hundred MB in total), and later runs use the browser's cache.
4. Click **Copy results** and paste them into an email, Teams message or GitHub issue.

**Candidate models:** [SlimSAM-77](https://huggingface.co/Xenova/slimsam-77-uniform), [SAM 2.1 tiny/small](https://huggingface.co/onnx-community/sam2.1-hiera-tiny-ONNX) and the [SAM 3 tracker](https://huggingface.co/onnx-community/sam3-tracker-ONNX). They run via [Transformers.js](https://github.com/huggingface/transformers.js) and ONNX Runtime Web: on the CPU (WebAssembly) or on the GPU (WebGPU, including integrated graphics). On GPU runs, only the image encoder uses the GPU; the small mask decoder always runs on the CPU.

## Development

Requires [Node.js](https://nodejs.org/) 24 LTS or newer.

```bash
npm install
npm run dev          # http://localhost:5173 (benchmark at /bench/)
npm run build        # production build in dist/
npm run typecheck
```

Multi-threaded CPU inference needs the page to be *cross-origin isolated*. The dev server and `vercel.json` both send the required `Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy` headers. ONNX Runtime's WebAssembly files are copied into `public/ort/` by `scripts/copy-ort.mjs` and served from imago's own origin rather than a CDN.

**Tech stack:** Vite, React, TypeScript, Transformers.js / ONNX Runtime Web. Deployed as a static site.

> **Working inside Dropbox/OneDrive?** Exclude `node_modules` and `dist` from syncing. On Windows with Dropbox, run this in PowerShell from the repo folder (create the folders first if needed):
> `Set-Content -Path node_modules -Stream com.dropbox.ignored -Value 1`

## Licence

[MIT](LICENSE). The segmentation models have their own licences (SlimSAM and SAM 2.1: Apache 2.0; SAM 3: see Meta's SAM 3 model card). Check them before redistributing model weights.
