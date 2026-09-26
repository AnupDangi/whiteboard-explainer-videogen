# Simi Parity Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn any source document into a Simi-grade whiteboard video. That means dense, coloured, icon-rich boards; narration-locked reveals; the requested length; and deterministic rendering. Every generated run should reach `draft`, and `passed` should need only human calibration.

**Architecture:** Keep the S1–S12 pipeline. Fix the two classes of defect that stop it:
- **Blockers:** narration with numbers breaks alignment, stable-ts collapses short words, status logic makes `passed` unreachable, and the speaking-rate constant is wrong.
- **Design defects:** Codex's uncommitted retrieval-only icon rule, one node per abstract concept, bare-text labels, and debug role badges produce near-empty boards.

Then measure our frames against Simi's frames with numbers, not prose.

**Tech Stack:** TypeScript (Node `node:test`, zod), Python 3 (`unittest`, stable-ts, torchaudio CTC), resvg, ffmpeg, OpenRouter (`openai/gpt-6-luna`).

**Spec:** This file. Copy it verbatim into `hypothesis_claude/docs/superpowers/plans/2026-09-27-simi-parity-recovery.md` in Task 0. Evidence sources: the senior review in this conversation (2026-09-27), `hypothesis_claude/CLAUDE.md`, `docs/HANDOFF.md`, Simi reference `lamina-labs-video/*.mp4`, and run `phase6-2026-09-27/multi-domain`.

---

## Context — why this plan exists (senior review, 2026-09-27)

End goal: generate a video for any domain at Simi's visual level, consistently and deterministically, with no hardcoding. Simi's reference videos show the target:
- Boards: 5–9 nodes per board; concrete or metaphor icons (sun, drop, key, treasure chest, magnifier); pastel shape boxes and circles for abstract terms ("SOFTMAX", "WEIGHTED SUM"); repeated icon instances ("VALUE: SAT/MAT/THE"); short arrows.
- Pacing: about 4 scenes of about 18s each in a 70s video; 50–70% of the board filled at scene end.

**Verified findings (evidence, not claims):**

1. **Visual regression in the uncommitted Codex diff.**
   - What changed: `planner/board.ts:108` now admits an icon only when `score >= TAU_MID_EMB (0.5)`. The prompt at `:508` now says "Never invent a metaphor… use 'label'".
   - Effect: MiniLM's top-1 median score is 0.356, and only 27 of 152 mentions (18%) have any icon candidate. Boards are therefore mostly bare text. The bicycle contact sheet shows titles plus 0–1 icon; RLHF from committed HEAD `f034029` had icons.
   - Tests `board.test.ts:275,296` pin the regression.
2. **Debug overlays on video.** `render/renderScene.ts:182` (`renderProcessRole`) draws "INPUT"/"PROCESS" chips, and `:196` draws a "VS" cue. Simi never shows either.
3. **Board capacity is capped by the concept count.** `boardProblems` rejects a second node for the same concept (`board.ts:198`). 24 of 33 scenes had only 1–2 concepts, so boards have 1–2 nodes. Measured layout occupancy is 0.09–0.45, mean 0.31.
4. **Label nodes render as bare text.** `compileBoard` maps `icon:"label"` to `prim:'text'` (`board.ts:381`). The `box` prim with `fill` already exists in `schema.ts:67`.
5. **Duration runs 16% long.**
   - `plan/analyze.ts:12` sets `WORDS_PER_SEC = 2.6`, but Supertonic measured 2.287 and 2.293 w/s. 158 words produced 70.1s of audio.
   - `SCENE_SEC.min = 8` allows 7 thin scenes in 60s.
6. **Alignment.**
   - stable-ts collapses short words on its 20ms grid (`[1560,1560)`), and there is no repair step.
   - No step turns digits into words, so "24" kills the CTC fallback (`compare_aligners.py:57`).
   - The aligner identity is dropped from the cache payload, and `provider` is hard-coded `'stable-ts'` (`runLive.ts:442,585,700`).
7. **`passed` is unreachable.**
   - `runLive.ts:619,768,788` call `deriveRunStatus(hardCount)` with no judge result or evidence.
   - `alignment-calibration-unmeasured` is `hard:true` (`runLive.ts:246`), so every live run shows `failed` even when the video is clean.
8. **RAG is wasted spend on short sources.**
   - Queries use `mode:'naive'` and never read the knowledge graph that indexing paid to build.
   - It costs about $0.025 of a $0.10 budget and 26–42s per cold run on 223–258-word `.md` files.
   - The stage is recorded `completed` when disabled.
9. **Dead code.**
   - Dead: `draw/{freehand,marker-motion,rough-geometry,types}.ts` (tests only), `mapWithConcurrency` (`runLive.ts:172`), the no-op loop at `gates.ts:38-46`.
   - **Not dead, despite the earlier audit:** `compare_aligners.py` (the live CTC fallback), `word_boundary_review.py` (calibration), `pipeline/run.ts` (the `run:hypothesis` fixture CLI), `chatVision` (the judge).

**User decisions (chat, 2026-09-27):**
- Dirty tree: "Whatever you feel is best do it make sure first phase cleanup what is not required before that commit and move ahead.but complete and understand my end goal plan for that."
- Calibration: "Keep human gate, ship draft (Recommended)".
- Icon policy: "LLM picks from full catalog (Recommended)".

## Global Constraints

- Content comes from data only. Never branch on lesson title, case ID, filename, or keyword list (`CLAUDE.md`). Every new rule gets a topic-swap regression test.
- Models emit validated scene data only. No model-generated SVG or code.
- `renderSVG(scene, timeline, timeMs)` stays pure and deterministic. No wall clock, no `Math.random`.
- Missing evidence, alignment, or calibration stays a visible `draft` or `failed` result, never `passed`.
- Frozen plan `docs/superpowers/plans/2026-09-25-visual-richness-and-deterministic-generation.md` and `plan-lock.json` are never edited. This plan is a new file and is **not** added to the lock.
- Record scope changes and approvals in `docs/HANDOFF.md`, quoting the user verbatim.
- Verification commands, run from `hypothesis_claude/`: `npm run typecheck:hypothesis` and `npm run test:hypothesis`.
- Paid runs are reported separately from offline tests, with actual model IDs, costs, cache state, and failures.
- Commit on branch `simi-parity-recovery` only. Never push. End every commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Keys stay in `.env`. Media stays in `.data/`.

## Review Focus

1. **Narration full of numbers, units, years, and percentages** ("24 hours", "1998", "3.5%", "2nd"). Expected: spoken form reaches both TTS and aligner; no alignment abort. Pinned in Task 2.
2. **A scene whose narration is all short function words around a single noun.** Expected: repaired intervals are positive and ordered, the repair is recorded, and more than 10% repaired words fails closed. Pinned in Task 3.
3. **An abstract topic with no literal icons** (e.g. "attention mechanism"). Expected: the board still has at least 3 nodes, using metaphor icons or pastel boxes, never a title-only board. Pinned in Tasks 6–8.
4. **The same concept shown several times** (instances). Expected: arrows stay attached to one node per concept, and gates do not report duplicate roles. Pinned in Task 8.
5. **A clean run with calibration still unmeasured.** Expected: status is `draft`, not `failed`, and it can never be `passed`. Pinned in Task 5.

---

## File Structure

| File | Responsibility | Tasks |
|---|---|---|
| `src/experimental/hypothesis/v1_claude/narration/spokenForm.ts` (new) | Deterministic digits/symbols → spoken English | 2 |
| `src/experimental/hypothesis/shared/alignment/align.py` | Collapsed-word repair pass and aligner identity | 3 |
| `v1_claude/pipeline/runLive.ts`, `pipeline/lesson.ts` | Keep aligner in S5 cache payload; pass status evidence | 3, 5 |
| `shared/evaluation.ts` | `deriveRunStatus` returns draft when evidence is incomplete | 5 |
| `v1_claude/plan/analyze.ts`, `plan/stages.ts` | Measured speaking rate, scene pacing, mention count | 4, 8 |
| `v1_claude/planner/board.ts`, `fewshots/boardBank.v1.ts` | Full-catalog icons, `iconBasis`, instance nodes, box compile | 6, 7, 8 |
| `v1_claude/render/renderScene.ts` | Remove role badges and VS cue | 7 |
| `v1_claude/layout/solver.ts`, `style.ts`, `validation/gates.ts` | Fill the board, keep text ≥32px, hard sparse gate | 1, 9 |
| `v1_claude/plan/ragSidecar.ts`, `lessonCli.ts` | Source-size RAG gate; `skipped` status | 10 |
| `harness/boardMetrics.ts` (new), `harness/boardMetricsCli.ts` (new), `harness/reference/lamina/metrics.v1.json` (new) | Numeric Simi comparison | 11 |
| `shared/alignment/word_boundary_review.py` | `--write-calibration` output | 13 |

