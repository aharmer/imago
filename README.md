# imago

**Free, browser-based image annotation with one-click segmentation, for training deep learning models.**

🌐 **https://imago-label.vercel.app**

imago runs entirely in your browser: open a folder of images, click an object to segment it, assign a class, and export annotations in common training formats (COCO, YOLO, Pascal VOC). Images never leave your computer, and there is nothing to install.

> **Status:** early development. You can open a folder, draw and edit boxes and polygons, manage classes, and your work saves automatically. One-click segmentation (phase 2) and export (phase 3) are next.

## Roadmap

| Phase | Scope |
|---|---|
| 0. Model benchmark ✓ | Measure candidate SAM models on CPU and GPU across the team's machines |
| **1. Core** ✓ | Open a folder, image list, zoom/pan, manual boxes and polygons, classes, autosave, per-image status and resume |
| 2. One-click segmentation | SAM in a background worker, include/exclude points, background pre-encoding, segment-the-visible-area when zoomed |
| 3. Export and import | COCO, YOLO (detect and seg), Pascal VOC, CSV; import COCO/YOLO |
| 4. Polish | Undo/redo, shortcuts, dark mode, offline support, public release |

## Using imago

1. Open **https://imago-label.vercel.app** in Chrome, Edge or Brave (Brave needs a one-time setting; the app shows how).
2. Click **Open image folder…** and choose a folder of JPEG, PNG or WebP images.
3. Add your classes on the right, then draw.

Annotations save automatically into a hidden `.imago` folder inside the image folder, so you can close the tab and carry on later; imago reopens at the image you were on. If the folder is open somewhere else (another tab, or a colleague on a shared drive), imago warns you before opening it.

| Key | Action |
|---|---|
| V / B / P | Select, Box, Polygon tool |
| 1–9 | Use that class (and apply it to the selected shape) |
| Enter | Mark image done and go to the next (or finish a polygon) |
| ← / → | Previous / next image |
| Delete | Delete the selected shape |
| Ctrl+Z / Ctrl+Shift+Z | Undo / redo |
| Scroll · Space+drag | Zoom · pan (with Select, drag empty space to pan) |
| F | Fit image to window |
| Alt+click a polygon point | Remove that point |

**Brave users:** Brave turns off the folder access imago relies on. Open `brave://flags/#file-system-access-api`, set it to **Enabled**, and relaunch.

## Segmentation benchmark

The benchmark page times one-click segmentation models in your browser on your hardware:

- **Encode:** the heavy step, run once per image.
- **Click:** the time from a click to a mask, run on every click.

Please run it on the computers you'd annotate on, then send the copied results back.

1. Open **https://imago-label.vercel.app/bench/** in **Chrome or Microsoft Edge**.
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
