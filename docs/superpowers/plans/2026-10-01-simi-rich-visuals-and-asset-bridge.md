# Simi-Rich Visuals and AssetBridge Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make generated lessons teach like Simi: each scene builds a sparse but *pictorial* mental model (real icons for literals, geometry/diagrams/metaphors for abstractions) in sync with the narration, using Asset Lab `bridge.json` as the only asset authority.

**Architecture:** Add a deterministic **Visual Discovery lane** between S3 and S4/S6 that resolves every scene concept to a representation (icon / role / topology / diagram / metaphor) *before* narration and board planning, so narration and board are written around depictions that actually exist. Replace the stale vendored catalog with bridge-driven runtime catalogs, fix the type gate that kills similarity rungs, enforce taxonomy filtering and one-family-per-scene, and add richer scene recipes (compare, containment, cycle/feedback, cross-section) plus teaching-beat prompts.

**Tech Stack:** TypeScript (Node test runner, `npm run test:hypothesis`), `tsx` for scripts, MiniLM embeddings (`@huggingface/transformers`), resvg/ffmpeg render, Asset Lab (`Assest-Library/asset-lab`, vitest).

**Spec:** `final_plan/02_ICON_TAXONOMY_AND_ASSET_LIBRARY.md` §§2–8, 13–20, 24–25; `final_plan/01`, `03`, `04` (frozen, never edit); `final_plan/simi_teaching_methods/SIMI_TEACHING_BENCHMARK_CONTEXT.md` (behavioural benchmark, §§4–12, 38–40, 50–53, rubric §52).

## Global Constraints

- `final_plan/*` is frozen: never edit (`git diff final_plan/` must stay empty).
- Runtime consumes only `Assest-Library/asset-lab/out/asset-bridge-v2/bridge.json` (spec 02 §20). Models request `conceptId`/role/strategy; never provider IDs (01 §1.4, 02 §24.1–2).
- Ladder order R0–R11 (02 §16); filter-before-rank (02 §17); one primary family per scene (02 §19); pins only after semantic validation (02 §18).
- "A wrong icon is worse than no icon" (Simi §6): confidence floor, else role/topology/diagram/metaphor/label fallback.
- No topic hardcoding, no scene/run ID special cases, no pixel overrides (01 §15, 04 §36). Every change needs a generic invariant and a topic-swap test.
- Flaticon `licenseStatus: review` assets load only under `ASSET_USAGE_CONTEXT=local-dev` (user-approved for local development, 2026-09-30); the release evaluator must still report them as a provenance failure.
- After lock, no LLM/network/asset search (01 §1.3). Discovery output is written into the lock.
- Verify with: `npm run typecheck:hypothesis && npm run test:hypothesis` (hypothesis_claude) and `npm run typecheck && npm test && npm run taxonomy-bench` (asset-lab; expect 69 pass/1 skip, 57/57, 0 wrongIcon).
- `hypothesis_claude/CLAUDE.md`: no commits unless the user asks; append results to `docs/HANDOFF.md`; paid runs reported separately; frozen plans in `plan-lock.json` untouched.

## Review Focus

- A referent phrase with article/plural/adjective noise ("the red blood cells", "a thermostat") must still find its icon, yet an ambiguous name ("apple": fruit vs brand) must not guess.
- A concept with no pictorial asset (thermostat, memory, opportunity cost) must become a role/diagram/metaphor or a labelled box, never a similar-looking wrong icon.
- Two icons from different families (hand-drawn Downshift + Flaticon glyph) must not appear in one scene.
- A relation such as containment/comparison must be drawn by geometry, not by a printed verb and a generic arrow.
- Narration that names an object with no depiction must be caught before S6, not after three failed repairs.
- Release runs must not pass with review-licensed assets; local-dev runs must be marked as such in the lock.

## File Structure

