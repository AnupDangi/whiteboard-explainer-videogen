# 04 — Packages and Spikes

Rule: no dependency enters the engine until its spike prints its success line on your machine. APIs below are written from memory of each library's documented usage — **the spike is the verification**. If a spike fails, check the package README for the current API before concluding the package is unusable.

---

## 1. Package table

Status legend: ✅ real, name as Gemini said · ⚠️ real, but Gemini named/described it wrong · ❌ not a real package (as far as I know) · ➕ added by this plan

| Need | Package | Status | Notes / license check |
|---|---|---|---|
| Schema validation | `zod` | ➕ | Validate every stage artifact |
| SVG cleanup | `svgo` | ➕ | Normalizer step 1 |
| SVG parse to tree | `svgson` | ➕ | Walk/restyle paths |
| Path length in Node (no DOM) | `svg-path-properties` | ➕ | For stroke-dash reveal timing |
| Rasterize SVG → PNG fast | `@resvg/resvg-js` | ➕ | Replaces spawning `rsvg-convert` per frame |
| Encode | `ffmpeg-static` (or system ffmpeg) | ➕ | Pipe frames via stdin |
| Hand-drawn primitives | `roughjs` | ✅ | Use `rough.generator()` (no DOM). Fixed `seed`. Primitives only |
| Convert whole SVGs to rough | `svg2roughjs` | ✅ but **not recommended** | Needs a DOM (jsdom) in Node; hurts small-icon legibility; test in E7 only |
| Math → SVG (server) | `mathjax-full` (v3) | ➕ replaces Gemini's pick | Output SVG with `fontCache: 'none'`; MathJax 4 ships as `@mathjax/src` — check which you install |
| KaTeX | `katex` | ⚠️ | Renders HTML/MathML, not standalone SVG paths |
| "commander-svg" | — | ❌ | Not a known package; ignore |
| Programmatic video | `remotion` | ✅ | Check license: free for individuals/very small companies, company license beyond that |
| Path draw-on helper | `@remotion/paths` (`evolvePath`, `interpolatePath`, `getLength`) | ⚠️ | Gemini said "@remotion/svg" / "interpolatedPath hook" — wrong names |
| Path morphing | `flubber` | ✅ | Optional, week 3+ |
| Graph layout | `elkjs` | ➕ | Better than dagre for layered flows with labels |
| Graph layout (simple) | `dagre` | ✅ | OK for small DAGs |
| Tree layout | `d3-hierarchy` | ✅ | Only for tree-shaped scenes |
| Font → paths | `opentype.js` | ✅ | Text as paths → deterministic, wipe-able |
| Font engine alt | `fontkit` | ✅ | Only if you need advanced shaping (Devanagari → test!) |
| Icon data | `@iconify/json` + `@iconify/utils` | ➕ | Per-set `info.license` available in metadata → filter programmatically |
| Streamline | MCP / API | ➕ | Check your plan's terms for use inside rendered videos before cataloging |
| Local embeddings | `@huggingface/transformers` | ➕ | MiniLM-class model, zero API cost |
| PDF text | `pdfjs-dist` or `unpdf` | ➕ | Start simple; figures later |
| PDF structure (optional, Python) | `docling` or `marker` | ➕ | Better headings/tables/equations; run as sidecar |
| Word alignment (Python) | `whisperx`, `stable-ts`, or `aeneas` | ➕ | Forced alignment of known text to TTS audio |
| Raster → vector (offline factory) | `vtracer` (Rust/Python), `potrace` | ➕ | Offline asset factory path B only |
| Concurrency (local) | `p-limit` / `piscina` (worker threads) | ➕ | Render worker pool |
| Queue (scale phase) | `bullmq` + Redis | ➕ | Not before week-1 exit criteria |
| Colors | `culori` | ➕ | Nearest palette token mapping |

Fonts (all SIL OFL, Google Fonts): Kalam, Patrick Hand, Gochi Hand, Architects Daughter, Caveat. For Nepali/Hindi later: test a Devanagari handwriting-style OFL font (e.g., Kalam has Devanagari support — verify glyph coverage).

---

## 2. Spikes (each ≤ 20 minutes)

