# 02 — Implementation Plan

Build order principle: **prove the look first with a hand-written scene, then automate.** If a hand-authored SceneSpec rendered by your engine does not look like Simi, no planner will fix it.

---

## Day 0 — Spikes and baseline (half day)

Goal: every dependency proven in 20-minute spikes before you build on it.

| Task | Output | Done when |
|---|---|---|
| Run spikes S-1 … S-8 from file 04 | `spikes/` folder with passing scripts | Each prints its success line |
| Freeze baseline | Copy 10 lessons + current metrics from `visual-system-benchmark` into `harness/goldens/` | `baseline/summary.json` exists |
| Collect Simi references | 20–40 Simi keyframes, tagged by template (hub_spoke, convergence…) | `harness/reference/simi/*.png` + `index.json` |
| Hand-write 3 SceneSpecs | "Why Attention", "Query Meets Keys", "Blending the Values" as DSL JSON | Validated by zod schema |

---

## Day 1 — Renderer core (the look)

Build `s10-render` with no LLM involved.

1. `style/tokens.ts` (copy from file 01 §5).
2. Primitives: `box`, `pill`, `tokenStrip`, `operator`, `meter`, `arrow`, `text`, `bracket`. Each primitive returns `{ paths: StrokePath[], fills: FillShape[], texts: TextRun[], bbox }`.
3. Text: opentype.js → glyph paths; uppercase labels; measure width for layout.
4. `renderFrame(laidOutScene, timeline, t): string` — pure function returning SVG.
5. Reveal functions (below).

```ts
// reveal.ts — stroke draw-on for any path
export function strokeReveal(d: string, length: number, progress: number) {
  const p = Math.min(1, Math.max(0, progress));
  return `<path d="${d}" fill="none" stroke="${STYLE.stroke.color}" stroke-width="${STYLE.stroke.width}"
    stroke-linecap="round" stroke-linejoin="round"
    stroke-dasharray="${length}" stroke-dashoffset="${length * (1 - p)}"/>`;
}

// text / formula wipe: clip rect grows left→right
export function wipeReveal(id: string, bbox: BBox, progress: number, inner: string) {
  const w = bbox.w * Math.min(1, Math.max(0, progress));
  return `<clipPath id="c_${id}"><rect x="${bbox.x}" y="${bbox.y - 8}" width="${w}" height="${bbox.h + 16}"/></clipPath>
          <g clip-path="url(#c_${id})">${inner}</g>`;
}
```

**Acceptance (Day 1):** the 3 hand-written scenes rendered at hand-placed coordinates as single PNG keyframes sit next to Simi's frames and a person cannot tell style apart at thumbnail size (E1 in file 03).

---

## Day 2 — Layout + templates + timeline + video

1. Implement templates: `title_card`, `hub_spoke`, `chain`, `convergence`, `fan_out`, `list_icon`, `weighted_blend` (the 7 used most in the Simi frames). Remaining 5 on Day 6.
2. Solver: slots → measured sizes → overlap push → occupancy scale.
3. Timeline compiler from anchors. For now, anchors use a fake uniform word clock.
4. Encode: resvg worker pool → ffmpeg stdin → MP4, 30 fps.

```ts
// encode.ts — no per-frame process spawn
const ff = spawn(ffmpegPath, ['-y','-f','image2pipe','-framerate','30','-i','-',
  '-i', wavPath, '-c:v','libx264','-pix_fmt','yuv420p','-crf','20','-c:a','aac','-shortest', out]);
for (let f = 0; f < totalFrames; f++) {
  const svg = renderFrame(scene, timeline, (f / 30) * 1000);
  ff.stdin.write(new Resvg(svg).render().asPng());   // move to worker pool once it works
}
ff.stdin.end();
```

**Acceptance:** "Query Meets Keys" renders as a 20 s MP4 with draw-on animation, no overlaps, occupancy in band. Render speed recorded (target: ≥ 3× realtime on your laptop after worker pool).

---

## Day 3 — Catalog v0 + normalizer + ladder

1. Normalizer (file 01 §4.2) with svgo + path classification + restyle.
2. Seed catalog: 150 concrete objects from **stroke-based Iconify sets with permissive licenses** (filter by `info.license` in `@iconify/json`; Lucide and Tabler are strong candidates). Add Streamline assets only if your plan's license permits use in rendered videos.
3. Embeddings for catalog entries (local MiniLM via `@huggingface/transformers`, zero API cost).
4. Ladder: catalog exact/alias → embedding ≥ τ_high → compose(base + badge) → styled text box.
5. Badges: 13 small glyphs drawn as primitives (✓ ✗ ? ! $ ⚠ ↑ ↓ ⏱ lock ★ + −), attached at top-right of base object.

**Acceptance:** zero placeholders across the 10 golden lessons; rung distribution recorded; E3 (normalization coherence) passes.

---

## Day 4 — Voice + word alignment + scene planner v1