| File | Responsibility |
|---|---|
| `catalog/bridgeCatalog.ts` (new) | Build runtime icon catalogs from a frozen bridge snapshot (all families), replacing `data/*.json` ingests |
| `scripts/ingest-bridge-assets.mjs` (new; supersedes `ingest-bridge-flaticon.mjs`) | Bridge → `catalog/data/bridge-*.json` + embeddings, per family, carrying `houseFamily`, domains, concept type |
| `catalog/referent.ts` (new) | Normalise spoken referent → candidate concept keys (articles, plurals, head noun, alias) |
| `catalog/ladder.ts` (modify) | Use referent candidates, curated-type gate, family lock, taxonomy filter, real R1/R5/R6/R7 |
| `catalog/sceneFamily.ts` (new) | Choose one primary `houseFamily` per scene; filter candidates |
| `catalog/metaphors.ts` + `catalog/data/metaphors.v1.json` (new) | Reviewed concept→role/asset metaphors with structure note + reconnect term (R5) |
| `discovery/visualDiscovery.ts` (new) | Deterministic S3.5 lane: scene concepts → `VisualVocabulary` (representation + confidence) |
| `plan/stages.ts`, `planner/board.ts` (modify) | S4/S6 consume the vocabulary; beat-structured narration; recipes beyond `chain` |
| `render/semanticCore.ts` (modify) | Missing §5 roles and §6 topologies; containment/compare geometry |
| `catalog/diagramAdapters.ts` (new) | Instantiate bridge diagram recipes (cycle/feedback, filter, tree, annotated scene) |
| `layout/*`, `timeline/compile.ts` (modify) | Arrow-leads-reveal, non-colliding arrows, closing freeze, occupancy |
| `harness/simiRubric.ts` + `harness/iconAudit.ts` (new) | Automated Simi rubric subset + wrong-icon/coverage audit over a run |

---

### Task 1: Bridge becomes the only runtime asset source

**Files:**
- Create: `scripts/ingest-bridge-assets.mjs`, `src/experimental/hypothesis/v1_claude/catalog/bridgeCatalog.ts`
- Modify: `catalog/data/enabled-libraries.json`, `catalog/registry.ts`, `catalog/bridge.ts` (`loadBridge` data path), `package.json` (`assets:sync` script)
- Delete (after green): `scripts/ingest-bridge-flaticon.mjs`
- Test: `__tests__/bridge-catalog.test.ts`

**Interfaces:**
- Produces: `loadBridgeCatalogs(ctx: 'production' | 'local-dev'): CatalogEntry[]` — entries carry `source = "<houseFamily>:<family>"`, `domains: string[]`, `conceptId: string`; `bridgeVersion(): string`.
- Consumes: `validateBridge(value, {strictSnapshot:true})` from `catalog/bridge.ts`.

- [ ] **Step 1: Failing test** — a fixture bridge with one `allowed` Downshift asset and one `review` Flaticon asset:

```ts
test('production loads only allowed assets; local-dev adds review assets', () => {
  const prod = loadBridgeCatalogs('production', fixtureDir);
  const dev = loadBridgeCatalogs('local-dev', fixtureDir);
  assert.deepEqual(prod.map((e) => e.id), ['abacus:sketchy-downshift:abacus-svg']);
  assert.equal(dev.length, 2);
  assert.ok(dev.every((e) => e.conceptId && e.houseFamily));
});
```

- [ ] **Step 2:** Run `npm run build && node --test dist/src/experimental/hypothesis/v1_claude/__tests__/bridge-catalog.test.js` → FAIL (module missing).
- [ ] **Step 3:** Implement `ingest-bridge-assets.mjs`: read bridge.json + asset root, `ingestSvg(..., {allowFillOnly:true})` for every asset (all families incl. iconify/streamline/sketchi with `fade`), write `data/bridge-<family>.json` + `.emb.bin` (reuse `embed-catalog.mjs` descriptor: `${name}. ${aliases.join(', ')}. ${domain}`), record `houseFamily`, `domain`, `conceptId`, `license.status`. Rejected-asset report to `data/bridge-ingest-report.json` (counts by reason).
- [ ] **Step 4:** Implement `bridgeCatalog.ts` (`loadBridgeCatalogs`), gated by `assetUsageContext()`; replace `enabled-libraries.json` libraries with the generated `bridge-*` files (`devOnly` for review-license families).
- [ ] **Step 5:** `npm run assets:sync` (runs Asset Lab `bridge-v2` then ingest); run tests; expect new test PASS and whole suite green with default context.
- [ ] **Step 6:** Record counts (ingested vs rejected per family) in HANDOFF.

