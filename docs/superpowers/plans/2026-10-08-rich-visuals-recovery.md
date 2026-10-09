# Rich Visuals Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make V2 lesson videos visibly richer — exact-name icons on labelled cards, one icon family per scene, a measured wrong-icon rate — and prove the gain with numbers before and after one user-approved paid run.

**Architecture:** First build an offline "richness" measurement that replays retained, source-generated V2 runs through the existing reducer/timeline/layout code (no model calls). Then add a deterministic, render-only icon-card layer: a resolver that only accepts an exact catalog match on the asset's primary name, locks one icon family per scene with the existing `chooseSceneFamily`, and refuses reused/rejected/abstract matches; the renderer draws the icon inside the existing labelled box when it fits at ≥56 px. A human-reviewed verdict file turns wrong-icon rate into a number. Paid work (model routing bake-off, live verification) comes last and is gated on explicit user approval.

**Tech Stack:** TypeScript (Node ESM, `tsc` to `dist/`), `node:test`, zod, Resvg (`rasterizePng`), ffmpeg/ffprobe, existing V2 modules under `src/visual-v2`, `src/pipeline-v2`, `src/assets`, `src/harness`.

**Spec:** No separate spec file exists. This plan argues from (1) the lead's brief of 2026-10-08 (goal: "richer visuals with icons and better results"), (2) `docs/HANDOFF.md` 2026-10-04 entry, line ~276–278: "pictorial entities 0/18, boards are sparse" and "Still open … richer pictures (concrete-noun entity resolution, scene-family icon lock, measured wrong-icon rate)", (3) `CLAUDE.md` (no topic-specific runtime branches; wrong/missing evidence stays visible), and (4) the evidence section below, verified on disk on 2026-10-08.

## Global Constraints

- Work in worktree `/Users/anupdangi/Desktop/AnupAI/Research/lamina-labs-clone/hypothesis_claude/.claude/worktrees/v2b`, branch `teaching-compiler-v2` (tip `ff584e8` when this plan was written).
- Before starting and before ending each session: run `agent-master status --format json`, then `agent-master checkpoint` / `agent-master validate` (AGENTS.md). On 2026-10-08 `agent-master` was **not on PATH** (`which agent-master` → not found) and `.master/` does not exist in this worktree; if that is still true, record "agent-master unavailable" in the HANDOFF entry and continue.
- Gates: `pnpm run typecheck` and `pnpm run test:hypothesis` (builds `dist/`, runs 1,481+ Node tests, the retained-board audit test, alignment and RAG suites). Both must pass at the end of every task.
- Runtime code must never branch on a lesson title, case ID, topic word or keyword list (CLAUDE.md). Icon choice comes only from the catalog's own names, the bound concept's kind, and the reviewed-verdict data file.
- A wrong picture is worse than a label (`src/visual-v2/resolver/typeGate.ts`). Badges accept only `selectionBasis` `exact` or `curated`, and only when the referent equals the asset's **primary** name (`entry.names[0]`).
- Paid model or TTS calls require explicit user approval in chat for that exact run. Repo cap: `LESSON_COST_CAP_USD[60] = 0.1` (`src/run/config.ts:13`) — $0.10 per 60 s clip. Every paid step below is marked **PAID**.
- Commit steps run **only after the user approves committing in chat** (CLAUDE.md: "Do not commit … unless the user explicitly requests it"). Never push.
- Videos and run outputs stay in gitignored `.data/` or `output/`; never `git add` them.
- Never edit files listed in `docs/superpowers/plans/plan-lock.json` or the lock itself. Do not add this plan to the lock.
- After each task, append a dated entry to `docs/HANDOFF.md` (commands, results, limitations, next task) with each acceptance item marked `implemented` / `tested` / `passed` / `failed` / `unmeasured`.
- Human verdicts on pictures are recorded only from the user's own chat messages, quoted with date. An agent never fills in a verdict.

## Review Focus

1. **Abstract noun gets an icon** (e.g. "energy", "interest", "time"): a reasonable person expects no picture unless a human accepted that exact (asset, word) pair or the catalog's primary name is literally that word; a reviewed `reject` must block it. Pinned by Task 2 "abstract and process labels never badge" + "a rejected verdict blocks the badge", and Task 4 real-catalog gold test.
2. **Same icon reused for two different things in one scene** (an entity picture for "nucleus" and a badge for "cell" resolving to the same asset): expect the second to stay a label. Pinned by Task 2 "a reserved asset is not reused for another referent" and Task 1 metric `assetReuseConflicts`.
3. **Icon too small at 1080p or squeezing the label into overflow**: expect no icon below 56 px and never a label that stops fitting. Pinned by Task 3 `iconCard` tests (short box, long label).
4. **Icon licence/rights evidence missing**: every drawn badge asset must appear in `asset-provenance.json` with its licence. Pinned by Task 3 `badgeRightsEvidence` test.
5. **Icon families mixed in one scene** (verified risk: `cell` resolves to `simi-house-v1/domain-outline`, `battery` to `simi-house-v1/general-drawon`): expect one family per scene, minority-family icons dropped. Pinned by Task 2 "one family per scene" and Task 1 metric `familyMix`.

---

## Evidence (verified on disk 2026-10-08)

- **Why boards are icon-free.** `elementVisual` (`src/visual-v2/renderer/visuals.ts`) draws an entity as a picture only when `depictEntity` (`typeGate.ts`) gets concept kind `entity` and an `exact`/`curated` asset; tokens are always labelled boxes. In the eight retained V2 cold runs (`.data/benchmark-v2/cold-v2/2026-10-04-final*/*/*/runs/*/lesson-prep.json`) there are 46 concepts: 2 of kind `entity` ("Sound and light examples", "Series connection"), the rest `process`/`quantity`/`event`/`rule`/`formula`, and **no** `validatedAssetId`. `runLessonV2.ts:432–434` only maps Visual Discovery icons for `conceptKind === 'entity'`. Result: 0 pictures.
- **The catalog has usable exact pictures.** Offline probe of `resolveObject(referent, {visualStrategy:'literal'})` on the real 19,076-entry catalog (`allCatalogEntries()`), ~24 ms per lookup: exact primary-name hits for cell, battery, resistor, coin, money, water, ambulance, graph, array, thermometer, time, dna, heart, clock, bank; no exact hit for compound interest, prophase, energy, interest, chromosomes; "source" resolves to generated asset `book` through a **synonym** (`names = [book, document, source]`) — a wrong picture the primary-name rule refuses.
- **Families split.** `cell`, `water`, `graph`, `dna` → `simi-house-v1/domain-outline`; `battery`, `coin`, `heart`, `clock` → `simi-house-v1/general-drawon`.
- **Existing metric modules are V1-shaped.** `src/assets/resolutionMetrics.ts` (15 lines) counts V1 `ResolutionRecord` rungs; `src/harness/sceneRichness.ts` measures V1 `SceneSpec`. Neither sees a V2 `BoardState`. The V2 equivalent of "which entity got which picture" already exists as `auditRenderedEntityAssets` (`src/pipeline-v2/renderedEntityAssets.ts`); Task 1 reuses it and mirrors the V1 summary names where meaning matches instead of duplicating rung counting.
- **Retained V2 run layout:** `<run>/lesson-prep.json` (`plan.sections`, `graph.concepts`, `stageRuns`), `<run>/v2/scene.<sceneId>.json` (`transition`, `ops`, `beatTimings`, `timelineHash`), `<run>/evaluation-bundle.json` (`usage.costUsd`, `failures`), `<run>/structured/<stage>/<n>/report.json`, `<run>/video.mp4`. `scripts/audit-retained-board-v2.mjs` already replays these snapshots with `startScene` → `compileSceneTimeline` → `layoutScene`.
- **Lock safety.** `publishSceneLockV2` (`lockV2.ts:1049–1073`) stores rendered SVG bytes; verification replays hashes, not the renderer, so a renderer change does not invalidate existing locks.
- **Cost today:** retained compound-interest run: evaluation usage $0.0188 for 60 s (33 calls); prep stages (`stageRuns`) S1 10.6 s / S2 9.4 s / S3 19.0 s / S3b beats 32.2 s, all `openai/gpt-6-luna`. Cost is far under the $0.10 cap; latency is the larger problem.
- **Model routing mechanism already exists:** `src/planner/env.ts` reads `OPENROUTER_SCENE_MODEL`, `OPENROUTER_CONTENT_MODEL`, `OPENROUTER_{SYLLABUS,CONCEPTS,PLAN,SCRIPT}_MODEL`, `OPENROUTER_VISION_MODEL`; `lessonCli` takes `--planner`, `--s6-planner`, `--content`; `scripts/v2-benchmark.mjs` forwards `V2_BENCH_PLANNER` as `--s6-planner`. S3b Visual Discovery uses `modelFor('plan')` (`src/run/lesson.ts:153`).
- **cmp comparison inputs:** sources and instructions are recorded verbatim in `cmp-worktrees/v1.0.0/.data/{cmp/cmp-bio01,cmp-CS-01/cmp-cs01,cmp-MATH-01/cmp-math01}/runs/*/lesson-prep.json` → `request.source` (== `request.sourceDoc.text`, sha256 matches `contentSha256`), `request.instruction`, `targetDurationSec: 60`. Only cmp-math01 has a v1.0.0 `video.mp4`. v0.3.0 has one MP4 per case under `cmp-worktrees/v0.3.0/output/cmp-*/`.

### Why not roll back to v0.3.0

- The lead's frame inspection (2026-10-08) of the v0.3.0 cmp-BIO-01 video found text overlapping the lock icon, a label overlapping boxes, a hallucinated "key 1..key 4 / q" attention table inside an osmosis lesson, and a subtitle bar covering content. v1.0.0/V2 frames are clean but icon-free. v0.3.0 is not more correct; it is noisier.
- Verified: v0.3.0's cmp-BIO-01 `…-1min.scenes/manifest.json` has 2 scenes of 28.7 s + 25.2 s = 53.9 s for a "1min" request, `timingMode: "engine-estimated"`, and `audio: null` per scene — no aligned narration evidence.
- v0.3.0 (tag 2026-09-19) predates the V2 lock, provenance, rights evidence and the type gate that keeps wrong pictures off the board.
- The two v0.3.0 ideas worth keeping already exist in V2: per-scene SVGs (V2 locks every frame SVG in `svgAssets`) and subtitles (V2 writes `captions.vtt`). Burned-in subtitles caused the clutter, so they are not harvested.
- Decision: **no rollback.** Task 5 makes the three-way comparison reproducible so this decision can be re-checked from files, not memory.

### Out of scope (and why)

- **Relation glyphs on arrows:** they would be drawn after layout and bypass the `edge_label_collision` / `edge_text_collision` checks in `sceneLayout.ts`; adding them safely needs a layout change. Revisit after Task 7 numbers.
- **Head-noun fallback** ("parent cell" → cell): the ladder deliberately refuses head-noun matches ("passive transport" must not become "transport"). Keep refusing until Task 4 verdicts show which head nouns are safe.
- **New representation families** (17 of 19 unregistered): separate V3 roadmap work.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src/assets/referent.ts` | modify | add `referentOf(label)` (normalised full referent) |
| `src/harness/v2Richness.ts` | create | pure per-scene/pooled V2 richness metrics |
| `src/harness/retainedV2Run.ts` | create | replay a retained V2 run dir into `CompiledScene[]`; derive `IconUse[]` |
| `src/harness/v2RichnessReport.ts` | create | assemble the `v2-richness/v1` JSON report over many runs |
| `src/harness/v2RichnessCli.ts` | create | argv wrapper: print table, write JSON, review score, acceptance |
| `src/assets/badgeReview.ts` | create | load/validate human verdicts on (asset, referent) pairs |
| `src/assets/data/badge-review.v1.json` | create | the verdict data (starts empty) |
| `src/visual-v2/resolver/referentBadge.ts` | create | exact-name badge resolver + scene family lock + reuse guard |
| `src/visual-v2/renderer/visuals.ts` | modify | `iconCard`, `iconCardFits`, `badgeSide`, `BADGE_MIN_SIDE_PX`; badge param |
| `src/visual-v2/renderer/frame.ts` | modify | `CompileSceneOptions`, badges on `CompiledScene`, context icon by title |
| `src/pipeline-v2/badgeProvenance.ts` | create | rights evidence for drawn badge assets |
| `src/pipeline-v2/runLessonV2.ts` | modify | compile with `icon-cards`, provenance, `v2.iconBadges` metric |
| `scripts/v2-contact-sheet.mjs` | create | per-run before/after contact sheet PNG from retained runs |
| `src/harness/wrongIcon.ts` | create | wrong-icon rate + review coverage from `IconUse[]` and verdicts |
| `src/harness/richnessAcceptance.ts` | create | numeric acceptance rules over baseline/projection/live reports |
| `scripts/badge-review-sheet.mjs` | create | human review sheet PNG + `candidates.json` |
| `src/__tests__/fixtures/icon-gold.v1.json` | create | hand-authored gold inputs for offline tests |
| `scripts/cmp-v1.mjs`, `scripts/cmp-v1.test.mjs` | create | extract cmp sources/manifest; ffmpeg contact sheets for any MP4 |
| `bench/cmp-v1/manifest.json`, `bench/cmp-v1/sources/*.md` | create (by script) | frozen cmp inputs |
| `src/harness/stageCost.ts`, `src/harness/stageCostCli.ts` | create | per-stage cost/latency/first-try report from retained runs |
| `package.json` | modify | `richness:v2`, `stage-cost`, add `scripts/cmp-v1.test.mjs` to `test:hypothesis` |
| `src/__tests__/v2-richness.test.ts`, `referent-badge.test.ts`, `icon-cards.test.ts`, `icon-gold.test.ts`, `richness-acceptance.test.ts`, `stage-cost.test.ts` | create | tests |

---

### Task 1: Offline V2 richness baseline

**Files:**
- Modify: `src/assets/referent.ts` (append one export)
- Create: `src/harness/v2Richness.ts`, `src/harness/retainedV2Run.ts`, `src/harness/v2RichnessReport.ts`, `src/harness/v2RichnessCli.ts`
- Modify: `package.json` (`scripts`)
- Test: `src/__tests__/v2-richness.test.ts`
- Output: `harness/reports/rich-visuals/baseline.labels.json`

**Interfaces:**
- Consumes: `auditRenderedEntityAssets(states, rectsByState, conceptEntries)` (`src/pipeline-v2/renderedEntityAssets.ts`); `compileScene(sceneId, title, timeline, lessonId?, concepts?, prior?)` (`frame.ts`); `startScene`, `emptyBoardState` (`board-state/reducer.ts`); `compileSceneTimeline({ ops, initial, beats })`; `SceneBoardDraftSchema` (`ops-plan/types.ts`); `isExemptFamily` (`assets/sceneFamily.ts`); `allCatalogEntries()` (`assets/semantic.ts`).
- Produces:
  - `referentOf(label: string): string` in `src/assets/referent.ts`
  - `interface IconUse { elementId: string; referent: string; assetId: string; houseFamily?: string; sidePx: number; kind: 'entity-picture' | 'badge' }`
  - `interface V2SceneRichnessInput { sceneId: string; states: readonly BoardState[]; icons: readonly IconUse[] }`
  - `measureV2Scene(input): V2SceneRichness`, `summarizeV2Richness(rows): V2RichnessSummary` (fields listed in code below)
  - `loadRetainedV2Run(runDir: string): Promise<RetainedV2Run>`; `iconUsesFor(scene: CompiledScene, catalog?: ReadonlyMap<string, CatalogEntry>): IconUse[]`
  - `richnessReport(runDirs: readonly string[]): Promise<RichnessReport>` with `RichnessReport = { schemaVersion: 'v2-richness/v1'; composition: 'labels' | 'icon-cards'; runs: RichnessRunReport[]; pooled: V2RichnessSummary }`

- [ ] **Step 0: Session start checks**

Run: `agent-master status --format json; git -C /Users/anupdangi/Desktop/AnupAI/Research/lamina-labs-clone/hypothesis_claude/.claude/worktrees/v2b status --short | head; git -C /Users/anupdangi/Desktop/AnupAI/Research/lamina-labs-clone/hypothesis_claude/.claude/worktrees/v2b log --oneline -1`
Expected: branch `teaching-compiler-v2`; only untracked `benchmark-review-2026-10-03/*` entries plus this plan. If `agent-master` is not found, note it for the HANDOFF entry.

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/v2-richness.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { BoardOpSchema } from '../visual-v2/board-ops/types.js';
import { applyOps, emptyBoardState } from '../visual-v2/board-state/reducer.js';
import { referentOf } from '../assets/referent.js';
import { measureV2Scene, summarizeV2Richness, type IconUse } from '../harness/v2Richness.js';
import { loadRetainedV2Run } from '../harness/retainedV2Run.js';
import { richnessReport } from '../harness/v2RichnessReport.js';

// Synthetic contract fixture only; never a quality or visual measurement.
const G = 'simi-house-v1/general-drawon';
const D = 'simi-house-v1/domain-outline';
const op = (raw: unknown) => BoardOpSchema.parse(raw);
const ops = [
  op({ op: 'add', opId: 'b1.e1', beatId: 'b1', id: 'e1', element: { type: 'entity', conceptId: 'c1', label: 'Cell', provenance: 'illustrative' }, at: { region: 'left' } }),
  op({ op: 'add', opId: 'b1.t1', beatId: 'b1', id: 't1', element: { type: 'token', text: 'ATP', provenance: 'illustrative' }, at: { region: 'right' } }),
  op({ op: 'add', opId: 'b1.x1', beatId: 'b1', id: 'x1', element: { type: 'text', text: 'Energy note', role: 'note', provenance: 'illustrative' }, at: { region: 'bottom' } }),
  op({ op: 'connect', opId: 'b1.r1', beatId: 'b1', id: 'r1', from: 'e1', to: 't1', relation: 'produces', label: 'makes' }),
];
const state = applyOps(emptyBoardState(), ops).state;

test('referentOf strips determiners and singularises the last word', () => {
  assert.equal(referentOf('The Cells'), 'cell');
  assert.equal(referentOf('Compound interest'), 'compound interest');
  assert.equal(referentOf(''), '');
});

test('measureV2Scene counts icons, families, reuse conflicts and text on the board', () => {
  const icons: IconUse[] = [
    { elementId: 'e1', referent: 'cell', assetId: 'a1', houseFamily: G, sidePx: 80, kind: 'entity-picture' },
    { elementId: 't1', referent: 'atp', assetId: 'a1', houseFamily: D, sidePx: 50, kind: 'badge' },
  ];
  const row = measureV2Scene({ sceneId: 's1', states: [state], icons });
  assert.equal(row.depictableCount, 2);
  assert.equal(row.iconBearingCount, 2);
  assert.equal(row.labelOnlyEntityCount, 0);
  assert.equal(row.edgeCount, 1);
  assert.deepEqual(row.iconFamilies, [D, G]);
  assert.equal(row.familyMix, true);
  assert.equal(row.assetReuseConflicts, 1);
  assert.equal(row.minIconSidePx, 50);
  assert.equal(row.textChars, 'Cell'.length + 'ATP'.length + 'Energy note'.length + 'makes'.length);
  assert.equal(row.wordsOnBoard, 5);
  assert.deepEqual(row.elementVariety, ['entity', 'text', 'token']);
});

test('a board with no icons reports zero icon share and every entity label-only', () => {
  const row = measureV2Scene({ sceneId: 's1', states: [state], icons: [] });
  const summary = summarizeV2Richness([row, row]);
  assert.equal(summary.iconBearingShare, 0);
  assert.equal(summary.labelOnlyEntityRatio, 1);
  assert.equal(summary.minIconSidePx, null);
  assert.equal(summary.scenes, 2);
});

const beatTimings = [{ beatId: 'one.b1', startMs: 0, endMs: 3000, sentences: [{ startMs: 0, endMs: 3000 }] }];
const prep = {
  request: { id: 'fixture-lesson' },
  plan: { sections: [{ id: 'one', title: 'One' }] },
  graph: { concepts: [{ id: 'x', label: 'X', kind: 'process' }] },
};
const snapshot = {
  transition: { mode: 'clean' },
  ops: [{ op: 'add', opId: 'o1', beatId: 'one.b1', id: 'x1', element: { type: 'entity', conceptId: 'x', label: 'X', provenance: 'illustrative' }, at: { region: 'center' } }],
  beatTimings,
  timelineHash: 'not-the-replayed-hash',
};

async function fixtureRun(withScene: boolean): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'v2-richness-'));
  await mkdir(path.join(dir, 'v2'));
  await writeFile(path.join(dir, 'lesson-prep.json'), JSON.stringify(prep));
  if (withScene) await writeFile(path.join(dir, 'v2', 'scene.one.json'), JSON.stringify(snapshot));
  return dir;
}

test('loadRetainedV2Run replays a retained scene without a video and marks it incomplete', async () => {
  const dir = await fixtureRun(true);
  try {
    const run = await loadRetainedV2Run(dir);
    assert.equal(run.status, 'loaded');
    assert.equal(run.lessonId, 'fixture-lesson');
    assert.equal(run.complete, false);
    assert.equal(run.hardFailures, null);
    assert.equal(run.scenes.length, 1);
    assert.equal(run.scenes[0]!.timelineReplayMatches, false);
    const report = await richnessReport([dir]);
    assert.equal(report.runs[0]!.summary.iconBearingShare, 0);
    assert.equal(report.pooled.scenes, 0, 'runs without video.mp4 never enter the pooled numbers');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a missing scene snapshot makes the run unavailable, not silently shorter', async () => {
  const dir = await fixtureRun(false);
  try {
    const run = await loadRetainedV2Run(dir);
    assert.equal(run.status, 'unavailable');
    assert.match(run.reason ?? '', /scene\.one\.json/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm run build && node --test dist/src/__tests__/v2-richness.test.js`
Expected: build FAILS with `Module '"../assets/referent.js"' has no exported member 'referentOf'` and missing modules `../harness/v2Richness.js`, `../harness/retainedV2Run.js`, `../harness/v2RichnessReport.js`.

- [ ] **Step 3: Add `referentOf`**

Append to `src/assets/referent.ts`:

```ts
/** The full normalised referent of a label (determiners stripped, last word singular): the key icons and verdicts use. */
export const referentOf = (label: string): string => referentKeys(label)[0] ?? '';
```

- [ ] **Step 4: Create `src/harness/v2Richness.ts`**

```ts
import type { BoardEdge, BoardElement, BoardState } from '../visual-v2/board-state/types.js';
import { isExemptFamily } from '../assets/sceneFamily.js';