```bash
mkdir spikes && cd spikes && npm init -y && npm pkg set type=module
npm i zod svgo svgson svg-path-properties @resvg/resvg-js ffmpeg-static roughjs \
      mathjax-full opentype.js elkjs @iconify/json @iconify/utils culori p-limit
```

### S-1 Rasterize SVG with resvg (replaces rsvg-convert)
```js
import { Resvg } from '@resvg/resvg-js';
import { writeFileSync } from 'fs';
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080">
  <rect width="100%" height="100%" fill="#FDFDFB"/>
  <rect x="800" y="440" width="320" height="200" rx="18" fill="#9CCDF0" stroke="#1A1A1A" stroke-width="6"/></svg>`;
const t = performance.now();
const png = new Resvg(svg).render().asPng();
writeFileSync('s1.png', png);
console.log('S-1 OK', (performance.now() - t).toFixed(1), 'ms/frame');
```
Record ms/frame → tells you render throughput for 60-min videos (108k frames).

### S-2 Path length + stroke reveal without a DOM
```js
import { svgPathProperties } from 'svg-path-properties';
const d = 'M100 100 C 300 0, 500 200, 700 100';
const len = new svgPathProperties(d).getTotalLength();
const frame = p => `<path d="${d}" fill="none" stroke="#1A1A1A" stroke-width="6" stroke-linecap="round"
  stroke-dasharray="${len}" stroke-dashoffset="${len * (1 - p)}"/>`;