### Task 2: Curated concept types so similarity rungs stop being dead

**Files:**
- Modify: `Assest-Library/asset-lab/src/bridge-v2.ts`, `catalog/ladder.ts:135-139 (typeCompatible)`
- Test: asset-lab `test/bridge-v2.test.ts`, runtime `__tests__/type-gate.test.ts`

**Interfaces:** Produces `BridgeConcept.inferred=false` for any concept whose literal asset was human-approved (approval is the curation act); abstract/role concepts stay `inferred:true` and never take icons by similarity.

- [ ] **Step 1: Failing test** — `typeCompatible('entity', entry, false)` true for an asset-backed literal concept; false for an `abstract` concept even with a high embedding score.
- [ ] **Step 2:** Run → FAIL (all concepts `inferred:true`).
- [ ] **Step 3:** In `bridge-v2.ts` set `inferred: false` when `approvedAssetRefs.length > 0 && conceptType === 'entity'`; keep `system` concepts inferred.
- [ ] **Step 4:** In `ladder.ts` `similarity()`: require `score >= TAU_MID_EMB` **and** same conceptType **and** (domain match OR score >= TAU_HIGH_EMB) — document thresholds as uncalibrated (E4 harness).
- [ ] **Step 5:** Re-run bridge build + both suites; `npm run taxonomy-bench` (57/57, 0 wrongIcon).

### Task 3: Referent normalisation and alias/head-noun lookup

**Files:**
- Create: `catalog/referent.ts`; Test: `__tests__/referent.test.ts`
- Modify: `catalog/ladder.ts` (`resolveObject` uses `referentKeys`), `planner/board.ts` (`boundedIconReferent` output feeds it)

**Interfaces:** Produces `referentKeys(phrase: string): string[]` ordered most→least specific, e.g. `"the red blood cells"` → `["red blood cell","blood cell","cell"]`.

- [ ] **Step 1: Failing test**

```ts
assert.deepEqual(referentKeys('the red blood cells'), ['red blood cell', 'blood cell', 'cell']);
assert.deepEqual(referentKeys('A thermostat'), ['thermostat']);
assert.deepEqual(referentKeys('memories'), ['memory']);
```

- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement: lowercase, strip `the|a|an|this|that|its|their`, singularise (existing `singular`, plus `ies→y`, `ves→f` exceptions list kept generic), emit suffix n-grams. **Step 4:** In `resolveObject`, for each key try `exact(...)` in ladder order; ambiguity (`nameIsAmbiguous`) still blocks exact. **Step 5:** tests green; add topic-swap test (different nouns, same outcomes).

### Task 4: Taxonomy filter (§17) and one-family-per-scene (§19)

**Files:**
- Create: `catalog/sceneFamily.ts`; Modify: `catalog/ladder.ts`, `resolveScene.ts`, `validation/gates.ts`
- Test: `__tests__/scene-family.test.ts`

**Interfaces:** `chooseSceneFamily(candidatesByElement: Map<string, CatalogEntry[]>): string | undefined` — the `houseFamily` covering most elements (tie → fixed family order general-drawon > domain-outline > technical-brand > alphabetical). `resolveScene` passes `sceneFamily` to `resolveObject`; entries with other families are filtered before ranking, except `technical-brand` and semantic-core.