/**
 * Structural richness of V2 boards (offline, deterministic). It counts what is drawn; it never establishes teaching
 * quality. Names mirror V1 `RichnessSummary` where the meaning matches; V1 rung counts (resolutionMetrics.ts) do not apply to V2.
 */
export interface IconUse { elementId: string; referent: string; assetId: string; houseFamily?: string; sidePx: number; kind: 'entity-picture' | 'badge' }
export interface V2SceneRichnessInput { sceneId: string; states: readonly BoardState[]; icons: readonly IconUse[] }
export interface V2SceneRichness {
  sceneId: string;
  elementCount: number;
  entityCount: number;
  tokenCount: number;
  edgeCount: number;
  /** Entities and tokens: the elements drawn as labelled boxes unless they carry a picture. */
  depictableCount: number;
  iconBearingCount: number;
  labelOnlyEntityCount: number;
  distinctAssetIds: string[];
  iconFamilies: string[];
  familyMix: boolean;
  /** Assets drawn for more than one referent in this scene (target 0). */
  assetReuseConflicts: number;
  minIconSidePx: number | null;
  textChars: number;
  wordsOnBoard: number;
  elementVariety: string[];
}
export interface V2RichnessSummary {
  scenes: number;
  iconBearingShare: number | null;
  labelOnlyEntityRatio: number | null;
  distinctAssetIds: number;
  familyMixScenes: number;
  assetReuseConflicts: number;
  minIconSidePx: number | null;
  meanTextChars: number;
  meanWordsOnBoard: number;
  meanElementVariety: number;
}

function textOf(el: BoardElement): string {
  const spec = el.spec;
  switch (spec.type) {
    case 'entity': return spec.label;
    case 'token': return spec.text;
    case 'text': return spec.text;
    case 'value': return `${spec.label} ${String(el.value ?? spec.value)}${spec.unit ? ` ${spec.unit}` : ''}`;
    case 'kit': return spec.label ?? '';
    case 'equation': return '';
  }
}
const wordCount = (text: string): number => (text.trim() ? text.trim().split(/\s+/).length : 0);

export function measureV2Scene(input: V2SceneRichnessInput): V2SceneRichness {
  const live = new Map<string, BoardElement>();
  const edges = new Map<string, BoardEdge>();
  for (const state of input.states) {
    for (const el of Object.values(state.elements)) if (el.lifecycle.removedAtBeat === undefined && !live.has(el.id)) live.set(el.id, el);
    for (const edge of Object.values(state.edges)) if (edge.lifecycle.removedAtBeat === undefined && !edges.has(edge.id)) edges.set(edge.id, edge);
  }
  const elements = [...live.values()];
  const icons = input.icons.filter((icon) => live.has(icon.elementId));
  const withIcon = new Set(icons.map((icon) => icon.elementId));
  const depictable = elements.filter((el) => el.spec.type === 'entity' || el.spec.type === 'token');
  const entities = elements.filter((el) => el.spec.type === 'entity');
  const referentsByAsset = new Map<string, Set<string>>();
  for (const icon of icons) referentsByAsset.set(icon.assetId, (referentsByAsset.get(icon.assetId) ?? new Set<string>()).add(icon.referent));
  const iconFamilies = [...new Set(icons.map((icon) => icon.houseFamily).filter((family): family is string => !isExemptFamily(family)))].sort();
  const texts = [...elements.map(textOf), ...[...edges.values()].map((edge) => edge.label ?? '')];
  return {
    sceneId: input.sceneId,
    elementCount: elements.length,
    entityCount: entities.length,
    tokenCount: depictable.length - entities.length,
    edgeCount: edges.size,
    depictableCount: depictable.length,
    iconBearingCount: depictable.filter((el) => withIcon.has(el.id)).length,
    labelOnlyEntityCount: entities.filter((el) => !withIcon.has(el.id)).length,
    distinctAssetIds: [...referentsByAsset.keys()].sort(),
    iconFamilies,
    familyMix: iconFamilies.length > 1,
    assetReuseConflicts: [...referentsByAsset.values()].filter((referents) => referents.size > 1).length,
    minIconSidePx: icons.length ? Math.min(...icons.map((icon) => icon.sidePx)) : null,
    textChars: texts.reduce((sum, text) => sum + text.length, 0),
    wordsOnBoard: texts.reduce((sum, text) => sum + wordCount(text), 0),
    elementVariety: [...new Set(elements.map((el) => (el.spec.type === 'kit' ? `kit:${el.spec.kit}` : el.spec.type)))].sort(),
  };
}

export function summarizeV2Richness(rows: readonly V2SceneRichness[]): V2RichnessSummary {
  const sum = (pick: (row: V2SceneRichness) => number): number => rows.reduce((total, row) => total + pick(row), 0);
  const mean = (pick: (row: V2SceneRichness) => number): number => (rows.length ? sum(pick) / rows.length : 0);
  const depictable = sum((row) => row.depictableCount);
  const entities = sum((row) => row.entityCount);
  const sides = rows.flatMap((row) => (row.minIconSidePx === null ? [] : [row.minIconSidePx]));
  return {
    scenes: rows.length,
    iconBearingShare: depictable ? sum((row) => row.iconBearingCount) / depictable : null,
    labelOnlyEntityRatio: entities ? sum((row) => row.labelOnlyEntityCount) / entities : null,
    distinctAssetIds: new Set(rows.flatMap((row) => row.distinctAssetIds)).size,
    familyMixScenes: rows.filter((row) => row.familyMix).length,
    assetReuseConflicts: sum((row) => row.assetReuseConflicts),
    minIconSidePx: sides.length ? Math.min(...sides) : null,
    meanTextChars: mean((row) => row.textChars),
    meanWordsOnBoard: mean((row) => row.wordsOnBoard),
    meanElementVariety: mean((row) => row.elementVariety.length),
  };
}
```

- [ ] **Step 5: Create `src/harness/retainedV2Run.ts`**

```ts
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { CatalogEntry } from '../assets/catalog.js';
import { allCatalogEntries } from '../assets/semantic.js';
import { referentOf } from '../assets/referent.js';
import { auditRenderedEntityAssets } from '../pipeline-v2/renderedEntityAssets.js';
import { SceneBoardDraftSchema } from '../visual-v2/ops-plan/types.js';
import { emptyBoardState, startScene } from '../visual-v2/board-state/reducer.js';
import type { BoardState } from '../visual-v2/board-state/types.js';
import { compileSceneTimeline, type BeatTiming } from '../visual-v2/timeline/compile.js';
import { compileScene, type CompiledScene } from '../visual-v2/renderer/frame.js';
import type { PriorLayout } from '../visual-v2/layout/sceneLayout.js';
import type { ConceptInfo } from '../visual-v2/resolver/typeGate.js';
import type { Rect } from '../visual-v2/kits/geometry.js';
import type { IconUse } from './v2Richness.js';

/**
 * Read-only replay of a retained V2 run (lesson-prep.json + v2/scene.<id>.json) through the current reducer, timeline and
 * layout. Metric-grade, not byte-identical: retained snapshots lack semantic event bindings, so `timelineReplayMatches`
 * reports whether the replayed timeline hash equals the recorded one. Never calls a provider and never writes.
 */
export interface RetainedV2Scene { scene: CompiledScene; timelineReplayMatches: boolean }
export interface RetainedV2Run {
  runDir: string;
  lessonId: string;
  /** A run counts as complete only when it produced video.mp4 (CLAUDE.md: only complete generated lessons enter visual review). */
  complete: boolean;
  status: 'loaded' | 'unavailable';
  reason?: string;
  hardFailures: number | null;
  scenes: RetainedV2Scene[];
}

interface PrepShape {
  request?: { id?: string };
  plan?: { sections?: Array<{ id?: unknown; title?: unknown }>; lessonBible?: { domain?: string } };
  graph?: { concepts?: Array<{ id: string; label: string; kind: ConceptInfo['kind'] }> };
  validatedByConcept?: Record<string, string>;
}
interface SnapshotShape { transition?: unknown; ops?: unknown; beatTimings?: unknown; timelineHash?: unknown }

const readJson = async (file: string): Promise<unknown> => JSON.parse(await readFile(file, 'utf8'));
const exists = (file: string): Promise<boolean> => access(file).then(() => true, () => false);

async function hardFailureCount(run: string): Promise<number | null> {
  try {
    const bundle = await readJson(path.join(run, 'evaluation-bundle.json')) as { failures?: Array<{ hard?: boolean }> };
    return Array.isArray(bundle.failures) ? bundle.failures.filter((failure) => failure.hard === true).length : null;
  } catch { return null; }
}

export async function loadRetainedV2Run(runDir: string): Promise<RetainedV2Run> {
  const run = path.resolve(runDir);
  const base = { runDir: run, lessonId: path.basename(run), complete: await exists(path.join(run, 'video.mp4')), hardFailures: await hardFailureCount(run), scenes: [] as RetainedV2Scene[] };
  let prep: PrepShape;
  try { prep = await readJson(path.join(run, 'lesson-prep.json')) as PrepShape; }
  catch (error) { return { ...base, status: 'unavailable', reason: `lesson-prep.json: ${(error as Error).message}` }; }
  const sections = prep.plan?.sections;
  if (!Array.isArray(sections)) return { ...base, status: 'unavailable', reason: 'lesson-prep.json has no plan.sections' };
  const lessonId = typeof prep.request?.id === 'string' ? prep.request.id : base.lessonId;
  const domain = prep.plan?.lessonBible?.domain;
  const validated = prep.validatedByConcept ?? {};
  const concepts = new Map<string, ConceptInfo>((prep.graph?.concepts ?? []).map((concept) => [concept.id, {
    id: concept.id, label: concept.label, kind: concept.kind,
    ...(domain ? { domain } : {}),
    ...(validated[concept.id] ? { validatedAssetId: validated[concept.id] } : {}),
  }]));
  let carried: BoardState = emptyBoardState();
  let prior: PriorLayout | undefined;
  const scenes: RetainedV2Scene[] = [];
  for (const section of sections) {
    const sceneId = section.id;
    if (typeof sceneId !== 'string' || !/^[A-Za-z0-9_.-]+$/.test(sceneId)) return { ...base, lessonId, scenes, status: 'unavailable', reason: `unsafe scene id ${String(sceneId)}` };
    let saved: SnapshotShape;
    try { saved = await readJson(path.join(run, 'v2', `scene.${sceneId}.json`)) as SnapshotShape; }
    catch { return { ...base, lessonId, scenes, status: 'unavailable', reason: `missing or unreadable v2/scene.${sceneId}.json` }; }
    const draft = SceneBoardDraftSchema.safeParse({ transition: saved.transition, ops: saved.ops });
    if (!draft.success || !Array.isArray(saved.beatTimings)) return { ...base, lessonId, scenes, status: 'unavailable', reason: `scene ${sceneId} snapshot is not replayable` };
    const initial = startScene(carried, draft.data.transition, sceneId);
    const timeline = compileSceneTimeline({ ops: draft.data.ops, initial, beats: saved.beatTimings as BeatTiming[] });
    const scene = compileScene(sceneId, typeof section.title === 'string' ? section.title : sceneId, timeline, lessonId, concepts, prior);
    scenes.push({ scene, timelineReplayMatches: timeline.hash === saved.timelineHash });
    carried = timeline.states.at(-1)!;
    prior = { state: carried, geometry: scene.geometry };
  }
  return { ...base, lessonId, scenes, status: 'loaded' };
}

let catalogById: Map<string, CatalogEntry> | undefined;
const defaultCatalog = (): Map<string, CatalogEntry> => (catalogById ??= new Map(allCatalogEntries().map((entry) => [entry.id, entry])));

/** Last settled rectangle of an element in the scene, and its label (entity label or token text). */
export function elementRect(scene: CompiledScene, id: string): Rect | undefined {
  const states = scene.timeline.states;
  for (let i = states.length - 1; i >= 0; i--) { const rect = scene.geometry.rectFor(states[i]!, id); if (rect) return rect; }
  return undefined;
}
export function elementLabel(scene: CompiledScene, id: string): string {
  for (const state of scene.timeline.states) {
    const spec = state.elements[id]?.spec;
    if (spec?.type === 'entity') return spec.label;
    if (spec?.type === 'token') return spec.text;
  }
  return '';
}

/** Pictures actually drawn in a scene. Entity pictures use the same type gate as the renderer (auditRenderedEntityAssets). */
export function iconUsesFor(scene: CompiledScene, catalog: ReadonlyMap<string, CatalogEntry> = defaultCatalog()): IconUse[] {
  const states = scene.timeline.states;
  const audit = auditRenderedEntityAssets(
    states,
    states.map((state) => Object.keys(state.elements).flatMap((id) => { const rect = scene.geometry.rectFor(state, id); return rect ? [{ id, rect }] : []; })),
    [...(scene.concepts?.entries() ?? [])],
  );
  return audit.evidence.flatMap((evidence) => {
    if (evidence.depictionFamily !== 'pictorial' || !evidence.meaningful || !evidence.resolvedAssetId) return [];
    const rect = elementRect(scene, evidence.elementId);
    const houseFamily = catalog.get(evidence.resolvedAssetId)?.houseFamily;
    return [{ elementId: evidence.elementId, referent: referentOf(elementLabel(scene, evidence.elementId)), assetId: evidence.resolvedAssetId, ...(houseFamily ? { houseFamily } : {}), sidePx: rect ? Math.min(rect.w, rect.h) : 0, kind: 'entity-picture' as const }];
  });
}
```

- [ ] **Step 6: Create `src/harness/v2RichnessReport.ts`**

```ts
import { iconUsesFor, loadRetainedV2Run } from './retainedV2Run.js';
import { measureV2Scene, summarizeV2Richness, type IconUse, type V2RichnessSummary, type V2SceneRichness } from './v2Richness.js';

