# 03 — Validation Harness

Purpose: every architectural claim (ours or Gemini's) becomes an experiment with a pass/fail criterion. Nothing is called "better" without a number.

---

## 1. Golden set

| Set | Contents | Use |
|---|---|---|
| G-10 | Your 10 frozen lessons (attention, web request, zero-trust, gradient descent, induction, photosynthesis, immune, catalyst, inflation, bill→law) | Regression on every change |
| G-LONG | Your 4 long lessons (5-min) | Long-form timing, continuity, cost |
| G-DOC | 5 real uploads: paper section, textbook chapter, policy doc, product doc, formula-heavy notes | Generalization — the real test |
| SIMI-REF | 20–40 Simi keyframes tagged by template + 3 full Simi videos on overlapping topics | Style and design reference |

Rule: goldens are frozen and hashed. A change to a golden = new golden version, never an edit.

---

## 2. Deterministic gates (run on every video, zero cost)

| Gate | Rule | Fail action |
|---|---|---|
| G1 schema | Every artifact validates against its zod schema | Block |
| G2 placeholders | 0 unresolved elements in final render | Block |
| G3 overlap | 0 element bbox intersections (excluding declared containers/badges) | Block |
| G4 safe area | All elements within canvas minus 64 px | Block |
| G5 occupancy | Content bbox area / canvas in [0.45, 0.75] at scene end | Warn → block after week 2 |
| G6 font size | Rendered label height ≥ 32 px at 1080p | Block |
| G7 palette | Every fill in palette tokens; every stroke = style stroke | Block |
| G8 anchors | Every element has a resolvable anchor; anchor time inside scene | Block |
| G9 idle | No window > 2500 ms without a reveal or emphasis | Warn |
| G10 concurrency | ≤ 2 reveals running simultaneously | Warn |
| G11 sync | Last visual event ≤ audio end; video length = audio length ± 200 ms | Block |
| G12 element count | 2 ≤ elements per scene ≤ 9 | Warn |
| G13 label length | Labels ≤ 4 words | Warn |
| G14 license | Every asset's license in allowlist | Block |
| G15 cost | Actual $ ≤ ceiling for duration | Block (prod) / warn (dev) |

Implementation: gates read the LaidOutScene + Timeline + render log, not pixels — fast and exact.

---

## 3. Metrics (recorded per run, compared to previous run)

| Metric | Definition | Week-1 target |
|---|---|---|
| Rung distribution | % elements resolved at primitive / catalog / composed / text-box | text-box ≤ 25% of `object` elements |
| Semantic match | VLM judge: fraction of object elements whose visual depicts the label | ≥ 0.85 |
| Style coherence | VLM judge 1–5 per frame: "do all elements look like one illustrator made them?" | ≥ 4.0 |
| Teaching clarity | VLM judge 1–5 per scene given narration | ≥ 3.8 |
| Template diversity | Distinct templates per 1-min lesson | ≥ 3 |
| Occupancy | Mean content area share | 0.5–0.7 |
| Reveal-word lag | Median (reveal start − mention start) | −200 … +100 ms |
| Render speed | Video seconds / wall seconds | ≥ 3× |
| Wall time 1-min | Upload → MP4 | Record (Simi claims ~20–40 s) |
| Cost per video | Sum of API costs | ≤ ceiling |
| Cache hit rate | On rerun of unchanged input | ≥ 95% |

---

## 4. Experiments

Each experiment: hypothesis → setup → metric → pass criterion. Run on G-10 unless stated.

### E1 — Style parity (the look)
- H: Our renderer with hand-written SceneSpecs is stylistically indistinguishable from Simi.
- Setup: 10 of our keyframes (hand-authored scenes) + 10 Simi keyframes, same topics where possible, shuffled, scaled to 480 px.
- Judges: VLM (blind, "which frames come from the same product?") + 2 humans.
- Pass: humans can't separate sources better than 60% accuracy; VLM style coherence across the mixed set ≥ 4.

### E2 — Cards vs freeform
- H: Removing 168×132 cards increases perceived quality.
- Setup: same SceneSpecs rendered in old card mode vs new freeform mode.
- Pass: freeform wins pairwise preference ≥ 80%.

### E3 — Normalization makes hybrid coherent
- H: Mixed-source assets after normalization are as coherent as a single source.
- Setup: 4 conditions — Iconify-only raw, Hybrid raw, Iconify-only normalized, Hybrid normalized.
- Metric: style coherence per frame.
- Pass: Hybrid normalized ≥ Iconify-only normalized − 0.2. (Your earlier finding "mixing reduces coherence" should reverse after normalization.)

### E4 — Ladder thresholds calibration
- H: There exist τ_high/τ_mid that maximize semantic match without collapsing to text boxes.
- Setup: 200 concept→asset pairs labeled correct/incorrect by the VLM judge (spot-check 50 by hand); sweep thresholds.
- Output: precision/recall curve; choose τ_high at precision ≥ 0.9.
- Pass: chosen thresholds recorded in config with the curve in the report.

### E5 — Planner model A/B
- H: A stronger planner model produces diagrams (not entity lists) and is worth its cost.
- Setup: same prompt, same catalog candidates; flash model vs strong model; SceneSpecs rendered identically.
- Metrics: teaching clarity, template diversity, primitives-per-scene (operators/meters/strips count), cost.
- Pass: pick the model with best clarity per dollar that fits the 1-min $0.10 ceiling.

### E6 — Wrong icon vs text box
- H: A labeled text box beats a wrong-but-resolved icon.
- Setup: for 30 elements where the old pipeline picked a mismatched pictogram, render (a) the mismatched icon, (b) text box.
- Pass: text box preferred ≥ 70% → confirms "semantic correctness > coverage" and justifies strict τ.

### E7 — Font and roughness
- H: Clean strokes with a marker font are closer to Simi than rough.js hachure.
- Setup: 4 fonts × roughness {0, 0.5 fixed seed, 1.5 hachure} on 5 scenes.
- Metric: pairwise similarity to SIMI-REF by VLM + human.
- Pass: choose the configuration with highest similarity; expected winner roughness 0 or 0.5.

### E8 — Reveal sync
- H: Word-anchored reveals feel more "tutor-like" than proportional beat timing.
- Setup: same scenes; (a) old proportional timing, (b) word anchors.
- Metrics: reveal-word lag + human preference on 5 clips.
- Pass: median lag in target band; preference ≥ 70% for (b).

### E9 — Real documents (generalization)
- H: The pipeline produces valid, clear videos from unseen documents.
- Setup: G-DOC end to end.
- Pass: all gates pass; clarity ≥ 3.5; every failure categorized into the failure taxonomy (§6).

### E10 — Speed and cost
- H: 1-min video fits the $0.10 ceiling and a practical wall-time budget.
- Setup: cold run and warm run for 1/5/10 min.
- Report: per-stage time and cost table; time-to-first-playable-frame for player mode.
- Pass: cost ≤ ceiling; record wall time against Simi's claimed range.

---

## 5. VLM judge — prompts (fixed, versioned)

Use a capable vision model; cache by image hash + prompt version. Always ask for JSON.

**J-semantic (per object element)**
```
You see a small drawing from a teaching video. Without being told what it is,
name the object in ≤ 3 words. Then: does it plausibly represent "<LABEL>" in a
teaching diagram about "<TOPIC>"? Answer JSON:
{"named":"...", "represents": true|false, "confidence":0-1, "why":"≤15 words"}
```
Run blind first (named) then with the label — blind naming catches icons that only "fit" because the label tells you what to see.

**J-style (per frame)**
```
Rate 1-5 whether every element in this frame looks drawn by the same illustrator
(stroke weight, line style, fill palette, lettering). List up to 3 elements that
break the style. JSON: {"score":n, "offenders":[...]}
```

**J-clarity (per scene, frame + narration)**
```
Narration: "<TEXT>". Final frame attached.
1) Would a first-time learner understand the idea from this visual + narration? 1-5
2) Does the visual show the relationship/mechanism, or only list things? "mechanism"|"list"
3) One concrete improvement (≤20 words).
JSON: {"clarity":n, "type":"...", "fix":"..."}
```

**J-simi (pairwise)**
```
Frame A and Frame B. Which looks more like a polished whiteboard explainer
(clean marker strokes, flat pastel fills, clear diagram, good use of space)?
JSON: {"winner":"A"|"B"|"tie", "reasons":["..."]}
```
Randomize A/B order; run both orders; count a win only if consistent.

Judge hygiene: calibrate on 20 hand-labeled items before trusting a judge; report judge-human agreement.

---

## 6. Failure taxonomy (every failure gets exactly one primary code)

| Code | Stage | Meaning |
|---|---|---|
| F-ING | S1 | Lost structure (equation, table, heading) |
| F-CON | S2 | Wrong/missing concept or relation |
| F-PED | S3 | Bad order, missing prerequisite |
| F-SCR | S4 | Narration wrong, too dense, or mentions missing |
| F-ALN | S5 | Mention timing wrong |
| F-LIST | S6 | Scene is a list where a mechanism was needed |
| F-TPL | S6 | Wrong template for the idea |
| F-META | S7 | Wrong metaphor chosen |
| F-GAP | S7 | No good asset — ended as text box where an object was clearly better |
| F-LAY | S8 | Overlap, crowding, tiny elements |
| F-TIM | S9 | Reveal too early/late, idle, clutter |
| F-STY | S10 | Style break |
| F-ENC | S11 | A/V sync or encode error |

The weekly report ranks codes by count × severity. That ranking *is* next week's backlog.

---

## 7. Report format (`harness/reports/<date>.md`)

1. Run config (git sha, model ids, prompt versions, catalog version).
2. Gate pass table per golden.
3. Metrics vs previous run (delta column, red if worse).
4. Experiment results with pass/fail.
5. Failure taxonomy ranking with 3 example frames for the top code.
6. Side-by-side strip: ours vs Simi for 5 matched scenes.
7. Cost + time table.
8. Decision: what changes next and why.