- [ ] **Step 1: Failing tests:** (a) three literal elements, two available in general-drawon and one only in domain-outline → the third falls to role/label, not a mixed-family icon; (b) gate `family-mixed` fires (hard) if a resolved scene contains two non-exempt families.
- [ ] **Step 2–4:** Implement family choice, filter, and the gate. Domain filter: if the S2 concept/lesson `domain` (from `lessonBible.domain`) matches an asset `domain`, rank those first (keep all as fallback). **Step 5:** suite green; record family mix counts in evaluation metrics (`resolver.familyByScene`).

### Task 5: Visual Discovery lane (S3.5) — concepts → depictions before narration

**Files:**
- Create: `discovery/visualDiscovery.ts`; Modify: `pipeline/runLive.ts` (insert stage after S3, cache-keyed), `plan/stages.ts` (S4 prompt), `planner/board.ts` (S6 prompt + enums), `pipeline/lessonLock.ts` (persist)
- Test: `__tests__/visual-discovery.test.ts`

**Interfaces:**

```ts
export type Depiction =
  | { kind: 'icon'; conceptId: string; rung: 'R3'|'R4'|'R6'|'R7'|'R8'; confidence: number; houseFamily: string }
  | { kind: 'role'; role: string } | { kind: 'topology'; topology: string }
  | { kind: 'diagram'; diagramRef: string } | { kind: 'metaphor'; metaphorId: string; reconnectTerm: string }
  | { kind: 'labelled' };
export interface VisualVocabulary { sceneId: string; concepts: Array<{ conceptId: string; label: string; depiction: Depiction }>; family: string | undefined }
export function discoverVisualVocabulary(scene: TeachingSceneContract, graph: ConceptGraph, ctx): VisualVocabulary
```

- [ ] **Step 1: Failing test:** a scene with concepts {clock-like noun, thermostat-like control concept, abstract quantity} → `icon`, `metaphor|role|diagram`, `role|labelled`; no provider IDs in output; deterministic across two calls.
- [ ] **Step 2:** Implement using `referentKeys` + ladder dry-run (`resolveObject` in "probe" mode returns the rung without rendering) + `chooseSceneFamily`.
- [ ] **Step 3:** S4 prompt addition: "Concepts with an `icon` depiction may be named as concrete objects; `metaphor` concepts must be reconnected to `reconnectTerm`; `labelled` concepts must be taught by relation, not by pointing." S6 prompt: list per-scene vocabulary by concept ID + kind (never asset IDs); `representation.kind` must be consistent with it (validator problem otherwise, so repair fixes it early).
- [ ] **Step 4:** Persist vocabulary in the lock; replay never recomputes it. **Step 5:** suite green; one cold diagnostic run (paid, approved) labelled `discovery-1`; compare icon-element share vs `goal5` baseline (16 elements: 0 pictorial icons).

### Task 6: Complete semantic-core roles/topologies (§5–§6) and geometry-first relations

**Files:** Modify `render/semanticCore.ts`, `planner/board.ts` (`RELATION_ARROWS`, layouts), `layout/*`; Test `__tests__/semantic-core-coverage.test.ts`

- [ ] **Step 1: Failing test** — every name in a typed constant `SPEC_SEMANTIC_ROLES` (channel, pipeline, accumulator, fork, router, selector, mixer, comparator, limit, group, hierarchy, success, failure, uncertain, active, inactive, before, after, claim, question, contradiction, exception, prerequisite, dependency) and `SPEC_TOPOLOGIES` (feedback, bounded-flow, routing, merge, accumulation, tree, input-process-output, decision-tree, timeline, claim-evidence, rule-exception, state-machine) renders non-empty within bounds.
- [ ] **Step 2–4:** Implement drawings as deterministic vector recipes (same style tokens; no topic words). Add **containment** (`contains` relation → nested container) and **compare** (`compares` → side-by-side columns with shared axis) layouts; arrows only for causal/flow relations; no printed verbs (Simi §8).
- [ ] **Step 5:** Add a wrong-binding guard: semantic roles bind only when S6 names the role AND the concept type is `system|process|quantity` (kills `core:cost` for "passive transport"). Suite green.

