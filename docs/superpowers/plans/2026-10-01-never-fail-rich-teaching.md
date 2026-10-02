# Never-Fail, Rich-Visual, Math-Capable Teaching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox syntax.

**Goal:** Any prompt + source reaches a finished, taught video: every scene composes without a hard failure, concepts are drawn as real icons chosen by meaning (Lamina style), and mathematics is taught step by step with exact notation and geometry. No topic hardcoding; no weakening of gates; tests change only when the behavior they pin legitimately changes.

**Spec / evidence:** `final_plan/01–04`, `final_plan/simi_teaching_methods/SIMI_TEACHING_BENCHMARK_CONTEXT.md`, `harness/reference/lamina/OBSERVATIONS.md` + frames (`simi-scene02.png`: leaf, chloroplast, sun, lightning bolt, flask; `ssstwitter…scene09.png`: robot, building, brain, coin, stacked tokens, clock, wrench; every concept = pictorial icon + short label, arrows lead the eye, 5–9 elements per scene, no label boxes).

## Audit (measured over 40 cold runs in `.data/goal-run`, 2026-10-01)

| Cause | Count | What it means |
|---|---|---|
| S6 board repair exhausted → fallback | 59 | Model board rejected for fixable shape errors (bad role enum, compare >3 nodes, duplicate instances, title words/numbers, missing intents, process role). Code can repair all of these deterministically. |
| Fallback fails its own gates | 38 | Fallback creates one node per concept, so 2-concept scenes miss the 3-node rule; every fallback is recorded as a HARD failure by policy even when valid. |
| Claim target not fully revealed by claim end | 44 | Reveal finishes after the spoken claim: 2-server scheduler + long icon stroke times; no deadline awareness. |
| Element never visibly drawn | 18 | Mention near scene end gets ≤1 ms; scene ends exactly at audio end (200 ms gap) so no closing hold. |
| Script word budget | 5 | Audio is the master clock, yet a 38-word scene in a 31-word window hard-fails S4. |
| Icons | — | Only exact-name or one-shot validated matches; abstract and domain concepts become pastel boxes or role glyphs; Lamina shows a picture for every concept (metaphor nouns: "trapped energy" = lightning bolt, "tension" = bolt + warning). |
| Math | — | S6 has formula/plot/matrix/number-line primitives but no geometry drawing; math scenes untested live. |

## Global constraints
- `final_plan/*` frozen. No topic strings in production code (static scan test stays green). Gates are not weakened: a composed board must pass the same B3/B4/layout gates; a failure is recorded, never hidden.
- Audio is the master clock; models never emit coordinates or code; asset use only through AssetBridge; local-dev licence context unchanged.
- Verify: `npm run typecheck:hypothesis && npm run test:hypothesis`; paid runs labelled, all reported.

## Tasks (priority order)

### P1 Never-fail composition
- [ ] **T1 Deterministic board repair** (`planner/boardRepair.ts`): before validation normalise a model board: invalid/missing role → derive from layout+relations; `compare` with ≠2–3 nodes → `flow`/`fan_out`; excess/duplicate instances (done); missing/unsupported intents → synthesize from claims and drawn edges; missing process role → busiest node; title failing word/number rules → derive from heading/labels; claim target not named near claim → re-anchor node mention to the mention inside the claim sentence. Tests per rule + topic swap.
- [ ] **T2 Rich fallback composer** (`planner/board.ts fallbackBoard`): one node per *mention* (≤7, up to 3 instances per concept with distinct phrases), real depiction per node, relation edges only from the graph; counted as soft `planner-deterministic-compose` when it passes every gate, hard only when a gate fails.
- [ ] **T3 Reveal deadlines + scene hold** (`timeline/compile.ts`, `runLive.ts`): scene visual end includes a closing hold (config `SCENE_HOLD_MS`); reveal phases compressed to meet each target's claim-end deadline; scheduler orders by deadline; never fewer than 3 concurrent reveals for dense scenes.
- [ ] **T4 S4 soft length** (`plan/stages.ts`): word-budget violations that survive repair become `scene-over-budget` warnings when within pacing bounds (audio sets the clock); structural errors stay hard.

### P2 Rich icons by meaning
- [ ] **T5 Depiction Director** (`discovery/depictionDirector.ts`): per scene one cheap call: for each concept/mention referent return ≤3 *concrete drawable nouns* (single objects) or an abstract kind (role/topology/diagram); resolver looks the nouns up exactly in AssetBridge (aliases included) in preference order, then embedding+validation fallback; result locked; runs before S4 (concepts) and again per scene after S4 for mention referents.
- [ ] **T6 Library coverage** (Asset Lab): normalise slug ids (`pills-2`→`pills`), add concept aliases from taxonomy letters A–T, merge duplicate nouns, report coverage of the Lamina vocabulary (leaf, sun, flask, robot, building, brain, coin, clock, wrench, bolt, warning, layers…); re-export bridge.
- [ ] **T7 Style harmony**: recolour single-colour Flaticon glyphs to outline + pastel fill so scenes read like Lamina (family lock already prevents mixing).
- [ ] **T8 Lamina scene grammar**: 5–9 elements, arrows lead the eye (arrow before target), left→right then down, short side labels for quantities; occupancy target 0.5–0.7.

### P3 Mathematics and "draw anything"
- [ ] **T9 Math probe + audit** on 3 non-science sources (math, algorithm, economics); fix what the audit shows.
- [ ] **T10 Geometry diagram primitive** (`schema`/`render/geometry.ts`): data-only points/segments/polygons/right-angle marks/labels in a normalised frame, numbers checked against cited evidence; renders deterministically.
- [ ] **T11 Stepwise math teaching**: S3 math adapter emits intuition → symbols → one transformation per beat → result; S6 uses worked-example/formula steps revealed one at a time; exact notation by MathJax.
- [ ] **T12 Algorithm/data-structure scenes** (array cells with highlight/eliminate states) using the same data-only primitives.

### P4 Verification
- [ ] **T13 Cold matrix**: 5 benchmark topics + 3 probes, all reported; audit + Simi rubric per run; update HANDOFF. Acceptance: no hard failure on composition; pictorial share ≥50% of object elements; zero flagged wrong bindings.