Paths below are relative to `hypothesis_claude/src/experimental/hypothesis/` unless they start with `hypothesis_claude/`.

---

## Phase 0 — Checkpoint and cleanup

### Task 0: Branch, checkpoint the Codex tree, land this plan

**Files:**
- Create: `hypothesis_claude/docs/superpowers/plans/2026-09-27-simi-parity-recovery.md` (a copy of this file)
- Modify: `hypothesis_claude/docs/HANDOFF.md` (prepend an entry)

- [ ] **Step 1: Verify the tree state**

Run from `hypothesis_claude/`: `git status --short | wc -l && git log --oneline -1`
Expected: `89` (±new files) and `f034029 Record 5-topic board v2 run…`

- [ ] **Step 2: Run the offline suite on the dirty tree to record its baseline**

Run: `npm run typecheck:hypothesis && npm run test:hypothesis 2>&1 | tail -20`
Expected: record the pass/fail counts exactly. If anything fails, do **not** fix it here; record it in HANDOFF as a checkpoint defect.

- [ ] **Step 3: Branch and commit the checkpoint**

```bash
git checkout -b simi-parity-recovery
git add -A
git commit -m "WIP checkpoint: Codex phase 3-6 tree (alignment worker pool, CTC fallback, hierarchical plan, RAG sidecar, typed boards)

Committed as-is so later fixes are reviewable diffs. Known regressions
reverted in later tasks: retrieval-only icon admission (board.ts), role
badges (renderScene.ts). Baseline suite result recorded in HANDOFF.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Check `git status` first. `.env` and `.data/` must be ignored and must not appear in the commit.

- [ ] **Step 4: Copy this plan into the repo, prepend a HANDOFF entry, commit**

HANDOFF entry text (prepend under the title):

```markdown
## 2026-09-27 — Simi parity recovery plan adopted
- Plan: docs/superpowers/plans/2026-09-27-simi-parity-recovery.md (not plan-locked).
- User approvals (chat, 2026-09-27): "Whatever you feel is best do it make sure first phase cleanup what is not required before that commit and move ahead.but complete and understand my end goal plan for that." / "Keep human gate, ship draft (Recommended)" / "LLM picks from full catalog (Recommended)".
- Checkpoint commit <sha> holds Codex's uncommitted tree; baseline suite: <paste counts>.
- Status: all tasks unmeasured.
```

```bash
git add docs/superpowers/plans/2026-09-27-simi-parity-recovery.md docs/HANDOFF.md
git commit -m "docs: adopt Simi parity recovery plan

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 1: Remove verified-dead code

**Files:**
- Delete: `v1_claude/draw/freehand.ts`, `v1_claude/draw/marker-motion.ts`, `v1_claude/draw/rough-geometry.ts`, `v1_claude/draw/types.ts`, `v1_claude/__tests__/draw-freehand.test.ts`, `v1_claude/__tests__/draw-marker.test.ts`, `v1_claude/__tests__/draw-rough.test.ts`
- Modify: `v1_claude/pipeline/runLive.ts:172` (delete `mapWithConcurrency`)
- Modify: `v1_claude/validation/gates.ts:38-46` (delete the no-op loop)
- Conditional delete: `hypothesis_claude/src/{core,domain,gateway,ingest}`, `hypothesis_claude/src/types` runtime functions, `hypothesis_claude/parse-engine/convert.py`

- [ ] **Step 1: Prove each target has no live caller**

```bash
cd hypothesis_claude
grep -rn "draw/freehand\|draw/marker-motion\|draw/rough-geometry\|draw/types" src --include='*.ts' | grep -v "/draw/"
grep -rn "mapWithConcurrency" src
grep -rn "convert.py\|convert\b" parse-engine package.json scripts | grep -v "^parse-engine/convert.py"
grep -rn "from '\.\./\.\./\.\./core\|src/core\|src/domain\|src/gateway\|src/ingest\|types/engine" src/experimental harness scripts package.json tsconfig.json
```

Expected:
- The draw grep lists only `__tests__/draw-*.test.ts` and `__tests__/drawing.test.ts`. If `drawing.test.ts` imports a draw module, delete only that test's draw cases.
- `mapWithConcurrency` appears only at its definition.
- **The legacy-dir grep must return nothing, and `package.json` must have no script entry under `src/core|domain|gateway|ingest`. Otherwise keep those dirs and record why in HANDOFF.**

- [ ] **Step 2: Delete the dead files and symbols**

```bash
git rm src/experimental/hypothesis/v1_claude/draw/freehand.ts src/experimental/hypothesis/v1_claude/draw/marker-motion.ts src/experimental/hypothesis/v1_claude/draw/rough-geometry.ts src/experimental/hypothesis/v1_claude/draw/types.ts src/experimental/hypothesis/v1_claude/__tests__/draw-freehand.test.ts src/experimental/hypothesis/v1_claude/__tests__/draw-marker.test.ts src/experimental/hypothesis/v1_claude/__tests__/draw-rough.test.ts
```

In `gates.ts`, delete this whole block:

```ts
  for (const edge of scene.edges) {
    const relation = edge.factualRelation;
    if (!relation) continue;
    const fromElements = elementsByConcept.get(relation.fromConceptId) ?? [];
    const toElements = elementsByConcept.get(relation.toConceptId) ?? [];
    const endpointsMatch = fromElements.some((element) => element.element.id === edge.from)
      && toElements.some((element) => element.element.id === edge.to);
    if (!endpointsMatch) continue;
  }
```

In `runLive.ts`, delete the `mapWithConcurrency` function. If Step 1 proved them unreachable, also `git rm -r` the legacy dirs and `parse-engine/convert.py`.

- [ ] **Step 3: Verify**

Run: `npm run typecheck:hypothesis && npm run test:hypothesis 2>&1 | tail -8`
Expected: typecheck is clean, and the test count drops by exactly the deleted draw tests; otherwise the result matches the Task 0 baseline.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "chore: remove unreachable draw E7 modules, mapWithConcurrency, no-op gate loop

Kept (live, despite earlier audit): compare_aligners.py (CTC fallback),
word_boundary_review.py (calibration), pipeline/run.ts (run:hypothesis),
chatVision (judge).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Phase 1 — Unblock S5, status, duration

### Task 2: Spoken-form normalization for narration

**Files:**
- Create: `v1_claude/narration/spokenForm.ts`
- Modify: `v1_claude/plan/stages.ts` (the `writeScript` script assembly, right after `results.some(...)`)
- Test: `v1_claude/__tests__/spoken-form.test.ts`

**Interfaces:**
- Produces: `export function spokenForm(text: string): string`. It keeps `[[id|phrase]]` markers intact and normalizes text inside and outside them.
- Produces: `export const SPOKEN_FORM_VERSION = 'spoken-form-v1'`

- [ ] **Step 1: Write the failing test**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { spokenForm } from '../narration/spokenForm.js';
import { parseMarkers } from '../narration/markers.js';

test('integers, decimals, percents, ordinals, years and signs become words', () => {
  assert.equal(spokenForm('The tide turns every 24 hours.'), 'The tide turns every twenty-four hours.');
  assert.equal(spokenForm('About 3.5% of water'), 'About three point five percent of water');
  assert.equal(spokenForm('the 2nd bulge'), 'the second bulge');
  assert.equal(spokenForm('In 1998 and 2024'), 'In nineteen ninety-eight and twenty twenty-four');
  assert.equal(spokenForm('1,250 kilometres'), 'one thousand two hundred fifty kilometres');
  assert.equal(spokenForm('-4 degrees'), 'minus four degrees');
  assert.equal(spokenForm('100'), 'one hundred');
});

test('markers survive and their phrases are normalized too', () => {
  const out = spokenForm('Every [[cycle|12 hours]] the [[moon|Moon]] pulls.');
  assert.equal(out, 'Every [[cycle|twelve hours]] the [[moon|Moon]] pulls.');
  const { plainText, mentions } = parseMarkers(out);
  assert.equal(plainText.slice(mentions[0].plainStart, mentions[0].plainEnd), 'twelve hours');
});