console.log('S-2 OK length', len.toFixed(1), frame(0.5).includes('dashoffset'));
```

### S-3 Frames → MP4 via ffmpeg stdin (no per-frame spawn)
```js
import { spawn } from 'child_process';
import ffmpeg from 'ffmpeg-static';
import { Resvg } from '@resvg/resvg-js';
import { svgPathProperties } from 'svg-path-properties';
const d = 'M200 540 L1720 540'; const L = new svgPathProperties(d).getTotalLength();
const ff = spawn(ffmpeg, ['-y','-f','image2pipe','-framerate','30','-i','-','-c:v','libx264','-pix_fmt','yuv420p','s3.mp4']);
for (let f = 0; f < 90; f++) {
  const p = f / 89;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080"><rect width="100%" height="100%" fill="#FDFDFB"/>
    <path d="${d}" stroke="#1A1A1A" stroke-width="8" stroke-linecap="round" stroke-dasharray="${L}" stroke-dashoffset="${L*(1-p)}"/></svg>`;
  ff.stdin.write(new Resvg(svg).render().asPng());
}
ff.stdin.end(); ff.on('close', c => console.log('S-3 OK exit', c));
```

### S-4 MathJax → self-contained SVG
```js
import { mathjax } from 'mathjax-full/js/mathjax.js';
import { TeX } from 'mathjax-full/js/input/tex.js';
import { SVG } from 'mathjax-full/js/output/svg.js';
import { liteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor.js';
import { RegisterHTMLHandler } from 'mathjax-full/js/handlers/html.js';
import { AllPackages } from 'mathjax-full/js/input/tex/AllPackages.js';
const adaptor = liteAdaptor(); RegisterHTMLHandler(adaptor);
const doc = mathjax.document('', { InputJax: new TeX({ packages: AllPackages }), OutputJax: new SVG({ fontCache: 'none' }) });
const node = doc.convert('\\mathrm{softmax}\\left(\\frac{QK^T}{\\sqrt{d_k}}\\right)V', { display: true });
const svg = adaptor.innerHTML(node);
console.log('S-4 OK', svg.startsWith('<svg'), svg.length, 'chars');
```
Then rasterize with S-1 to confirm it renders. Note: glyphs are **filled paths** → use wipe reveal, not dashoffset. If `mathjax-full` import paths fail, you likely installed MathJax 4 — check its docs.

### S-5 Rough primitives, deterministic
```js
import rough from 'roughjs';
const gen = rough.generator();
const a = gen.toPaths(gen.rectangle(10, 10, 300, 160, { roughness: 0.5, seed: 42, stroke: '#1A1A1A', strokeWidth: 4 }));
const b = gen.toPaths(gen.rectangle(10, 10, 300, 160, { roughness: 0.5, seed: 42, stroke: '#1A1A1A', strokeWidth: 4 }));
console.log('S-5 OK deterministic:', JSON.stringify(a) === JSON.stringify(b));
```
If `false`, roughness breaks reproducible renders — keep roughness 0.

### S-6 Word timestamps for TTS audio
Option A (preferred): check whether your TTS returns word/phoneme timings. Option B: forced alignment in a Python sidecar.
```bash
pip install stable-ts   # or whisperx
```
```python
import stable_whisper, json
model = stable_whisper.load_model('base')
text = open('script.txt').read()
res = model.align('narration.wav', text, language='en')
words = [{'w': w.word, 'startMs': int(w.start*1000), 'endMs': int(w.end*1000)} for s in res.segments for w in s.words]
json.dump(words, open('words.json','w')); print('S-6 OK', len(words), 'words')
```
Measure: median |aligned − true| on a clip you time by hand (10 words). Target < 80 ms. Repeat for Nepali before promising it.

### S-7 Remotion vs custom renderer (decision spike, 1–2 h)
Render the same 20 s scene (S-3 style, ~10 elements) both ways. Compare: wall time, CPU, code complexity, license fit. Remotion's `evolvePath(progress, d)` returns `strokeDasharray/strokeDashoffset` — equivalent to S-2. Choose custom if within 1.5× speed and you want zero license exposure.

### S-8 Iconify: license filter + normalize one icon
```js
import { readFileSync } from 'fs';
import { getIconData, iconToSVG, iconToHTML } from '@iconify/utils';
import { optimize } from 'svgo';
const lucide = JSON.parse(readFileSync('node_modules/@iconify/json/json/lucide.json','utf8'));
console.log('license:', lucide.info?.license?.spdx);
const data = getIconData(lucide, 'key');
const r = iconToSVG(data, { height: 100 });
let svg = iconToHTML(r.body, r.attributes);
svg = svg.replace(/stroke-width="[^"]*"/g, 'stroke-width="2.4"').replace(/currentColor/g, '#1A1A1A');
svg = optimize(svg, { multipass: true }).data;
console.log('S-8 OK', svg.slice(0, 120));
```
Then build the license allowlist by scanning `info.license.spdx` across all collections and keeping only what you accept (e.g., MIT, ISC, Apache-2.0; CC-BY only if you add attribution).

### S-9 (optional) ELK layout for a convergence scene
```js
import ELK from 'elkjs/lib/elk.bundled.js';
const elk = new ELK();
const g = { id: 'root', layoutOptions: { 'elk.algorithm': 'layered', 'elk.direction': 'RIGHT', 'elk.spacing.nodeNode': '64' },
  children: ['k1','k2','k3','q','dot','sm','m'].map(id => ({ id, width: 180, height: 140 })),
  edges: [['k1','dot'],['k2','dot'],['k3','dot'],['q','dot'],['dot','sm'],['sm','m']].map(([s,t],i)=>({ id:'e'+i, sources:[s], targets:[t] })) };
const out = await elk.layout(g);
console.log('S-9 OK', out.children.map(c => `${c.id}:${c.x},${c.y}`).join(' '));
```

### S-10 (optional) Local embeddings for catalog retrieval
```js
import { pipeline } from '@huggingface/transformers';
const embed = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
const v = await embed(['key: access, unlocking, identifier'], { pooling: 'mean', normalize: true });
console.log('S-10 OK dims', v.dims);
```

---

## 3. Spike results template (`spikes/RESULTS.md`)

| Spike | Pass? | Measured | Decision |
|---|---|---|---|
| S-1 resvg | | ms/frame | |
| S-2 path length | | | |
| S-3 ffmpeg pipe | | fps achieved | |
| S-4 MathJax | | | |
| S-5 rough determinism | | | roughness value |
| S-6 alignment | | median error ms (en / ne) | |
| S-7 Remotion vs custom | | wall time each | renderer choice |
| S-8 Iconify license | | allowed sets count | |
| S-9 ELK | | | |
| S-10 embeddings | | ms per query | |
