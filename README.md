# imagoLabel

**Free, browser-based image annotation with one-click segmentation, for training deep learning models.**

🌐 **https://imago-label.vercel.app**

imagoLabel runs entirely in your browser: open a folder of images, click an object to segment it, assign a class, and export annotations in common training formats (COCO, YOLO, Pascal VOC). Images never leave your computer, and there is nothing to install.

> **Status:** usable. Open a folder, click objects to outline them automatically (or draw boxes and polygons by hand), and export for training. Polish (phase 4) is next.

## Roadmap

| Phase | Scope |
|---|---|
| 0. Model benchmark ✓ | Measure candidate SAM models on CPU and GPU across the team's machines |
| 1. Core ✓ | Open a folder, image list, zoom/pan, manual boxes and polygons, classes, autosave, per-image status and resume |
| 2. One-click segmentation ✓ | SAM in a background worker, include/exclude points, background pre-encoding, segment-the-visible-area when zoomed |
| **3. Export and import** ✓ | COCO, YOLO (detect and seg), Pascal VOC, CSV; import COCO/YOLO |
| 4. Polish | Undo/redo, shortcuts, dark mode, offline support, public release |

## Using imagoLabel

1. Open **https://imago-label.vercel.app** in Chrome, Edge or Brave (Brave needs a one-time setting; the app shows how).
2. Click **Open image folder…** and choose a folder of JPEG, PNG or WebP images.
3. Add your classes on the right, pick the **Segment** tool (S) and click an object. The first time, the segmentation model (about 100 MB) downloads and is then cached by the browser.

Annotations save automatically into a hidden `.imagoLabel` folder inside the image folder, so you can close the tab and carry on later; imagoLabel reopens at the image you were on. If the folder is open somewhere else (another tab, or a colleague on a shared drive), imagoLabel warns you before opening it.

| Key | Action |
|---|---|
| S / V / B / P | Segment, Select, Box, Polygon tool |
| 1–9 | Use that class (and apply it to the selected shape) |
| Enter | Mark image done and go to the next (or finish a polygon) |
| ← / → | Previous / next image |
| Delete | Delete the selected shape |
| Ctrl+Z / Ctrl+Shift+Z | Undo / redo |
| Scroll · Space+drag | Zoom · pan (with Select, drag empty space to pan) |
| F | Fit image to window |
| Alt+click a polygon point | Remove that point |

**Segmenting:** click an object and imagoLabel outlines it; drag a box instead for thin or awkward objects. To fix an outline, **click a part it missed** (a leg, an antenna) to add it, or **right-click** an area to remove it; **Backspace** undoes your last click. Clicking well away from the outline keeps it and starts the next object, so most objects are a single click. **Enter** keeps the outline without starting another, and **Esc** discards it. Zoom in on small objects before clicking: imagoLabel then segments just the visible area, which gives much sharper outlines.

Segmentation uses [SAM 2.1 small](https://huggingface.co/onnx-community/sam2.1-hiera-small-ONNX), running on your graphics card when it can and on the CPU otherwise. Upcoming images are prepared in the background so clicks are near-instant.

**Brave users:** Brave turns off the folder access imagoLabel relies on. Open `brave://flags/#file-system-access-api`, set it to **Enabled**, and relaunch.

## Exporting for training

**Export…** in the right-hand panel writes a dataset into a folder you choose:

| Format | What you get |
|---|---|
| **YOLO — boxes** (Ultralytics detect) | `labels/train/*.txt` with one box per line, plus `data.yaml` |
| **YOLO — polygons** (Ultralytics segment) | The same, with a polygon per line |
| **COCO JSON** | One `annotations.json` with boxes and polygons |
| **Pascal VOC XML** | One `.xml` per image, boxes only |
| **CSV** | One row per annotation, with the polygon when there is one |

Options: copy the images alongside the labels (so the export is ready to train on), hold back a validation split (the same image always lands in the same set, so re-exporting later doesn't shuffle images between training and validation), and choose whether to export every annotated image or only those marked done. Skipped images and annotations without a class are left out.

For YOLO the generated `data.yaml` deliberately omits `path`, so Ultralytics resolves `train:`/`val:` relative to the file itself:

```bash
yolo detect train data=data.yaml model=yolo11n.pt epochs=100 imgsz=640
```

**Import…** reads annotations made elsewhere — a COCO JSON file, or a folder of YOLO label files (with `data.yaml` or `classes.txt` for the class names). Annotations are matched to images by file name, existing classes are reused, and you choose whether images that already have annotations are replaced.

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

Multi-threaded CPU inference needs the page to be *cross-origin isolated*. The dev server and `vercel.json` both send the required `Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy` headers. ONNX Runtime's WebAssembly files are copied into `public/ort/` by `scripts/copy-ort.mjs` and served from imagoLabel's own origin rather than a CDN.

**Tech stack:** Vite, React, TypeScript, Transformers.js / ONNX Runtime Web. Deployed as a static site.

> **Working inside Dropbox/OneDrive?** Exclude `node_modules` and `dist` from syncing. On Windows with Dropbox, run this in PowerShell from the repo folder (create the folders first if needed):
> `Set-Content -Path node_modules -Stream com.dropbox.ignored -Value 1`

## Licence

[MIT](LICENSE). The segmentation models have their own licences (SlimSAM and SAM 2.1: Apache 2.0; SAM 3: see Meta's SAM 3 model card). Check them before redistributing model weights.
