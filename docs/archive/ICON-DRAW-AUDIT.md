# Icon & Drawing Readiness Audit — 2026-09-27
Target reader: the next (higher) agent taking over teaching-draw quality.
Sources: live file reads, renders, repo clones, web research, 3 parallel researcher subagents (VideoScribe SVG format / character packs / pipeline evidence audit).

## 0. Objective

Reach simi-level output (reference: `lamina-labs-video/simi.mp4` — 69s, 1920×1080, "THE PLANT FOOD FACTORY" photosynthesis explainer: sunlight/water/CO₂ → plant → leaf→chloroplast→chlorophyll → reaction → glucose/growth/leaves/stems/fruit → oxygen/we-breathe) across thousands of domains/topics — with icons that fit our renderer.

## 1. Conversation transcript (what was asked → what was found)

1. **What files interconnect in the latest run?** Latest run = commit `f034029` + `.data/hypothesis-runs/phase6-2026-09-27` (live v1/v2 + cold-r2). Chain: `pipeline/runLive.ts` → `catalog/{registry,iconPins,semantic,streamline}` → `plan/stages.ts` (S3 v5) → `planner/board.ts` → `resolveScene.ts` → `layout/measure.ts` → `timeline/compile.ts` → `export/*`. LLM routes: `OPENROUTER_CONTENT_MODEL=OPENROUTER_SCENE_MODEL=openai/gpt-6-luna`.
2. **How many icons? Realtime search? What do Assest-Library + sketchi hold?** Live pool = **462** (`assetlab-sketchy-downshift`, sole enabled family). Search is local embedding retrieval, NOT web search. Assest-Library (local checkout, ahead of GitHub): 722 approved / 500-concept seed / 89 diagrams / 113 quarantined / 561 Downshift SVGs / 10,204-entry taxonomy. sketchi: 1,412 flat brand/tech logos — wrong style, trademark risk, unusable for lesson boards.
3. **Can we reach simi with these icons?** Style: yes (same thick-ink + flat-fill language). Coverage: ~70% for simi; gaps = chloroplast, glucose, roots, soil, stem (+ weak humans).
4. **Bigger library or same?** Verdict: same family, depth not breadth — grow 462 → ~550–600 via gap-driven top-up. Enabling streamline/mit adds style pollution + retrieval confusion.
5. **What happens when a required icon is missing?** Ladder rung 4: unconditional styled text box (`assetId:null, lane:text-fallback`). Never crashes; visibly downgrades. Strategy: steer (synonyms) → procedural (geometry) → backfill (art).
6. **Where to source more drawable icons + how simi constructs each?** Primary: Downshift/Sketchie MIT pool (10,385 icons, two-layer stroke→fill, same taxonomy we vendor from). Backup: Doodle/Duma (CC0/MIT, needs stroke normalization). Avoid: sketchyicons/Lucide-derivatives, Iconro (attribution), Keyline (UI style). Per-icon construction specs recorded (chloroplast = double-oval + thylakoid bars; roots = tapered brown strokes; soil = half-ellipse mound; stem = tapered stick; glucose = isometric cream cube).
7. **"Are you sure or guessing?"** Honesty split documented; file-verified vs web-reported vs inferred labeled explicitly.
8. **Realtime teaching-draw research.** Mechanism = plan-as-data + word-timed stroke reveal + pen tip leading. Sketchie: stroke-by-stroke timed to exact narration word; eval laws (always draw on, no decoration, ≤6 min, end with question). Our stack mirrors it (seeded geometry, marker math, S9 compiler, ffmpeg mux). Biggest gap = S5 word-timing uncalibrated.
9. **Local Assest-Library read.** 722 approved (622 support/82 hero/18 symbolic); bridge 462/462 ran 2026-09-26 (exactly our live set). Taxonomy query: chloroplast/root/soil/seedling/oxygen/photosynthesis exist as concepts; only `seedling.svg` drawn; glucose/chlorophyll/stem absent. Full per-concept table in §4.
10. **Thousands of domains?** Industry converged on ~10k drawable core (VideoScribe 7–11k, Doodly ≤7.3k, Sketchie 10.4k). Our 10,204 taxonomy aims correctly; 5% drawn. 5-layer coverage model adopted (library head + diagrams + procedural + steering/fallback + gap-log backfill).
11. **Are VideoScribe icons available?** No — Sparkol terms §7.2/§8.13 forbid extraction/reuse outside their app.
12. **How did VideoScribe get drawable humans-in-sizes?** Mask-reveal in path/document order over SVGs authored draw-order-first (basic strokes, separate fill layer, driver paths); character systems = modular parts × poses × emotions (Doodly People Builder: 130 poses, ~52M combos; VideoScribe named characters Mia/Ousmane, stick/realistic/cartoon tiers). Proprietary — clone the spec, not the assets. Open substitutes ranked: Kenney Toon 1 + Modular (CC0, best fit) → Open Peeps/Humaaans (CC0, needs thickening) → Open Doodles (cleanup needed).
13. **Did simi use Streamline?** No — proven by rendering our own `streamline.json` sun (gear glyph) and apple (grey UI glyph) vs simi's hand-drawn art; no public Lamina↔Streamline link. Our vendored Streamline is the free CC-BY-via-Iconify set (attribution only); paid key needed solely for 62 premium heroes (free budget 49/50).