### Task 7: Instantiate diagram recipes (R1) — all 93 no longer "spec-only"

**Files:** Create `catalog/diagramAdapters.ts`; Modify `catalog/ladder.ts:118-125 (classifyDiagramAdapter)`, `Assest-Library/asset-lab/src/diagram.ts`; Test `__tests__/diagram-adapters.test.ts`

**Interfaces:** `instantiateDiagram(d: BridgeDiagram, relations: SceneRelation[], size): PrimitiveVisual | undefined` — supports `flow`, `cycle`, `feedback`, `filter`, `tree`, `network-graph`; `annotated-scene`, `plot`, `chart` route to existing plot/chart renderers or return `undefined` (explicit `rejected` with reason code) — never silent.

- [ ] **Step 1: Failing test:** `classifyDiagramAdapter` returns `compiled` for topology `cycle`/`feedback`/`flow`/`tree`, `rejected` with `UNSUPPORTED_TOPOLOGY` for the rest; counts asserted (`compiled ≥ 50 of 93`).
- [ ] **Step 2–4:** Implement adapters reusing `renderTopology`; use scene relations for instance structure (no invented nodes). **Step 5:** diagram coverage metric in evaluation bundle; suite green.

### Task 8: Reviewed metaphor table (R5) with structure + reconnect

**Files:** Create `catalog/metaphors.ts`, `catalog/data/metaphors.v1.json`; Modify `ladder.ts` (`APPROVED_METAPHORS` ← loader); Test `__tests__/metaphors.test.ts`

**Interfaces:** Entry `{ conceptId, role?: string, assetConceptId?: string, structure: string, reconnectTerm: string }`; loader rejects entries lacking `structure` (Simi §39) or `reconnectTerm` (§40).

- [ ] **Step 1: Failing test** — loader rejects an entry without `structure`; accepts a complete one; `resolveObject` returns `R5-approved-metaphor` and exposes `reconnectTerm`.
- [ ] **Step 2–4:** Author ≥40 entries for abstractions (feedback, threshold, bottleneck, regularization, opportunity cost, context window, recursion, …) mapping to roles/topologies or literal assets with stated preserved structure. Data only; reviewed by user. **Step 5:** suite green.

### Task 9: Teaching-beat narration and scene recipes (Simi §§2–4, 14–16, 38–45)

**Files:** Modify `plan/stages.ts` (S3/S4 prompts), `plan/schemas.ts` (beats), `planner/board.ts` (recipe selection), `planner/exemplars/*`; Test `__tests__/teaching-beats.test.ts`

- [ ] **Step 1: Failing tests:** (a) S3 contract carries `beats: Array<{ idea, reveal: 'object'|'relation'|'state'|'interpret' }>` (2–4 per scene); (b) S4 validator flags stage-direction phrasing and a recap that repeats earlier claim text (`recap-restatement` already exists — extend to n-gram overlap ≥0.6); (c) a comparison-skilled scene selects `compare` layout, a feedback-skilled scene selects `cycle`, not `flow`.
- [ ] **Step 2–4:** Prompt: orient → one idea → draw → connect → interpret; term→meaning→hook; contrast pairs for confusable terms; analogy only with `reconnectTerm`. Map `teachingSkill` → layout deterministically (`comparison→compare`, `mechanism(loop)→cycle`, `definition→list+hook`). Add domain adapters text (math/bio/chem/software/law/psych, 03 §11) selected by `lessonBible.domain`.
- [ ] **Step 5:** Suite green; cold diagnostic `beats-1`; check `templates used ≠ all chain`.

### Task 10: Reveal rhythm, arrow quality, density, closing freeze (Simi §§4, 9–11, 50)