test('output has no ASCII digits and is deterministic', () => {
  const input = 'Values 0, 7, 19, 45, 999, 1000001 and 0.05';
  const a = spokenForm(input);
  assert.equal(a, spokenForm(input));
  assert.equal(/\d/.test(a), false, a);
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm run build && node --test dist/src/experimental/hypothesis/v1_claude/__tests__/spoken-form.test.js`
Expected: FAIL, `Cannot find module '../narration/spokenForm.js'`

- [ ] **Step 3: Implement `spokenForm.ts`**

```ts
/**
 * Deterministic spoken form for narration (S4 → S5). TTS and both aligners
 * (stable-ts, wav2vec2 CTC) must receive the same words; the CTC alphabet has
 * no digits, so digits are written out here once, before markers are parsed.
 */
export const SPOKEN_FORM_VERSION = 'spoken-form-v1';

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const SCALES: Array<[number, string]> = [[1e12, 'trillion'], [1e9, 'billion'], [1e6, 'million'], [1e3, 'thousand']];
const ORDINAL_WORD: Record<string, string> = { one: 'first', two: 'second', three: 'third', five: 'fifth', eight: 'eighth', nine: 'ninth', twelve: 'twelfth' };

function below100(n: number): string {
  if (n < 20) return ONES[n];
  const t = TENS[Math.floor(n / 10)];
  return n % 10 ? `${t}-${ONES[n % 10]}` : t;
}

function below1000(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  if (!h) return below100(r);
  return r ? `${ONES[h]} hundred ${below100(r)}` : `${ONES[h]} hundred`;
}

export function integerWords(n: number): string {
  if (n === 0) return 'zero';
  const parts: string[] = [];
  let rest = n;
  for (const [value, name] of SCALES) {
    if (rest >= value) { parts.push(`${below1000(Math.floor(rest / value))} ${name}`); rest %= value; }
  }
  if (rest) parts.push(below1000(rest));
  return parts.join(' ');
}

function yearWords(n: number): string {
  const hi = Math.floor(n / 100), lo = n % 100;
  if (lo === 0) return `${below100(hi)} hundred`;
  return `${below100(hi)} ${lo < 10 ? `oh ${ONES[lo]}` : below100(lo)}`;
}

function ordinal(words: string): string {
  const parts = words.split(/([ -])/);
  const last = parts[parts.length - 1];
  const next = ORDINAL_WORD[last] ?? (last.endsWith('y') ? `${last.slice(0, -1)}ieth` : `${last}th`);
  parts[parts.length - 1] = next;
  return parts.join('');
}

const NUMBER_RE = /(?<![\p{L}\d])([-−]?)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?(st|nd|rd|th)?(%?)/gu;

function normalizeSegment(text: string): string {
  return text.replace(NUMBER_RE, (_m, sign: string, intPart: string, frac: string | undefined, ord: string | undefined, pct: string) => {
    const n = Number(intPart.replaceAll(',', ''));
    const isYear = !sign && !frac && !ord && !pct && !intPart.includes(',') && intPart.length === 4 && n >= 1100 && n <= 2099;
    let words = isYear ? yearWords(n) : integerWords(n);
    if (frac) words += ` point ${[...frac].map((d) => ONES[Number(d)]).join(' ')}`;
    if (ord) words = ordinal(words);
    if (sign) words = `minus ${words}`;
    if (pct) words += ' percent';
    return words;
  });
}

const MARKER_RE = /\[\[([a-zA-Z0-9_.-]+)\|([^\]|]+)\]\]/g;

export function spokenForm(text: string): string {
  let out = '';
  let cursor = 0;
  for (const m of text.matchAll(MARKER_RE)) {
    out += normalizeSegment(text.slice(cursor, m.index)) + `[[${m[1]}|${normalizeSegment(m[2])}]]`;
    cursor = m.index! + m[0].length;
  }
  return out + normalizeSegment(text.slice(cursor));
}
```

- [ ] **Step 4: Wire it into `writeScript`**

In `plan/stages.ts`, add the import `import { spokenForm } from '../narration/spokenForm.js';` and change the script line to:

```ts
  const script: Script = { scenes: results.map(({ section, result }) => ({ sectionId: section.id, text: spokenForm(result.value!.text) })) };
```

Bump the S4 cache version. In `pipeline/lesson.ts`, change the `'S4-module-script-v1'` literal to `'S4-module-script-v2-spoken-form'`; grep for other `S4-` stage versions and bump each one.

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `npm run build && node --test dist/src/experimental/hypothesis/v1_claude/__tests__/spoken-form.test.js && npm run test:hypothesis 2>&1 | tail -5`
Expected: PASS; the full suite is unchanged apart from the new tests.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "fix(S4): write narration in spoken form so TTS and CTC get digit-free words

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 3: Collapsed-word repair pass and recorded aligner identity

**Files:**
- Modify: `shared/alignment/align.py` (`run_alignment`; add `_repair_collapsed_words`)
- Modify: `shared/alignment/align.ts` and `v1_claude/narration/align.ts` (surface `aligner`, `repairedWordIndexes`)
- Modify: `v1_claude/pipeline/runLive.ts` (S5 cache payload, `provider`, warning); `v1_claude/pipeline/lesson.ts` (same payload)
- Test: `shared/alignment/test_align.py`; `v1_claude/__tests__/alignment-worker-pool.test.ts` or a new `__tests__/alignment-identity.test.ts`

**Interfaces:**
- `run_alignment` returns `{'durationMs', 'words', 'aligner', 'repairedWordIndexes': list[int]}`. `aligner` is one of `stable-ts`, `stable-ts-fast-mode`, `torchaudio-wav2vec2-ctc`, `stable-ts+collapsed-repair`.
- The S5 cache payload becomes `{ durationMs, words, audioBase64, aligner, repairedWordIndexes }`. The stage version is `voice-align-4-repair-identity`.

Pass order (measured aligners first, synthetic repair last): default → fast_mode → CTC → repair of the default words. Repair only fixes intervals where `end <= start` and the word sequence matches exactly. It fails closed when more than `MAX_REPAIRED_FRACTION = 0.1` of words need repair. Calibration still blocks `passed`, so a repaired run is at best `draft`.

- [ ] **Step 1: Write the failing Python tests** (append to `AlignmentTimestampTests` in `test_align.py`)

```python
    def test_collapsed_short_words_are_repaired_after_all_measured_aligners_fail(self):
        words = [
            {'word': 'Pick', 'startMs': 0.0, 'endMs': 300.0},
            {'word': 'a', 'startMs': 300.0, 'endMs': 300.0},
            {'word': 'wheel', 'startMs': 300.0, 'endMs': 700.0},
            {'word': 'now', 'startMs': 760.0, 'endMs': 1000.0},
            {'word': 'to', 'startMs': 1000.0, 'endMs': 1000.0},
            {'word': 'spin', 'startMs': 1000.0, 'endMs': 1400.0},
            {'word': 'it', 'startMs': 1400.0, 'endMs': 1600.0},
            {'word': 'and', 'startMs': 1600.0, 'endMs': 1800.0},
            {'word': 'lean', 'startMs': 1800.0, 'endMs': 2100.0},
            {'word': 'left', 'startMs': 2100.0, 'endMs': 2400.0},
            {'word': 'slowly', 'startMs': 2400.0, 'endMs': 2900.0},
            {'word': 'today', 'startMs': 2900.0, 'endMs': 3300.0},
            {'word': 'please', 'startMs': 3300.0, 'endMs': 3700.0},
            {'word': 'okay', 'startMs': 3700.0, 'endMs': 4000.0},
            {'word': 'done', 'startMs': 4000.0, 'endMs': 4400.0},
            {'word': 'here', 'startMs': 4400.0, 'endMs': 4800.0},
            {'word': 'wow', 'startMs': 4800.0, 'endMs': 5000.0},
            {'word': 'yes', 'startMs': 5000.0, 'endMs': 5200.0},
            {'word': 'go', 'startMs': 5200.0, 'endMs': 5400.0},
            {'word': 'end', 'startMs': 5400.0, 'endMs': 5600.0},
        ]
        text = ' '.join(w['word'] for w in words)
        repaired, indexes = align._repair_collapsed_words(words, text, 6000)
        self.assertEqual(indexes, [1, 4])
        self.assertIsNone(align._invalid_word_intervals(repaired, text, 6000))
        for prev, cur in zip(repaired, repaired[1:]):
            self.assertLessEqual(prev['endMs'], cur['startMs'])
        self.assertGreaterEqual(repaired[1]['endMs'] - repaired[1]['startMs'], align.MIN_REPAIRED_WORD_MS)

    def test_repair_refuses_when_too_many_words_collapsed(self):
        words = [{'word': w, 'startMs': 100.0, 'endMs': 100.0} for w in ['a', 'b', 'c']] + [{'word': 'long', 'startMs': 100.0, 'endMs': 900.0}]
        with self.assertRaises(ValueError):
            align._repair_collapsed_words(words, 'a b c long', 1000)

    def test_run_alignment_reports_repair_identity_when_ctc_also_fails(self):
        class Collapsing:
            def align(self, audio_path, text, **kwargs):
                return None
        # Patch _result_words to return one collapsed word among 12 valid ones.
        base = [{'word': f'w{i}', 'startMs': i * 100.0, 'endMs': i * 100.0 + 90.0} for i in range(12)]
        base[5] = {'word': 'w5', 'startMs': 500.0, 'endMs': 500.0}
        text = ' '.join(w['word'] for w in base)
        with mock.patch.object(align, '_result_words', return_value=base), mock.patch.object(align, 'wav_duration_ms', return_value=2000):
            model = Collapsing()
            model.align = lambda *a, **k: object()
            result = align.run_alignment('x.wav', text, 'en', 'base', model=model, ctc_fallback=lambda *a: (_ for _ in ()).throw(ValueError('ctc down')))
        self.assertEqual(result['aligner'], 'stable-ts+collapsed-repair')
        self.assertEqual(result['repairedWordIndexes'], [5])
```

Check the imports at the top of `test_align.py` (`from unittest import mock`, `import align`) and match them. Update the existing `test_zero_duration_output_fails_when_model_retry_is_still_invalid` so it expects failure only when the fraction exceeds 10%. Give its fixture 1 word of 1 (100%), which still raises.

- [ ] **Step 2: Run them and confirm they fail**

Run: `cd hypothesis_claude && python3 -m unittest discover -s src/experimental/hypothesis/shared/alignment -p 'test_align.py' -v 2>&1 | tail -15`
Expected: FAIL with `AttributeError: module 'align' has no attribute '_repair_collapsed_words'`

- [ ] **Step 3: Implement it in `align.py`**

Add near `_invalid_word_intervals`:

```python
MIN_REPAIRED_WORD_MS = 40.0
MAX_REPAIRED_FRACTION = 0.1


def _repair_collapsed_words(words: list[dict], text: str, duration_ms: int) -> tuple[list[dict], list[int]]:
    """Give stable-ts zero-length words (its 20 ms grid drops short words such as
    "a"/"to") a small positive interval borrowed from the neighbouring word.
    Deterministic, recorded, and bounded: raises when the word sequence differs
    or more than MAX_REPAIRED_FRACTION of words collapsed."""
    if [w['word'] for w in words] != text.split():
        raise ValueError('cannot repair: word sequence differs from reference')
    out = [dict(w) for w in words]
    collapsed = [i for i, w in enumerate(out) if w['endMs'] <= w['startMs']]
    if len(collapsed) > MAX_REPAIRED_FRACTION * len(out):
        raise ValueError(f'cannot repair: {len(collapsed)}/{len(out)} words collapsed (limit {MAX_REPAIRED_FRACTION:.0%})')
    for i in collapsed:
        w = out[i]
        prev_end = out[i - 1]['endMs'] if i > 0 else 0.0
        next_start = out[i + 1]['startMs'] if i + 1 < len(out) else float(duration_ms)
        if next_start - prev_end >= MIN_REPAIRED_WORD_MS and (next_start - w['startMs'] >= MIN_REPAIRED_WORD_MS or w['startMs'] - prev_end >= MIN_REPAIRED_WORD_MS):
            start = min(max(prev_end, w['startMs']), next_start - MIN_REPAIRED_WORD_MS)
            w['startMs'], w['endMs'] = start, start + MIN_REPAIRED_WORD_MS
            continue
        # No silence: take the tail of the previous word, else the head of the next.
        if i > 0 and out[i - 1]['endMs'] - out[i - 1]['startMs'] >= 3 * MIN_REPAIRED_WORD_MS:
            out[i - 1]['endMs'] -= MIN_REPAIRED_WORD_MS
            w['startMs'], w['endMs'] = out[i - 1]['endMs'], out[i - 1]['endMs'] + MIN_REPAIRED_WORD_MS
        elif i + 1 < len(out) and out[i + 1]['endMs'] - out[i + 1]['startMs'] >= 3 * MIN_REPAIRED_WORD_MS:
            w['startMs'] = out[i + 1]['startMs']
            w['endMs'] = w['startMs'] + MIN_REPAIRED_WORD_MS
            out[i + 1]['startMs'] = w['endMs']
        else:
            raise ValueError(f'cannot repair word {i}: no neighbour long enough')
    return out, collapsed
```

In `run_alignment`, keep the default-pass words in a variable `default_words`. Replace the `raise RuntimeError(...)` in the CTC-failure branch with:

```python
            if ctc_error:
                try:
                    words, repaired = _repair_collapsed_words(default_words, text, duration_ms)
                    repair_error = _invalid_word_intervals(words, text, duration_ms)
                except Exception as error:  # noqa: BLE001
                    repair_error = f'{type(error).__name__}: {error}'
                if repair_error:
                    raise RuntimeError(
                        'word alignment failed validation for stable-ts default, stable-ts fast_mode, CTC, and bounded repair; '
                        f'default={default_error}; fast_mode={retry_error}; ctc={ctc_error}; repair={repair_error}'
                    )
                aligner = 'stable-ts+collapsed-repair'
            else:
                aligner = 'torchaudio-wav2vec2-ctc'
```

Initialize `repaired: list[int] = []` before the passes, and return `'repairedWordIndexes': repaired`.

- [ ] **Step 4: Surface the identity in TS**

- `shared/alignment/align.ts`: extend the parsed result type with `aligner: string; repairedWordIndexes: number[]`, defaulting to `'stable-ts'` and `[]` when absent. Thread them through `synthesizeAndAlign` in `narration/align.ts`.
- `runLive.ts` S5 `artifactStore.run` payload: add `aligner: generated.aligner, repairedWordIndexes: generated.repairedWordIndexes`. Set `stageVersion` to `'voice-align-4-repair-identity'` and `modelId` to `'voice-engine:auto+stable-ts+wav2vec2-ctc+repair:base'`.
- Replace hard-coded `provider: 'stable-ts'` at `runLive.ts:442,585,700` with the payload's `aligner`.
- When `repairedWordIndexes.length > 0`, push `{ code: 'alignment-words-repaired', stage: 'align', message: \`${sceneId}: repaired word indexes ${idx.join(',')}\`, hard: false }`.
- Apply the same payload and version change to the `lesson.ts` S5 block (the three string literals shown in review).
- Hoist the stage version and model ID into `pipeline/versions.ts` as `S5_STAGE_VERSION` and `S5_MODEL_ID` so both sites share them.

TS test (new `__tests__/alignment-identity.test.ts`):

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { S5_STAGE_VERSION, S5_MODEL_ID } from '../pipeline/versions.js';

test('S5 cache identity names the repair-capable aligner stack', () => {
  assert.equal(S5_STAGE_VERSION, 'voice-align-4-repair-identity');
  assert.match(S5_MODEL_ID, /repair/);
});
```

- [ ] **Step 5: Run everything**

Run: `npm run typecheck:hypothesis && npm run test:hypothesis 2>&1 | tail -8`
Expected: PASS, including the three new Python tests and the TS identity test.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "fix(S5): bounded collapsed-word repair after measured aligners; record aligner identity in cache

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 4: Measured speaking rate and Simi pacing

**Files:**
- Modify: `v1_claude/plan/analyze.ts:10-13` and the section-count check in `analyzeTeachingPlan`
- Modify: `v1_claude/plan/stages.ts:170,205` (prompt scene count)
- Test: `v1_claude/__tests__/plan.test.ts` (append)

**Interfaces:** `WORDS_PER_SEC = 2.25`; `SCENE_SEC = { min: 14, max: 30 }`; `export function sceneCountFor(targetSec: number): number` returns `Math.max(1, Math.round(targetSec / 18))`.

- [ ] **Step 1: Write the failing test**

```ts
import { WORDS_PER_SEC, SCENE_SEC, sceneCountFor } from '../plan/analyze.js';

test('pacing constants come from measured Supertonic rate and Simi scene lengths', () => {
  assert.equal(WORDS_PER_SEC, 2.25); // measured 2.287 / 2.293 w/s, phase6-2026-09-27 bicycle+composting
  assert.deepEqual(SCENE_SEC, { min: 14, max: 30 });
  assert.equal(sceneCountFor(60), 3);
  assert.equal(sceneCountFor(75), 4);
  assert.equal(sceneCountFor(300), 17);
});
```

In the same file, add a test that builds a 60s plan with 7 sections of about 8.6s each and asserts that `analyzeTeachingPlan(...).findings` contains an `error` with check `pacing`. Build it by copying the smallest existing plan fixture in `plan.test.ts` and overriding `sections` and `budgetSec`.

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm run build && node --test dist/src/experimental/hypothesis/v1_claude/__tests__/plan.test.js`
Expected: FAIL (`2.6 !== 2.25`)

- [ ] **Step 3: Implement it**

In `analyze.ts`:

```ts
/**
 * Pacing from measurement: Supertonic speaks 2.29 words/s (phase6-2026-09-27
 * bicycle 158 w / 68.9 s, composting 159 w / 69.5 s); Lamina scenes run
 * 10.5-28.5 s, mean 18.6 s (harness/reference/lamina/index.json).
 */
export const WORDS_PER_SEC = 2.25;
export const SCENE_SEC = { min: 14, max: 30 };
export const sceneCountFor = (targetSec: number): number => Math.max(1, Math.round(targetSec / 18));
```

Change the per-section pacing finding at `:86` from `'warn'` to `'error'`. In `stages.ts:170,205`, compute `scenes` with `sceneCountFor(req.targetDurationSec)`. Bump the S3 and S4 prompt cache versions (grep `S3-` and `S4-` stage-version literals in `lesson.ts`).

- [ ] **Step 4: Run tests.** `npm run test:hypothesis 2>&1 | tail -8`. Expected: PASS. Fix any older test that pinned `2.6` by updating it to import `WORDS_PER_SEC`, never to hardcode a number.

- [ ] **Step 5: Commit** — `fix(S3/S4): measured 2.25 w/s speaking rate and 14-30 s Simi scene pacing`, with the trailer.

### Task 5: Honest status — clean runs reach `draft`, `passed` becomes reachable

**Files:**
- Modify: `shared/evaluation.ts` (`deriveRunStatus`)
- Modify: `v1_claude/pipeline/runLive.ts:245-247,619,768,788`
- Test: `v1_claude/__tests__/publish-status.test.ts`

**Interfaces:** `deriveRunStatus(hardFailures, judgePassed=false, evidence)` is unchanged in shape. Missing evidence now returns `'draft'` instead of `'failed'`.

- [ ] **Step 1: Update the tests first**

Replace the first test in `publish-status.test.ts` with:

```ts
test('clean runs are draft until judge + evidence + calibration all pass', () => {
  assert.equal(deriveRunStatus(0), 'draft');
  assert.equal(deriveRunStatus(0, true, { factualEvidenceComplete: true, alignmentComplete: true }), 'passed');
  assert.equal(deriveRunStatus(1, true), 'failed');
  assert.equal(deriveRunStatus(0, true, { factualEvidenceComplete: false, alignmentComplete: true }), 'draft');
  assert.equal(deriveRunStatus(0, true, { factualEvidenceComplete: true, alignmentComplete: false }), 'draft');
});
```

Add a test on the uncalibrated live path. Use the existing `run-live-concurrency.test.ts` harness pattern (mocked providers) and assert:
- the run has a failure with `code === 'alignment-calibration-unmeasured'` and `hard === false`;
- `evaluationBundle.status === 'draft'` when no other hard failure exists.

Copy the smallest mocked `runHypothesisLive` setup from that file.

- [ ] **Step 2: Run and confirm failure.** Expected: the `'failed' !== 'draft'` assertions fail.

- [ ] **Step 3: Implement it**

`evaluation.ts`:

```ts
export function deriveRunStatus(hardFailures:number,judgePassed=false,evidence:PublishEvidence={factualEvidenceComplete:false,alignmentComplete:false}):RunStatus{
  if(hardFailures>0)return 'failed';
  if(!judgePassed)return 'draft';
  return evidence.factualEvidenceComplete&&evidence.alignmentComplete?'passed':'draft';
}
```

`runLive.ts:246`: change `hard: true` to `hard: false`. Compute `const alignmentComplete = options.alignment.calibrationMedianErrorMs !== undefined && !failures.some((f) => f.code === 'invalid-word-alignment');`. Compute `factualEvidenceComplete` as having no failure whose code starts with `board-concept-omitted`, `board-relation-omitted`, or `source-`. At `:619,768,788`, call `deriveRunStatus(hardCount, judgePassed, { factualEvidenceComplete, alignmentComplete })`. Here `judgePassed` is `false` unless the run was given a judge verdict; grep `judge` in `runLive.ts` and use the existing field if present, otherwise pass `false`.

- [ ] **Step 4: Run the suite.** Expected: PASS.
- [ ] **Step 5: Commit** — `fix(status): uncalibrated clean runs are draft, calibration still gates passed`, with the trailer.

---

## Phase 2 — Visual parity (the main lever)

### Task 6: Full-catalog icon choice with audit basis

**Files:**
- Modify: `v1_claude/planner/board.ts` (`boardEnums` :96-120, `boardProblems` :204-208, prompt :498-540, `BOARD_PROMPT_VERSION`)
- Modify: `v1_claude/pipeline/runLive.ts:333-335` (retrieval query; stale comment)
- Test: `v1_claude/__tests__/board.test.ts` (rewrite the tests at :60, :275, :296; add new ones)

**Interfaces:**
- `BoardEnums.icons` is every catalog icon name when `input.iconCatalog` is given, else the candidate names. `candidatesByMention` stays as ranked hints with `score >= ICON_HINT_MIN (0.3)`.
- Compiled elements carry `iconBasis: 'retrieval' | 'metaphor'`: `retrieval` when the icon is in `candidatesByMention[mention]`, else `metaphor`. It goes on `Element` as an optional audit field; add it to `schema.ts` `elementBase` as `iconBasis: z.enum(['retrieval','metaphor']).optional()`.
- `BOARD_PROMPT_VERSION = 'board-prompt-v11-full-catalog+' + BOARD_BANK_VERSION`.

- [ ] **Step 1: Write the failing tests** (in `board.test.ts`, replacing the two regression tests at :275 and :296)

```ts
test('with an icon catalog, any catalog icon is admissible and its basis is recorded', () => {
  const catalog = [{ id: 'lib:flour', name: 'flour' }, { id: 'lib:key', name: 'key' }, { id: 'lib:water', name: 'water' }, { id: 'lib:dough', name: 'dough' }];
  const input = { ...scene, iconCatalog: catalog } as PlannerSceneInput;
  const enums = boardEnums(input);
  assert.ok(enums.icons.includes('key'));
  const board = goodBoard();
  board.nodes[2] = { ...board.nodes[2], icon: 'key' }; // metaphor for "mixing"
  const result = validateBoard(board, input);
  assert.deepEqual(result.problems, []);
  const byId = Object.fromEntries(result.spec!.elements.map((e) => [e.id, e]));
  assert.equal(byId.n1.iconBasis, 'retrieval');
  assert.equal(byId.n3.iconBasis, 'metaphor');
});

test('icons outside the catalog are still rejected with near-name hints', () => {
  const input = { ...scene, iconCatalog: [{ id: 'lib:flour', name: 'flour' }] } as PlannerSceneInput;
  const board = goodBoard();
  board.nodes[0] = { ...board.nodes[0], icon: 'unicorn' };
  const result = validateBoard(board, input);
  assert.ok(result.problems.some((p) => p.includes('not in the icon catalog')));
});

test('prompt lists the catalog once and permits teacher metaphors', () => {
  const input = { ...scene, iconCatalog: [{ id: 'lib:key', name: 'key' }, { id: 'lib:flour', name: 'flour' }] } as PlannerSceneInput;
  const { system, user } = buildBoardPrompt(input);
  assert.match(system, /visual metaphor a teacher would sketch/);
  assert.doesNotMatch(system, /Never invent a metaphor/);
  assert.match(user, /"key"/);
});
```

Update the test at :60 so its expected `candidatesByMention` uses the 0.3 hint floor. With the fixture scores (0.9, 0.55, 0.8; weak at 0.2) the result is the same, so keep its assertions.

- [ ] **Step 2: Run and confirm failure.** Expected: FAIL, because `key` is not admissible and `iconBasis` is undefined.

- [ ] **Step 3: Implement it**

`boardEnums`:

```ts
export const ICON_HINT_MIN = 0.3;

export function boardEnums(input: PlannerSceneInput): BoardEnums {
  const mentionIds = input.mentions.map((mention) => mention.id);
  const conceptIds = (input.teachingContext?.concepts ?? []).map((concept) => concept.id);
  const iconAssetIds: Record<string, string> = {};
  // The enabled catalog is one hand-drawn family; the planner may pick any of it,
  // including a teacher's metaphor (Simi draws a key for "key", a chest for "value").
  for (const icon of input.iconCatalog ?? []) if (!(icon.name in iconAssetIds)) iconAssetIds[icon.name] = icon.id;
  const candidatesByMention: Record<string, string[]> = {};
  for (const mention of input.mentions) {
    candidatesByMention[mention.id] = [];
    for (const candidate of (input.candidates?.[mention.id] ?? []).filter((c) => c.id && c.score >= ICON_HINT_MIN).slice(0, MAX_CANDIDATES_PER_MENTION)) {
      if (!(candidate.name in iconAssetIds)) {
        if (input.iconCatalog || Object.keys(iconAssetIds).length >= MAX_CANDIDATES_PER_SCENE) continue;
        iconAssetIds[candidate.name] = candidate.id!;
      }
      if (iconAssetIds[candidate.name] === candidate.id && !candidatesByMention[mention.id].includes(candidate.name)) candidatesByMention[mention.id].push(candidate.name);
    }
  }
  return { mentionIds, conceptIds, icons: Object.keys(iconAssetIds), iconAssetIds, candidatesByMention };
}
```

`boardProblems`: delete the "not a candidate for mention" block (:204-208) and keep the catalog-membership check.

`compileBoard` object branch: add `iconBasis: (enums.candidatesByMention[node.mention] ?? []).includes(node.icon) ? 'retrieval' as const : 'metaphor' as const`. `enums` is already in scope there; if it is not, compute `boardEnums(input)` once at the top of `compileBoard`.

Prompt rule (replaces :508), restoring committed HEAD wording plus the audit note:

```
- icon: choose from the icon catalog. Prefer an icon that literally depicts the thing (a leaf for "leaf"); otherwise use the standard visual metaphor a teacher would sketch on a whiteboard (a key for a lookup, a treasure chest for stored value, a magnifier for searching, scales for comparing, a gear for a process, people for reviewers). iconSuggestions per mention are retrieval hints, not limits. Never pick an icon that suggests a different meaning. Use "label" only when no icon or clear metaphor fits — "label" nodes are drawn as coloured boxes, and boards made only of boxes teach poorly.
```

The user prompt must list the catalog names once under `<icon_catalog>` as a JSON array of names (462 names is about 2.5k tokens, cache-friendly). Leave the Simi-topic examples ("LEAF", "CARBON DIOXIDE") in the label rule; they are illustrative style tokens, not lesson content.

`runLive.ts:333`: query retrieval with `\`${mention.phrase}. ${conceptLabel ?? ''}\`` so hints reflect the concept. Get `conceptLabel` from the scene concept whose id matches the mention, or from the best word overlap, reusing the matching logic in `fallbackBoard`; extract it to an exported helper `conceptForMention(input, mention)` in `board.ts`. Fix the stale comment at :334.

- [ ] **Step 4: Run the suite.** `npm run test:hypothesis 2>&1 | tail -8`. Expected: PASS. Update `board-intent`/`typed-board-adequacy` tests only where they asserted retrieval-only admission.

- [ ] **Step 5: Commit** — `fix(S6): full-catalog icon choice with iconBasis audit (reverts retrieval-only regression)`, with the trailer.

### Task 7: Label nodes become pastel boxes; remove debug overlays

**Files:**
- Modify: `v1_claude/planner/board.ts:381` (`compileBoard` label branch)
- Modify: `v1_claude/render/renderScene.ts` (delete `renderProcessRole`, `renderComparisonCue` and their call sites)
- Test: `v1_claude/__tests__/board.test.ts`, `v1_claude/__tests__/renderer.test.ts`

**Interfaces:**
- `export function boxFillFor(conceptId: string, role: BoardRole): PaletteToken`. Process nodes get `'blue'`. Otherwise the fill is `['yellow','green','orange','purple','red'][fnv1a(conceptId) % 5]`, deterministic.
- Label nodes compile to `{ prim: 'box', text: label, fill }`.

- [ ] **Step 1: Write the failing tests**

```ts
test('label-only nodes compile to deterministic pastel boxes, not bare text', () => {
  const r1 = compileBoard(goodBoard(), scene);
  const n3 = r1.spec.elements.find((e) => e.id === 'n3')!;
  assert.equal(n3.prim, 'box');
  assert.equal((n3 as { text?: string }).text, 'mixing');
  assert.equal(n3.fill, 'blue'); // process role
  const r2 = compileBoard(goodBoard(), scene);
  assert.deepEqual(r1.spec, r2.spec);
});

test('topic swap keeps box colours data-derived', () => {
  const other = makeScene({ a: 'sand', b: 'lime', p: 'heating', o: 'glass' }, 'alt');
  const spec = compileBoard(goodBoard({ a: 'sand', b: 'lime', p: 'heating', o: 'glass' }, 'alt'), other).spec;
  assert.equal(spec.elements.find((e) => e.id === 'n3')!.prim, 'box');
});
```

In `renderer.test.ts`:

```ts
test('rendered boards never contain role badges or VS cues', () => {
  // Reuse the file's existing laid-out process-board fixture helper.
  const svg = renderSVG(processBoardScene, processBoardTimeline, processBoardTimeline.sceneEndMs);
  assert.doesNotMatch(svg, />(INPUT|PROCESS|OUTPUT|VS)</);
});
```

If `renderer.test.ts` lacks a process-board fixture, build one with `compileBoard(goodBoard(), scene)` → `resolveScene` → `layoutScene` → `compileTimelineFull`, as `board-intent.test.ts` does, and import those helpers.

- [ ] **Step 2: Run and confirm failure.**

- [ ] **Step 3: Implement it**

```ts
const BOX_FILLS = ['yellow', 'green', 'orange', 'purple', 'red'] as const;
const fnv1a = (s: string): number => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h; };
export const boxFillFor = (conceptId: string, role: BoardRole): PaletteToken => role === 'process' ? 'blue' : BOX_FILLS[fnv1a(conceptId) % BOX_FILLS.length];
```

Label branch: `if (node.icon === LABEL_ONLY) return { ...base, prim: 'box' as const, text: label, fill: boxFillFor(node.concept, node.role) };`

In `renderScene.ts`, delete `renderProcessRole` (:182-194), `renderComparisonCue` (:196-212), and their calls in `renderSceneBody`.

Check `layout/measure.ts` box sizing. Box text must wrap to at most 2 lines at ≥32px (`boxMinW 180`); if measure lacks wrapping for `box`, reuse `splitLabelLines` from `catalog/ladder.ts`. Bump `VISUAL_STAGE_VERSIONS` for S7, S8, and S10 in `pipeline/versions.ts`.

- [ ] **Step 4: Run the suite.** Expected: PASS. Gates `board-role-*` still pass because roles live in `boardIntent`, not the render.
- [ ] **Step 5: Commit** — `fix(S6/S10): label nodes render as pastel boxes; remove INPUT/PROCESS/VS overlays`, with the trailer.

### Task 8: Instance nodes and richer boards

**Files:**
- Modify: `v1_claude/planner/board.ts` (`boardProblems` :197-199 duplicate rule, plus a new minimum-node rule; `nodeFor` in `compileBoard`)
- Modify: `v1_claude/plan/stages.ts:315` (`MENTIONS_PER_SCENE`) and the S4 prompt line about what to mark
- Modify: `v1_claude/fewshots/boardBank.v1.ts` (add one abstract-topic example with metaphor icons and instances; bump `BOARD_BANK_VERSION`)
- Test: `v1_claude/__tests__/board.test.ts`, `typed-board-adequacy.test.ts`

**Rules:**
- One concept may have up to `MAX_NODES_PER_CONCEPT = 3` nodes, each with a distinct mention and label ("VALUE: SAT / MAT / THE").
- Relations attach to the first node of each concept.
- A board needs at least `MIN_BOARD_NODES = 3` nodes, except `compare` (2) and structured visuals (formula, plot, matrix, number-line, worked-example).
- S4 marks 4–7 mentions per scene.

- [ ] **Step 1: Write the failing tests**

```ts
test('a concept may appear as up to three labelled instances with distinct mentions', () => {
  const input = makeScene(WORDS);
  input.mentions.push({ id: 'm_a2', phrase: 'more flour' });
  const board = goodBoard();
  board.nodes.push({ id: 'n5', mention: 'm_a2', concept: 'src_a', icon: 'flour', label: 'more flour', role: 'input' });
  const { problems, spec } = validateBoard(board, input);
  assert.deepEqual(problems, []);
  const fromA = spec!.edges.filter((e) => e.factualRelation?.fromConceptId === 'src_a');
  assert.equal(fromA.length, 1);
  assert.equal(fromA[0].from, 'n1');
});

test('instances must use distinct mentions and labels, and at most three per concept', () => {
  const board = goodBoard();
  board.nodes.push({ id: 'n5', mention: 'm_a', concept: 'src_a', icon: 'flour', label: 'flour', role: 'input' });
  assert.ok(validateBoard(board, scene).problems.some((p) => p.includes('distinct mention')));
});

test('a process board with fewer than three nodes is rejected with a fix hint', () => {
  const board = { ...goodBoard(), layout: 'flow' as const, nodes: goodBoard().nodes.slice(2) };
  const problems = validateBoard(board, scene).problems;
  assert.ok(problems.some((p) => p.includes('at least 3 nodes')));
});
```

Delete or replace `board rejects duplicate source-concept nodes even when node ids differ` (:134) with the distinct-mention test above.

- [ ] **Step 2: Run and confirm failure.**

- [ ] **Step 3: Implement it**

Replace the duplicate-concept block in `boardProblems`:

```ts
    const sameConcept = board.nodes.filter((other) => other.concept === node.concept);
    if (sameConcept.length > MAX_NODES_PER_CONCEPT && sameConcept[MAX_NODES_PER_CONCEPT] === node) problems.push(`concept ${node.concept} has ${sameConcept.length} nodes; at most ${MAX_NODES_PER_CONCEPT} instances`);
    const twin = sameConcept.find((other) => other !== node && (other.mention === node.mention || other.label.toLowerCase() === node.label.toLowerCase()));
    if (twin && board.nodes.indexOf(twin) < board.nodes.indexOf(node)) problems.push(`nodes ${twin.id} and ${node.id} show concept ${node.concept} twice; instances need a distinct mention and a distinct label`);
```

Add after the layout checks:

```ts
  const structured = ['formula', 'plot', 'matrix', 'number-line', 'worked-example'].includes(board.visual.kind);
  if (!structured && board.layout !== 'compare' && board.nodes.length < MIN_BOARD_NODES) problems.push(`board has ${board.nodes.length} nodes; show at least ${MIN_BOARD_NODES} — add the concrete things the narration names (icons, metaphors, or instances of a concept)`);
```

Keep `nodeFor` as `board.nodes.find(...)` (first instance). In the repeated-board signature, include the mention so instances don't collide.

`stages.ts:315`: `export const MENTIONS_PER_SCENE = { min: 4, max: 7 };`. Change the S4 prompt's marker line to: `Mark the concrete, drawable things the board shows — objects, people, places, tools, quantities — and each step; name abstract ideas through a concrete stand-in when the source supports one.`

Few-shot: add `abstract-lookup` to `boardBank.v1.ts`. It is an illustrative, clearly non-lesson topic ("a librarian finds a book by its catalog card") using icons `magnifier`/`key`/`book`, one `label` box node, and two instances of `book`. Verify each icon name exists in `catalog/data` before using it (`grep -o '"name":"book"' …`). Bump `BOARD_BANK_VERSION`.

Also bump the S4 and S6 prompt/cache versions.

- [ ] **Step 4: Run the suite.** Expected: PASS. The `board-role-duplicate` gate is keyed by `elementId`, so it is unaffected; confirm via `typed-board-adequacy.test.ts`.
- [ ] **Step 5: Commit** — `feat(S6): concept instances and 3-node minimum; S4 marks 4-7 drawable mentions`, with the trailer.

### Task 9: Fill the board without shrinking text; hard sparse gate

**Files:**
- Modify: `v1_claude/style.ts` (`element.objectSize`, `occupancy`)
- Modify: `v1_claude/layout/solver.ts:31` (`GROWTH_FACTORS`), `:113-130` (occupancy target), label-size floor
- Modify: `v1_claude/validation/gates.ts:186-204`
- Test: `v1_claude/__tests__/templates.test.ts` (layout) and `v1_claude/__tests__/renderer.test.ts` (gates), or wherever `runClaudeGates` is tested (`grep -l runClaudeGates __tests__`)

**Rules:**
- The solver targets `STYLE.occupancy.target = 0.55`.
- `GROWTH_FACTORS = [2.0, 1.8, 1.6, 1.45, 1.3, 1.15, 1.0, 0.85]`.
- Scaling grows icons and boxes but never sets a text size below `MIN_READABLE_FONT_PX` (32). This fixes composting's 31.8px/30.6px `min-readable-text`.
- New hard gate `board-too-sparse`: at scene end, `occupancy < 0.30` or fewer than 2 elements, for non-structured boards.
- Occupancy and idle warnings stay as warnings.

- [ ] **Step 1: Write the failing tests**

```ts
test('a three-node board fills toward the Simi band and keeps labels readable', () => {
  const laid = layoutScene(resolvedThreeNodeBoard); // build via compileBoard(goodBoard()) → resolveScene, as board-intent.test.ts does
  assert.ok(laid.occupancy >= 0.45, `occupancy ${laid.occupancy}`);
  for (const el of laid.elements) for (const t of el.visual.texts) assert.ok(t.size * (el.bbox.h / el.intrinsicSize.h) >= 32 - 1e-6);
});

test('near-empty boards are a hard failure', () => {
  const laid = layoutScene(resolvedOneNodeBoard);
  const { failures } = runClaudeGates(laid, compileTimelineFull(laid, [], 0, 10_000));
  assert.ok(failures.some((f) => f.code === 'board-too-sparse' && f.hard));
});
```

- [ ] **Step 2: Run and confirm failure.**

- [ ] **Step 3: Implement it**

`style.ts`: `occupancy: { min: 0.45, target: 0.55, max: 0.75, hardMin: 0.30 }`. `solver.ts:113`: use `targetArea = (occupancy < min ? STYLE.occupancy.target : max) * canvasArea`.

For the text floor, check whether `laid.elements[*].visual.texts[*].size` is post-scale. If scaling applies through the `el.bbox`/`intrinsicSize` ratio (see `renderScene.ts:131-133`), clamp the shrink branch of `placeWithGrowth`: skip any growth factor `g` where `STYLE.font.sizes.label * g < MIN_READABLE_FONT_PX` for scenes containing labels.

`gates.ts`, after the element-count warning:

```ts
  const structured = scene.elements.some((el) => ['formula', 'plot', 'matrix', 'numberLine'].includes(el.element.prim));
  if (!structured && (scene.occupancy < STYLE.occupancy.hardMin || scene.elements.length < 2)) {
    failures.push({ code: 'board-too-sparse', stage: 'layout', message: `occupancy ${scene.occupancy.toFixed(2)} with ${scene.elements.length} elements is below the ${STYLE.occupancy.hardMin} floor`, hard: true });
  }
```

Check the prim name for number lines in `types.ts` and use the exact literal. Bump the S8 layout visual stage version.

- [ ] **Step 4: Run the suite.** Expected: PASS. Existing fixtures with 1-element scenes that now fail `board-too-sparse` must be synthetic contract tests; update their expectations only if they assert the absence of hard failures.
- [ ] **Step 5: Commit** — `feat(S8/S12): fill boards to 0.55 occupancy without sub-32px text; board-too-sparse hard gate`, with the trailer.

---

## Phase 3 — Source intake efficiency

### Task 10: Size-gated RAG and truthful stage status

**Files:**
- Modify: `v1_claude/plan/ragSidecar.ts:38` (`enabled`) and `indexSourceBundleWithRag`
- Modify: `v1_claude/lessonCli.ts:114`
- Test: `v1_claude/__tests__/rag-env.test.ts`

**Rule:** RAG runs only when `RAG_ENGINE=on` **and** `ragWorthwhile(bundle)` holds: combined words > `RAG_MIN_WORDS = 6000`, or more than one document, or any figure/table item. Otherwise the outcome is `{ status: 'skipped', reason }`, and the stage record says `status: 'skipped'`. Add `'skipped'` to the stage status union in `shared/contracts.ts` if it is missing.

- [ ] **Step 1: Write the failing test**

```ts
import { ragWorthwhile, RAG_MIN_WORDS } from '../plan/ragSidecar.js';

test('short single-document text sources skip RAG; large, multi-doc or figure sources use it', () => {
  const doc = (words: number) => ({ documents: [{ text: 'w '.repeat(words) }], figures: [] });
  assert.equal(ragWorthwhile(doc(250) as never).use, false);
  assert.equal(ragWorthwhile(doc(RAG_MIN_WORDS + 1) as never).use, true);
  assert.equal(ragWorthwhile({ documents: [{ text: 'a' }, { text: 'b' }], figures: [] } as never).use, true);
  assert.equal(ragWorthwhile({ documents: [{ text: 'a' }], figures: [{}] } as never).use, true);
});
```

Match the real `SourceBundle` field names from `plan/sourceBundle.ts`, and adjust the fixture keys to them before running.

- [ ] **Step 2: Confirm failure. Step 3: implement.**

```ts
export const RAG_MIN_WORDS = 6000;
export function ragWorthwhile(bundle: SourceBundle): { use: boolean; reason: string } {
  const words = bundle.documents.reduce((n, d) => n + d.text.split(/\s+/).filter(Boolean).length, 0);
  if (bundle.documents.length > 1) return { use: true, reason: 'multiple documents' };
  if ((bundle.figures?.length ?? 0) > 0) return { use: true, reason: 'figures/tables present' };
  return words > RAG_MIN_WORDS ? { use: true, reason: `${words} words` } : { use: false, reason: `${words} words fits in context; full text is sent to S2` };
}
```

Call it at the top of `indexSourceBundleWithRag`, after the `enabled()` check. In `lessonCli.ts:114`, map `disabled` and `skipped` outcomes to stage `status: 'skipped'`.

- [ ] **Step 4: Run the suite. Step 5: commit** — `perf(S1): skip RAG for sources that fit in context; record skipped honestly`, with the trailer.

---

## Phase 4 — Measure against Simi (end-goal validation)

### Task 11: Numeric board metrics and a Simi reference

**Files:**
- Create: `hypothesis_claude/harness/boardMetrics.ts` (pure functions on RGBA buffers)
- Create: `hypothesis_claude/harness/boardMetricsCli.ts` (reads a run dir or reference videos, writes JSON)
- Create: `hypothesis_claude/harness/reference/lamina/metrics.v1.json` (generated; `index.json` untouched)
- Modify: `hypothesis_claude/package.json` (add `"metrics:boards": "npm run build && node dist/harness/boardMetricsCli.js"`)
- Test: `v1_claude/__tests__/board-metrics.test.ts`

**Interfaces:**

```ts
export interface BoardMetrics { inkBboxOccupancy: number; inkPixelFraction: number; colourPixelFraction: number }
export function measureFrame(rgba: Uint8Array, width: number, height: number, opts?: { excludeTopFraction?: number; excludeBottomFraction?: number }): BoardMetrics;
```

Definitions:
- **Ink:** a pixel whose luminance is < 0.85 or whose saturation is > 0.25, compared with background `#fafafa`-ish.
- **Colour:** saturation > 0.25.
- **Exclusions:** the top 12% (title) and bottom 6% (brand bug and CTA) are left out, for both Simi and ours.

- [ ] **Step 1: Write the failing test**

```ts
import { measureFrame } from '../../../../../harness/boardMetrics.js';

test('frame metrics: blank, full ink, and a coloured square', () => {
  const w = 100, h = 100;
  const blank = new Uint8Array(w * h * 4).fill(250);
  assert.deepEqual(measureFrame(blank, w, h, { excludeTopFraction: 0, excludeBottomFraction: 0 }), { inkBboxOccupancy: 0, inkPixelFraction: 0, colourPixelFraction: 0 });
  const sq = new Uint8Array(blank);
  for (let y = 25; y < 75; y++) for (let x = 25; x < 75; x++) { const i = (y * w + x) * 4; sq[i] = 60; sq[i + 1] = 150; sq[i + 2] = 240; }
  const m = measureFrame(sq, w, h, { excludeTopFraction: 0, excludeBottomFraction: 0 });
  assert.equal(m.inkBboxOccupancy, 0.25);
  assert.equal(m.inkPixelFraction, 0.25);
  assert.equal(m.colourPixelFraction, 0.25);
});
```

Adjust the relative import depth to match how other tests import `harness/*` (`grep -rn "harness/" __tests__ | head -3`).

- [ ] **Step 2: Confirm failure. Step 3: implement `measureFrame`** (straight pixel loop, no dependencies), then the CLI:
  - `--reference`: for each entry in `harness/reference/lamina/index.json`, extract the frame at `endS - 0.3` with `ffmpeg -ss <t> -i <video> -frames:v 1 -f rawvideo -pix_fmt rgba -s 1920x1080 -`. It writes `metrics.v1.json` as `{ schemaVersion: 'lamina-board-metrics/v1', generatedAt, scenes: [{ video, scene, ...BoardMetrics }], summary: { median, p25, p75 } }`.
  - `--run <runDir>`: rasterize each scene's final SVG at its scene end (reuse `export/raster` helpers; grep `rasterize` in `export/`). It writes `<runDir>/board-metrics.json` with the same summary shape plus `vsReference` deltas.
- [ ] **Step 4:** Run `npm run metrics:boards -- --reference` once and commit the generated `metrics.v1.json`. Record the median occupancy and colour fraction in HANDOFF; these replace the prose "50–70%" as the parity target.
- [ ] **Step 5: Commit** — `feat(harness): numeric board metrics and Lamina reference metrics v1`, with the trailer.

### Task 12: Live 5-topic validation batch (paid)

**Files:** none in code. Run records go in `.data/hypothesis-runs/phase7-<date>/`, and results go in HANDOFF.

**Budget:** about $0.02 per 60s video, about $0.10 total. Topics:
- the three from `.data/sources/` (bicycle-balance, composting, ocean-tides; ocean contains "24")
- two abstract sources: pick the two `.md` sources in `.data/sources/` with the least concrete nouns (e.g. an AI-concept source). If none exist, ask the user for sources rather than authoring lesson content.

- [ ] **Step 1: Preconditions**
  - Tasks 0–11 are committed; `npm run test:hypothesis` is green.
  - `.env` has `OPENROUTER_CONTENT_MODEL=OPENROUTER_SCENE_MODEL=openai/gpt-6-luna`.
  - `RAG_ENGINE` is unset.

- [ ] **Step 2: Run cold, 3 at a time**

```bash
cd hypothesis_claude
for s in bicycle-balance composting ocean-tides <abstract-1> <abstract-2>; do
  npm run run:lesson -- --source=.data/sources/$s.md --duration=60 --output=.data/hypothesis-runs/phase7-$(date +%F)/$s &
done; wait
```

Check `lessonCli.ts` argument names (`--output` may be named differently) before running.

- [ ] **Step 3: Measure and look**
  - For each run, run `npm run metrics:boards -- --run <runDir>`.
  - Build a contact sheet: `ffmpeg -i video.mp4 -vf "fps=1/6,scale=480:-1,tile=4x3" -frames:v 1 sheet.png`.
  - **Open and inspect every sheet.** Codex never looked at frames; that is how the regression shipped.

- [ ] **Step 4: Acceptance**

| Metric | Target | Source |
|---|---|---|
| Runs reaching MP4 | 5/5 | run-manifest |
| Status | `draft` for all 5 (never `failed` from S5 or planner) | evaluation-bundle |
| Duration | 60s ±10% | ffprobe |
| Scenes per 60s | 3–4 | manifest |
| Nodes per board | median ≥4 | scene-spec |
| Icon or box nodes (no bare text) | 100% | scene-spec |
| Metaphor-basis icons | recorded; spot-check each for wrong meaning | scene-spec `iconBasis` |
| Ink bbox occupancy (scene end) | ≥ Simi p25 from metrics.v1 | board-metrics |
| Colour pixel fraction | ≥ Simi p25 | board-metrics |
| Repaired-word warnings | ≤10% of words per scene | failures |
| Cost per video | ≤$0.03 | budget-ledger |

For every target, record `passed`, `failed` or `unmeasured` in HANDOFF with the numbers. A miss is recorded, not tuned away. Any missed row becomes the next bounded task.

- [ ] **Step 5: Commit the HANDOFF entry only** (media stays in `.data/`) — `docs: phase7 live 5-topic parity batch results`, with the trailer.

### Task 13: One-command calibration output for the human gate

**Files:** `shared/alignment/word_boundary_review.py` (`score` subcommand); `shared/alignment/test_word_boundary_review.py`

- [ ] **Step 1: Write the failing test.** It feeds two synthetic vote files that meet the existing thresholds and passes `--write-calibration <tmp>/calibration.v2.json`. It asserts the file exists with `status == 'measured'`, `aligner` equal to the aligner recorded in the review pack (not hard-coded `stable-ts`), and `medianErrorMs` equal to the scored median.
- [ ] **Step 2: Confirm failure.** Expected: unknown argument.
- [ ] **Step 3: Implement it.** On a passing score, write the calibration JSON with the exact fields `shared/alignment/calibration.ts` loads; read the loader to get them. On a failing score, write nothing and exit non-zero. Make the loader accept the recorded aligner family (`stable-ts*`, `torchaudio-wav2vec2-ctc`) instead of requiring `'stable-ts'`.
- [ ] **Step 4: Run the Python suite. Step 5: commit** — `feat(calibration): scorer writes calibration.v2.json; loader accepts recorded aligner`, with the trailer.
- [ ] **Step 6:** Append the reviewer instructions to HANDOFF: the command to build the pack (`harness/humanReviewPackCli.ts`) and the command to score it. Status stays `unmeasured` until two humans submit votes.

---

## Out of scope (next plans, gated on Task 12 numbers)

- **S3 v6 repair-stranding fix:** needs its own measured experiment (composting fell from 3/3 to 1/3 under v5).
- **S2 "concrete entity" prompt variant:** run only if Task 12 shows metaphor/box share over 50%.
- **Human-figure family (Kenney CC0) and catalog top-up** (chloroplast, glucose, stem): run only if Task 12 contact sheets show wrong or missing key objects.
- **Pen/hand cursor:** Simi shows none; dropped.

## Verification (end to end)

1. `npm run typecheck:hypothesis`: clean.
2. `npm run test:hypothesis`: green, plus the new tests in Tasks 2–11 and 13.
3. The Task 12 batch meets its acceptance table, and each sheet was inspected by eye next to `simi.mp4` sheets.
4. `git log --oneline simi-parity-recovery`: one commit per task, nothing pushed.