export interface RichnessRunReport {
  runDir: string;
  lessonId: string;
  complete: boolean;
  status: 'loaded' | 'unavailable';
  reason?: string;
  hardFailures: number | null;
  timelineReplayMismatches: number;
  summary: V2RichnessSummary;
  scenes: V2SceneRichness[];
  icons: Array<IconUse & { sceneId: string }>;
}
export interface RichnessReport { schemaVersion: 'v2-richness/v1'; composition: 'labels' | 'icon-cards'; runs: RichnessRunReport[]; pooled: V2RichnessSummary }

export async function richnessReport(runDirs: readonly string[]): Promise<RichnessReport> {
  const runs: RichnessRunReport[] = [];
  for (const runDir of runDirs) {
    const run = await loadRetainedV2Run(runDir);
    const perScene = run.scenes.map(({ scene }) => ({ scene, icons: iconUsesFor(scene) }));
    const scenes = perScene.map(({ scene, icons }) => measureV2Scene({ sceneId: scene.sceneId, states: scene.timeline.states, icons }));
    runs.push({
      runDir: run.runDir, lessonId: run.lessonId, complete: run.complete, status: run.status, ...(run.reason ? { reason: run.reason } : {}),
      hardFailures: run.hardFailures, timelineReplayMismatches: run.scenes.filter((item) => !item.timelineReplayMatches).length,
      summary: summarizeV2Richness(scenes), scenes,
      icons: perScene.flatMap(({ scene, icons }) => icons.map((icon) => ({ ...icon, sceneId: scene.sceneId }))),
    });
  }
  const pooled = summarizeV2Richness(runs.filter((run) => run.complete && run.status === 'loaded').flatMap((run) => run.scenes));
  return { schemaVersion: 'v2-richness/v1', composition: 'labels', runs, pooled };
}
```

- [ ] **Step 7: Create `src/harness/v2RichnessCli.ts`**

```ts
#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { richnessReport } from './v2RichnessReport.js';
import type { V2RichnessSummary } from './v2Richness.js';

/** Offline V2 board richness. Usage: node dist/src/harness/v2RichnessCli.js [--json=<out.json>] <run-dir>... */
const args = process.argv.slice(2);
const flag = (key: string): string | undefined => args.find((arg) => arg.startsWith(`--${key}=`))?.slice(key.length + 3);
const runDirs = args.filter((arg) => !arg.startsWith('--'));
const fmt = (value: number | null): string => (value === null ? 'n/a' : value.toFixed(3));
const line = (name: string, s: V2RichnessSummary, extra = ''): string =>
  `${name}\tscenes=${s.scenes}\ticonShare=${fmt(s.iconBearingShare)}\tlabelOnlyEntities=${fmt(s.labelOnlyEntityRatio)}\tassets=${s.distinctAssetIds}\tfamilyMixScenes=${s.familyMixScenes}\tconflicts=${s.assetReuseConflicts}\tminIconPx=${s.minIconSidePx ?? 'n/a'}\ttextChars=${s.meanTextChars.toFixed(1)}\twords=${s.meanWordsOnBoard.toFixed(1)}\tvariety=${s.meanElementVariety.toFixed(2)}${extra}\n`;

async function main(): Promise<void> {
  if (!runDirs.length) { process.stderr.write('usage: v2RichnessCli.js [--json=<out.json>] <run-dir>...\n'); process.exitCode = 2; return; }
  const report = await richnessReport(runDirs);
  for (const run of report.runs) {
    const note = `${run.complete ? '' : '\t(no video.mp4: excluded from POOLED)'}${run.reason ? `\treason=${run.reason}` : ''}\thardFailures=${run.hardFailures ?? 'n/a'}\treplayHashMismatches=${run.timelineReplayMismatches}`;
    process.stdout.write(line(`${run.lessonId}[${run.status}]`, run.summary, note));
  }
  process.stdout.write(line(`POOLED(${report.composition})`, report.pooled));
  const out = flag('json');
  if (out) { await mkdir(path.dirname(path.resolve(out)), { recursive: true }); await writeFile(path.resolve(out), `${JSON.stringify(report, null, 2)}\n`); }
}