**Files:** Modify `timeline/compile.ts` (scheduleEdges, hold), `layout/edges.ts`, `layout/solver.ts`, `validation/gates.ts`; Test `__tests__/reveal-rhythm.test.ts`, `__tests__/arrow-routing.test.ts`

- [ ] **Step 1: Failing tests:** (a) arrows begin before their target's reveal (`arrowMs` lead) and fan-in edges are staggered ≥250 ms; (b) no edge polyline intersects a non-endpoint node bbox (solver reroutes or reorders); (c) final frame holds ≥1.5 s after last reveal (`closing-freeze` metric, WARN→gate DRAFT); (d) text bbox never overlaps a container it does not belong to (hard `label-overlap`).
- [ ] **Step 2–4:** Implement stagger + reroute (orthogonal dogleg) + freeze; scene minimum occupancy 0.35 already exists — add max-icon-count warning (>8). **Step 5:** suite green; diagnostic render contact sheets reviewed.

### Task 11: Audit and Simi-rubric tooling

**Files:** Create `harness/iconAudit.ts`, `harness/simiRubric.ts`, CLI `harness/auditCli.ts` (`npm run audit:run -- <runDir>`); Test `__tests__/icon-audit.test.ts`

- [ ] **Step 1: Failing test:** on a fixture resolved scene, audit reports per-element `{rung, family, pictorial: boolean}` and summary `{pictorialShare, roleShare, labelledShare, wrongBindingSuspects}`; rubric returns numeric subset of Simi §52 (progressive reveal, critical-claim coverage, relationship clarity, fallback quality, spatial stability, mute-test proxy = pictorial+relation coverage).
- [ ] **Step 2–4:** Implement; wrong-binding suspect = `core:*` role whose label conceptType ≠ role's declared domain. **Step 5:** run on `output/goal-videos` baselines; store `docs/SIMI-BASELINE-2026-10-01.md` (pictorial share ≈0 baseline) for before/after.

### Task 12: Lock and release-verification gaps

**Files:** Modify `pipeline/lessonLock.ts`, `harness/releaseEvidence*.ts`; Test `__tests__/lesson-lock.test.ts`

- [ ] **Step 1: Failing tests:** renderable lock without `sourceHash` is rejected; replay compares regenerated captions hash to locked hash; lock records `assetUsageContext` and `visualVocabulary` hash; release evaluator fails any run whose lock says `local-dev`.
- [ ] **Step 2–4:** Implement; evaluator accepts signed evidence files for human/held-out/rights inputs. **Step 5:** suite green.

### Task 13: Validation run, comparison, and docs

- [ ] **Step 1:** `npm run assets:sync`; Asset Lab `npm run typecheck && npm test && npm run taxonomy-bench`; runtime typecheck + tests; anti-hardcoding scan; `git diff final_plan/` empty.
- [ ] **Step 2:** Paid cold runs (user-approved; unique labels `rich-<topic>`): 5 topics × 1, `ASSET_USAGE_CONTEXT=local-dev`; report every attempt.
- [ ] **Step 3:** `npm run audit:run` on each; compare to Simi baseline: targets — pictorial share ≥50% of object elements, 0 wrong-binding suspects, ≥2 distinct templates across a lesson, arrows crossing nodes = 0, closing freeze present.
- [ ] **Step 4:** Copy drafts to `output/goal-videos/rich-*`; append HANDOFF entry; mark each acceptance item `implemented|tested|passed|failed|unmeasured`.

### Task 14: S3 Teaching Director contract completion (03 §10, 01 §4.3)

Gap from audit: `learningDelta` exists, but `mentalModel`, `misconceptionRisk[]`, `semanticVisualIntents[]`, `priorKnowledge[]` are missing in `plan/schemas.ts:76-122`; no continuity validator.

**Files:** Modify `plan/schemas.ts`, `plan/contracts.ts`, `plan/stages.ts` (S3 prompts), `plan/analyze.ts`; Test `__tests__/teaching-director-contract.test.ts`