## 2. Verified inventory (file-read, 2026-09-27)

| Asset | Count | State |
|---|---|---|
| Live retrievable | 480 (462 sketchy + 18 procedural seed) | sole enabled family; matrix bytes exact |
| On-disk disabled | 2,182 (streamline 1,992 / mit 195 / isc 13 / apache20 0) | rollback only; apache20 100% `no-ink` rejected |
| asset-lab approved | 722 (622 support / 82 hero / 18 symbolic) | 500-concept seed, 89 diagrams, 113 quarantined |
| Downshift inbox | 561 SVGs drawn / 10,204 taxonomy entries (~5%) | bridge 462/462 = live set |
| sketchi manifest | 1,412 brand/tech logos | rejected for boards |
| Human figures live | 1 man / 1 woman / 1 person / 1 teacher / 1 student; **0 boy/girl/human**; 23 role entries | blocking gap |

## 3. Pipeline (verified)

`rankConcepts` (MiniLM-L6-v2, 384-d, precomputed `.emb.bin`, top-8 cosine) → `resolveObject` ladder (pin → house-exact → emb≥0.62 → any-exact → emb≥0.50 → lexical → rung-4 textbox; license allowlist enforced) → `resolveScene` (pins freeze per-concept visuals) → S9 timeline compiler (stroke 300–1500ms → fill 250ms → text wipe; compress to audio clock) → ffmpeg H.264+AAC. Draw geometry fully seeded/deterministic (FNV-1a + mulberry32, zero `Math.random`).

## 4. Simi gap table (taxonomy queried)

| Need | Taxonomy | Drawn | Path |
|---|---|---|---|
| seedling | ✅ t1 | ✅ | approve now |
| chloroplast / root / soil / oxygen / photosynthesis | ✅ | ❌ | re-pull upstream; draw if absent |
| glucose / chlorophyll / stem | ❌ | ❌ | hand-draw procedural/seed entry |
| boy/learner humans, poses | n/a | ❌ | adopt CC0 modular human system |

## 5. DO (ordered, with why)

1. **Calibrate S5 word timing** (`alignment-calibration-unmeasured`). Why: word-locked reveal is the #1 retention mechanism per all three researchers; unlocks everything below.
2. **Adopt one CC0 human system** (Kenney Toon 1 first): normalize to our stroke token + palette, ingest as second per-scene-routed family. Why: humans are the blocking gap; simi's payoff scenes need them.
3. **Approve seedling + draw glucose/stem/chlorophyll fallback** (~1 hr) → bridge → embed (462→~472). Why: closes simi board with zero architecture change.
4. **Weekly approve cadence (~20/wk) + upstream re-pulls.** Why: compounds 5%→15% drawn in 6 months; KPI = taxonomy-% + rung-4 rate per lesson.
5. **Diagrams 89→200 for mechanisms.** Why: one diagram ≈ 50 icons of teaching power.
6. **Add no-decoration gate + pen presence + per-scene re-render.** Why: their eval laws, our missing mirrors.
7. **Board discipline**: ≤4 pins/board, hero 2×, two-line labels, one family per scene — enforced in planner. Why: simi's quality is layout discipline, not icon count.

## 6. DO NOT (with why)

1. **Do not enable streamline/mit/isc to "look richer."** Why: style pollution, retrieval confusion (lookalikes), re-imports known-rejected geometry; proven by renders.
2. **Do not use sketchi logos on lesson boards.** Why: flat brand marks fail ink+fill gates + trademark risk.
3. **Do not touch VideoScribe/Doodly assets.** Why: Sparkol §7.2/§8.13 + proprietary licenses;Spec-clone only.
4. **Do not buy Streamline premium yet.** Why: free set suffices (CC-BY + attribution); spend only if 62 heroes win a measured A/B. Free budget 49/50 — freeze.
5. **Do not mix icon families on one board.** Why: clip-art soup; the rule must survive the human-family addition.
6. **Do not ship confident wrong pictures** (weak ≥0.50 matches on critical concepts). Why: a labeled box beats a wrong icon; human-review gate exists for this.
7. **Do not trust chatbot license pastes** (incl. §13 above): verify at `help.streamlinehq.com` before spend.

## 7. Open / unverified (do not assert)

- Sketchie 10,385/MIT/two-layer claims: strong (aligns with our handover) but snippet-sourced; confirm via repo fetch.
- Upstream draw status of chloroplast/root/soil/oxygen: re-pull then grep.
- sketchi style judgment: manifest-name-level; render samples to confirm if ever reconsidered.
- Streamline Solo terms: verify official help center before any purchase or per-project-cap compliance review (our bundled-distribution model may not fit Solo's per-project framing — legal check, not engineering).

## 8. Handoff to higher agent

Execute §5 in order; respect §6; close §7 items before citing them. Evidence files: `hypothesis_claude/src/.../catalog/data/*`, `Assest-Library/asset-lab/{catalog,out/bridge-sketchy}`, `lamina-labs-video/simi.mp4` (+ `/tmp/opencode/simi-frames/`), `docs/HANDOFF.md`. Success metric: rung-4 rate per lesson trending down, S5 gate passing, simi's 5-board structure reproducible frame-by-frame.