main().catch((error: unknown) => { process.stderr.write(`v2 richness failed: ${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 2; });
```

Add to `package.json` `scripts` (after `"metrics:boards"`):

```json
    "richness:v2": "pnpm run build && node dist/src/harness/v2RichnessCli.js",
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `pnpm run build && node --test dist/src/__tests__/v2-richness.test.js`
Expected: PASS, 6 tests.

- [ ] **Step 9: Produce the baseline (offline, free)**

Run:
```bash
cd /Users/anupdangi/Desktop/AnupAI/Research/lamina-labs-clone/hypothesis_claude/.claude/worktrees/v2b
node dist/src/harness/v2RichnessCli.js --json=harness/reports/rich-visuals/baseline.labels.json $(ls -d .data/benchmark-v2/cold-v2/2026-10-04-final*/*/*/runs/*/)
```
Expected: one line per run plus `POOLED(labels)`. Every complete run prints `iconShare=0.000` (consistent with HANDOFF "pictorial entities 0/18" and with the concept kinds in the Evidence section). Runs whose snapshots cannot be replayed print `[unavailable]` with a reason; they are reported, not dropped. This JSON is the **baseline** that Task 4's acceptance rules read.

- [ ] **Step 10: Full gates**

Run: `pnpm run typecheck && pnpm run test:hypothesis`
Expected: both pass.

- [ ] **Step 11: HANDOFF entry**

Append to `docs/HANDOFF.md` a dated "Rich visuals Task 1" entry with: the baseline command, the `POOLED(labels)` line copied verbatim, the list of unavailable runs with reasons, and status `implemented, tested` for the richness tool; `unmeasured` for wrong-icon rate.

- [ ] **Step 12: Commit (only after the user approves committing in chat)**

```bash
git add src/assets/referent.ts src/harness/v2Richness.ts src/harness/retainedV2Run.ts src/harness/v2RichnessReport.ts src/harness/v2RichnessCli.ts src/__tests__/v2-richness.test.ts package.json harness/reports/rich-visuals/baseline.labels.json docs/HANDOFF.md
git commit -m "feat(v2): offline board richness baseline over retained runs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Exact-name icon badges with scene family lock

**Files:**
- Create: `src/assets/badgeReview.ts`, `src/assets/data/badge-review.v1.json`, `src/visual-v2/resolver/referentBadge.ts`
- Test: `src/__tests__/referent-badge.test.ts`

**Interfaces:**
- Consumes: `referentOf` (Task 1); `resolveObject(concept, opts, catalog)` (`assets/ladder.ts`; `resolution.houseFamily`, `selectionBasis`, `rung`, `assetId`); `chooseSceneFamily` (`assets/sceneFamily.ts` — reused, not rebuilt); `licensePolicy`, `ConceptInfo` (`typeGate.ts`).
- Produces:
  - `reviewKey(assetId: string, referent: string): string`; `interface BadgeReview { accepted: ReadonlySet<string>; rejected: ReadonlySet<string> }`; `EMPTY_BADGE_REVIEW`; `validateBadgeDecisions(entries: unknown): { ok: BadgeDecision[]; problems: string[] }`; `badgeReviewFrom(decisions): BadgeReview`; `loadBadgeReview(file?: string): BadgeReview`; `BADGE_REVIEW_DATA: string`
  - `interface BadgeRequest { elementId: string; label: string; concept?: ConceptInfo }`
  - `interface ReferentBadge { elementId; referent; assetId; houseFamily?; license; releaseClean; attributionRequired; ownerApproved; review: 'accepted' | 'unreviewed' }`
  - `interface PlacedBadge extends ReferentBadge { draw(side: number): PrimitiveVisual }`
  - `interface SceneBadgePlan { family?: string; badges: ReferentBadge[]; refusals: BadgeRefusal[] }`
  - `planSceneBadges(requests: readonly BadgeRequest[], options?: BadgeOptions): SceneBadgePlan` with `BadgeOptions { lessonDomain?; catalog?; review?; extraFamilies?; reservedAssets?: ReadonlyMap<string, string> }`
  - `placeBadges(plan: SceneBadgePlan, catalog?: readonly CatalogEntry[]): Map<string, PlacedBadge>`
  - `badgeEligibility(request: BadgeRequest): string | undefined`

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/referent-badge.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import type { CatalogEntry } from '../assets/catalog.js';
import { EMPTY_BADGE_REVIEW, badgeReviewFrom, reviewKey, validateBadgeDecisions } from '../assets/badgeReview.js';
import { planSceneBadges, placeBadges } from '../visual-v2/resolver/referentBadge.js';

// Synthetic catalog for contract tests only (same shape as scene-family.test.ts); never a visual measurement.
const G = 'simi-house-v1/general-drawon';
const D = 'simi-house-v1/domain-outline';
const entry = (id: string, names: string[], houseFamily: string): CatalogEntry => ({
  id, names, tags: [], meaning: '', source: 'assetlab-sketchy-downshift:x', license: 'MIT', lane: 'simple-symbol', strokePaths: 1, houseFamily,
  render: (size) => ({ paths: [{ d: `M0 0 L${size.w} ${size.h}`, length: Math.hypot(size.w, size.h) }], fills: [], texts: [] }),
});
const catalog = [entry('gen-cell', ['cell'], G), entry('dom-beaker', ['beaker'], D), entry('dom-flask', ['flask'], D), entry('gen-book', ['book', 'source'], G), entry('gen-mitosis', ['mitosis'], G)];
const opts = { catalog, review: EMPTY_BADGE_REVIEW };

test('an exact primary-name match badges and records licence and family', () => {
  const plan = planSceneBadges([{ elementId: 't1', label: 'Cells' }], opts);
  assert.equal(plan.badges.length, 1);
  assert.equal(plan.badges[0]!.assetId, 'gen-cell');
  assert.equal(plan.badges[0]!.referent, 'cell');
  assert.equal(plan.badges[0]!.license, 'MIT');
  assert.equal(plan.badges[0]!.review, 'unreviewed');
  assert.equal(plan.family, G);
  const placed = placeBadges(plan, catalog).get('t1')!;
  assert.equal(placed.draw(64).paths.length, 1);
});

test('a synonym match is refused: badges need the asset primary name', () => {
  const plan = planSceneBadges([{ elementId: 't1', label: 'source' }], opts);
  assert.equal(plan.badges.length, 0);
  assert.match(plan.refusals[0]!.reason, /synonym of "book"|no exact catalog picture/);
});

test('abstract and process labels never badge', () => {
  const plan = planSceneBadges([
    { elementId: 'e1', label: 'Mitosis', concept: { id: 'c1', label: 'Mitosis', kind: 'process' } },
    { elementId: 't1', label: '2 cells' },
    { elementId: 't2', label: 'energy' },
    { elementId: 't3', label: 'one very long noun phrase here' },
  ], opts);
  assert.equal(plan.badges.length, 0);
  assert.deepEqual(plan.refusals.map((refusal) => refusal.elementId), ['e1', 't1', 't3', 't2']);
});

test('a participant of a process concept may badge when its own label names a thing', () => {
  const plan = planSceneBadges([{ elementId: 'e1', label: 'Cell', concept: { id: 'c1', label: 'Mitosis', kind: 'process' } }], opts);
  assert.equal(plan.badges[0]?.assetId, 'gen-cell');
});

test('one family per scene: minority-family icons fall back to labels', () => {
  const plan = planSceneBadges([{ elementId: 'a', label: 'cell' }, { elementId: 'b', label: 'beaker' }, { elementId: 'c', label: 'flask' }], opts);
  assert.equal(plan.family, D);
  assert.deepEqual(plan.badges.map((badge) => badge.elementId), ['b', 'c']);
  assert.equal(plan.refusals[0]!.elementId, 'a');
});

test('a reserved asset is not reused for another referent', () => {
  const plan = planSceneBadges([{ elementId: 't1', label: 'cell' }], { ...opts, reservedAssets: new Map([['gen-cell', 'nucleus']]) });
  assert.equal(plan.badges.length, 0);
  assert.match(plan.refusals[0]!.reason, /already depicts "nucleus"/);
});

test('a rejected verdict blocks the badge; an accepted one is marked', () => {
  const rejected = planSceneBadges([{ elementId: 't1', label: 'cell' }], { catalog, review: badgeReviewFrom([{ assetId: 'gen-cell', referent: 'cell', verdict: 'reject', reviewer: 'owner', date: '2026-10-08' }]) });
  assert.equal(rejected.badges.length, 0);
  const accepted = planSceneBadges([{ elementId: 't1', label: 'cell' }], { catalog, review: badgeReviewFrom([{ assetId: 'gen-cell', referent: 'cell', verdict: 'accept', reviewer: 'owner', date: '2026-10-08' }]) });
  assert.equal(accepted.badges[0]!.review, 'accepted');
});

test('verdict validation refuses unnormalised referents, bad dates and conflicting verdicts', () => {
  const { problems } = validateBadgeDecisions([
    { assetId: 'a', referent: 'Cells', verdict: 'accept', reviewer: 'r', date: '2026-10-08' },
    { assetId: 'a', referent: 'cell', verdict: 'accept', reviewer: 'r', date: '8 Oct' },
    { assetId: 'b', referent: 'cell', verdict: 'accept', reviewer: 'r', date: '2026-10-08' },
    { assetId: 'b', referent: 'cell', verdict: 'reject', reviewer: 'r', date: '2026-10-08' },
  ]);
  assert.equal(problems.length, 3);
  assert.equal(reviewKey('a', 'cell'), 'a|cell');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm run build && node --test dist/src/__tests__/referent-badge.test.js`
Expected: build FAILS: cannot find modules `../assets/badgeReview.js` and `../visual-v2/resolver/referentBadge.js`.

- [ ] **Step 3: Create the verdict data file `src/assets/data/badge-review.v1.json`**

```json
{
  "schemaVersion": "badge-review/v1",
  "note": "Human verdicts on (asset, referent) pairs, keyed by referentOf(label). Add an entry only from a reviewer's recorded decision (quote the dated chat approval in docs/HANDOFF.md). Never infer a verdict.",
  "entries": []
}
```

- [ ] **Step 4: Create `src/assets/badgeReview.ts`**

```ts
import { readFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { referentOf } from './referent.js';

/** Reviewed verdicts on whether one catalog asset correctly depicts one referent. Data, like metaphors.v1.json; never inferred. */
export interface BadgeDecision { assetId: string; referent: string; verdict: 'accept' | 'reject'; reviewer: string; date: string; note?: string }
export interface BadgeReview { accepted: ReadonlySet<string>; rejected: ReadonlySet<string> }

export const reviewKey = (assetId: string, referent: string): string => `${assetId}|${referent}`;
export const EMPTY_BADGE_REVIEW: BadgeReview = { accepted: new Set(), rejected: new Set() };

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST_SRC = `${sep}dist${sep}src${sep}`;
export const BADGE_REVIEW_DATA = resolve(HERE.includes(DIST_SRC) ? HERE.replace(DIST_SRC, `${sep}src${sep}`) : HERE, 'data', 'badge-review.v1.json');

export function validateBadgeDecisions(entries: unknown): { ok: BadgeDecision[]; problems: string[] } {
  if (!Array.isArray(entries)) return { ok: [], problems: ['entries must be an array'] };
  const ok: BadgeDecision[] = [];
  const problems: string[] = [];
  const verdicts = new Map<string, string>();
  entries.forEach((raw: unknown, index) => {
    const e = (raw ?? {}) as Partial<BadgeDecision>;
    if (typeof e.assetId !== 'string' || !e.assetId) { problems.push(`entry ${index}: assetId is required`); return; }
    if (typeof e.referent !== 'string' || !e.referent || referentOf(e.referent) !== e.referent) { problems.push(`entry ${index}: referent must be referentOf(label), got "${String(e.referent)}"`); return; }
    if (e.verdict !== 'accept' && e.verdict !== 'reject') { problems.push(`entry ${index}: verdict must be accept or reject`); return; }
    if (typeof e.reviewer !== 'string' || !e.reviewer.trim()) { problems.push(`entry ${index}: reviewer is required`); return; }
    if (typeof e.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(e.date)) { problems.push(`entry ${index}: date must be YYYY-MM-DD`); return; }
    const key = reviewKey(e.assetId, e.referent);
    const prior = verdicts.get(key);
    if (prior !== undefined && prior !== e.verdict) { problems.push(`entry ${index}: conflicting verdicts for ${key}`); return; }
    verdicts.set(key, e.verdict);
    ok.push({ assetId: e.assetId, referent: e.referent, verdict: e.verdict, reviewer: e.reviewer, date: e.date, ...(typeof e.note === 'string' ? { note: e.note } : {}) });
  });
  return { ok, problems };
}

export function badgeReviewFrom(decisions: readonly BadgeDecision[]): BadgeReview {
  const keys = (verdict: BadgeDecision['verdict']) => new Set(decisions.filter((d) => d.verdict === verdict).map((d) => reviewKey(d.assetId, d.referent)));
  return { accepted: keys('accept'), rejected: keys('reject') };
}

let cached: BadgeReview | undefined;
export function loadBadgeReview(file: string = BADGE_REVIEW_DATA): BadgeReview {
  if (file === BADGE_REVIEW_DATA && cached) return cached;
  const { ok, problems } = validateBadgeDecisions((JSON.parse(readFileSync(file, 'utf8')) as { entries: unknown }).entries);
  if (problems.length) throw new Error(`badge review rejected: ${problems.join('; ')}`);
  const review = badgeReviewFrom(ok);
  if (file === BADGE_REVIEW_DATA) cached = review;
  return review;
}
```

- [ ] **Step 5: Create `src/visual-v2/resolver/referentBadge.ts`**

```ts
import type { PrimitiveVisual } from '../../shared/types.js';
import type { CatalogEntry } from '../../assets/catalog.js';
import { allCatalogEntries } from '../../assets/semantic.js';
import { resolveObject } from '../../assets/ladder.js';
import { referentOf } from '../../assets/referent.js';
import { chooseSceneFamily } from '../../assets/sceneFamily.js';
import { loadBadgeReview, reviewKey, type BadgeReview } from '../../assets/badgeReview.js';
import { licensePolicy, type ConceptInfo } from './typeGate.js';

/**
 * Icon badges: a small picture on a labelled card when the card's own label names one concrete thing that the catalog has
 * under that exact primary name. The label stays; the picture never replaces it. Process/event/rule/quantity concepts keep
 * their type-gate rule (no noun picture for the concept itself). One house family per scene (chooseSceneFamily), no asset
 * drawn for two referents, reviewed rejections honoured. Topic-free: nothing here knows any subject.
 */
export interface BadgeRequest { elementId: string; label: string; concept?: ConceptInfo }
export interface ReferentBadge {
  elementId: string; referent: string; assetId: string; houseFamily?: string;
  license: string; releaseClean: boolean; attributionRequired: boolean; ownerApproved: boolean;
  review: 'accepted' | 'unreviewed';
}
export interface PlacedBadge extends ReferentBadge { draw(side: number): PrimitiveVisual }
export interface BadgeRefusal { elementId: string; label: string; reason: string }
export interface SceneBadgePlan { family?: string; badges: ReferentBadge[]; refusals: BadgeRefusal[] }
export interface BadgeOptions {
  lessonDomain?: string;
  catalog?: readonly CatalogEntry[];
  review?: BadgeReview;
  /** Families of pictures already drawn in the scene (entity pictures); they vote for the scene family. */
  extraFamilies?: readonly (string | undefined)[];
  /** asset id -> referent already drawn in the scene (entity pictures). */
  reservedAssets?: ReadonlyMap<string, string>;
}

const MAX_REFERENT_WORDS = 3;

export function badgeEligibility(request: BadgeRequest): string | undefined {
  const referent = referentOf(request.label);
  if (!referent) return 'label has no nameable referent';
  if (/\d/.test(referent)) return 'label carries a number, not a thing';
  if (referent.split(' ').length > MAX_REFERENT_WORDS) return 'label is a phrase, not one depictable thing';
  const concept = request.concept;
  if (concept && concept.kind !== 'entity' && referentOf(concept.label) === referent) return `label names the ${concept.kind} concept itself; a ${concept.kind} is shown by structure, not a noun picture`;
  return undefined;
}

type Probe = { entry: CatalogEntry; houseFamily?: string } | { reason: string };

function probe(referent: string, catalog: CatalogEntry[], lessonDomain: string | undefined, sceneFamily: string | undefined): Probe {
  const { resolution } = resolveObject(referent, { label: referent, size: { w: 240, h: 240 }, visualStrategy: 'literal', ...(lessonDomain ? { lessonDomain } : {}), ...(sceneFamily ? { sceneFamily } : {}) }, catalog);
  if (resolution.rung === 4 || !resolution.assetId) return { reason: 'no exact catalog picture' };
  if (resolution.selectionBasis !== 'exact' && resolution.selectionBasis !== 'curated') return { reason: `picture chosen by ${resolution.selectionBasis ?? 'unknown'}; only exact names may badge` };
  const entry = catalog.find((candidate) => candidate.id === resolution.assetId);
  if (!entry) return { reason: `resolved asset ${resolution.assetId} is not in the catalog` };
  if (referentOf(entry.names[0] ?? '') !== referent) return { reason: `matched a synonym of "${entry.names[0] ?? ''}"; badges require the asset's primary name` };
  return { entry, ...(resolution.houseFamily ? { houseFamily: resolution.houseFamily } : {}) };
}

export function planSceneBadges(requests: readonly BadgeRequest[], options: BadgeOptions = {}): SceneBadgePlan {
  const catalog = [...(options.catalog ?? allCatalogEntries())];
  const review = options.review ?? loadBadgeReview();
  const refusals: BadgeRefusal[] = [];
  const candidates: Array<{ request: BadgeRequest; referent: string }> = [];
  for (const request of requests) {
    const reason = badgeEligibility(request);
    if (reason) refusals.push({ elementId: request.elementId, label: request.label, reason });
    else candidates.push({ request, referent: referentOf(request.label) });
  }
  const unlocked = new Map<string, Probe>();
  for (const { referent } of candidates) if (!unlocked.has(referent)) unlocked.set(referent, probe(referent, catalog, options.lessonDomain, undefined));
  const family = chooseSceneFamily([
    ...(options.extraFamilies ?? []),
    ...candidates.map(({ referent }) => { const hit = unlocked.get(referent)!; return 'entry' in hit ? hit.houseFamily : undefined; }),
  ]);
  const locked = new Map<string, Probe>();
  const owners = new Map<string, string>(options.reservedAssets ?? []);
  const badges: ReferentBadge[] = [];
  for (const { request, referent } of candidates) {
    if (!locked.has(referent)) locked.set(referent, probe(referent, catalog, options.lessonDomain, family));
    const hit = locked.get(referent)!;
    const refuse = (reason: string): void => { refusals.push({ elementId: request.elementId, label: request.label, reason }); };
    if (!('entry' in hit)) { refuse(hit.reason); continue; }
    const key = reviewKey(hit.entry.id, referent);
    if (review.rejected.has(key)) { refuse(`reviewed as a wrong picture for "${referent}"`); continue; }
    const owner = owners.get(hit.entry.id);
    if (owner !== undefined && owner !== referent) { refuse(`asset ${hit.entry.id} already depicts "${owner}" in this scene`); continue; }
    owners.set(hit.entry.id, referent);
    badges.push({
      elementId: request.elementId, referent, assetId: hit.entry.id, ...(hit.houseFamily ? { houseFamily: hit.houseFamily } : {}),
      license: hit.entry.license, ...licensePolicy(hit.entry.license), review: review.accepted.has(key) ? 'accepted' : 'unreviewed',
    });
  }
  return { ...(family ? { family } : {}), badges, refusals };
}

export function placeBadges(plan: SceneBadgePlan, catalog: readonly CatalogEntry[] = allCatalogEntries()): Map<string, PlacedBadge> {
  const byId = new Map(catalog.map((entry) => [entry.id, entry]));
  const placed = new Map<string, PlacedBadge>();
  for (const badge of plan.badges) {
    const entry = byId.get(badge.assetId);
    if (entry) placed.set(badge.elementId, { ...badge, draw: (side: number) => entry.render({ w: side, h: side }) });
  }
  return placed;
}
```

Refusal order is part of the contract: eligibility refusals (`e1` process concept, `t1` number, `t3` phrase) are recorded before catalog-lookup refusals (`t2` "energy" has no exact name), which is what the "abstract and process labels" test asserts.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm run build && node --test dist/src/__tests__/referent-badge.test.js`
Expected: PASS, 8 tests. If "one family per scene" fails because the ladder still returns `gen-cell` with `sceneFamily: D`, inspect `assetEligibilityProblems` (`ladder.ts:204`): synthetic entries must keep `houseFamily` set; do not loosen the ladder.

- [ ] **Step 7: Full gates**

Run: `pnpm run typecheck && pnpm run test:hypothesis`
Expected: both pass (no runtime path uses the new modules yet).

- [ ] **Step 8: HANDOFF entry, then commit (only after the user approves committing in chat)**

```bash
git add src/assets/badgeReview.ts src/assets/data/badge-review.v1.json src/visual-v2/resolver/referentBadge.ts src/__tests__/referent-badge.test.ts docs/HANDOFF.md
git commit -m "feat(v2): exact-name icon badge resolver with scene family lock and verdict data

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Icon-card composition, runtime wiring, rights evidence, contact sheets

**Files:**
- Modify: `src/visual-v2/renderer/visuals.ts` (imports; `elementVisual` signature + `token`/`entity` cases; new exports)
- Modify: `src/visual-v2/renderer/frame.ts:14-27` (`CompiledScene`, `compileScene`), `:146` (context icon), `:156-157` (pass badge)
- Create: `src/pipeline-v2/badgeProvenance.ts`
- Modify: `src/pipeline-v2/runLessonV2.ts:456` (compile option), `:516-532` (families, provenance), metric map near `:543`
- Modify: `src/harness/retainedV2Run.ts`, `src/harness/v2RichnessReport.ts`, `src/harness/v2RichnessCli.ts` (composition option)
- Create: `scripts/v2-contact-sheet.mjs`
- Test: `src/__tests__/icon-cards.test.ts`
- Output: `harness/reports/rich-visuals/projection.icon-cards.json`, `output/rich-visuals/<lesson>/{labels,icon-cards}.png`

**Interfaces:**
- Consumes: `planSceneBadges`, `placeBadges`, `PlacedBadge`, `SceneBadgePlan`, `BadgeRequest` (Task 2); `BadgeReview` (Task 2); `referentOf` (Task 1); `IconUse`, `elementRect`, `elementLabel`, `RichnessReport` (Task 1); `buildAssetRightsEvidence`, `bridgeRecordForCatalogEntry` (`assets/rightsEvidence.ts`); `rasterizePng(svg, width)` (`export/videoEncode.ts`).
- Produces:
  - `BADGE_MIN_SIDE_PX = 56`; `badgeSide(rect: Rect): number`; `iconCardFits(rect: Rect, label: string): boolean`; `iconCard(rect, label, fill, badge?: Pick<PlacedBadge, 'draw'>): PrimitiveVisual` (all in `visuals.ts`)
  - `elementVisual(el, rect, geometry, concepts?, resolver?, badge?)`
  - `interface CompileSceneOptions { composition?: 'labels' | 'icon-cards'; catalog?: readonly CatalogEntry[]; review?: BadgeReview }`; `CompiledScene.badges?: ReadonlyMap<string, PlacedBadge>`; `CompiledScene.badgeFamily?: string`; `compileScene(..., prior?, options?: CompileSceneOptions)`
  - `badgeRightsEvidence(scenes, catalogue, bridgeAssets): AssetRightsEvidence[]`
  - `loadRetainedV2Run(runDir, options?: { composition?: 'labels' | 'icon-cards' })`; `richnessReport(runDirs, options?: { composition?: 'labels' | 'icon-cards' })`; CLI flag `--composition=labels|icon-cards`

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/icon-cards.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import type { CatalogEntry } from '../assets/catalog.js';
import { EMPTY_BADGE_REVIEW } from '../assets/badgeReview.js';
import { BoardOpSchema } from '../visual-v2/board-ops/types.js';
import { emptyBoardState } from '../visual-v2/board-state/reducer.js';
import { compileSceneTimeline, type BeatTiming } from '../visual-v2/timeline/compile.js';
import { compileScene, renderSceneSvg, type CompiledScene } from '../visual-v2/renderer/frame.js';
import { BADGE_MIN_SIDE_PX, iconCard } from '../visual-v2/renderer/visuals.js';
import { badgeRightsEvidence } from '../pipeline-v2/badgeProvenance.js';

// Synthetic contract fixture only; never a quality or visual measurement.
const D = 'simi-house-v1/domain-outline';
const entry = (id: string, name: string): CatalogEntry => ({
  id, names: [name], tags: [], meaning: '', source: 'assetlab-sketchy-downshift:x', license: 'MIT', lane: 'simple-symbol', strokePaths: 1, houseFamily: D,
  render: (size) => ({ paths: [{ d: `M0 0 L${size.w} ${size.h}`, length: Math.hypot(size.w, size.h) }], fills: [], texts: [] }),
});
const catalog = [entry('dom-flask', 'flask'), entry('dom-beaker', 'beaker'), entry('dom-funnel', 'funnel')];
const badge = { draw: (side: number) => ({ paths: [{ d: `M0 0 L${side} ${side}`, length: side }], fills: [], texts: [] }) };

test('a card with room draws the icon left of the label', () => {
  const rect = { x: 100, y: 100, w: 360, h: 110 };
  const visual = iconCard(rect, 'flask', '#fff', badge);
  assert.equal(visual.paths.length, 2, 'box + icon');
  assert.ok(visual.texts[0]!.x > rect.x + rect.w / 2, 'label shifts right of centre');
});

test('a card too short for a 56 px icon stays a plain labelled box', () => {
  assert.equal(BADGE_MIN_SIDE_PX, 56);
  const rect = { x: 100, y: 100, w: 360, h: 60 };
  const visual = iconCard(rect, 'flask', '#fff', badge);
  assert.equal(visual.paths.length, 1);
  assert.equal(visual.texts[0]!.x, rect.x + rect.w / 2);
});

test('a label that would stop fitting next to the icon keeps the plain box', () => {
  const visual = iconCard({ x: 0, y: 0, w: 200, h: 110 }, 'extraordinarily unbreakable labelword', '#fff', badge);
  assert.equal(visual.paths.length, 1);
});

const add = (id: string, element: unknown, at: unknown, beat: string) => BoardOpSchema.parse({ op: 'add', opId: `${beat}.${id}`, beatId: beat, id, element, at });
const tok = (text: string) => ({ type: 'token', text, provenance: 'illustrative' });
const ops = [
  add('ring', { type: 'kit', kit: 'cycle', paramsJson: '{"nodes":3}', provenance: 'illustrative' }, { region: 'center' }, 'b0'),
  add('t1', tok('flask'), { region: 'center', container: 'ring', slot: 'end' }, 'b1'),
  add('t2', tok('beaker'), { region: 'center', container: 'ring', slot: 'end' }, 'b2'),
  add('t3', tok('funnel'), { region: 'center', container: 'ring', slot: 'end' }, 'b3'),
];
const beats: BeatTiming[] = ops.map((op, i) => ({ beatId: op.beatId, startMs: i * 3000, endMs: i * 3000 + 2800, sentences: [{ startMs: i * 3000, endMs: i * 3000 + 2800 }] }));
const timeline = compileSceneTimeline({ ops, initial: emptyBoardState(), beats });

test('labels composition is unchanged; icon-cards plans one badge per process step', () => {
  const plain = compileScene('s1', 'Lab glassware', timeline, 'lesson');
  assert.equal(plain.badges, undefined);
  const rich = compileScene('s1', 'Lab glassware', timeline, 'lesson', undefined, undefined, { composition: 'icon-cards', catalog, review: EMPTY_BADGE_REVIEW });
  assert.deepEqual([...rich.badges!.keys()], ['t1', 't2', 't3']);
  assert.equal(rich.badgeFamily, D);
  assert.notEqual(renderSceneSvg(rich, timeline.durationMs), renderSceneSvg(plain, timeline.durationMs));
});

test('the context icon appears beside the title only after the title wipe', () => {
  const rich = compileScene('s1', 'Lab glassware', timeline, 'lesson', undefined, undefined, { composition: 'icon-cards', catalog, review: EMPTY_BADGE_REVIEW });
  assert.equal(renderSceneSvg(rich, 0).includes('data-role="context-icon"'), false);
  assert.equal(renderSceneSvg(rich, 800).includes('data-role="context-icon"'), true);
});

test('every drawn badge asset gets one rights evidence record with its licence', () => {
  const rich = compileScene('s1', 'Lab glassware', timeline, 'lesson', undefined, undefined, { composition: 'icon-cards', catalog, review: EMPTY_BADGE_REVIEW });
  const evidence = badgeRightsEvidence([rich, rich] as CompiledScene[], new Map(catalog.map((e) => [e.id, e])), []);
  assert.deepEqual(evidence.map((item) => item.assetId).sort(), ['dom-beaker', 'dom-flask', 'dom-funnel']);
  assert.ok(evidence.every((item) => item.license.identifier === 'MIT'));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm run build && node --test dist/src/__tests__/icon-cards.test.js`
Expected: build FAILS: `iconCard`/`BADGE_MIN_SIDE_PX` not exported, `compileScene` takes 6 args, module `../pipeline-v2/badgeProvenance.js` missing.

- [ ] **Step 3: Icon cards in `src/visual-v2/renderer/visuals.ts`**

Change the geometry import line to include `shiftVisual`, and add the badge type import:

```ts
import { boxPath, emptyVisual, fillOf, linePath, shiftVisual, textRun, upper, type Rect } from '../kits/geometry.js';
import type { PlacedBadge } from '../resolver/referentBadge.js';
```

Add after `labelledBox`:

```ts
/** Smallest icon side drawn on the 1920x1080 board; below it the badge is dropped, never shrunk into a smudge. */
export const BADGE_MIN_SIDE_PX = 56;
const BADGE_MAX_SIDE_PX = 120;
const BADGE_PAD_PX = 10;
const BADGE_GAP_PX = 16;
export const badgeSide = (rect: Rect): number => Math.floor(Math.min(rect.h - 16, rect.w * 0.4, BADGE_MAX_SIDE_PX));
const cardTextRect = (rect: Rect, side: number): Rect => ({ x: rect.x + BADGE_PAD_PX + side + BADGE_GAP_PX, y: rect.y, w: rect.w - (BADGE_PAD_PX + side + BADGE_GAP_PX), h: rect.h });

/** True when an icon of at least BADGE_MIN_SIDE_PX fits AND the label still fits beside it at a readable size. */
export function iconCardFits(rect: Rect, label: string): boolean {
  const side = badgeSide(rect);
  if (side < BADGE_MIN_SIDE_PX) return false;
  const text = cardTextRect(rect, side);
  return fitText(label, text.w - 16, text.h - 8).fits;
}

/** A labelled box with an icon at its left. The label always stays; without room the box is drawn exactly as before. */
export function iconCard(rect: Rect, label: string, fill: string, badge?: Pick<PlacedBadge, 'draw'>): PrimitiveVisual {
  if (!badge || !iconCardFits(rect, label)) return labelledBox(rect, label, fill);
  const side = badgeSide(rect);
  const box = boxPath(rect, 18);
  const icon = shiftVisual(badge.draw(side), rect.x + BADGE_PAD_PX, rect.y + (rect.h - side) / 2);
  const text = cardTextRect(rect, side);
  return {
    paths: [box, ...icon.paths],
    fills: [fillOf(box, fill), ...icon.fills],
    texts: [...icon.texts, ...fittedRuns(text, label, text.w - 16)],
    ...(icon.embeds?.length ? { embeds: icon.embeds } : {}),
  };
}
```

Replace the `elementVisual` signature and its `token`/`entity` cases:

```ts
export function elementVisual(el: BoardElement, rect: Rect, geometry: SceneGeometry, concepts?: ConceptIndex, resolver?: EntityResolver, badge?: Pick<PlacedBadge, 'draw'>): PrimitiveVisual {
  const spec = el.spec;
  switch (spec.type) {
    case 'kit': return geometry.kitGeometry(el.id)?.frame ?? emptyVisual();
    case 'token': return iconCard(rect, spec.text, toneOf(el, PROVENANCE_FILL[spec.provenance] ?? STYLE.palette.grey), badge);
    case 'entity': {
      // Type first: only a concrete entity with an exact approved picture is drawn as a picture; everything else is a labelled box, optionally with an exact-name badge.
      const depiction = depictEntity(concepts?.get(spec.conceptId), spec.label, rect, resolver);
      return depiction.meaningful ? depiction.visual : iconCard(rect, spec.label, toneOf(el, entityFill(spec.conceptId)), badge);
    }
```

(The `value`, `text`, `equation` cases are unchanged.)

- [ ] **Step 4: Badges in `src/visual-v2/renderer/frame.ts`**

Add imports:

```ts
import type { CatalogEntry } from '../../assets/catalog.js';
import type { BadgeReview } from '../../assets/badgeReview.js';
import { referentOf } from '../../assets/referent.js';
import { depictEntity } from '../resolver/typeGate.js';
import { planSceneBadges, placeBadges, type BadgeRequest, type PlacedBadge, type SceneBadgePlan } from '../resolver/referentBadge.js';
import { shiftVisual } from '../kits/geometry.js';
```

Replace lines 14–27 (`CompiledScene` and `compileScene`) with:

```ts
export interface CompiledScene {
  sceneId: string;
  title: string;
  timeline: SceneTimeline;
  geometry: SceneGeometry;
  /** Rough.js seeds derive from this and the element id, so a frame is a pure function of (scene, time). */
  seedBase: string;
  /** Concept kinds, so entities are depicted by type (V2 plan Phase 7). */
  concepts?: ConceptIndex;
  /** Element id -> exact-name icon badge (composition 'icon-cards' only). Render-only: layout never sees it. */
  badges?: ReadonlyMap<string, PlacedBadge>;
  badgeFamily?: string;
}

export interface CompileSceneOptions {
  /** 'labels' is the board as it was before icon cards; 'icon-cards' adds exact-name badges to labelled boxes. */
  composition?: 'labels' | 'icon-cards';
  catalog?: readonly CatalogEntry[];
  review?: BadgeReview;
}

function sceneBadgePlan(timeline: SceneTimeline, concepts: ConceptIndex | undefined, options: CompileSceneOptions): SceneBadgePlan {
  const requests: BadgeRequest[] = [];
  const extraFamilies: Array<string | undefined> = [];
  const reservedAssets = new Map<string, string>();
  const seen = new Set<string>();
  for (const state of timeline.states) {
    for (const el of Object.values(state.elements).sort((a, b) => a.seq - b.seq)) {
      if (seen.has(el.id) || el.lifecycle.removedAtBeat !== undefined) continue;
      seen.add(el.id);
      if (el.spec.type === 'token') requests.push({ elementId: el.id, label: el.spec.text });
      else if (el.spec.type === 'entity') {
        const concept = concepts?.get(el.spec.conceptId);
        const depiction = depictEntity(concept, el.spec.label, { x: 0, y: 0, w: 240, h: 210 });
        if (depiction.meaningful && depiction.assetId) { reservedAssets.set(depiction.assetId, referentOf(el.spec.label)); extraFamilies.push(concept?.houseFamily); }
        else if (!depiction.meaningful) requests.push({ elementId: el.id, label: el.spec.label, ...(concept ? { concept } : {}) });
      }
    }
  }
  const lessonDomain = [...(concepts?.values() ?? [])].find((concept) => concept.domain)?.domain;
  return planSceneBadges(requests, { ...(lessonDomain ? { lessonDomain } : {}), ...(options.catalog ? { catalog: options.catalog } : {}), ...(options.review ? { review: options.review } : {}), extraFamilies, reservedAssets });
}

export function compileScene(sceneId: string, title: string, timeline: SceneTimeline, lessonId = 'lesson', concepts?: ConceptIndex, prior?: PriorLayout, options: CompileSceneOptions = {}): CompiledScene {
  const scene: CompiledScene = { sceneId, title, timeline, geometry: layoutScene(timeline.states, prior), seedBase: `${lessonId}|${sceneId}|visual-v2`, ...(concepts ? { concepts } : {}) };
  if (options.composition !== 'icon-cards') return scene;
  const plan = sceneBadgePlan(timeline, concepts, options);
  const badges = placeBadges(plan, options.catalog);
  return { ...scene, ...(badges.size ? { badges } : {}), ...(plan.family ? { badgeFamily: plan.family } : {}) };
}
```

Add after `titleSvg`:

```ts
const CONTEXT_ICON_SIDE = 84;
/** The scene's first badge, faint, left of the settled title: a context cue, never a new fact. */
function contextIconSvg(scene: CompiledScene, tMs: number): string {
  const first = scene.badges ? [...scene.badges.values()][0] : undefined;
  if (!first || !scene.title || tMs < TITLE_WIPE_MS) return '';
  const width = STYLE.canvas.w - 2 * STYLE.canvas.safe;
  const natural = Math.max(1, measureTextWidth(scene.title, STYLE.font.sceneTitle));
  const size = Math.min(STYLE.font.sceneTitle, (width / natural) * STYLE.font.sceneTitle);
  const titleW = Math.min(width, measureTextWidth(scene.title, size));
  const x = STYLE.canvas.w / 2 - titleW / 2 - 24 - CONTEXT_ICON_SIDE;
  if (x < STYLE.canvas.safe) return '';
  const rect: Rect = { x, y: 150 - CONTEXT_ICON_SIDE + 12, w: CONTEXT_ICON_SIDE, h: CONTEXT_ICON_SIDE };
  return `<g data-role="context-icon">${drawVisual(shiftVisual(first.draw(CONTEXT_ICON_SIDE), rect.x, rect.y), rect, FULL, scene.seedBase, 'title.icon', 0.55)}</g>`;
}
```

In `renderSceneBody` replace `const out: string[] = [titleSvg(scene.title, tMs)];` with:

```ts
  const out: string[] = [titleSvg(scene.title, tMs), contextIconSvg(scene, tMs)];
```

Replace lines 156–157 with:

```ts
    const badge = scene.badges?.get(el.id);
    let svg = place(elementVisual(el, rect, geometry, scene.concepts, undefined, badge), el.id, reveal, opacity);
    if (ov?.fade) svg += place(elementVisual(ov.fade.to, rect, geometry, scene.concepts, undefined, badge), `${el.id}.next`, FULL, ease(ov.fade.p));
```

(`holdKey` needs no change: the context icon only appears after `TITLE_WIPE_MS`, when hold keys start.)

- [ ] **Step 5: Create `src/pipeline-v2/badgeProvenance.ts`**

```ts
import type { CatalogEntry } from '../assets/catalog.js';
import { bridgeRecordForCatalogEntry, buildAssetRightsEvidence, type AssetRightsEvidence } from '../assets/rightsEvidence.js';
import type { CompiledScene } from '../visual-v2/renderer/frame.js';

type BridgeAssets = Parameters<typeof bridgeRecordForCatalogEntry>[1];

/** One rights record per distinct badge asset drawn anywhere in the lesson (same builder as entity pictures). */
export function badgeRightsEvidence(scenes: readonly CompiledScene[], catalogue: ReadonlyMap<string, CatalogEntry>, bridgeAssets: BridgeAssets): AssetRightsEvidence[] {
  const seen = new Set<string>();
  const out: AssetRightsEvidence[] = [];
  for (const scene of scenes) for (const badge of scene.badges?.values() ?? []) {
    if (seen.has(badge.assetId)) continue;
    seen.add(badge.assetId);
    const entry = catalogue.get(badge.assetId);
    out.push(buildAssetRightsEvidence(
      { assetId: badge.assetId, license: badge.license, releaseClean: badge.releaseClean, attributionRequired: badge.attributionRequired, ownerApproved: badge.ownerApproved },
      entry, entry ? bridgeRecordForCatalogEntry(entry, bridgeAssets) : undefined,
    ));
  }
  return out;
}
```

- [ ] **Step 6: Run the new tests to verify they pass**

Run: `pnpm run build && node --test dist/src/__tests__/icon-cards.test.js dist/src/__tests__/visual-v2-render.test.js dist/src/__tests__/renderer.test.js`
Expected: PASS. The existing render tests still pass because the default composition is `labels`.

- [ ] **Step 7: Wire the runtime in `src/pipeline-v2/runLessonV2.ts`**

Line 456, replace:

```ts
    const scene = compileScene(section.id, section.title, timeline, input.lessonId, sceneConceptIndex, prior);
```
with:
```ts
    const scene = compileScene(section.id, section.title, timeline, input.lessonId, sceneConceptIndex, prior, { composition: 'icon-cards' });
```

In the `sceneIconFamilies` map (line ~518), replace the `houseFamily:` line with:

```ts
    houseFamily: [...(scene.concepts?.values() ?? [])].find((concept) => concept.houseFamily)?.houseFamily ?? scene.badgeFamily ?? null,
```

Replace the `asset-provenance.json` dump and the two lines using `pictures` after it (lines ~529–532) so badges carry rights evidence and attribution:

```ts
  const drawnAssets = [...pictures, ...badgeRightsEvidence(compiled, catalogueAssets, bridge.assets)];
  await dump('asset-provenance.json', { schemaVersion: 'v2-asset-provenance/v2', assets: drawnAssets });
  const credits = [...new Set(drawnAssets.filter((p) => p.attribution.required).map((p) => p.attribution.text ? `${p.attribution.text} [${p.license.identifier}; ${p.assetId}]` : `[MISSING ATTRIBUTION] ${p.assetId} (${p.license.identifier})`))].sort();
  if (credits.length) await writeFile(path.join(outputDir, 'attribution.txt'), `Picture credits required by licence:\n${credits.map((c) => `- ${c}`).join('\n')}\n`, 'utf8');
  for (const picture of drawnAssets) { const failure = rightsEvidenceFailure(picture); if (failure) failures.push(failure); }
```

Add the import `import { badgeRightsEvidence } from './badgeProvenance.js';`, and in the metric map next to `'v2.pictorialEntities'` add:

```ts
    'v2.iconBadges': compiled.reduce((n, s) => n + (s.badges?.size ?? 0), 0),
```

Run: `pnpm run build && node --test dist/src/__tests__/lesson-v2.test.js dist/src/__tests__/lock-v2.test.js dist/src/__tests__/scene-lock-v2.test.js dist/src/__tests__/rendered-entity-assets.test.js`
Expected: PASS. If a test asserts an exact `asset-provenance.json` asset list or exact SVG bytes for a lesson that now gains badges, read the assertion: a change caused by a new, correctly evidenced badge is expected — update that assertion only with a comment naming this task; a missing rights record is a real failure.

- [ ] **Step 8: Composition option in the offline tools**

`src/harness/retainedV2Run.ts`: change the signature and the `compileScene` call, and add badges to `iconUsesFor`:

```ts
export async function loadRetainedV2Run(runDir: string, options: { composition?: 'labels' | 'icon-cards' } = {}): Promise<RetainedV2Run> {
```
```ts
    const scene = compileScene(sceneId, typeof section.title === 'string' ? section.title : sceneId, timeline, lessonId, concepts, prior, { composition: options.composition ?? 'labels' });
```
Add the import `import { badgeSide, iconCardFits } from '../visual-v2/renderer/visuals.js';` and replace the `return audit.evidence.flatMap(...)` statement in `iconUsesFor` with:

```ts
  const pictures: IconUse[] = audit.evidence.flatMap((evidence) => {
    if (evidence.depictionFamily !== 'pictorial' || !evidence.meaningful || !evidence.resolvedAssetId) return [];
    const rect = elementRect(scene, evidence.elementId);
    const houseFamily = catalog.get(evidence.resolvedAssetId)?.houseFamily;
    return [{ elementId: evidence.elementId, referent: referentOf(elementLabel(scene, evidence.elementId)), assetId: evidence.resolvedAssetId, ...(houseFamily ? { houseFamily } : {}), sidePx: rect ? Math.min(rect.w, rect.h) : 0, kind: 'entity-picture' as const }];
  });
  // A planned badge counts only when the renderer will actually draw it (same fit rule as iconCard).
  const badges: IconUse[] = [...(scene.badges ?? [])].flatMap(([elementId, badge]) => {
    const rect = elementRect(scene, elementId);
    if (!rect || !iconCardFits(rect, elementLabel(scene, elementId))) return [];
    return [{ elementId, referent: badge.referent, assetId: badge.assetId, ...(badge.houseFamily ? { houseFamily: badge.houseFamily } : {}), sidePx: badgeSide(rect), kind: 'badge' as const }];
  });
  return [...pictures, ...badges];
```

`src/harness/v2RichnessReport.ts`: change to

```ts
export async function richnessReport(runDirs: readonly string[], options: { composition?: 'labels' | 'icon-cards' } = {}): Promise<RichnessReport> {
  const composition = options.composition ?? 'labels';
```
pass `{ composition }` to `loadRetainedV2Run(runDir, { composition })`, and return `composition` instead of the literal `'labels'`.

`src/harness/v2RichnessCli.ts`: replace `const report = await richnessReport(runDirs);` with

```ts
  const composition = flag('composition') ?? 'labels';
  if (composition !== 'labels' && composition !== 'icon-cards') { process.stderr.write('--composition must be labels or icon-cards\n'); process.exitCode = 2; return; }
  const report = await richnessReport(runDirs, { composition });
```
and update the usage string to `usage: v2RichnessCli.js [--composition=labels|icon-cards] [--json=<out.json>] <run-dir>...`.

- [ ] **Step 9: Create `scripts/v2-contact-sheet.mjs`**

```js
#!/usr/bin/env node
// Contact sheet of every scene's final frame for one retained, source-generated V2 run, drawn by the same renderer the
// video uses. Each scene is rasterized on its own (no clip-id collisions) and tiled 2 per row at 960x540. Offline.
// Usage: pnpm run build && node scripts/v2-contact-sheet.mjs <run-dir> <out.png> [--composition=labels|icon-cards]
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const dist = path.resolve(import.meta.dirname, '..', 'dist', 'src');
const load = (rel) => import(pathToFileURL(path.join(dist, rel)).href);
const args = process.argv.slice(2);
const composition = args.find((a) => a.startsWith('--composition='))?.slice('--composition='.length) ?? 'labels';
const [runDir, out] = args.filter((a) => !a.startsWith('--'));
if (!runDir || !out || !['labels', 'icon-cards'].includes(composition)) { console.error('usage: node scripts/v2-contact-sheet.mjs <run-dir> <out.png> [--composition=labels|icon-cards]'); process.exit(2); }

const [{ loadRetainedV2Run }, { renderSceneSvg }, { rasterizePng }] = await Promise.all([load('harness/retainedV2Run.js'), load('visual-v2/renderer/frame.js'), load('export/videoEncode.js')]);
const run = await loadRetainedV2Run(runDir, { composition });
if (run.status !== 'loaded') { console.error(`run not replayable: ${run.reason}`); process.exit(1); }
const tiles = run.scenes.map(({ scene }, i) => {
  const png = rasterizePng(renderSceneSvg(scene, scene.timeline.durationMs), 960).toString('base64');
  return `<image x="${(i % 2) * 960}" y="${Math.floor(i / 2) * 540}" width="960" height="540" href="data:image/png;base64,${png}"/>`;
});
const rows = Math.max(1, Math.ceil(tiles.length / 2));
const sheet = `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="${rows * 540}" viewBox="0 0 1920 ${rows * 540}"><rect width="1920" height="${rows * 540}" fill="#FDFDFB"/>${tiles.join('')}</svg>`;
mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
writeFileSync(out, rasterizePng(sheet, 1920));
console.log(`wrote ${out} (${run.lessonId}, ${run.scenes.length} scenes, ${composition}${run.complete ? '' : ', NO video.mp4: not for visual review'})`);
```

- [ ] **Step 10: Offline projection and before/after sheets (free)**

Run:
```bash
cd /Users/anupdangi/Desktop/AnupAI/Research/lamina-labs-clone/hypothesis_claude/.claude/worktrees/v2b
pnpm run build
RUNS=$(ls -d .data/benchmark-v2/cold-v2/2026-10-04-final*/*/*/runs/*/)
node dist/src/harness/v2RichnessCli.js --composition=icon-cards --json=harness/reports/rich-visuals/projection.icon-cards.json $RUNS
for r in $RUNS; do [ -f "$r/video.mp4" ] || continue; n=$(basename $(dirname $(dirname "$r"))); for c in labels icon-cards; do node scripts/v2-contact-sheet.mjs "$r" "output/rich-visuals/$n/$c.png" --composition=$c; done; done
open output/rich-visuals
```
Expected: `POOLED(icon-cards)` prints `familyMixScenes=0`, `conflicts=0`, `minIconPx` ≥ 56 or `n/a`, and an `iconShare` ≥ the baseline value from Task 1. Two PNGs per complete lesson. Show the user the `icon-cards.png` sheets; the projection number is the offline upper bound for live runs (it re-uses old boards whose labels were not written with icons in mind).

- [ ] **Step 11: Full gates, HANDOFF, commit (only after the user approves committing in chat)**

Run: `pnpm run typecheck && pnpm run test:hypothesis` — Expected: both pass.
Append HANDOFF: projection command, `POOLED(labels)` vs `POOLED(icon-cards)` lines verbatim, sheet paths; status `implemented, tested`; live visibility `unmeasured`.

```bash
git add src/visual-v2/renderer/visuals.ts src/visual-v2/renderer/frame.ts src/pipeline-v2/badgeProvenance.ts src/pipeline-v2/runLessonV2.ts src/harness/retainedV2Run.ts src/harness/v2RichnessReport.ts src/harness/v2RichnessCli.ts scripts/v2-contact-sheet.mjs src/__tests__/icon-cards.test.ts harness/reports/rich-visuals/projection.icon-cards.json docs/HANDOFF.md
git commit -m "feat(v2): icon cards with exact-name badges, rights evidence and contact sheets

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Wrong-icon gold set, human review sheet, scoring and acceptance rules

**Files:**
- Create: `src/__tests__/fixtures/icon-gold.v1.json`, `src/__tests__/icon-gold.test.ts`
- Create: `src/harness/wrongIcon.ts`, `src/harness/richnessAcceptance.ts`, `src/__tests__/richness-acceptance.test.ts`
- Create: `scripts/badge-review-sheet.mjs`
- Modify: `src/harness/v2RichnessCli.ts` (`--review`, `--accept`)

**Interfaces:**
- Consumes: `planSceneBadges` (Task 2), `loadBadgeReview`, `reviewKey`, `BadgeReview`, `EMPTY_BADGE_REVIEW` (Task 2), `IconUse`, `V2RichnessSummary`, `RichnessReport`, `richnessReport(runDirs, { composition })` (Tasks 1, 3).
- Produces:
  - `interface WrongIconScore { uses: number; reviewed: number; wrong: number; coverage: number | null; wrongIconRate: number | null; unreviewedKeys: string[] }`; `scoreWrongIcons(uses: readonly IconUse[], review: BadgeReview): WrongIconScore`
  - `ACCEPTANCE = { iconShareGainMin: 0.15, projectionRatioMin: 0.8, wrongIconRateMax: 0.05, textGrowthMax: 1.1, minIconSidePx: 56 }`
  - `evaluateRichnessAcceptance(input: { baseline: V2RichnessSummary; projection: V2RichnessSummary; live: RichnessReport; wrongIcons: WrongIconScore }): { passed: boolean; checks: AcceptanceCheck[] }` with `AcceptanceCheck { name: string; value: string; threshold: string; pass: boolean }`

- [ ] **Step 1: Create the gold fixture `src/__tests__/fixtures/icon-gold.v1.json`**

Every outcome below was probed against the current catalog on 2026-10-08 (see Evidence).

```json
{
  "schemaVersion": "icon-gold/v1",
  "note": "Hand-authored offline test inputs. expectNoBadge and expectSynonymRefusal are expected refusals; reviewCandidates only resolve to an exact primary-name asset and still need a HUMAN verdict in src/assets/data/badge-review.v1.json before they count as correct.",
  "expectNoBadge": ["compound interest", "prophase", "energy", "interest"],
  "expectSynonymRefusal": [{ "label": "source", "primaryName": "book" }],
  "reviewCandidates": ["cell", "battery", "resistor", "coin", "money", "water", "ambulance", "graph", "array", "thermometer", "time", "dna", "heart", "clock", "bank"]
}
```

- [ ] **Step 2: Write the failing tests**

Create `src/__tests__/icon-gold.test.ts` (real catalog, offline):

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { EMPTY_BADGE_REVIEW, badgeReviewFrom, loadBadgeReview } from '../assets/badgeReview.js';
import { planSceneBadges } from '../visual-v2/resolver/referentBadge.js';

const gold = JSON.parse(readFileSync(path.resolve('src/__tests__/fixtures/icon-gold.v1.json'), 'utf8')) as {
  expectNoBadge: string[]; expectSynonymRefusal: Array<{ label: string; primaryName: string }>; reviewCandidates: string[];
};
const one = (label: string, review = EMPTY_BADGE_REVIEW) => planSceneBadges([{ elementId: 'g', label }], { review });

test('gold: abstract labels with no exact catalog name never badge', () => {
  for (const label of gold.expectNoBadge) assert.equal(one(label).badges.length, 0, label);
});

test('gold: a synonym-only match is refused', () => {
  for (const { label, primaryName } of gold.expectSynonymRefusal) {
    const plan = one(label);
    assert.equal(plan.badges.length, 0, label);
    assert.match(plan.refusals[0]!.reason, new RegExp(`synonym of "${primaryName}"`));
  }
});

test('gold: review candidates resolve to exactly one primary-name badge', () => {
  for (const label of gold.reviewCandidates) assert.equal(one(label).badges.length, 1, label);
});

test('gold: a rejected verdict removes a candidate (abstract-noun guard by review)', () => {
  const first = one('time').badges[0]!;
  const review = badgeReviewFrom([{ assetId: first.assetId, referent: 'time', verdict: 'reject', reviewer: 'test', date: '2026-10-08' }]);
  assert.equal(one('time', review).badges.length, 0);
});

test('the shipped verdict file validates', () => {
  assert.doesNotThrow(() => loadBadgeReview());
});
```

Create `src/__tests__/richness-acceptance.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { badgeReviewFrom } from '../assets/badgeReview.js';
import { scoreWrongIcons } from '../harness/wrongIcon.js';
import { evaluateRichnessAcceptance } from '../harness/richnessAcceptance.js';
import type { IconUse, V2RichnessSummary } from '../harness/v2Richness.js';
import type { RichnessReport } from '../harness/v2RichnessReport.js';

const use = (assetId: string, referent: string): IconUse => ({ elementId: referent, referent, assetId, sidePx: 80, kind: 'badge' });
const summary = (over: Partial<V2RichnessSummary>): V2RichnessSummary => ({ scenes: 4, iconBearingShare: 0, labelOnlyEntityRatio: 1, distinctAssetIds: 0, familyMixScenes: 0, assetReuseConflicts: 0, minIconSidePx: null, meanTextChars: 100, meanWordsOnBoard: 20, meanElementVariety: 3, ...over });
const report = (pooled: V2RichnessSummary, hardFailures: number | null = 0): RichnessReport => ({ schemaVersion: 'v2-richness/v1', composition: 'icon-cards', pooled, runs: [{ runDir: 'r', lessonId: 'l', complete: true, status: 'loaded', hardFailures, timelineReplayMismatches: 0, summary: pooled, scenes: [], icons: [] }] });

test('wrong-icon rate counts only reviewed uses and reports coverage', () => {
  const review = badgeReviewFrom([
    { assetId: 'a', referent: 'cell', verdict: 'accept', reviewer: 'r', date: '2026-10-08' },
    { assetId: 'b', referent: 'time', verdict: 'reject', reviewer: 'r', date: '2026-10-08' },
  ]);
  const score = scoreWrongIcons([use('a', 'cell'), use('b', 'time'), use('c', 'coin')], review);
  assert.equal(score.uses, 3);
  assert.equal(score.reviewed, 2);
  assert.equal(score.wrong, 1);
  assert.equal(score.wrongIconRate, 0.5);
  assert.equal(score.coverage, 2 / 3);
  assert.deepEqual(score.unreviewedKeys, ['c|coin']);
});

test('acceptance passes only when every rule holds', () => {
  const full = { uses: 10, reviewed: 10, wrong: 0, coverage: 1, wrongIconRate: 0, unreviewedKeys: [] };
  const ok = evaluateRichnessAcceptance({ baseline: summary({}), projection: summary({ iconBearingShare: 0.5 }), live: report(summary({ iconBearingShare: 0.45, minIconSidePx: 60, meanTextChars: 105 })), wrongIcons: full });
  assert.equal(ok.passed, true, JSON.stringify(ok.checks));
  const partialReview = evaluateRichnessAcceptance({ baseline: summary({}), projection: summary({ iconBearingShare: 0.5 }), live: report(summary({ iconBearingShare: 0.45, minIconSidePx: 60 })), wrongIcons: { ...full, reviewed: 9, coverage: 0.9 } });
  assert.equal(partialReview.passed, false);
  const hard = evaluateRichnessAcceptance({ baseline: summary({}), projection: summary({ iconBearingShare: 0.5 }), live: report(summary({ iconBearingShare: 0.45, minIconSidePx: 60 }), 1), wrongIcons: full });
  assert.equal(hard.passed, false);
  const mixed = evaluateRichnessAcceptance({ baseline: summary({}), projection: summary({ iconBearingShare: 0.5 }), live: report(summary({ iconBearingShare: 0.45, minIconSidePx: 60, familyMixScenes: 1 })), wrongIcons: full });
  assert.equal(mixed.passed, false);
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm run build && node --test dist/src/__tests__/icon-gold.test.js dist/src/__tests__/richness-acceptance.test.js`
Expected: build FAILS: modules `../harness/wrongIcon.js` and `../harness/richnessAcceptance.js` missing. (`icon-gold.test.ts` alone compiles; its assertions are expected to pass already — it pins Task 2 behaviour against the real catalog.)

- [ ] **Step 4: Create `src/harness/wrongIcon.ts`**

```ts
import { reviewKey, type BadgeReview } from '../assets/badgeReview.js';
import type { IconUse } from './v2Richness.js';

/** Wrong-icon rate over human-reviewed uses only; coverage says how much of what was drawn has a verdict. */
export interface WrongIconScore { uses: number; reviewed: number; wrong: number; coverage: number | null; wrongIconRate: number | null; unreviewedKeys: string[] }

export function scoreWrongIcons(uses: readonly IconUse[], review: BadgeReview): WrongIconScore {
  const keys = uses.map((use) => reviewKey(use.assetId, use.referent));
  const reviewed = keys.filter((key) => review.accepted.has(key) || review.rejected.has(key));
  const wrong = keys.filter((key) => review.rejected.has(key)).length;
  return {
    uses: keys.length,
    reviewed: reviewed.length,
    wrong,
    coverage: keys.length ? reviewed.length / keys.length : null,
    wrongIconRate: reviewed.length ? wrong / reviewed.length : null,
    unreviewedKeys: [...new Set(keys.filter((key) => !review.accepted.has(key) && !review.rejected.has(key)))].sort(),
  };
}
```

- [ ] **Step 5: Create `src/harness/richnessAcceptance.ts`**

```ts
import type { V2RichnessSummary } from './v2Richness.js';
import type { RichnessReport } from './v2RichnessReport.js';
import type { WrongIconScore } from './wrongIcon.js';

/**
 * Fixed acceptance rules for the rich-visuals live run. Absolute thresholds are fixed here; the icon-share bar is derived
 * from the measured baseline (Task 1) and the offline projection (Task 3), so no number is guessed before measurement.
 */
export const ACCEPTANCE = { iconShareGainMin: 0.15, projectionRatioMin: 0.8, wrongIconRateMax: 0.05, textGrowthMax: 1.1, minIconSidePx: 56 } as const;
export interface AcceptanceCheck { name: string; value: string; threshold: string; pass: boolean }

const n = (value: number | null): string => (value === null ? 'n/a' : value.toFixed(3));

export function evaluateRichnessAcceptance(input: { baseline: V2RichnessSummary; projection: V2RichnessSummary; live: RichnessReport; wrongIcons: WrongIconScore }): { passed: boolean; checks: AcceptanceCheck[] } {
  const { baseline, projection, live, wrongIcons } = input;
  const pooled = live.pooled;
  const shareBar = Math.max((baseline.iconBearingShare ?? 0) + ACCEPTANCE.iconShareGainMin, (projection.iconBearingShare ?? 0) * ACCEPTANCE.projectionRatioMin);
  const complete = live.runs.filter((run) => run.complete);
  const hardFailures = complete.reduce((sum, run) => sum + (run.hardFailures ?? Number.POSITIVE_INFINITY), 0);
  const checks: AcceptanceCheck[] = [
    { name: 'complete live runs', value: String(complete.length), threshold: '>= 1', pass: complete.length >= 1 },
    { name: 'hard failures', value: String(hardFailures), threshold: '0 (unknown counts as failure)', pass: hardFailures === 0 },
    { name: 'icon-bearing share', value: n(pooled.iconBearingShare), threshold: `>= ${shareBar.toFixed(3)} (max(baseline+${ACCEPTANCE.iconShareGainMin}, ${ACCEPTANCE.projectionRatioMin} x projection))`, pass: (pooled.iconBearingShare ?? 0) >= shareBar },
    { name: 'wrong-icon rate', value: n(wrongIcons.wrongIconRate), threshold: `<= ${ACCEPTANCE.wrongIconRateMax}`, pass: wrongIcons.wrongIconRate !== null && wrongIcons.wrongIconRate <= ACCEPTANCE.wrongIconRateMax },
    { name: 'review coverage', value: n(wrongIcons.coverage), threshold: '= 1.000 (every drawn icon has a human verdict)', pass: wrongIcons.coverage === 1 },
    { name: 'family-mix scenes', value: String(pooled.familyMixScenes), threshold: '0', pass: pooled.familyMixScenes === 0 },
    { name: 'asset reuse conflicts', value: String(pooled.assetReuseConflicts), threshold: '0', pass: pooled.assetReuseConflicts === 0 },
    { name: 'smallest icon side (px)', value: String(pooled.minIconSidePx ?? 'n/a'), threshold: `>= ${ACCEPTANCE.minIconSidePx}`, pass: pooled.minIconSidePx !== null && pooled.minIconSidePx >= ACCEPTANCE.minIconSidePx },
    { name: 'mean text chars per scene', value: pooled.meanTextChars.toFixed(1), threshold: `<= ${(baseline.meanTextChars * ACCEPTANCE.textGrowthMax).toFixed(1)} (icons add pictures, not words)`, pass: pooled.meanTextChars <= baseline.meanTextChars * ACCEPTANCE.textGrowthMax },
  ];
  return { passed: checks.every((check) => check.pass), checks };
}
```

- [ ] **Step 6: Add `--review` and `--accept` to `src/harness/v2RichnessCli.ts`**

Add imports:

```ts
import { readFile } from 'node:fs/promises';
import { loadBadgeReview } from '../assets/badgeReview.js';
import { scoreWrongIcons } from './wrongIcon.js';
import { evaluateRichnessAcceptance } from './richnessAcceptance.js';
import type { RichnessReport } from './v2RichnessReport.js';
```

Append inside `main()` after the JSON write:

```ts
  const completeIcons = report.runs.filter((run) => run.complete).flatMap((run) => run.icons);
  if (args.includes('--review') || args.includes('--accept')) {
    const score = scoreWrongIcons(completeIcons, loadBadgeReview());
    process.stdout.write(`WRONG-ICON\tuses=${score.uses}\treviewed=${score.reviewed}\twrong=${score.wrong}\tcoverage=${fmt(score.coverage)}\trate=${fmt(score.wrongIconRate)}\tunreviewed=${score.unreviewedKeys.join(',') || '-'}\n`);
    if (args.includes('--accept')) {
      const baselinePath = flag('baseline'); const projectionPath = flag('projection');
      if (!baselinePath || !projectionPath) { process.stderr.write('--accept needs --baseline=<labels.json> and --projection=<icon-cards.json>\n'); process.exitCode = 2; return; }
      const baseline = JSON.parse(await readFile(baselinePath, 'utf8')) as RichnessReport;
      const projection = JSON.parse(await readFile(projectionPath, 'utf8')) as RichnessReport;
      const result = evaluateRichnessAcceptance({ baseline: baseline.pooled, projection: projection.pooled, live: report, wrongIcons: score });
      for (const check of result.checks) process.stdout.write(`${check.pass ? 'PASS' : 'FAIL'}\t${check.name}\t${check.value}\t${check.threshold}\n`);
      process.stdout.write(`ACCEPTANCE ${result.passed ? 'PASSED' : 'FAILED'}\n`);
      if (!result.passed) process.exitCode = 1;
    }
  }
```

Update the usage string to `usage: v2RichnessCli.js [--composition=labels|icon-cards] [--json=<out.json>] [--review] [--accept --baseline=<json> --projection=<json>] <run-dir>...`.

- [ ] **Step 7: Create `scripts/badge-review-sheet.mjs`**

```js
#!/usr/bin/env node
// Human review sheet of distinct (icon, referent) pairs drawn in retained runs and/or proposed by the gold fixture.
// It never records a verdict. The reviewer replies in chat; verdicts go into src/assets/data/badge-review.v1.json.
// Usage: pnpm run build && node scripts/badge-review-sheet.mjs --out=<dir> [--gold=src/__tests__/fixtures/icon-gold.v1.json] [<run-dir>...]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const dist = path.resolve(import.meta.dirname, '..', 'dist', 'src');
const load = (rel) => import(pathToFileURL(path.join(dist, rel)).href);
const args = process.argv.slice(2);
const flag = (key) => args.find((a) => a.startsWith(`--${key}=`))?.slice(key.length + 3);
const out = flag('out');
const goldPath = flag('gold');
const runDirs = args.filter((a) => !a.startsWith('--'));
if (!out || (!goldPath && !runDirs.length)) { console.error('usage: node scripts/badge-review-sheet.mjs --out=<dir> [--gold=<file>] [<run-dir>...]'); process.exit(2); }

const [{ richnessReport }, { planSceneBadges }, { allCatalogEntries }, { loadBadgeReview, reviewKey }, render, { rasterizePng }] = await Promise.all([
  load('harness/v2RichnessReport.js'), load('visual-v2/resolver/referentBadge.js'), load('assets/semantic.js'), load('assets/badgeReview.js'), load('render/renderScene.js'), load('export/videoEncode.js'),
]);
const catalog = new Map(allCatalogEntries().map((entry) => [entry.id, entry]));
const review = loadBadgeReview();
const pairs = new Map();
const add = (assetId, referent, seenIn) => { const key = reviewKey(assetId, referent); const pair = pairs.get(key) ?? { key, assetId, referent, seenIn: [] }; pair.seenIn.push(seenIn); pairs.set(key, pair); };
if (runDirs.length) {
  const report = await richnessReport(runDirs, { composition: 'icon-cards' });
  for (const run of report.runs) for (const icon of run.icons) add(icon.assetId, icon.referent, `${run.lessonId}/${icon.sceneId}/${icon.kind}`);
}
if (goldPath) {
  const gold = JSON.parse(readFileSync(goldPath, 'utf8'));
  for (const label of gold.reviewCandidates) for (const badge of planSceneBadges([{ elementId: 'gold', label }]).badges) add(badge.assetId, badge.referent, 'gold-candidate');
}
const list = [...pairs.values()].sort((a, b) => a.key.localeCompare(b.key)).map((pair, index) => ({
  number: index + 1, ...pair, license: catalog.get(pair.assetId)?.license ?? null, houseFamily: catalog.get(pair.assetId)?.houseFamily ?? null,
  verdict: review.accepted.has(pair.key) ? 'accept' : review.rejected.has(pair.key) ? 'reject' : null,
}));
const cols = 4, W = 480, H = 320, rows = Math.max(1, Math.ceil(list.length / cols));
const cells = list.map((pair, i) => {
  const visual = catalog.get(pair.assetId).render({ w: 200, h: 200 });
  const icon = [...visual.fills.map((f) => render.fillSvg(f, 1)), ...render.sequentialStrokes(visual.paths, 1), ...visual.texts.map(render.textSvg), ...(visual.embeds ?? []).map(render.embedSvg)].join('');
  const caption = render.textSvg({ x: W / 2, y: 260, text: `#${pair.number} ${pair.referent}`, size: 30, anchor: 'middle' });
  const status = render.textSvg({ x: W / 2, y: 298, text: pair.verdict ?? 'unreviewed', size: 22, anchor: 'middle' });
  return `<g transform="translate(${(i % cols) * W},${Math.floor(i / cols) * H})"><rect width="${W}" height="${H}" fill="#FDFDFB" stroke="#cccccc" stroke-width="2"/><g transform="translate(140,20)">${icon}</g>${caption}${status}</g>`;
});
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${cols * W}" height="${rows * H}" viewBox="0 0 ${cols * W} ${rows * H}"><rect width="${cols * W}" height="${rows * H}" fill="#FDFDFB"/>${cells.join('')}</svg>`;
mkdirSync(out, { recursive: true });
writeFileSync(path.join(out, 'sheet.png'), rasterizePng(svg, Math.min(cols * W, 1920)));
writeFileSync(path.join(out, 'candidates.json'), `${JSON.stringify({ schemaVersion: 'badge-review-candidates/v1', pairs: list }, null, 2)}\n`);
console.log(`wrote ${path.join(out, 'sheet.png')} and candidates.json (${list.length} pairs, ${list.filter((p) => !p.verdict).length} unreviewed)`);
```

- [ ] **Step 8: Run tests, build the first review sheet (free)**

Run:
```bash
pnpm run build && node --test dist/src/__tests__/icon-gold.test.js dist/src/__tests__/richness-acceptance.test.js
node scripts/badge-review-sheet.mjs --out=output/badge-review/2026-10-gold --gold=src/__tests__/fixtures/icon-gold.v1.json $(ls -d .data/benchmark-v2/cold-v2/2026-10-04-final*/*/*/runs/*/)
open output/badge-review/2026-10-gold/sheet.png
```
Expected: tests PASS (7). Sheet lists numbered pairs, all `unreviewed`.

- [ ] **Step 9: Record human verdicts (user action)**

Show the user the sheet and ask: "For each numbered icon, reply accept or reject (e.g. `1 accept, 2 reject …`)." Write one entry per numbered pair into `src/assets/data/badge-review.v1.json` exactly as answered, with `"reviewer": "anup"` and today's date; quote the user's reply verbatim and dated in the HANDOFF entry. If the user does not answer, leave the file unchanged and keep wrong-icon rate `unmeasured`.

Run: `pnpm run build && node --test dist/src/__tests__/icon-gold.test.js dist/src/__tests__/referent-badge.test.js`
Expected: PASS. If a review candidate the user rejected makes "review candidates resolve to exactly one badge" fail, that is correct behaviour: move that label from `reviewCandidates` to `expectNoBadge` in the fixture with a note naming the verdict date.

- [ ] **Step 10: Full gates, HANDOFF, commit (only after the user approves committing in chat)**

Run: `pnpm run typecheck && pnpm run test:hypothesis` — Expected: both pass.

```bash
git add src/__tests__/fixtures/icon-gold.v1.json src/__tests__/icon-gold.test.ts src/__tests__/richness-acceptance.test.ts src/harness/wrongIcon.ts src/harness/richnessAcceptance.ts src/harness/v2RichnessCli.ts scripts/badge-review-sheet.mjs src/assets/data/badge-review.v1.json docs/HANDOFF.md
git commit -m "feat(v2): wrong-icon gold set, review sheet and numeric acceptance rules

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Reproducible v0.3.0 / v1.0.0 / V2 comparison

**Files:**
- Create: `scripts/cmp-v1.mjs`, `scripts/cmp-v1.test.mjs`
- Modify: `package.json` (`test:hypothesis`: add `node --test scripts/cmp-v1.test.mjs` right after the existing `node --test scripts/audit-retained-board-v2.test.mjs`)
- Output (by script): `bench/cmp-v1/manifest.json`, `bench/cmp-v1/sources/{cmp-bio01,cmp-cs01,cmp-math01}.md`, `output/cmp-v1/<case>/<version>.png`

**Interfaces:**
- Consumes: retained files under the cmp worktrees root (passed as `--cmp-root`); `ffmpeg`, `ffprobe` (verified at `/opt/homebrew/bin/ffmpeg`).
- Produces: `caseFromPrep(prep)`, `v030Matches(sourceText, fileName)`, `sheetArgs(input, output, durationSec, frames?)` (exported for tests); manifest schema `cmp-v1/v1` read by Task 7.

- [ ] **Step 1: Write the failing test `scripts/cmp-v1.test.mjs`**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { caseFromPrep, sheetArgs, v030Matches } from './cmp-v1.mjs';

const text = '[S1] A semipermeable membrane lets water pass but blocks most solutes. [S2] More.\n';
const prep = { request: { id: 'cmp-bio01', source: text, instruction: 'Explain it.', targetDurationSec: 60, sourceDoc: { text, contentSha256: '' } } };

test('caseFromPrep keeps the verbatim source, instruction and hash check', async () => {
  const { createHash } = await import('node:crypto');
  prep.request.sourceDoc.contentSha256 = createHash('sha256').update(text).digest('hex');
  const item = caseFromPrep(prep);
  assert.equal(item.id, 'cmp-bio01');
  assert.equal(item.instruction, 'Explain it.');
  assert.equal(item.durationSec, 60);
  assert.equal(item.source, text);
  assert.equal(item.sourceMatchesSourceDoc, true);
});

test('v0.3.0 output names are matched to a source by their first-sentence slug', () => {
  assert.equal(v030Matches(text, 'S1-A-semipermeable-membrane-lets-water-pass-but-blocks-most--1min.mp4'), true);
  assert.equal(v030Matches(text, 'S1-Binary-search-needs-a-sorted-array-1min.mp4'), false);
});

test('sheetArgs tiles evenly spaced frames with integer rates', () => {
  const args = sheetArgs('in.mp4', 'out.png', 59.998, 10);
  assert.deepEqual(args.slice(-3), ['-frames:v', '1', 'out.png']);
  assert.match(args[args.indexOf('-vf') + 1], /^fps=10000\/59998,scale=384:-2,tile=5x2$/);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test scripts/cmp-v1.test.mjs`
Expected: FAIL with `Cannot find module '.../scripts/cmp-v1.mjs'`.

- [ ] **Step 3: Create `scripts/cmp-v1.mjs`**

```js
#!/usr/bin/env node
// Reproducible comparison of the three cmp lessons across v0.3.0, v1.0.0 and V2. Offline; never calls a provider.
//   node scripts/cmp-v1.mjs extract --cmp-root=<dir>                          write bench/cmp-v1/{manifest.json,sources/*.md}
//   node scripts/cmp-v1.mjs sheets  --cmp-root=<dir> [--v2=<caseId>=<mp4>]...  write output/cmp-v1/<case>/<version>.png
// <dir> is the folder holding the v0.3.0/ and v1.0.0/ comparison worktrees (on the 2026-10-08 host:
// /Users/anupdangi/Desktop/AnupAI/Research/lamina-labs-clone/cmp-worktrees).
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
// Where each retained case lives inside the comparison worktrees (evidence paths, not topic logic).
const CASES = [
  { id: 'cmp-bio01', v100: 'v1.0.0/.data/cmp/cmp-bio01/runs', v030: 'v0.3.0/output/cmp-BIO-01' },
  { id: 'cmp-cs01', v100: 'v1.0.0/.data/cmp-CS-01/cmp-cs01/runs', v030: 'v0.3.0/output/cmp-CS-01' },
  { id: 'cmp-math01', v100: 'v1.0.0/.data/cmp-MATH-01/cmp-math01/runs', v030: 'v0.3.0/output/cmp-MATH-01' },
];
const sha256 = (text) => createHash('sha256').update(text).digest('hex');

export function caseFromPrep(prep) {
  const request = prep?.request;
  if (typeof request?.id !== 'string' || typeof request.source !== 'string') throw new Error('lesson-prep.json has no request.id/source');
  return {
    id: request.id,
    instruction: typeof request.instruction === 'string' ? request.instruction : null,
    durationSec: request.targetDurationSec ?? 60,
    source: request.source,
    sourceSha256: sha256(request.source),
    sourceMatchesSourceDoc: typeof request.sourceDoc?.text === 'string' && request.sourceDoc.text === request.source && sha256(request.sourceDoc.text) === request.sourceDoc.contentSha256,
  };
}

export function v030Matches(sourceText, fileName) {
  const slug = sourceText.replace(/^\s*\[S1\]\s*/, '').replace(/[^A-Za-z0-9]+/g, '-');
  const stem = fileName.replace(/^S1-/, '').replace(/-*1min\.mp4$/, '');
  return stem.length > 10 && slug.startsWith(stem);
}

export function sheetArgs(input, output, durationSec, frames = 10) {
  const cols = 5;
  const rows = Math.ceil(frames / cols);
  return ['-v', 'error', '-y', '-i', input, '-vf', `fps=${frames * 1000}/${Math.round(durationSec * 1000)},scale=384:-2,tile=${cols}x${rows}`, '-frames:v', '1', output];
}

function durationOf(file) {
  const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' });
  if (probe.status !== 0) throw new Error(`ffprobe failed for ${file}: ${probe.stderr}`);
  return Number(probe.stdout.trim());
}

function extract(cmpRoot) {
  const cases = CASES.map((item) => {
    const runsDir = path.join(cmpRoot, item.v100);
    const runs = readdirSync(runsDir).sort();
    const prepRun = runs.findLast((run) => existsSync(path.join(runsDir, run, 'lesson-prep.json')));
    if (!prepRun) throw new Error(`${item.id}: no v1.0.0 lesson-prep.json under ${runsDir}`);
    const found = caseFromPrep(JSON.parse(readFileSync(path.join(runsDir, prepRun, 'lesson-prep.json'), 'utf8')));
    if (found.id !== item.id || !found.sourceMatchesSourceDoc) throw new Error(`${item.id}: recorded source does not verify`);
    const v100Video = runs.map((run) => path.join(item.v100, run, 'video.mp4')).findLast((rel) => existsSync(path.join(cmpRoot, rel))) ?? null;
    const v030Dir = path.join(cmpRoot, item.v030);
    const v030Video = readdirSync(v030Dir).find((name) => name.endsWith('.mp4') && v030Matches(found.source, name));
    const sourceRel = `bench/cmp-v1/sources/${item.id}.md`;
    mkdirSync(path.join(ROOT, 'bench/cmp-v1/sources'), { recursive: true });
    writeFileSync(path.join(ROOT, sourceRel), found.source);
    return {
      id: item.id, instruction: found.instruction, durationSec: found.durationSec, source: sourceRel, sourceSha256: found.sourceSha256,
      retained: {
        'v0.3.0': { video: v030Video ? path.join(item.v030, v030Video) : null, sourceEvidence: 'output file name matches the first-sentence slug' },
        'v1.0.0': { run: path.join(item.v100, prepRun), video: v100Video, sourceEvidence: 'lesson-prep.json request.source sha256 == sourceDoc.contentSha256' },
      },
    };
  });
  writeFileSync(path.join(ROOT, 'bench/cmp-v1/manifest.json'), `${JSON.stringify({ schemaVersion: 'cmp-v1/v1', note: 'Paths under retained are relative to --cmp-root. Videos are evidence only and never committed.', cases }, null, 2)}\n`);
  for (const c of cases) console.log(`${c.id}\tv0.3.0=${c.retained['v0.3.0'].video ?? 'none'}\tv1.0.0=${c.retained['v1.0.0'].video ?? 'none'}`);
}

function sheets(cmpRoot, v2Videos) {
  const manifest = JSON.parse(readFileSync(path.join(ROOT, 'bench/cmp-v1/manifest.json'), 'utf8'));
  for (const c of manifest.cases) {
    const versions = { 'v0.3.0': c.retained['v0.3.0'].video && path.join(cmpRoot, c.retained['v0.3.0'].video), 'v1.0.0': c.retained['v1.0.0'].video && path.join(cmpRoot, c.retained['v1.0.0'].video), v2: v2Videos.get(c.id) };
    for (const [version, video] of Object.entries(versions)) {
      if (!video) { console.log(`${c.id}\t${version}\tno video`); continue; }
      const out = path.join(ROOT, 'output/cmp-v1', c.id, `${version}.png`);
      mkdirSync(path.dirname(out), { recursive: true });
      const run = spawnSync('ffmpeg', sheetArgs(video, out, durationOf(video)), { encoding: 'utf8' });
      if (run.status !== 0) throw new Error(`ffmpeg failed for ${video}: ${run.stderr}`);
      console.log(`${c.id}\t${version}\t${out}`);
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const [command, ...rest] = process.argv.slice(2);
  const cmpRoot = rest.find((a) => a.startsWith('--cmp-root='))?.slice('--cmp-root='.length);
  const v2Videos = new Map(rest.filter((a) => a.startsWith('--v2=')).map((a) => { const [id, ...file] = a.slice('--v2='.length).split('='); return [id, path.resolve(file.join('='))]; }));
  if (!cmpRoot || !['extract', 'sheets'].includes(command)) { console.error('usage: node scripts/cmp-v1.mjs extract|sheets --cmp-root=<dir> [--v2=<caseId>=<video.mp4>]...'); process.exit(2); }
  if (command === 'extract') extract(path.resolve(cmpRoot)); else sheets(path.resolve(cmpRoot), v2Videos);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test scripts/cmp-v1.test.mjs`
Expected: PASS, 3 tests.

- [ ] **Step 5: Extract and render the retained comparison (free)**

Run:
```bash
cd /Users/anupdangi/Desktop/AnupAI/Research/lamina-labs-clone/hypothesis_claude/.claude/worktrees/v2b
CMP=/Users/anupdangi/Desktop/AnupAI/Research/lamina-labs-clone/cmp-worktrees
node scripts/cmp-v1.mjs extract --cmp-root=$CMP
node scripts/cmp-v1.mjs sheets --cmp-root=$CMP
open output/cmp-v1
```
Expected: `extract` prints three lines; `v0.3.0` has a video for all three cases, `v1.0.0` only for `cmp-math01` (verified 2026-10-08). `sheets` writes one 10-frame PNG per existing video. `bench/cmp-v1/sources/*.md` byte-equal the recorded sources.

- [ ] **Step 6: Wire into the suite, gates, HANDOFF, commit (only after the user approves committing in chat)**

In `package.json` `test:hypothesis`, insert `&& node --test scripts/cmp-v1.test.mjs` immediately after `node --test scripts/audit-retained-board-v2.test.mjs`.

Run: `pnpm run typecheck && pnpm run test:hypothesis && node scripts/v2-benchmark.mjs verify cold-v2`
Expected: all pass; `benchmark intact` (the new `bench/cmp-v1/` folder is outside `bench/benchmark-v2/`).

Append HANDOFF: the "Why not v0.3.0" bullets from this plan, the extract/sheets output, sheet paths.

```bash
git add scripts/cmp-v1.mjs scripts/cmp-v1.test.mjs bench/cmp-v1/manifest.json bench/cmp-v1/sources package.json docs/HANDOFF.md
git commit -m "chore(bench): reproducible cmp comparison inputs and video contact sheets

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Stage cost/latency report and model-routing proposal

**Files:**
- Create: `src/harness/stageCost.ts`, `src/harness/stageCostCli.ts`, `src/__tests__/stage-cost.test.ts`
- Modify: `package.json` (`"stage-cost": "pnpm run build && node dist/src/harness/stageCostCli.js"`)

**Interfaces:**
- Consumes: `lesson-prep.json` `stageRuns[]` (`{ stage, modelId?, status, durationMs, apiCostUsd }`); `evaluation-bundle.json` `usage.costUsd`; `structured/<stage>/<n>/report.json`; `computeStructuredMetrics(reports)` (`src/harness/structuredMetrics.ts`).
- Produces: `interface StageRunRecord`, `interface StageCostRow { stage; models: string[]; runs; failed; costUsd; meanDurationMs }`, `stageFamily(stage)`, `stageCostRows(perRun)`, `v2RemainderUsd(totalUsd, prep)`.

- [ ] **Step 1: Write the failing test `src/__tests__/stage-cost.test.ts`**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { stageCostRows, stageFamily, v2RemainderUsd, type StageRunRecord } from '../harness/stageCost.js';

const runA: StageRunRecord[] = [
  { stage: 'S1-syllabus', modelId: 'm/strong', status: 'completed', durationMs: 10000, apiCostUsd: 0.001 },
  { stage: 'S2-concepts:01-module_1', modelId: 'm/strong', status: 'completed', durationMs: 9000, apiCostUsd: 0.002 },
  { stage: 'S1-evidence-retrieval', status: 'completed', durationMs: 0, apiCostUsd: 0 },
];
const runB: StageRunRecord[] = [
  { stage: 'S2-concepts:01-module_1', modelId: 'm/cheap', status: 'failed', durationMs: 3000, apiCostUsd: 0.0002 },
];

test('stage rows merge module-suffixed stages and keep every model and failure', () => {
  assert.equal(stageFamily('S3b-beats:01-module_1'), 'S3b-beats');
  const rows = stageCostRows([runA, runB]);
  const concepts = rows.find((row) => row.stage === 'S2-concepts')!;
  assert.deepEqual(concepts.models, ['m/cheap', 'm/strong']);
  assert.equal(concepts.runs, 2);
  assert.equal(concepts.failed, 1);
  assert.equal(concepts.meanDurationMs, 6000);
  assert.equal(rows[0]!.stage, 'S2-concepts', 'sorted by cost, highest first');
});

test('V2 remainder is evaluation total minus recorded prep stages, never negative', () => {
  assert.equal(Number(v2RemainderUsd(0.0188, runA).toFixed(4)), 0.0158);
  assert.equal(v2RemainderUsd(0.001, runA), 0);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm run build && node --test dist/src/__tests__/stage-cost.test.js`
Expected: build FAILS: module `../harness/stageCost.js` missing.

- [ ] **Step 3: Create `src/harness/stageCost.ts`**

```ts
/** Per-stage provider cost and latency from retained runs. Prep stages are itemised; V2 S4+S6 spend is derived, not itemised. */
export interface StageRunRecord { stage: string; modelId?: string; status: string; durationMs: number; apiCostUsd: number }
export interface StageCostRow { stage: string; models: string[]; runs: number; failed: number; costUsd: number; meanDurationMs: number }

export const stageFamily = (stage: string): string => stage.split(':', 1)[0] ?? stage;

export function stageCostRows(perRun: ReadonlyArray<readonly StageRunRecord[]>): StageCostRow[] {
  const rows = new Map<string, { models: Set<string>; runs: number; failed: number; costUsd: number; durationMs: number }>();
  for (const run of perRun) for (const record of run) {
    const key = stageFamily(record.stage);
    const row = rows.get(key) ?? { models: new Set<string>(), runs: 0, failed: 0, costUsd: 0, durationMs: 0 };
    if (record.modelId) row.models.add(record.modelId);
    row.runs += 1;
    if (record.status !== 'completed') row.failed += 1;
    row.costUsd += record.apiCostUsd;
    row.durationMs += record.durationMs;
    rows.set(key, row);
  }
  return [...rows].map(([stage, row]) => ({ stage, models: [...row.models].sort(), runs: row.runs, failed: row.failed, costUsd: row.costUsd, meanDurationMs: row.runs ? row.durationMs / row.runs : 0 }))
    .sort((a, b) => b.costUsd - a.costUsd || a.stage.localeCompare(b.stage));
}

export function v2RemainderUsd(totalUsd: number, prep: readonly StageRunRecord[]): number {
  return Math.max(0, totalUsd - prep.reduce((sum, record) => sum + record.apiCostUsd, 0));
}
```

- [ ] **Step 4: Create `src/harness/stageCostCli.ts`**

```ts
#!/usr/bin/env node
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { StructuredCallReport } from '../llm/structuredCall.js';
import { computeStructuredMetrics } from './structuredMetrics.js';
import { stageCostRows, v2RemainderUsd, type StageRunRecord } from './stageCost.js';

/** Usage: node dist/src/harness/stageCostCli.js <run-dir>...  (offline; reads retained run files only) */
const runDirs = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
const json = async <T>(file: string): Promise<T | undefined> => { try { return JSON.parse(await readFile(file, 'utf8')) as T; } catch { return undefined; } };

async function structuredReports(run: string): Promise<StructuredCallReport[]> {
  const root = path.join(run, 'structured');
  const out: StructuredCallReport[] = [];
  for (const stage of await readdir(root).catch(() => [] as string[])) {
    for (const call of await readdir(path.join(root, stage)).catch(() => [] as string[])) {
      const report = await json<StructuredCallReport>(path.join(root, stage, call, 'report.json'));
      if (report) out.push(report);
    }
  }
  return out;
}

async function main(): Promise<void> {
  if (!runDirs.length) { process.stderr.write('usage: stageCostCli.js <run-dir>...\n'); process.exitCode = 2; return; }
  const perRun: StageRunRecord[][] = [];
  const reports: StructuredCallReport[] = [];
  let remainder = 0; let total = 0;
  for (const run of runDirs) {
    const prep = await json<{ stageRuns?: StageRunRecord[] }>(path.join(run, 'lesson-prep.json'));
    const bundle = await json<{ usage?: { costUsd?: number } }>(path.join(run, 'evaluation-bundle.json'));
    const stageRuns = prep?.stageRuns ?? [];
    perRun.push(stageRuns);
    reports.push(...await structuredReports(run));
    const runTotal = bundle?.usage?.costUsd ?? 0;
    total += runTotal; remainder += v2RemainderUsd(runTotal, stageRuns);
  }
  process.stdout.write('stage\tmodels\truns\tfailed\tcostUsd\tmeanDurationMs\n');
  for (const row of stageCostRows(perRun)) process.stdout.write(`${row.stage}\t${row.models.join(',') || '-'}\t${row.runs}\t${row.failed}\t${row.costUsd.toFixed(6)}\t${Math.round(row.meanDurationMs)}\n`);
  process.stdout.write(`S4+S6 (derived: evaluation total - prep stages)\t-\t${runDirs.length}\t-\t${remainder.toFixed(6)}\t-\n`);
  process.stdout.write(`TOTAL\t-\t${runDirs.length}\t-\t${total.toFixed(6)}\t-\n`);
  const metrics = computeStructuredMetrics(reports);
  for (const [cls, rate] of Object.entries(metrics.firstTryValid)) process.stdout.write(`firstTryValid.${cls}\t${rate.valid}/${rate.calls}\n`);
}

main().catch((error: unknown) => { process.stderr.write(`stage cost failed: ${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 2; });
```

Add to `package.json` `scripts`: `"stage-cost": "pnpm run build && node dist/src/harness/stageCostCli.js",`.

- [ ] **Step 5: Run the test, then the offline report (free)**

Run:
```bash
pnpm run build && node --test dist/src/__tests__/stage-cost.test.js
node dist/src/harness/stageCostCli.js $(ls -d .data/benchmark-v2/cold-v2/2026-10-04-final*/*/*/runs/*/)
```
Expected: test PASS (2). The report lists `S3b-beats`, `S3-teaching-plan`, `S1-syllabus`, `S2-concepts` with `openai/gpt-6-luna`, a derived S4+S6 line, and `firstTryValid.S6` around the HANDOFF figure (5/25 first-try on the final runs).

- [ ] **Step 6: Write the routing proposal into HANDOFF (no paid call)**

Append a table built from Step 5's output: stage, current model, mean latency, cost share, and the proposed route. Evidence-based default proposal, to be confirmed by the numbers:
- Keep `OPENROUTER_PLAN_MODEL` (S3 plan **and** S3b Visual Discovery, `src/run/lesson.ts:153`), `OPENROUTER_SCENE_MODEL` (S4) and `--s6-planner` (S6) on `openai/gpt-6-luna`: HANDOFF records cheap models failing these stages (S3: `deepseek/deepseek-v4.1-flash` 2/10, `google/gemini-3.8-flash` 0 runs; S6: gemini 1/6 vs luna 6/6, HANDOFF line ~635; qwen S3 6/15, line ~2345).
- Candidate cheap route only for `OPENROUTER_SYLLABUS_MODEL` (S1) and `OPENROUTER_CONCEPTS_MODEL` (S2): short, schema-constrained stages; the goal is latency, since a whole 60 s lesson costs ≈ $0.019 today.

- [ ] **Step 7: Pick the candidate model id (network, free — ask first)**

Ask the user: "May I make one free, unauthenticated GET to https://openrouter.ai/api/v1/models to list current model ids and prices?" On yes, run:
```bash
curl -sS --max-time 20 https://openrouter.ai/api/v1/models | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{for(const m of JSON.parse(s).data){if(/haiku|flash|mini/i.test(m.id))console.log(m.id,m.pricing.prompt,m.pricing.completion)}})"
```
Show the list; the user picks one id (record it verbatim in HANDOFF as `CHEAP_MODEL`).

- [ ] **Step 8: PAID — routing bake-off (only with explicit approval)**

Ask: "Approve a PAID routing check: 2 cold 60 s V2 lessons of benchmark case `mitosis` (one baseline, one with S1+S2 on `<CHEAP_MODEL>`), local TTS, ≤ $0.10 each, ≤ $0.20 total, stop on first hard failure?" Only on an explicit yes:
```bash
pnpm run build
node scripts/v2-benchmark.mjs run cold-v2 --cases=mitosis --trials=1 --tts=local
OPENROUTER_SYLLABUS_MODEL=<CHEAP_MODEL> OPENROUTER_CONCEPTS_MODEL=<CHEAP_MODEL> node scripts/v2-benchmark.mjs run cold-v2 --cases=mitosis --trials=1 --tts=local
node dist/src/harness/stageCostCli.js <the two new run dirs printed by the benchmark>
```
(`<CHEAP_MODEL>` is the id the user picked in Step 7.) Adopt the route only if the cheap arm has 0 hard failures, S1/S2 completed first try, and lower S1+S2 latency; record both arms' real spend. Otherwise record "routing unchanged" with the numbers.

- [ ] **Step 9: Gates, HANDOFF, commit (only after the user approves committing in chat)**

Run: `pnpm run typecheck && pnpm run test:hypothesis`

```bash
git add src/harness/stageCost.ts src/harness/stageCostCli.ts src/__tests__/stage-cost.test.ts package.json docs/HANDOFF.md
git commit -m "feat(harness): per-stage cost and latency report for model routing

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: PAID — one user-approved live verification and comparison

**Files:**
- No source changes. Outputs: `.data/rich-visuals/2026-10-live/…` (gitignored), `harness/reports/rich-visuals/live.icon-cards.json`, `output/rich-visuals/live/*.png`, `output/badge-review/2026-10-live/`, `output/cmp-v1/*/v2.png`; HANDOFF entry.

**Interfaces:**
- Consumes: everything above; `bench/cmp-v1/manifest.json` (Task 5); `baseline.labels.json` (Task 1); `projection.icon-cards.json` (Task 3); acceptance CLI (Task 4).

- [ ] **Step 1: Preconditions (free)**

Run:
```bash
cd /Users/anupdangi/Desktop/AnupAI/Research/lamina-labs-clone/hypothesis_claude/.claude/worktrees/v2b
agent-master status --format json
pnpm run typecheck && pnpm run test:hypothesis && node scripts/v2-benchmark.mjs verify cold-v2
```
Expected: all pass; `benchmark intact`. Do not continue on any failure.

- [ ] **Step 2: Ask for approval (exact message)**

"Approve one PAID live verification: 3 cold 60-second V2 lessons from the frozen cmp sources (cmp-bio01, cmp-cs01, cmp-math01), local TTS ($0), models as configured in .env (plus the S1/S2 route only if Task 6 adopted it), hard cap $0.10 per lesson ($0.30 total; recent lessons cost ≈ $0.019), run one at a time and stop at the first hard failure. Reply 'approve rich-visuals live run'." Proceed only on that reply; quote it with the date in HANDOFF.

- [ ] **Step 3: PAID — run the three lessons, one at a time**

```bash
pnpm run build
OUT=.data/rich-visuals/2026-10-live
for ID in cmp-bio01 cmp-cs01 cmp-math01; do
  INSTR=$(node -e "const m=require('./bench/cmp-v1/manifest.json');console.log(m.cases.find(c=>c.id==='$ID').instruction)")
  TEACHING_COMPILER_VERSION=v2 TEACHING_BEATS_V2=1 BOARD_OPS_V2=1 PERSISTENT_BOARD_V2=1 TYPE_RESOLVER_V2=1 LAYOUT_V2=1 RENDER_PLAN_V2=1 HF_HUB_OFFLINE=1 \
    node dist/src/run/lessonCli.js --source=bench/cmp-v1/sources/$ID.md --instruction="$INSTR" --duration=60 --id=$ID --cache=cold --tts=local --out=$OUT || break
done
ls -d $OUT/*/runs/*/
```
Expected: one run directory per completed case, each with `video.mp4`. The env flags are the same set `scripts/v2-benchmark.mjs:253` uses. On a hard failure the loop stops; record the failure verbatim and do not retry without new approval.

- [ ] **Step 4: Measure richness and stage cost (free)**

```bash
LIVE=$(ls -d .data/rich-visuals/2026-10-live/*/runs/*/)
node dist/src/harness/v2RichnessCli.js --composition=icon-cards --json=harness/reports/rich-visuals/live.icon-cards.json --review $LIVE
node dist/src/harness/stageCostCli.js $LIVE
for r in $LIVE; do node scripts/v2-contact-sheet.mjs "$r" "output/rich-visuals/live/$(basename $(dirname $(dirname "$r"))).png" --composition=icon-cards; done
```

- [ ] **Step 5: Human review of every drawn icon (user action)**

```bash
node scripts/badge-review-sheet.mjs --out=output/badge-review/2026-10-live $LIVE
open output/badge-review/2026-10-live/sheet.png output/rich-visuals/live
```
Ask the user for accept/reject per unreviewed number; record verdicts exactly as in Task 4 Step 9.

- [ ] **Step 6: Acceptance (free)**

```bash
node dist/src/harness/v2RichnessCli.js --composition=icon-cards --accept --baseline=harness/reports/rich-visuals/baseline.labels.json --projection=harness/reports/rich-visuals/projection.icon-cards.json $LIVE
```
Acceptance criteria (encoded in `src/harness/richnessAcceptance.ts`, printed as PASS/FAIL lines):
- icon-bearing share ≥ max(baseline + 0.15, 0.8 × offline projection) — both inputs measured in Tasks 1 and 3;
- wrong-icon rate ≤ 0.05 with review coverage = 1.000;
- 0 hard failures in every complete run; 0 family-mix scenes; 0 asset-reuse conflicts;
- smallest drawn icon ≥ 56 px;
- mean text characters per scene ≤ 1.10 × baseline.
Expected: `ACCEPTANCE PASSED` or `ACCEPTANCE FAILED` with the failing rows. Either result is reported as is; a failure is not converted into a pass.

- [ ] **Step 7: Three-way comparison sheets (free)**

```bash
CMP=/Users/anupdangi/Desktop/AnupAI/Research/lamina-labs-clone/cmp-worktrees
ARGS=""; for r in $LIVE; do id=$(basename $(dirname $(dirname "$r"))); ARGS="$ARGS --v2=$id=$r/video.mp4"; done
node scripts/cmp-v1.mjs sheets --cmp-root=$CMP $ARGS
open output/cmp-v1
```
Expected: per case, `v0.3.0.png`, `v1.0.0.png` (math only) and `v2.png` side by side for the user to judge.

- [ ] **Step 8: HANDOFF and session close**

Append a dated entry: approval quote, exact commands, per-lesson real spend and wall time, acceptance table verbatim, verdict quotes, sheet paths, and next bounded task (if accepted: run the formal 5×3 grid with the same code digest; if not: the failing rule and its owning module). Mark each acceptance item `passed`/`failed`/`unmeasured`. Run `agent-master checkpoint` and `agent-master validate` (or record that the tool is unavailable). Commit only the HANDOFF and the small JSON reports, and only after the user approves committing in chat:

```bash
git add docs/HANDOFF.md harness/reports/rich-visuals/live.icon-cards.json src/assets/data/badge-review.v1.json
git commit -m "docs(v2): rich-visuals live verification results

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Self-Review

1. **Spec coverage.** (1) Baseline richness tool reusing `auditRenderedEntityAssets` instead of duplicating `resolutionMetrics.ts` → Task 1. (2) Concrete-noun resolution + per-scene family lock reusing `chooseSceneFamily` → Task 2. (3) Icon cards, process-step rows (kit children get badges), context icon, deterministic, no model, contact sheets → Task 3; relation icons deliberately deferred (Out of scope, with reason). (4) Wrong-icon guard measurement + gold fixture → Task 4. (5) Model routing through existing env/CLI flags and the existing benchmark harness → Task 6. (6) One paid run, comparison against v1.0.0 and v0.3.0, numeric acceptance → Tasks 5 and 7. "Why not v0.3.0" → Evidence section + Task 5. Paid steps: Task 6 Step 8, Task 7 Step 3, each behind an exact approval question.
2. **Placeholder scan.** No TBD/TODO. `<CHEAP_MODEL>` is a value the user chooses in Task 6 Step 7 from a printed list; acceptance thresholds are formulas in code over measured JSON files, not blanks.
3. **Type consistency.** `referentOf` (T1) used in T2/T3; `IconUse`/`V2RichnessSummary`/`RichnessReport` (T1) used in T3/T4; `planSceneBadges`/`placeBadges`/`PlacedBadge`/`BadgeReview` (T2) used in T3/T4; `loadRetainedV2Run(runDir, { composition })` and `richnessReport(runDirs, { composition })` gain the option in T3 and are called with it in T4/T7; `elementRect`/`elementLabel` defined in T1 and used in T3.
4. **Review Focus.** Each of the five lines has a named test in its owning task (T2 abstract/process, reuse, family, rejected verdict; T3 small icon/overflow and rights evidence; T4 real-catalog gold).