**Interfaces:** `SceneContract` gains `mentalModel: string (≤160)`, `misconceptionRisk: string[] (≤2)`, `priorKnowledge: string[]`, `semanticVisualIntents: VisualIntent[]` (`claimId`, `conceptType` per 01 §8 enum, `strategy`, `conceptIds`, `roles`, `topology?`). S6 `visualIntents` (board.ts) are validated against them.

- [ ] **Step 1: Failing test:** schema rejects a contract lacking `mentalModel`; `analyzeTeachingPlan` errors `continuity-restatement` when two scenes share a claim n-gram overlap ≥0.6 and `continuity-term` when one concept gets two labels.
- [ ] **Step 2–4:** Add fields (derive `priorKnowledge` from earlier scenes' `requiredConceptIds` in `deriveTeachingPlan`; model supplies `mentalModel`, `misconceptionRisk`, `semanticVisualIntents`). Domain adapters from 03 §11 as a prompt table keyed by `lessonBible.domain` (math, biology, chemistry, software, law, psychology). Bump S3 prompt/stage versions; update cache keys.
- [ ] **Step 5:** Suite green; Task 5 discovery reads `semanticVisualIntents` when present.

### Task 15: Close validation-suite gaps (04 §8, §9, §23, §28, §31, §32)

**Files:** Create `__tests__/anti-hardcoding-static.test.ts`, `__tests__/lexical-variants.test.ts`, `__tests__/asset-regression.test.ts`, `__tests__/rough-regression.test.ts`; Modify `harness/boardMetrics.ts` (stable-position)

- [ ] **Step 1: Failing tests:** (a) static scan: no banned benchmark strings (`osmosis|thermostat|vaccination|half-life|spaced-repetition`, scene/run IDs) in `src/**` outside `__tests__`, fixtures, docs; (b) lexical variants: the same lesson with reworded source/entity names yields identical template/rung classes; (c) asset regression: named cases literal-exact, metaphor, role, topology, brand, missing, license-unavailable, family-mismatch, duplicate-concept, pin-reuse, each asserting the expected rung; (d) rough: math and brand bypass, no runtime seed; (e) `stablePositionViolations(timeline, layout)` counts elements whose bbox moves after reveal, target 0.
- [ ] **Step 2–4:** Implement tests and the metric; wire `stablePositionViolations` into the §28 scorecard in `evaluation-bundle.json`.
- [ ] **Step 5:** Suite green.

### Execution order and parallelism

Wave 1 (independent): Task 1, Task 6, Task 15. Wave 2 (needs bridge catalogs): Task 2, 3, then 4. Wave 3: Task 14, 8, 7, then 5 (depends on 3, 4, 8, 14). Wave 4: Task 9, 10, 12. Wave 5: Task 11, 13. Paid runs only in Task 5 (`discovery-1`), Task 9 (`beats-1`) and Task 13.

## Self-Review

- **Spec coverage:** 02 §16 (Task 1–4, 7–8), §17 (4), §18 pins (2, 3; pins remain validated by `typeCompatible`), §19 (4), §20 (1), §5–§7 (6–8), §31 asset regression (2, 3, 4, 8 tests), §24/25 (1, 12); Simi §§4, 8–11 (10), §§6, 38–40 (5, 8), §§2–3, 14–16, 45 (9), §52 (11); user question "concept→icon discovery in sync with narration" (Task 5).
- **Placeholders:** none; data authoring steps (Task 8 list) are explicit deliverables with acceptance counts.
- **Consistency:** `referentKeys`, `chooseSceneFamily`, `Depiction`, `loadBridgeCatalogs` names used identically across tasks.
- **Known risks:** Flaticon glyph style (single-colour fills) vs hand-drawn Downshift may look inconsistent — Task 4 family lock contains it; embedding thresholds remain uncalibrated (E4 harness, out of scope); Task 7 leaves `annotated-scene/plot/chart` partially rejected by design.
