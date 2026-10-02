# Simi-Level Whiteboard Engine — Plan Pack

Owner: Anup · Codebase: `explain-canvas-lab` (+ `experiments/visual-system-benchmark`)
Status: v1 plan, 2026-09-21 · Scope: architecture, implementation, validation, packages, verdict

---

## Files in this pack (read in order)

| # | File | What it gives you | When you need it |
|---|------|-------------------|------------------|
| 00 | `00-README.md` | Verdict, principles, decision log | First, and when you doubt direction |
| 01 | `01-ARCHITECTURE.md` | Full pipeline, stage contracts, Scene DSL, style system, asset ladder, renderer, scaling | Before writing any code |
| 02 | `02-IMPLEMENTATION-PLAN.md` | 7-day sprint + hardening weeks, per-day tasks, acceptance criteria, code skeletons | Daily |
| 03 | `03-VALIDATION-HARNESS.md` | Experiments E1–E10, gates, metrics, VLM judge rubric, Simi comparison protocol | Every time you claim "better" |
| 04 | `04-PACKAGES-AND-SPIKES.md` | Every package with status (real / renamed / fake), license notes, 20-minute spike scripts | Day 0, before committing to any dependency |
| 05 | `05-GEMINI-AUDIT-AND-SIMI-HYPOTHESES.md` | Claim-by-claim audit of the Gemini output, what is publicly known about Lamina, what they likely run | When you want to reason about the competitor |

---

## The verdict (short version)

**Will you reach Simi's level?** Split it into four parities, because they have different answers:

| Parity | Can you reach it? | Time (focused) | What decides it |
|---|---|---|---|
| **Visual style** (stroke, palette, font, icon family, draw-on) | **Yes, high confidence** | 1–2 weeks | Renderer + style normalization. Pure engineering. |
| **Scene design** (diagrams that *are* the explanation, like "Query Meets Keys") | **Yes on familiar topics, medium confidence on arbitrary PDFs** | 2–6 weeks of eval loops | Planner model quality + Scene DSL expressiveness + templates + your judge loop |
| **Speed** (Lamina claims ~20–40 s for a 1-min video) | **Medium** | 2–4 weeks | Parallel planning + a data-driven player; not per-frame rsvg |
| **Robustness across thousands of real uploads** | **Not in weeks** | Months | Volume of real failures fixed. This is their real moat. |

**Do they have their own model?** No public evidence of a proprietary foundation model. A two-person team is far more likely running frontier LLM APIs behind their own planning/rendering pipeline, possibly with fine-tuned or distilled small models later. Their publicly reported history — abandoning automated Manim because it was hard to make reliable — is exactly the lesson this plan builds on: **LLM emits constrained data, deterministic code draws.** Details and sources in file 05.

**Are they "better and well-tested"?** Better-tested: almost certainly, because they have real users and paying customers generating failure cases daily. Better architecture: probably not fundamentally different from what this plan describes. The gap you can close with engineering; the gap you close with volume only by shipping and collecting failures.

---

## Non-negotiable principles

1. **The LLM never draws.** It emits a typed Scene DSL. Code draws. No raw SVG path data from models on the critical path.
2. **Audio is the master clock, words are the anchors.** Every visual reveal is anchored to a narration word timestamp.
3. **One style family.** Every asset — Iconify, Streamline, generated — passes through the normalizer into the same stroke/palette/outline system, or it does not ship.
4. **Resolution ladder, never a placeholder.** Primitive → catalog metaphor → composed (base + badge) → styled text box. An empty circle in a final video is a failed build.
5. **Semantic correctness > style coherence > richness > coverage.** A wrong icon is worse than a clean labeled box.
6. **Every stage is a pure, content-addressed, cached function.** Cache key = hash(input + model id + prompt version + schema version).
7. **Nothing is "better" until the harness says so.** Deterministic gates on every run, VLM judge on dev runs, side-by-side against Simi reference frames.

---

## Decision log (what we decided and why)

| Decision | Chosen | Rejected | Why |
|---|---|---|---|
| Visual unit | Freeform elements on an open canvas | 168×132 node cards | Cards produce the dashboard look; Simi has none |
| Default for abstract concepts | Primitives + text + composed badges | Literal icon search | Your benchmark: literal search fails most on civics/abstract domains and produces wrong matches |
| Asset source | One curated catalog, retrieval-grounded selection | 4-provider A/B | Provider choice is ~10% of the gap; mixing without normalization drops coherence |
| Roughness | None or light, fixed-seed, on primitives only | svg2roughjs on everything, hachure fills | Simi frames are clean marker strokes; rough on small icons destroys legibility and determinism |
| Math | MathJax (`mathjax-full`) → SVG, clip-mask reveal | "KaTeX + commander-svg" | KaTeX outputs HTML; commander-svg is not a real package |
| Runtime image generation | Never on critical path | — | Not animatable, style drift, latency |
| LLM-generated illustrations | Offline only, via sketch DSL + judge → catalog | Raw SVG at runtime | Reliability; grows a reusable library (asset flywheel) |
| Frame rate | 30 fps | 1 fps | 1 fps has no draw-on animation at all |
| Planner model | Strongest affordable model for scene planning only | Flash model for everything | Scene design is where teaching quality lives |

---

## Cost ceilings (carry into every decision)

| Length | Ceiling | Where the money goes |
|---|---|---|
| 1 min | $0.10 | 1 planning pass + TTS + CPU render |
| 5 min | $0.50 | Planning scales with scene count; cache the catalog embeddings |
| 10 min | $0.70 | Section-level planning in parallel |
| 30 min | $1.00 | Mostly cheaper models for narration expansion; strong model only for scene DSL |
| 60 min | $1.50–2.00 | Rendering must be CPU-efficient; VLM judge only on sampled keyframes |

VLM judging is a **dev/eval cost**, not a per-video cost. In production, only deterministic gates run on every video; the judge runs on a sampled 5%.