1. S5: keep Supertonic. If it doesn't emit word timings, add forced alignment (see file 04 S-6). Output `AlignedAudio` with mention times.
2. S4 script format with `[[id|spoken words]]` mentions. Strip markers before TTS; keep char offsets to map mentions → word indices.
3. S6 planner: prompt (file 01 §3.3), few-shots = your 3 hand-written scenes + 6 more you write for other templates, catalog candidates injected, zod validation, one repair call, deterministic fallback.
4. Run the planner with **two models** (your current flash model and one strong model) on the 10 goldens. Store both.

**Acceptance:** 100% of scenes schema-valid after repair/fallback; every element anchored; E5 (planner model A/B) run and scored.

---

## Day 5 — Wire the DAG + gates

1. `runner/dag.ts`: explicit stage graph, content-addressed cache (`hash(input, modelId, promptVersion, schemaVersion)`), resume from any stage, frozen inputs hashed at start.
2. `runner/budget.ts`: global persistent counter (file or Redis) — replaces per-process `maxLive`.
3. `s12-gates`: all deterministic gates from file 03 §2.
4. Single entrypoint: `engine run --input doc.pdf --duration 60 --out out/`.
5. Delete dead twins: `providers/*.ts` stubs, fake `references/iconify-index.json`, old `generate-benchmark-data / freeze-plan / render-outputs` scripts.

**Acceptance:** one command produces MP4 + report for any golden; rerun is ~all cache hits; a forced failure in S7 is reported by gates, not swallowed.

---

## Day 6 — Real documents + remaining templates + math

1. S1 ingest for PDF/DOCX/MD (start simple: text + headings + equations; figures later).
2. S2 + S3 on 5 real uploads (a paper section, a textbook chapter, a policy doc, a product doc, one with heavy formulas).
3. Remaining templates: `compare_2`, `threshold`, `layered_stack`, `cycle`, `formula_focus`.
4. `formula` primitive via MathJax → SVG, wipe reveal.

**Acceptance:** 5 real-document videos generated end-to-end with gates passing; failures logged with stage + reason.

---

## Day 7 — Side-by-side evaluation and decision

1. Run E1–E10 (file 03). Produce `harness/reports/week1.md`.
2. Blind comparison: 10 Simi frames + 10 yours, shuffled; judge (VLM + you + one other person) rates style and clarity.
3. Decide next week's focus from the data: planner quality, catalog breadth, or renderer polish.

**Week 1 exit criteria:** style parity on E1 ≥ 80% "can't tell / ours equal"; placeholders = 0; semantic-match ≥ 0.85; every golden under cost ceiling.

---

## Weeks 2–3 — Hardening (quality loop)

| Track | Work | Metric to move |
|---|---|---|
| Planner | More few-shots per template, failure taxonomy from judge, prompt versions A/B | Teaching-clarity judge score, template diversity |
| Catalog | 150 → 400 objects; offline asset factory v1 (sketch DSL → render → judge) for recurring gaps | Rung-2 share ↑, rung-4 share ↓ |
| Continuity | Carry-over elements, erase/redraw transitions, camera nothing fancy | Judge "flow" score |
| Intro/outro | Tutor intro: source title, section roadmap, time plan; recap scene | Presence gate |
| Speed | Parallel scene planning; worker pool; live player Mode B | Time-to-first-frame, total wall time |
| Long form | Section-parallel pipeline for 5/10/30/60 min | Cost per minute, gates pass rate |

## Weeks 4+ — Scale

Queue (BullMQ), stateless workers, object storage for artifacts, observability dashboard, learner-profile input into S3. See file 01 §11.

---

## Offline asset factory (rung 5) — spec for week 2

```
gap concept ──► LLM writes SKETCH DSL (not SVG):
   { "viewBox":100, "shapes":[
       {"t":"circle","cx":50,"cy":40,"r":22,"fill":"yellow"},
       {"t":"rect","x":35,"y":60,"w":30,"h":25,"rx":4,"fill":"none"},
       {"t":"poly","pts":[[40,85],[50,95],[60,85]],"closed":false} ] }
          │  validator: ≤ 25 shapes, coords in [0,100], palette only, min feature size
          ▼
   compile to SVG ──► normalizer ──► render 256px PNG
          │
          ▼
   VLM judge: "What object is this?" (blind) → must name the concept or a synonym
          │  + style judge against 5 catalog neighbors
          ▼
   pass → catalog entry (source: 'generated', qa scores) · fail ×3 → mark concept "text-box only"
```

Alternative factory path to A/B: image model (flat doodle, white bg, fixed style prompt) → `vtracer` → normalizer → same judge. Offline only.

---

## Risks and mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Planner produces "entity lists" not diagrams | High with flash models | Strong model for S6 only; template few-shots; judge-driven prompt iteration |
| Filled icons look wrong with stroke reveal | Medium | Prefer stroke-based sets; outline-then-fill for fill-type |
| Word alignment drift on Nepali/other languages | Medium | Forced aligner with per-language model; fall back to proportional timing per sentence |
| Render too slow for 60-min | Medium | Worker pool, resvg, section parallelism, player mode for in-app |
| License problems with icon sources | Medium | License stored per catalog entry; build fails on non-allowed license |
| Over-engineering scale before quality | High (tempting) | No queue/infra work until week-1 exit criteria pass |
