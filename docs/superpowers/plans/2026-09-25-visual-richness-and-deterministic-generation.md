# Visual Richness and Deterministic Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **THIS FILE IS FROZEN.** Its SHA-256 is recorded in `docs/superpowers/plans/plan-lock.json` and the file is read-only (`chmod 444`). Task 0 adds a test that fails the offline suite if these bytes change. **No agent may edit, reformat, re-save, `chmod`, or regenerate this file or `plan-lock.json`.** Progress tracking goes in `docs/HANDOFF.md`, not in these checkboxes. A change of scope is written to `docs/superpowers/plans/2026-09-25-visual-richness-and-deterministic-generation.amendments.md`. Each amendment must quote the user's chat approval, verbatim, with a date. An amendment without that quote is void.

**Goal:** Make the Claude hypothesis pipeline produce richer, source-grounded whiteboard scenes through a governed few-shot bank, a sectioned prompt builder, and deterministic icon selection from a pluggable icon library. Every run must finish as a recorded artifact, never as a crash, and reruns must be byte-reproducible from cache.

**Architecture:** Changes stay inside `src/experimental/hypothesis/v1_claude/`. LLM stages still emit validated data only, and code still draws. Reliability work separates provider route rejections from semantic repairs, anchors evidence quotes to exact source text through deterministic normalization, and turns validator exceptions into distinct failure codes. Visual work adds recipe cards and a template-complete exemplar bank to the S6 prompt, a deterministic scene-richness metric, and an S6 calibration harness that measures prompt arms against cached S1–S5 artifacts. Icon work adds a manifest-driven SVG ingest pipeline, a multi-library catalog registry, cached query embeddings, and lesson-level icon pins.

**Tech Stack:** TypeScript (ESM, `tsc`), Node `node:test`, zod 4, `@huggingface/transformers` (local MiniLM), `svg-path-properties`, `@resvg/resvg-js`, ffmpeg, OpenRouter HTTP API.

**Spec:** The user request of 2026-09-25 (harness, few-shot visuals, prompt builder, deterministic icons from a user-supplied library, videos that do not fail). It is read together with `CLAUDE.md`, `hypothesis/v1_claude/00-README.md` through `05-GEMINI-AUDIT-AND-SIMI-HYPOTHESES.md`, `docs/ARCHITECTURE.md`, and the 2026-09-25 entries in `docs/HANDOFF.md`.

## Meaning of "without failing" in this plan

"Without failing" has three measurable meanings here. The plan does not claim any other meaning.

1. **No crash.** Every S1–S12 path ends with a written artifact and a status (`failed` or `draft`). Provider routing rejections, validator exceptions, and evidence-format drift become typed, recorded failures or recoveries. None of them escapes as an uncaught exception.
2. **Reproducible.** The same inputs, versions, and cache produce byte-identical SceneSpecs, icon choices, SVG frames, and MP4 bytes. Nothing in S7–S11 depends on catalog array order, wall-clock time, or a non-cached embedding.
3. **Measured reliability.** The S1–S4 pass rate and the S6 valid-scene rate are measured by harnesses and reported. They are never asserted.

A **publish pass** still requires `calibration.v2.json` to reach `status: "measured"`. That requires two human reviewers on `.data/alignment-review-pack-20260925/`. This plan does not remove, weaken, or route around that gate. Task 7 lets S6 run for diagnosis while the gate stays failed.

## Global Constraints

Every task implicitly includes this section. The values are copied from `CLAUDE.md` and the hypothesis plan pack.

- Runtime code must never inject lesson claims, labels, numbers, relations, narration, or topic-specific icon choices by branching on a lesson title, case ID, source filename, golden ID, or keyword list.
- Hand-authored plans, answers, and expected values belong only in `fixtures/`, `__tests__/`, or explicitly versioned few-shot data.
- Missing evidence, provider output, alignment, or required assets must remain a visible failure or draft state. Never convert it into a passing result.
- Do not render, inspect, compare, or score retained legacy fixture media or hand-authored scene outputs as quality evidence.
- Never edit frozen source inputs, Simi references, expected outputs, or golden hashes to make a check pass.
- Never loosen `plan/contracts.ts`, `plan/analyze.ts`, `validation/gates.ts`, or the planner gates in `planner/plan.ts` to fake progress. A new check may be added. An existing check may not be removed or relaxed.
- Never modify an existing test's assertions to make new code pass. New behavior gets new tests.
- Models emit validated scene data only. Do not execute model-generated JavaScript/Python, SVG paths, or a Manim pipeline.
- Keep `renderSVG(scene, timeMs)` deterministic and shared by browser playback and export.
- Hard schema, factual provenance, alignment, layout, readability, license, audio/video sync, or budget failures block `passed`.
- Keys stay in `.env`. Media and job outputs stay in `.data/`. Exports stay in `output/`. Never print or copy a key.
- Do not commit, push, publish, or change the production runtime unless the user explicitly requests it. Every "Checkpoint" step below records evidence in `docs/HANDOFF.md`. It creates a git commit only if the user has authorized commits in chat.
- Do not modify `src/experimental/hypothesis/shared/**`. It is byte-shared with the rival track and verified by a SHA-256 manifest.
- The offline gate commands are exactly `npm run typecheck:hypothesis` and `npm run test:hypothesis`. Both must pass at the end of every task.
- Paid calls: $0.10 cap per one-minute clip. Harness runs use a dedicated budget ledger capped at $1.00 per harness invocation. Ask the user in chat before any paid run that is not already authorized in that session.
- Icon thresholds `TAU_HIGH_EMB = 0.62` and `TAU_MID_EMB = 0.5` are uncalibrated and must not change in this plan (E4 has no labeled dataset).
- `LICENSE_ALLOWLIST = ['MIT', 'ISC', 'Apache-2.0', 'CC0-1.0', 'CC-BY-4.0', 'manual']`. An icon library with any other license is rejected. It is not added to the allowlist.
- Every cache-relevant behavior change bumps its stage, prompt, bank, or catalog version so warm caches cannot replay stale artifacts.
- Status words in docs are only `implemented`, `tested`, `passed`, `failed`, or `unmeasured`.

## Review Focus

These are the five inputs or failure modes most likely to hurt a user that the spec implies but does not name. Each line has a pinning test in the task that owns the code.

1. **OpenRouter returns `HTTP 404 No endpoints found` on every attempt.** Expected: bounded transport retries, then one hard `<stage>-call-failed`. The budget ledger is not blocked, and no spend is recorded. Pinned in Task 1 (`all route rejections end in one hard failure and leave the ledger unblocked`).
2. **The model paraphrases an evidence quote, or quotes text that occurs in two spans.** Expected: the evidence stays invalid. Only typographic or whitespace drift, or a unique verbatim match in another span, is anchored. Pinned in Task 2 (`paraphrase is never anchored`, `ambiguous relocation is rejected`).
3. **The user's icon library has SVGs with `transform`, `<use>`, gradients, unknown colors, or more than 40 paths.** Expected: each bad file is rejected with a reason, the rest still ingest, and the output is identical across runs. Pinned in Task 9 (`bad files are rejected individually with reasons`, `ingest output is byte-stable`).
4. **The same concept appears in two scenes under different object wording.** Expected: the same icon in both scenes, keyed by `conceptIds`. Pinned in Task 12 (`same conceptIds keep one icon across scenes`).
5. **A warm cache after a prompt, bank, or catalog change.** Expected: S6 and S7 cache keys change, and no stale SceneSpec or resolution replays. Pinned in Task 4 (`prompt v13 changes the planning context hash`) and Task 10 (`catalog version changes when an enabled library changes`).

## User inputs this plan depends on

| Input | Needed by | If absent |
|---|---|---|
| Icon asset library: a directory of SVG files plus license and attribution | Task 11 | Tasks 9–10 complete against a synthetic test library. Task 11 stays `unmeasured`. |
| Two independent human reviewers for `.data/alignment-review-pack-20260925/` | Publish pass (outside this plan) | Runs stay `failed` at S5. This is correct behavior. |
| Chat approval for paid harness runs (≤ $1.00 per invocation) | Tasks 8, 13, 14 | Offline parts complete. Paid measurements stay `unmeasured`. |

## File structure

All paths are relative to `hypothesis_claude/`. `V1` means `src/experimental/hypothesis/v1_claude`.

| File | Responsibility | Task |
|---|---|---|
| `docs/superpowers/plans/plan-lock.json` | SHA-256 lock for frozen plans (already written; never edited) | 0 |
| `V1/__tests__/plan-lock.test.ts` | Fails the suite if a locked plan changes or becomes writable | 0 |
| `V1/llm/openrouter.ts` (modify) | Typed `ProviderNotDispatchedError` for 404 no-endpoint and exhausted 429 | 1 |
| `V1/pipeline/budgetLedger.ts` (modify) | Treat not-dispatched provider codes as no-charge preflight failures | 1 |
| `V1/llm/structuredCall.ts` (modify) | Transport retries separate from the one repair; `validator-threw` code | 1 |
| `V1/plan/evidenceAnchor.ts` (create) | Deterministic quote normalization and anchoring to exact source text | 2 |
| `V1/plan/stages.ts` (modify) | Use anchoring in S2; schema-keyword guard in S2/S3 | 2, 3 |
| `V1/pipeline/lesson.ts` (modify) | Bump S2/S3 stage versions | 2, 3 |
| `V1/prompt/builder.ts` (create) | Sectioned, hashed, deterministic prompt assembly; schema-keyword detector | 3 |
| `V1/planner/prompt.ts` (modify) | S6 prompt through the builder (v12 byte-identical, then v13) | 3, 4 |
| `V1/planner/recipes.ts` (create) | Topic-neutral visual recipe card per template | 4 |
| `V1/planner/context.ts` (modify) | `SCENE_PROMPT_VERSION` v13 and recipe version in context versions | 4 |
| `V1/fewshots/exampleBank.v2.ts` (create) | Template-complete, icon-rich structural exemplars | 5 |
| `V1/planner/exemplars.ts` (modify) | Load bank v2; bank version `mechanism-bank/v4` | 5 |
| `V1/harness/sceneRichness.ts` (create) | Deterministic visual-richness metrics per SceneSpec | 6 |
| `V1/planner/plan.ts` (modify) | Export `shouldSkipPaidPlanning` | 7 |
| `V1/pipeline/runLive.ts` (modify) | Diagnostic S6 opt-in; shared planner-input builder; pins; catalog version | 7, 8, 10, 12 |
| `V1/lessonCli.ts` (modify) | `--plan-despite-alignment-failure` flag | 7 |
| `V1/planner/sceneInput.ts` (create) | `buildPlannerSceneInput` shared by runLive and harness | 8 |
| `V1/harness/sceneCalibration.ts`, `V1/harness/sceneCalibrationCli.ts` (create) | S6 prompt-arm calibration on cached S1–S5 artifacts | 8 |
| `V1/catalog/libraryIngest.ts` (create) | Pure SVG normalization into the catalog raw format | 9 |
| `scripts/ingest-icon-library.mjs` (create) | CLI wrapper for ingest | 9 |
| `V1/catalog/registry.ts` (create) | Enabled libraries, house flag, catalog version hash | 10 |
| `V1/catalog/streamline.ts`, `V1/catalog/semantic.ts`, `V1/catalog/ladder.ts` (modify) | Multi-library loading and ranking | 10 |
| `scripts/embed-catalog.mjs` (modify) | Embed every enabled library | 10 |
| `V1/catalog/queryEmbeddingCache.ts` (create) | Content-addressed query embedding cache | 12 |
| `V1/catalog/iconPins.ts` (create) | Lesson-level concept → icon pins | 12 |
| `V1/resolveScene.ts` (modify) | Accept pins | 12 |
| `V1/harness/reliability.ts`, `V1/harness/reliabilityCli.ts` (create) | S1–S4 cold reliability measurement | 13 |
| `package.json` (modify) | `scene:calibrate`, `reliability:run`, `icons:ingest` scripts | 8, 9, 13 |
| `hypothesis/v1_claude/02-IMPLEMENTATION-PLAN.md`, `03-VALIDATION-HARNESS.md`, `docs/ARCHITECTURE.md`, `docs/HANDOFF.md` (modify) | Evidence ledger | 14 |

Test command pattern used by every task (it builds `dist/` first):

```bash
npm run build && node --test dist/src/experimental/hypothesis/v1_claude/__tests__/<name>.test.js
```

---

### Task 0: Plan lock enforcement

**Files:**
- Create: `src/experimental/hypothesis/v1_claude/__tests__/plan-lock.test.ts`
- Modify: `CLAUDE.md` (append one section at the end)
- Read only: `docs/superpowers/plans/plan-lock.json`

**Interfaces:**
- Consumes: `plan-lock.json` shape `{ schemaVersion: 'plan-lock/v1', plans: Array<{ path: string; sha256: string; amendmentsPath: string; lockedAt: string }> }`
- Produces: nothing used by later tasks. It adds a suite-wide guard.

- [ ] **Step 1: Write the failing test**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

interface PlanLock { schemaVersion: 'plan-lock/v1'; plans: Array<{ path: string; sha256: string; amendmentsPath: string; lockedAt: string }> }

const ROOT = process.cwd();
const lock = JSON.parse(readFileSync(resolve(ROOT, 'docs/superpowers/plans/plan-lock.json'), 'utf8')) as PlanLock;

test('plan lock file declares at least one frozen plan', () => {
  assert.equal(lock.schemaVersion, 'plan-lock/v1');
  assert.ok(lock.plans.length >= 1);
});

test('frozen plans match their locked SHA-256', () => {
  for (const entry of lock.plans) {
    const digest = createHash('sha256').update(readFileSync(resolve(ROOT, entry.path))).digest('hex');
    assert.equal(digest, entry.sha256, `${entry.path} changed after it was locked; record changes in ${entry.amendmentsPath} with quoted user approval instead`);
  }
});

test('frozen plans are read-only on disk', () => {
  for (const entry of lock.plans) {
    assert.equal(statSync(resolve(ROOT, entry.path)).mode & 0o222, 0, `${entry.path} must stay chmod 444`);
  }
});
```

- [ ] **Step 2: Run the test**

Run: `npm run build && node --test dist/src/experimental/hypothesis/v1_claude/__tests__/plan-lock.test.js`
Expected: PASS. The lock file and read-only permission already exist. If it FAILS, stop and report to the user. Do not "fix" the plan, the lock, or the permissions.

- [ ] **Step 3: Append the rule to `CLAUDE.md`**

Append exactly this section at the end of `CLAUDE.md`:

```markdown
## Frozen implementation plans

Files listed in `docs/superpowers/plans/plan-lock.json` are frozen. Never edit, reformat, `chmod`, or regenerate them or the lock file. `__tests__/plan-lock.test.ts` fails the offline suite if their bytes or read-only mode change. Record progress in `docs/HANDOFF.md`. Record scope changes in the plan's `.amendments.md` file, and quote the user's dated chat approval verbatim in each amendment.
```

- [ ] **Step 4: Run the full offline gate**

Run: `npm run typecheck:hypothesis && npm run test:hypothesis`
Expected: typecheck exits 0. The Node suite passes with 3 more tests than before (297 if the baseline is 294). All 17 Python tests pass.

- [ ] **Step 5: Checkpoint**

Append a `docs/HANDOFF.md` entry named "Task 0 — plan lock enforcement" with the commands and test counts.

---

### Task 1: Provider route rejections, transport retries, validator exceptions

**Why:** The 2026-09-25 session recorded 7/8 Sonnet rescue attempts failing with `HTTP 404 — No endpoints found that satisfy the max price`. Today `chatStructured` throws a plain `Error`. `PersistentBudgetLedger.call` then classifies it as an uncertain outcome and **blocks the ledger**, so one routing rejection stops every later call in that output directory. A 404 no-endpoint means OpenRouter selected no provider, so no model ran. Separately, an exception thrown inside a `validate` callback surfaces only as the generic `stage-threw` (HANDOFF "retry-ownership audit" gap).

**Files:**
- Modify: `src/experimental/hypothesis/v1_claude/llm/openrouter.ts` (`chatStructured`, the `!response.ok` branch)
- Modify: `src/experimental/hypothesis/v1_claude/pipeline/budgetLedger.ts` (`definitelyNotDispatched` list in `call`)
- Modify: `src/experimental/hypothesis/v1_claude/llm/structuredCall.ts` (`StructuredCallOptions`, `structuredCall`)
- Test: `src/experimental/hypothesis/v1_claude/__tests__/provider-transport.test.ts`

**Interfaces:**
- Produces: `export class ProviderNotDispatchedError extends Error { readonly status: number; readonly code: 'PROVIDER_NO_ENDPOINT' | 'PROVIDER_RATE_LIMITED' }` in `llm/openrouter.ts`. `error.cause` is `{ code }`.
- Produces: new `StructuredCallOptions` fields `transportRetries?: number` (default 2), `transportRetryDelayMs?: number` (default 5000), `sleep?: (ms: number) => Promise<void>`.
- Produces: failure codes `<stage>-transport-retry` (soft), `<stage>-validator-threw` (hard).

- [ ] **Step 1: Write the failing tests**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { PersistentBudgetLedger } from '../pipeline/budgetLedger.js';
import { ProviderNotDispatchedError, chatStructured } from '../llm/openrouter.js';
import { structuredCall } from '../llm/structuredCall.js';

const okBody = (content: string) => JSON.stringify({ id: 'gen-t', model: 'test/model', choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 3, cost: 0.0001 } });
const noEndpoint = () => new Response('{"error":{"message":"No endpoints found that satisfy the max price"}}', { status: 404 });
const noSleep = async () => {};

test('chatStructured types a 404 no-endpoint rejection as not dispatched', async () => {
  await assert.rejects(
    chatStructured('k', { model: 'test/model', system: 's', user: 'u', schema: {}, schemaName: 't', maxTokens: 10, temperature: 0 }, async () => noEndpoint()),
    (error: unknown) => error instanceof ProviderNotDispatchedError && error.code === 'PROVIDER_NO_ENDPOINT' && error.message.startsWith('OpenRouter HTTP 404'),
  );
});

test('chatStructured keeps other HTTP errors as plain errors', async () => {
  await assert.rejects(
    chatStructured('k', { model: 'test/model', system: 's', user: 'u', schema: {}, schemaName: 't', maxTokens: 10, temperature: 0 }, async () => new Response('boom', { status: 500 })),
    (error: unknown) => !(error instanceof ProviderNotDispatchedError) && String(error).includes('OpenRouter HTTP 500'),
  );
});

test('route rejection is retried as transport, not as the one repair, and the ledger stays unblocked', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'hyp-transport-'));
  try {
    const ledger = new PersistentBudgetLedger(path.join(root, 'budget.json'), 0.05);
    let calls = 0;
    const result = await structuredCall({
      stage: 'concepts', subject: 'transport test', model: 'test/model', apiKey: 'test-only', system: 's', user: 'u',
      schema: z.object({ ok: z.boolean() }), schemaName: 't', maxTokens: 50, remainingBudgetUsd: 0.05, budgetLedger: ledger, sleep: noSleep,
      fetcher: async () => (++calls <= 2 ? noEndpoint() : new Response(okBody('{"ok":true}'), { status: 200 })),
    });
    assert.deepEqual(result.value, { ok: true });
    assert.equal(result.usage.repairs, 0);
    assert.equal(result.rawResponses.length, 1);
    assert.equal(result.failures.filter((f) => f.code === 'concepts-transport-retry' && !f.hard).length, 2);
    const snapshot = await ledger.snapshot();
    assert.equal(snapshot.blocked, false);
    assert.equal(snapshot.preflightFailures, 2);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('all route rejections end in one hard failure and leave the ledger unblocked', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'hyp-transport-'));
  try {
    const ledger = new PersistentBudgetLedger(path.join(root, 'budget.json'), 0.05);
    const result = await structuredCall({
      stage: 'plan', subject: 'transport test', model: 'test/model', apiKey: 'test-only', system: 's', user: 'u',
      schema: z.object({ ok: z.boolean() }), schemaName: 't', maxTokens: 50, remainingBudgetUsd: 0.05, budgetLedger: ledger, sleep: noSleep,
      fetcher: async () => noEndpoint(),
    });
    assert.equal(result.value, undefined);
    assert.equal(result.failures.filter((f) => f.hard).map((f) => f.code).join(','), 'plan-call-failed');
    assert.equal((await ledger.snapshot()).blocked, false);
    assert.equal((await ledger.snapshot()).spentUsd, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('a validator exception is a distinct hard failure and spends no repair', async () => {
  const result = await structuredCall({
    stage: 'plan', subject: 'validator test', model: 'test/model', apiKey: 'test-only', system: 's', user: 'u',
    schema: z.object({ ok: z.boolean() }), schemaName: 't', maxTokens: 50, remainingBudgetUsd: 0.05, sleep: noSleep,
    validate: () => { throw new Error('validator bug'); },
    fetcher: async () => new Response(okBody('{"ok":true}'), { status: 200 }),
  });
  assert.equal(result.value, undefined);
  assert.equal(result.usage.repairs, 0);
  assert.ok(result.failures.some((f) => f.code === 'plan-validator-threw' && f.hard && f.message.includes('validator bug')));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run build && node --test dist/src/experimental/hypothesis/v1_claude/__tests__/provider-transport.test.js`
Expected: FAIL at compile time with `Module '"../llm/openrouter.js"' has no exported member 'ProviderNotDispatchedError'`.

- [ ] **Step 3: Add the typed error in `llm/openrouter.ts`**

Add above `chatStructured`:

```ts
/**
 * OpenRouter answered before any model endpoint ran: no endpoint satisfied the
 * request (routing or `max_price` filter), or throttling persisted after the
 * built-in 429 waits. No completion and no usage exist, so the budget ledger
 * records it as a preflight failure instead of an uncertain charge.
 */
export class ProviderNotDispatchedError extends Error {
  readonly status: number;
  readonly code: 'PROVIDER_NO_ENDPOINT' | 'PROVIDER_RATE_LIMITED';
  constructor(status: number, code: 'PROVIDER_NO_ENDPOINT' | 'PROVIDER_RATE_LIMITED', detail: string) {
    super(`OpenRouter HTTP ${status}${detail ? ` — ${detail.slice(0, 400)}` : ''}`, { cause: { code } });
    this.name = 'ProviderNotDispatchedError';
    this.status = status;
    this.code = code;
  }
}
```

Replace the `if (!response.ok) { ... }` block in `chatStructured` with:

```ts
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    if (response.status === 404 && /no endpoints found/i.test(text)) throw new ProviderNotDispatchedError(404, 'PROVIDER_NO_ENDPOINT', text);
    if (response.status === 429) throw new ProviderNotDispatchedError(429, 'PROVIDER_RATE_LIMITED', text);
    throw new Error(`OpenRouter HTTP ${response.status}${text ? ` — ${text.slice(0, 400)}` : ''}`);
  }
```

- [ ] **Step 4: Classify the new codes in `pipeline/budgetLedger.ts`**

Replace the `definitelyNotDispatched` line and its comment in `call` with:

```ts
        // DNS lookup and connection refusal happen before an HTTP request can
        // reach the provider. OpenRouter's "no endpoints found" 404 and an
        // exhausted 429 mean no model endpoint ran. Keep a durable diagnostic
        // without reserving spend, and allow a later retry.
        const definitelyNotDispatched = ['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'EHOSTUNREACH', 'PROVIDER_NO_ENDPOINT', 'PROVIDER_RATE_LIMITED'].includes(causeCode);
```

- [ ] **Step 5: Add transport retries and the validator guard in `llm/structuredCall.ts`**

Add the import: `import { ProviderNotDispatchedError } from './openrouter.js';` (merge it into the existing import from `./openrouter.js`).

Add to `StructuredCallOptions<T>`:

```ts
  /** Retries after a ProviderNotDispatchedError. These are transport retries, never the semantic repair. Default 2. */
  transportRetries?: number;
  /** Base delay; retry n waits n × this value. Default 5000 ms. */
  transportRetryDelayMs?: number;
  /** Test seam for retry waits. */
  sleep?: (ms: number) => Promise<void>;
```

Inside `structuredCall`, after the `call` function definition, add:

```ts
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const callWithTransportRetry = async (userPrompt: string, attempt: number): Promise<string | null> => {
    for (let retry = 0; ; retry++) {
      try {
        return await call(userPrompt, attempt);
      } catch (error) {
        if (!(error instanceof ProviderNotDispatchedError) || retry >= (opts.transportRetries ?? 2)) throw error;
        failures.push({ code: `${opts.stage}-transport-retry`, stage: opts.stage, message: `${opts.subject} attempt ${attempt}: ${error.message}; transport retry ${retry + 1} (no completion was produced; this is not a repair)`, hard: false });
        await sleep((opts.transportRetryDelayMs ?? 5000) * (retry + 1));
      }
    }
  };
  const parseSafely = (content: string) => {
    try {
      return parseCandidates(content, opts.schema, opts.validate);
    } catch (error) {
      return { threw: error } as const;
    }
  };
  const validatorThrew = (error: unknown) => failures.push({ code: `${opts.stage}-validator-threw`, stage: opts.stage, message: `${opts.subject}: validation code threw (a pipeline bug, not a model failure): ${error instanceof Error ? error.message : String(error)}`, hard: true });
```

Then change the attempt flow:
- `first = await call(opts.user, 1);` becomes `first = await callWithTransportRetry(opts.user, 1);`
- `second = await call(buildRepairPrompt(opts.user, first, parsed.error), 2);` becomes `second = await callWithTransportRetry(buildRepairPrompt(opts.user, first, parsed.error), 2);`
- `const parsed = parseCandidates(first, opts.schema, opts.validate);` becomes:

```ts
  const parsed = parseSafely(first);
  if ('threw' in parsed) { validatorThrew(parsed.threw); return { usage, failures, rawResponses }; }
```

- `const repaired = parseCandidates(second, opts.schema, opts.validate);` becomes:

```ts
  const repaired = parseSafely(second);
  if ('threw' in repaired) { validatorThrew(repaired.threw); return { usage, failures, rawResponses }; }
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm run build && node --test dist/src/experimental/hypothesis/v1_claude/__tests__/provider-transport.test.js`
Expected: PASS (5 tests).

- [ ] **Step 7: Run the full offline gate**

Run: `npm run typecheck:hypothesis && npm run test:hypothesis`
Expected: all green. If an existing test asserts the old plain-`Error` message for a 404 or 429, keep its assertion. The message text is unchanged, so it should pass. If it does not, report the conflict. Do not edit the existing test.

- [ ] **Step 8: Checkpoint** — append "Task 1" to `docs/HANDOFF.md`: root cause (404 blocks ledger), fix, tests, counts.

---

### Task 2: Deterministic evidence-quote anchoring for S2

**Why:** The 5-minute and 10-minute live attempts failed at S2 on "evidence quote is absent from source span". `resolveSourceEvidence` requires `span.text.includes(quote)` byte-for-byte. Models often change curly quotes, dashes, non-breaking spaces, line breaks, or trailing punctuation, or cite the right text under a neighboring span ID. Anchoring maps such a quote back to the **exact** source substring. Paraphrase is never accepted. The stored quote is always verbatim source text.

**Files:**
- Create: `src/experimental/hypothesis/v1_claude/plan/evidenceAnchor.ts`
- Modify: `src/experimental/hypothesis/v1_claude/plan/stages.ts` (`buildConceptGraph`: `checkEvidence` and `enrich`)
- Modify: `src/experimental/hypothesis/v1_claude/pipeline/lesson.ts` (S2 `stageVersion` literal)
- Test: `src/experimental/hypothesis/v1_claude/__tests__/evidence-anchor.test.ts`

**Interfaces:**
- Consumes: `resolveSourceEvidence(doc, spanId, quote)` and `sourceDocFromText(text, format)` from `plan/sourceDoc.ts`.
- Produces:
  - `export type AnchorMatch = 'exact' | 'normalized' | 'relocated'`
  - `export interface AnchoredEvidence { ref: SourceEvidenceRef; match: AnchorMatch }`
  - `export function normalizeForAnchor(text: string): { normalized: string; map: number[] }`
  - `export function anchorQuote(doc: SourceDoc, spanId: string, quote: string): AnchoredEvidence | undefined`
  - `export const MIN_RELOCATION_CHARS = 12`

- [ ] **Step 1: Write the failing tests**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceDocFromText } from '../plan/sourceDoc.js';
import { anchorQuote, normalizeForAnchor } from '../plan/evidenceAnchor.js';

const doc = sourceDocFromText('# Heat\n\nThe engine’s piston moves — then  the valve opens.\n\nPressure rises when the gas is heated.\n\nThe valve opens.\n\nThe valve opens.', 'markdown');
const spanWith = (needle: string) => doc.spans.find((s) => s.text.includes(needle))!.id;

test('exact quote anchors unchanged', () => {
  const hit = anchorQuote(doc, spanWith('Pressure'), 'Pressure rises when the gas is heated.');
  assert.equal(hit?.match, 'exact');
  assert.equal(hit?.ref.quote, 'Pressure rises when the gas is heated.');
});

test('typographic and whitespace drift anchors to the verbatim source substring', () => {
  const hit = anchorQuote(doc, spanWith('piston'), "The engine's piston moves - then the valve opens");
  assert.equal(hit?.match, 'normalized');
  assert.equal(hit?.ref.quote, 'The engine’s piston moves — then  the valve opens');
  assert.equal(doc.text.slice(hit!.ref.startChar, hit!.ref.endChar), hit!.ref.quote);
});

test('a unique verbatim quote cited under the wrong span is relocated', () => {
  const hit = anchorQuote(doc, spanWith('piston'), 'Pressure rises when the gas is heated');
  assert.equal(hit?.match, 'relocated');
  assert.equal(hit?.ref.spanId, spanWith('Pressure'));
});

test('ambiguous relocation is rejected', () => {
  assert.equal(anchorQuote(doc, spanWith('Pressure'), 'The valve opens.'), undefined);
});

test('short quotes are never relocated', () => {
  assert.equal(anchorQuote(doc, spanWith('Pressure'), 'the valve'), undefined);
});

test('paraphrase is never anchored', () => {
  assert.equal(anchorQuote(doc, spanWith('Pressure'), 'Heating the gas raises the pressure.'), undefined);
});

test('normalization map points back to original offsets', () => {
  const { normalized, map } = normalizeForAnchor('a’  b');
  assert.equal(normalized, "a' b");
  assert.deepEqual(map, [0, 1, 2, 4]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run build && node --test dist/src/experimental/hypothesis/v1_claude/__tests__/evidence-anchor.test.js`
Expected: FAIL with `Cannot find module '../plan/evidenceAnchor.js'` (compile error).

- [ ] **Step 3: Implement `plan/evidenceAnchor.ts`**

```ts
import { resolveSourceEvidence, type SourceDoc, type SourceEvidenceRef } from './sourceDoc.js';

/**
 * Deterministic evidence anchoring. A model quote is mapped back to the exact
 * source substring when it differs only by typography (quotes, dashes,
 * ellipsis, non-breaking space), whitespace runs, or leading/trailing
 * punctuation, or when an identical quote is cited under the wrong span and
 * occurs in exactly one other span. The stored quote is always the verbatim
 * source text. No fuzzy, semantic, or paraphrase matching exists here.
 */
export type AnchorMatch = 'exact' | 'normalized' | 'relocated';
export interface AnchoredEvidence { ref: SourceEvidenceRef; match: AnchorMatch }
export const MIN_RELOCATION_CHARS = 12;

const CHAR_MAP: Record<string, string> = {
  '‘': "'", '’': "'", '‚': "'", '‛': "'", '′': "'",
  '“': '"', '”': '"', '„': '"', '″': '"',
  '‐': '-', '‑': '-', '‒': '-', '–': '-', '—': '-', '−': '-',
  ' ': ' ', ' ': ' ', ' ': ' ',
};

/** Normalized text plus, for each normalized character, its index in the original text. */
export function normalizeForAnchor(text: string): { normalized: string; map: number[] } {
  let normalized = '';
  const map: number[] = [];
  let lastWasSpace = false;
  for (let i = 0; i < text.length; i++) {
    const raw = text[i];
    if (raw === '…') {
      for (const c of '...') { normalized += c; map.push(i); }
      lastWasSpace = false;
      continue;
    }
    const c = CHAR_MAP[raw] ?? raw;
    if (/\s/.test(c)) {
      if (lastWasSpace) continue;
      normalized += ' '; map.push(i); lastWasSpace = true;
      continue;
    }
    normalized += c; map.push(i); lastWasSpace = false;
  }
  return { normalized, map };
}

const trimQuote = (quote: string): string => quote.replace(/^[\s"'.,;:!?]+|[\s"'.,;:!?]+$/g, '');

function findNormalized(spanText: string, quote: string): { start: number; end: number } | undefined {
  const needle = normalizeForAnchor(trimQuote(quote)).normalized;
  if (!needle) return undefined;
  const { normalized, map } = normalizeForAnchor(spanText);
  const at = normalized.indexOf(needle);
  if (at < 0 || normalized.indexOf(needle, at + 1) >= 0) return undefined;
  return { start: map[at], end: map[at + needle.length - 1] + 1 };
}

export function anchorQuote(doc: SourceDoc, spanId: string, quote: string): AnchoredEvidence | undefined {
  const exact = resolveSourceEvidence(doc, spanId, quote);
  if (exact) return { ref: exact, match: 'exact' };
  const span = doc.spans.find((candidate) => candidate.id === spanId);
  if (span) {
    const hit = findNormalized(span.text, quote);
    if (hit) {
      const ref = resolveSourceEvidence(doc, spanId, span.text.slice(hit.start, hit.end));
      if (ref) return { ref, match: 'normalized' };
    }
  }
  if (trimQuote(quote).length < MIN_RELOCATION_CHARS) return undefined;
  const matches = doc.spans.filter((candidate) => candidate.id !== spanId && findNormalized(candidate.text, quote));
  if (matches.length !== 1) return undefined;
  const target = matches[0];
  const hit = findNormalized(target.text, quote)!;
  const ref = resolveSourceEvidence(doc, target.id, target.text.slice(hit.start, hit.end));
  return ref ? { ref, match: 'relocated' } : undefined;
}
```

Relocation requires one candidate span with one match. The span named by the model is excluded because it already failed.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run build && node --test dist/src/experimental/hypothesis/v1_claude/__tests__/evidence-anchor.test.js`
Expected: PASS (7 tests). If `sourceDocFromText` splits the fixture into spans differently than the test assumes (for example, the two `The valve opens.` paragraphs merge), change only the fixture text inside this new test file so that each paragraph becomes its own span. Do not change `sourceDoc.ts`.

- [ ] **Step 5: Wire anchoring into `buildConceptGraph`**

In `plan/stages.ts`, add `import { anchorQuote, type AnchorMatch } from './evidenceAnchor.js';`.

In `checkEvidence`, replace:
```ts
        for (const ref of evidence) if (!resolveSourceEvidence(sourceDoc, ref.spanId, ref.quote)) problems.push(`${owner} evidence quote is absent from source span ${ref.spanId}`);
```
with:
```ts
        for (const ref of evidence) if (!anchorQuote(sourceDoc, ref.spanId, ref.quote)) problems.push(`${owner} evidence quote is absent from source span ${ref.spanId}; copy the words exactly as they appear in that span`);
```

Replace the `enrich` line with:
```ts
  const anchorCounts: Record<AnchorMatch, number> = { exact: 0, normalized: 0, relocated: 0 };
  const enrich = (refs: Array<{ spanId: string; quote: string }>) => refs.map((ref) => {
    const anchored = anchorQuote(sourceDoc, ref.spanId, ref.quote)!;
    anchorCounts[anchored.match] += 1;
    return anchored.ref;
  });
```

After the `value` object is built and before `return`, record the counts as a soft, non-blocking note:
```ts
  const enriched = {
    concepts: result.value.concepts.map(({ evidence, ...c }) => ({ ...c, evidence: enrich(evidence) })),
    relations: result.value.relations.map(({ evidence, ...r }) => ({ ...r, evidence: enrich(evidence) })),
    prerequisites: result.value.prerequisites,
  };
  const failures = anchorCounts.normalized + anchorCounts.relocated > 0
    ? [...result.failures, { code: 'concepts-evidence-anchored', stage: 'concepts', message: `evidence anchored to verbatim source: ${anchorCounts.exact} exact, ${anchorCounts.normalized} normalized, ${anchorCounts.relocated} relocated`, hard: false }]
    : result.failures;
  return { ...result, failures, value: enriched };
```

Remove the now-unused `.filter(Boolean)` path. Keep the `resolveSourceEvidence` import only if it is still used in `stages.ts`.

- [ ] **Step 6: Bump the S2 cache version**

In `pipeline/lesson.ts`, change the S2 `runCached` stage-version argument `'S2-concept-graph-v1'` to `'S2-concept-graph-v2-anchored-evidence'`.

- [ ] **Step 7: Run the full offline gate**

Run: `npm run typecheck:hypothesis && npm run test:hypothesis`
Expected: all green. `source-lesson-preparation.test.ts` must pass unmodified.

- [ ] **Step 8: Checkpoint** — HANDOFF entry "Task 2": the rule (verbatim-only, uniqueness, 12-char relocation floor), tests, version bump.

---

### Task 3: Prompt builder and schema-keyword guard

**Why:** S6 assembles its system prompt as a single template string, so sections cannot be hashed, reordered, or measured. The `mirror-images` failure showed a model emitting `type`, `required`, and `relations` as concept IDs, because the JSON-Schema field names leaked into the data. A builder gives each section a stable ID and hash. The guard turns keyword leakage into a precise repair message.

**Files:**
- Create: `src/experimental/hypothesis/v1_claude/prompt/builder.ts`
- Modify: `src/experimental/hypothesis/v1_claude/planner/prompt.ts` (`buildSystemPrompt`)
- Modify: `src/experimental/hypothesis/v1_claude/plan/stages.ts` (S2 and S3 `validate`)
- Modify: `src/experimental/hypothesis/v1_claude/pipeline/lesson.ts` (S2/S3 stage versions)
- Test: `src/experimental/hypothesis/v1_claude/__tests__/prompt-builder.test.ts`

**Interfaces:**
- Produces:
  - `export interface PromptSection { id: string; title?: string; body: string }`
  - `export interface BuiltPrompt { text: string; sha256: string; sections: Array<{ id: string; sha256: string; chars: number }> }`
  - `export function buildPrompt(sections: PromptSection[], preamble?: string): BuiltPrompt`
  - `export const SCHEMA_KEYWORDS: readonly string[]`
  - `export function schemaKeywordLeaks(ids: string[]): string[]`
  - `export function buildSystemPromptSections(planningContext?: ScenePlanningContext): { preamble: string; sections: PromptSection[] }` in `planner/prompt.ts`

- [ ] **Step 1: Record the current S6 system prompt hash (before any change)**

Run:
```bash
npm run build && node -e "import('./dist/src/experimental/hypothesis/v1_claude/planner/prompt.js').then(async (m) => { const { createHash } = await import('node:crypto'); console.log(createHash('sha256').update(m.buildSystemPrompt()).digest('hex')); })"
```
Expected: one 64-hex-character line. Copy it into the test below as `V12_ZERO_SHOT_SYSTEM_SHA256`.

- [ ] **Step 2: Write the failing tests**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildPrompt, schemaKeywordLeaks } from '../prompt/builder.js';
import { buildSystemPrompt } from '../planner/prompt.js';

// Recorded in Task 3 Step 1 from the unmodified v12 prompt.
const V12_ZERO_SHOT_SYSTEM_SHA256 = '<the 64-hex value printed by Task 3 Step 1>';

test('buildPrompt joins sections deterministically with titles and per-section hashes', () => {
  const built = buildPrompt([{ id: 'a', title: 'Alpha', body: 'one' }, { id: 'b', body: 'two' }], 'intro');
  assert.equal(built.text, 'intro\n\n## Alpha\none\n\ntwo');
  assert.equal(built.sections.length, 2);
  assert.equal(built.sections[0].sha256, createHash('sha256').update('## Alpha\none').digest('hex'));
  assert.equal(built.sha256, createHash('sha256').update(built.text).digest('hex'));
});

test('buildPrompt rejects duplicate ids and empty bodies', () => {
  assert.throws(() => buildPrompt([{ id: 'a', body: 'x' }, { id: 'a', body: 'y' }]), /duplicate prompt section id a/);
  assert.throws(() => buildPrompt([{ id: 'a', body: '  ' }]), /empty prompt section a/);
});

test('schemaKeywordLeaks finds JSON-Schema keywords used as ids', () => {
  assert.deepEqual(schemaKeywordLeaks(['heat', 'type', 'required', 'relations', 'pressure']), ['type', 'required', 'relations']);
  assert.deepEqual(schemaKeywordLeaks(['heat_type', 'required_input']), []);
});

test('S6 v12 zero-shot system prompt is byte-identical after the builder refactor', () => {
  assert.equal(createHash('sha256').update(buildSystemPrompt()).digest('hex'), V12_ZERO_SHOT_SYSTEM_SHA256);
});
```

Before running, replace the placeholder string with the literal hash from Step 1. This is the only value in the plan that comes from running a command.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm run build && node --test dist/src/experimental/hypothesis/v1_claude/__tests__/prompt-builder.test.js`
Expected: FAIL with `Cannot find module '../prompt/builder.js'`.

- [ ] **Step 4: Implement `prompt/builder.ts`**

```ts
import { sha256 } from '../../shared/artifacts.js';

/**
 * Deterministic prompt assembly. Sections render in the given order as
 * "## title\nbody" (or body alone), joined by one blank line. Each section and
 * the whole prompt get a SHA-256, so prompt experiments can report which
 * section changed. No model writes prompt text.
 */
export interface PromptSection { id: string; title?: string; body: string }
export interface BuiltPrompt { text: string; sha256: string; sections: Array<{ id: string; sha256: string; chars: number }> }

export function buildPrompt(sections: PromptSection[], preamble?: string): BuiltPrompt {
  const seen = new Set<string>();
  const rendered = sections.map((section) => {
    if (seen.has(section.id)) throw new Error(`duplicate prompt section id ${section.id}`);
    seen.add(section.id);
    if (!section.body.trim()) throw new Error(`empty prompt section ${section.id}`);
    const text = section.title ? `## ${section.title}\n${section.body}` : section.body;
    return { id: section.id, text };
  });
  const text = [...(preamble ? [preamble] : []), ...rendered.map((r) => r.text)].join('\n\n');
  return { text, sha256: sha256(text), sections: rendered.map((r) => ({ id: r.id, sha256: sha256(r.text), chars: r.text.length })) };
}

/** JSON-Schema vocabulary plus top-level container names that must never appear as data ids. */
export const SCHEMA_KEYWORDS = ['type', 'required', 'properties', 'items', 'enum', 'anyof', 'oneof', 'allof', 'additionalproperties', '$schema', 'description', 'concepts', 'relations', 'prerequisites', 'sections', 'schema'] as const;

export function schemaKeywordLeaks(ids: string[]): string[] {
  const keywords = new Set<string>(SCHEMA_KEYWORDS);
  return ids.filter((id) => keywords.has(id.trim().toLowerCase()));
}
```

`sha256` in `shared/artifacts.ts` hashes a UTF-8 string and returns hex. Confirm this by reading its definition. If its signature differs, use `createHash('sha256').update(text).digest('hex')` from `node:crypto` instead. Do not modify `shared/`.

- [ ] **Step 5: Refactor `buildSystemPrompt` onto the builder (v12 output unchanged)**

In `planner/prompt.ts`, split the existing template literal into a preamble and sections with the **same text**:

- `preamble` = the first paragraph, `You are the Scene Planner ... only the structure below.`
- `{ id: 'skill', title: 'Visual-director skill', body: SCENE_DIRECTOR_SKILL }`
- `{ id: 'style', title: 'What good scenes look like (reference style)', body: <the five "- " lines> }`
- `{ id: 'contract', title: 'Output contract', body: <the output-contract line, blank line, and the "Each element MUST include..." paragraph> }`
- `{ id: 'rules', title: 'Hard rules (violations are rejected)', body: <the rule lines> }`
- `{ id: 'templates', title: 'Templates and slots (set each element\'s "slot" to one of these)', body: templateSlotLines() }`
- `{ id: 'primitives', title: 'Primitives (every element has required fields id, prim, and anchor; common optional fields: slot, label, fill)', body: <the primitive lines> }`
- `{ id: 'examples', title: 'Few-shot demonstrations', body: <the examples paragraph and the <examples> block, then a blank line, then "Respond with ONLY the SceneSpec JSON object."> }`

Export `buildSystemPromptSections(planningContext?)`, which returns `{ preamble, sections }`. `buildSystemPrompt(planningContext?)` becomes `return buildPrompt(sections, preamble).text;`.

The `## ` headings and blank lines in the original string must fall exactly where `buildPrompt` adds them. The byte-identity test proves it. If the test fails, compare the two strings and move characters between section bodies until the hashes match. Never change the recorded hash.

- [ ] **Step 6: Add the keyword guard to S2 and S3 validation**

In `plan/stages.ts`, add `import { schemaKeywordLeaks } from '../prompt/builder.js';`.

In the S2 `validate`, after the uniqueness checks, add:
```ts
      const leaked = schemaKeywordLeaks(g.concepts.map((c) => c.id));
      if (leaked.length) problems.push(`concept ids ${leaked.map((id) => `"${id}"`).join(', ')} are JSON field names, not source concepts; give each concept a snake_case id derived from its own label`);
```

In the S3 `validate`, before `return problems;`, add:
```ts
      const leakedIds = schemaKeywordLeaks(p.sections.flatMap((s) => [...s.conceptIds, ...(s.contract?.requiredConceptIds ?? [])]));
      if (leakedIds.length) problems.push(`section concept ids ${[...new Set(leakedIds)].map((id) => `"${id}"`).join(', ')} are JSON field names; use only ids from VALID CONCEPT IDS`);
```

Add S2/S3 tests to `prompt-builder.test.ts`. They drive `buildConceptGraph` through a stub `fetcher` whose first response uses concept id `type` and whose repair response is valid. Assert `usage.repairs === 1` and that the repair prompt (captured from the second request body `messages[1].content`) contains `are JSON field names`. Use the same `okBody` response shape as Task 1. The concept evidence quote must be copied verbatim from the stub SourceDoc made with `sourceDocFromText`.

- [ ] **Step 7: Bump S2/S3 cache versions**

In `pipeline/lesson.ts`: change `'S2-concept-graph-v2-anchored-evidence'` to `'S2-concept-graph-v3-keyword-guard'`, and change `'S3-teaching-plan-v3-explicit-concepts'` to `'S3-teaching-plan-v4-keyword-guard'`. Leave `'S3-teaching-plan-prompt-v4'` unchanged, because the prompt text did not change.

- [ ] **Step 8: Run tests and the full offline gate**

Run: `npm run build && node --test dist/src/experimental/hypothesis/v1_claude/__tests__/prompt-builder.test.js && npm run typecheck:hypothesis && npm run test:hypothesis`
Expected: all green.

- [ ] **Step 9: Checkpoint** — HANDOFF entry "Task 3".

---

### Task 4: S6 prompt v13 with visual recipe cards

**Why:** The S6 prompt lists slot names but does not say what each template teaches, which primitive suits which slot, or how icons and arrows carry a mechanism. Recipe cards are generic composition guidance. They contain no topic words.

**Files:**
- Create: `src/experimental/hypothesis/v1_claude/planner/recipes.ts`
- Modify: `src/experimental/hypothesis/v1_claude/planner/prompt.ts` (add a `recipes` section after `templates`; enrich candidate lines)
- Modify: `src/experimental/hypothesis/v1_claude/planner/context.ts` (`SCENE_PROMPT_VERSION`, `versions.recipes`)
- Test: `src/experimental/hypothesis/v1_claude/__tests__/scene-recipes.test.ts`

**Interfaces:**
- Consumes: `buildPrompt`, `PromptSection` (Task 3); `TEMPLATE_SLOTS` (`planner/prompt.ts`).
- Produces: `export const RECIPE_VERSION = 'visual-recipes/v1'`, `export const RECIPE_CARDS: Record<TemplateId, { useWhen: string; build: string; avoid: string }>`, `export function recipeSectionBody(): string`, and `SCENE_PROMPT_VERSION = 'scene-planner-prompt-v13'`.

- [ ] **Step 1: Write the failing tests**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { RECIPE_CARDS, RECIPE_VERSION, recipeSectionBody } from '../planner/recipes.js';
import { TEMPLATE_SLOTS, buildSystemPrompt } from '../planner/prompt.js';
import { SCENE_PROMPT_VERSION } from '../planner/context.js';

// Words from G-10 golden topics and the five calibration sources. Recipe text must stay topic-neutral.
const TOPIC_WORDS = /\b(attention|query|keys?|request|zero[- ]trust|gradient|induction|photosynthe\w*|leaf|immune|catalyst|inflation|bill|law|tides?|ocean|moon|bicycle|compost\w*|rainbow|prism|mirror)\b/i;

test('every template has a recipe card', () => {
  assert.deepEqual(Object.keys(RECIPE_CARDS).sort(), Object.keys(TEMPLATE_SLOTS).sort());
});

test('recipe cards are topic-neutral', () => {
  for (const [template, card] of Object.entries(RECIPE_CARDS)) {
    assert.doesNotMatch(`${card.useWhen} ${card.build} ${card.avoid}`, TOPIC_WORDS, template);
  }
});

test('v13 system prompt contains the recipe section and version', () => {
  const prompt = buildSystemPrompt();
  assert.ok(prompt.includes('## Visual recipes'));
  assert.ok(prompt.includes(recipeSectionBody()));
  assert.equal(SCENE_PROMPT_VERSION, 'scene-planner-prompt-v13');
  assert.equal(RECIPE_VERSION, 'visual-recipes/v1');
});
```

Add one more test to this file: **`prompt v13 changes the planning context hash`**. Build the same `ScenePlanningContext` inputs used in `__tests__/scene-context.test.ts` (import its fixture builders if they are exported; otherwise copy its synthetic contract, bible, and input into this test file). Assert that `context.versions.prompt === 'scene-planner-prompt-v13'`, that `context.versions.recipes === 'visual-recipes/v1'`, and that `context.contextHash` differs from a hash computed with `versions.prompt` replaced by `'scene-planner-prompt-v12'` (recompute with `sha256(stableJson(payload))` exactly as `compileScenePlanningContext` does).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run build && node --test dist/src/experimental/hypothesis/v1_claude/__tests__/scene-recipes.test.js`
Expected: FAIL with `Cannot find module '../planner/recipes.js'`.

- [ ] **Step 3: Implement `planner/recipes.ts`**

```ts
import type { TemplateId } from '../types.js';

/** Topic-neutral composition guidance per template. Content always comes from the target scene's evidence. */
export const RECIPE_VERSION = 'visual-recipes/v1';

export const RECIPE_CARDS: Record<TemplateId, { useWhen: string; build: string; avoid: string }> = {
  title_card: { useWhen: 'the scene opens a lesson or names one central claim', build: 'one short title text, one subtitle stating the claim, an optional tokenStrip previewing up to 4 steps', avoid: 'more than 3 elements; arrows' },
  hub_spoke: { useWhen: 'one thing connects to or is made of several parts', build: 'the central thing as an object icon or box in hub; each part as a pill, box, or icon in spoke; one edge per spoke-hub link in the direction the narration states', avoid: 'spokes that are not linked to the hub' },
  chain: { useWhen: 'a process runs through ordered stages', build: 'one node per stage, left to right; concrete stages as object icons with labels, abstract stages as boxes; an edge between consecutive nodes, labelled with the action when the narration names it', avoid: 'more than 5 nodes; unconnected nodes' },
  convergence: { useWhen: 'several inputs combine into one result', build: 'inputs in input, one operator whose symbol matches the combination, the result in output as a box, meter, or icon; edges from every input to the operator and from the operator to the output', avoid: 'an operator symbol the narration does not justify' },
  fan_out: { useWhen: 'one source spreads to several targets', build: 'the source in source, targets in target, one edge from the source to each target', avoid: 'edges between targets' },
  list_icon: { useWhen: 'the narration itself lists parallel items with no mechanism between them', build: '2-5 items, each an object icon with a label or a box', avoid: 'using it when the narration describes cause, order, or combination; choose chain, convergence, or cycle then' },
  compare_2: { useWhen: 'two alternatives differ on a stated property', build: 'left and right as matching icons or boxes; verdict as a meter or box naming the deciding property', avoid: 'unequal visual weight between the two sides' },
  threshold: { useWhen: 'a quantity crosses a limit and a state changes', build: 'subject as icon or box, bar as a meter with the limit labelled, marker as the resulting state with a badge when useful; an edge from bar to marker', avoid: 'a meter value that the source does not support; mark invented values illustrative-example' },
  weighted_blend: { useWhen: 'contributions of different size make a total', build: 'inputs, a weight text beside each input, a combiner operator, one result; edges from inputs to the combiner and from the combiner to the result', avoid: 'weights without inputs' },
  layered_stack: { useWhen: 'layers sit on top of each other or pass something down', build: 'one layer element per level, top to bottom; edges only between adjacent layers', avoid: 'more than 5 layers' },
  cycle: { useWhen: 'stages repeat and return to the start', build: '3-6 nodes; edges node to node and last back to first, in the narrated order', avoid: 'a missing closing edge' },
  formula_focus: { useWhen: 'the scene explains an equation', build: 'formula with parts so each term appears when named; callouts as short text anchored to the term they explain', avoid: 'a single unexplained latex block when the narration walks through terms' },
  plot_focus: { useWhen: 'a quantity changes over another quantity', build: 'one plot with axis labels; tangentAt, trajectory, or riseRun only when the narration describes slope, steps, or rise over run; callouts anchored after the curve', avoid: 'plot markers outside the domain' },
};

export function recipeSectionBody(): string {
  return (Object.entries(RECIPE_CARDS) as Array<[TemplateId, { useWhen: string; build: string; avoid: string }]>)
    .map(([template, card]) => `- ${template}: use when ${card.useWhen}. Build: ${card.build}. Avoid: ${card.avoid}.`)
    .join('\n') + '\nIcons: when a mention has icon candidates and one literally depicts the concrete thing, prefer that object icon with a short label. A scene with only boxes is acceptable only when nothing concrete is named.';
}
```

- [ ] **Step 4: Add the section, enrich candidates, bump the version**

In `planner/prompt.ts`:
- Import `recipeSectionBody` from `./recipes.js`.
- Insert `{ id: 'recipes', title: 'Visual recipes', body: recipeSectionBody() }` directly after the `templates` section.
- In `buildUserPrompt`, keep the top-5 candidate list per mention, but add an explicit line under the mention list when any candidate exists: `Icon rule: use an object icon only when its name literally depicts the mention; otherwise use a box, pill, or text.`

In `planner/context.ts`:
- `export const SCENE_PROMPT_VERSION = 'scene-planner-prompt-v13';`
- Import `RECIPE_VERSION` from `./recipes.js` and add `recipes: RECIPE_VERSION` to the `versions` object type and value.

The Task 3 byte-identity test compares against the v12 hash, so it now fails by design. Replace that single test's name and assertion with this, and keep the recorded v12 hash in the file:

```ts
test('v13 differs from the recorded v12 prompt only by the added recipe section', () => {
  const v13 = buildSystemPrompt();
  const withoutRecipes = v13.replace(`\n\n## Visual recipes\n${recipeSectionBody()}`, '');
  assert.equal(createHash('sha256').update(withoutRecipes).digest('hex'), V12_ZERO_SHOT_SYSTEM_SHA256);
});
```

This is the one permitted edit to a test written earlier **in this plan**. Tests that existed before this plan stay untouched.

- [ ] **Step 5: Run tests and the full offline gate**

Run: `npm run build && node --test dist/src/experimental/hypothesis/v1_claude/__tests__/scene-recipes.test.js dist/src/experimental/hypothesis/v1_claude/__tests__/prompt-builder.test.js && npm run typecheck:hypothesis && npm run test:hypothesis`
Expected: all green. If an existing test asserts `scene-planner-prompt-v12`, report it to the user as a required amendment. Do not edit that test on your own.

- [ ] **Step 6: Checkpoint** — HANDOFF entry "Task 4".

---

### Task 5: Few-shot exemplar bank v2 (template-complete, icon-rich)

**Why:** Bank v1 has 5 exemplars, and every one uses only boxes. The planner has never seen an object icon, plot, formula, cycle, hub, fan-out, list, stack, or title demonstration. Bank v2 keeps v1 unchanged and adds 10 structural demonstrations. Together they cover all 13 templates. Every object concept is an exact Streamline catalog name, so the ladder resolves it at rung 2 with no embedding dependency. Domains are disjoint from G-10 and the five calibration sources. All entries stay `experimental` with `pending` reviews. Nothing is promoted.

**Files:**
- Create: `src/experimental/hypothesis/v1_claude/fewshots/exampleBank.v2.ts`
- Modify: `src/experimental/hypothesis/v1_claude/planner/exemplars.ts` (import source and `EXAMPLE_BANK_VERSION`)
- Test: `src/experimental/hypothesis/v1_claude/__tests__/exemplar-bank-v2.test.ts`

**Interfaces:**
- Consumes: `SceneExemplar` type (`planner/exemplars.ts`), `loadStreamlineCatalog()` (`catalog/streamline.ts`), `resolveObject` (`catalog/ladder.ts`).
- Produces: `export const SCENE_EXEMPLARS: readonly SceneExemplar[]` from `exampleBank.v2.ts`; `EXAMPLE_BANK_VERSION = 'mechanism-bank/v4'`.

- [ ] **Step 1: Write the failing tests**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { SCENE_EXEMPLARS, EXAMPLE_BANK_VERSION } from '../planner/exemplars.js';
import { TEMPLATE_SLOTS } from '../planner/prompt.js';
import { loadStreamlineCatalog } from '../catalog/streamline.js';
import { resolveObject } from '../catalog/ladder.js';

const TOPIC_WORDS = /\b(attention|query|keys?|request|zero[- ]trust|gradient|induction|photosynthe\w*|leaf|immune|catalyst|inflation|bill|law|tides?|ocean|moon|bicycle|bike|compost\w*|rainbow|prism|mirror)\b/i;

test('bank v4 covers every template', () => {
  assert.equal(EXAMPLE_BANK_VERSION, 'mechanism-bank/v4');
  const covered = new Set(SCENE_EXEMPLARS.map((e) => e.sceneSpec.template));
  for (const template of Object.keys(TEMPLATE_SLOTS)) assert.ok(covered.has(template as never), `missing template ${template}`);
});

test('bank v4 contains icon, plot, and formula demonstrations', () => {
  const prims = new Set(SCENE_EXEMPLARS.flatMap((e) => e.sceneSpec.elements.map((el) => el.prim)));
  for (const prim of ['object', 'plot', 'formula', 'meter', 'tokenStrip', 'operator']) assert.ok(prims.has(prim as never), prim);
});

test('every object exemplar concept is an exact catalog name and resolves at rung 2', () => {
  const names = new Set(loadStreamlineCatalog().entries.flatMap((e) => e.names.map((n) => n.toLowerCase())));
  for (const exemplar of SCENE_EXEMPLARS) for (const el of exemplar.sceneSpec.elements) {
    if (el.prim !== 'object') continue;
    assert.ok(names.has(el.concept.toLowerCase()), `${exemplar.id}: ${el.concept}`);
    assert.equal(resolveObject(el.concept, { size: { w: 200, h: 260 } }).resolution.rung, 2, `${exemplar.id}: ${el.concept}`);
  }
});

test('bank v4 text is disjoint from golden and calibration topics', () => {
  for (const exemplar of SCENE_EXEMPLARS) assert.doesNotMatch(JSON.stringify(exemplar.sceneSpec) + exemplar.inputIntent.learningDelta, TOPIC_WORDS, exemplar.id);
});

test('no bank v4 entry is promoted', () => {
  for (const exemplar of SCENE_EXEMPLARS) {
    assert.equal(exemplar.reviewStatus, 'experimental', exemplar.id);
    assert.ok(Object.values(exemplar.review).every((v) => v === 'pending' || v === undefined), exemplar.id);
  }
});
```

Schema and structural validity are already enforced when `planner/exemplars.ts` loads: it throws on any invalid exemplar, so every test in this file fails if one entry is malformed.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run build && node --test dist/src/experimental/hypothesis/v1_claude/__tests__/exemplar-bank-v2.test.js`
Expected: FAIL with `bank v4 covers every template` (version is still `mechanism-bank/v3`).

- [ ] **Step 3: Create `fewshots/exampleBank.v2.ts`**

```ts
import type { SceneExemplar } from '../planner/exemplars.js';
import { SCENE_EXEMPLARS as BANK_V1 } from './exampleBank.v1.js';

/** v1 entries unchanged, plus template-complete, icon-rich structural demonstrations. Not lesson answers. */
const O = 'illustrative-example' as const;
const base = {
  sourceClass: 'hand-authored-example' as const, reviewStatus: 'experimental' as const, qualityScore: 0,
  provenance: { source: 'exampleBank.v2.ts', authoring: 'repository-authored structural demonstration', thirdPartyAssets: false, evaluationSplit: 'none' as const },
  review: { factuality: 'pending' as const, visual: 'pending' as const, license: 'pending' as const, leakage: 'pending' as const, human: 'pending' as const },
};

const BANK_V2_ADDITIONS: SceneExemplar[] = [
  { ...base, id: 'title-library-01', domain: 'libraries', teachingSkill: 'definition', visualMechanism: 'focus', complexity: 1,
    requiredCapabilities: ['text', 'tokenStrip'], inputIntent: { learningDelta: 'Introduce how a lending library moves one volume between readers' }, designRationale: ['one headline claim', 'a strip previews the steps'],
    sceneSpec: { schemaVersion: 'claude-scene-spec/v1', sceneId: 'title_library_example', title: 'How A Library Lends', template: 'title_card', elements: [
      { id: 'headline', prim: 'text', slot: 'title', anchor: 'sceneStart', text: 'ONE VOLUME, MANY READERS', size: 'title', origin: O },
      { id: 'sub', prim: 'text', slot: 'subtitle', anchor: 'mention:loan', text: 'A LOAN IS A PROMISE TO RETURN', size: 'body', origin: O },
      { id: 'steps', prim: 'tokenStrip', slot: 'strip', anchor: 'mention:steps', tokens: ['FIND', 'BORROW', 'RETURN'], highlight: [1], origin: O },
    ], edges: [] } },
  { ...base, id: 'hub-rocket-01', domain: 'aerospace', teachingSkill: 'mechanism', visualMechanism: 'fan_out', complexity: 2,
    requiredCapabilities: ['object', 'pill'], inputIntent: { learningDelta: 'Show the parts that must work together to launch a vehicle' }, designRationale: ['the whole sits in the centre', 'each part points into the whole'],
    sceneSpec: { schemaVersion: 'claude-scene-spec/v1', sceneId: 'hub_rocket_example', title: 'Three Parts Lift A Rocket', template: 'hub_spoke', elements: [
      { id: 'vehicle', prim: 'object', slot: 'hub', anchor: 'mention:vehicle', concept: 'rocket', label: 'ROCKET', fill: 'orange', origin: O },
      { id: 'fuel', prim: 'pill', slot: 'spoke', anchor: 'mention:fuel', text: 'FUEL', origin: O },
      { id: 'thrust', prim: 'pill', slot: 'spoke', anchor: 'mention:thrust', text: 'THRUST', origin: O },
      { id: 'steering', prim: 'pill', slot: 'spoke', anchor: 'mention:steering', text: 'STEERING', origin: O },
    ], edges: [{ from: 'fuel', to: 'vehicle', origin: O }, { from: 'thrust', to: 'vehicle', origin: O }, { from: 'steering', to: 'vehicle', origin: O }] } },
  { ...base, id: 'chain-delivery-02', domain: 'logistics', teachingSkill: 'process', visualMechanism: 'chain', complexity: 2,
    requiredCapabilities: ['object'], inputIntent: { learningDelta: 'Follow goods from where they are made to where they are sold' }, designRationale: ['concrete stages drawn as labelled icons', 'labelled arrows name each action'],
    sceneSpec: { schemaVersion: 'claude-scene-spec/v1', sceneId: 'chain_delivery_example', title: 'From Maker To Shelf', template: 'chain', elements: [
      { id: 'maker', prim: 'object', slot: 'node', anchor: 'mention:maker', concept: 'factory plant', label: 'FACTORY', fill: 'grey', origin: O },
      { id: 'carrier', prim: 'object', slot: 'node', anchor: 'mention:carrier', concept: 'shipping truck', label: 'TRUCK', fill: 'blue', origin: O },
      { id: 'seller', prim: 'object', slot: 'node', anchor: 'mention:seller', concept: 'store', label: 'STORE', fill: 'yellow', origin: O },
    ], edges: [{ from: 'maker', to: 'carrier', label: 'LOADS', origin: O }, { from: 'carrier', to: 'seller', label: 'DELIVERS', origin: O }] } },
  { ...base, id: 'converge-kitchen-01', domain: 'cooking', teachingSkill: 'mechanism', visualMechanism: 'convergence', complexity: 3,
    requiredCapabilities: ['object', 'operator', 'meter'], inputIntent: { learningDelta: 'Show two conditions combining to decide when food is ready' }, designRationale: ['concrete inputs as icons', 'the result is a quantity, drawn as a meter'],
    sceneSpec: { schemaVersion: 'claude-scene-spec/v1', sceneId: 'converge_kitchen_example', title: 'Heat And Time Cook Food', template: 'convergence', elements: [
      { id: 'heat', prim: 'object', slot: 'input', anchor: 'mention:heat', concept: 'thermometer', label: 'HEAT', fill: 'red', origin: O },
      { id: 'time', prim: 'object', slot: 'input', anchor: 'mention:time', concept: 'hourglass', label: 'TIME', fill: 'yellow', origin: O },
      { id: 'combine', prim: 'operator', slot: 'operator', anchor: 'after:time', symbol: '×', origin: O },
      { id: 'ready', prim: 'meter', slot: 'output', anchor: 'after:combine', values: [0.8], labels: ['DONENESS'], origin: O },
    ], edges: [{ from: 'heat', to: 'combine', origin: O }, { from: 'time', to: 'combine', origin: O }, { from: 'combine', to: 'ready', origin: O }] } },
  { ...base, id: 'fanout-newsletter-01', domain: 'communication', teachingSkill: 'mechanism', visualMechanism: 'fan_out', complexity: 2,
    requiredCapabilities: ['object', 'box'], inputIntent: { learningDelta: 'Show one message reaching many readers at once' }, designRationale: ['one source on the left', 'identical targets show a copy each'],
    sceneSpec: { schemaVersion: 'claude-scene-spec/v1', sceneId: 'fanout_newsletter_example', title: 'One Send, Many Inboxes', template: 'fan_out', elements: [
      { id: 'send', prim: 'object', slot: 'source', anchor: 'mention:send', concept: 'mail send', label: 'NEWSLETTER', fill: 'blue', origin: O },
      { id: 'r1', prim: 'box', slot: 'target', anchor: 'mention:readers', text: 'READER A', origin: O },
      { id: 'r2', prim: 'box', slot: 'target', anchor: 'after:r1', text: 'READER B', origin: O },
      { id: 'r3', prim: 'box', slot: 'target', anchor: 'after:r2', text: 'READER C', origin: O },
    ], edges: [{ from: 'send', to: 'r1', origin: O }, { from: 'send', to: 'r2', origin: O }, { from: 'send', to: 'r3', origin: O }] } },
  { ...base, id: 'list-homesafety-01', domain: 'home safety', teachingSkill: 'application', visualMechanism: 'focus', complexity: 1,
    requiredCapabilities: ['object'], inputIntent: { learningDelta: 'List three independent habits that keep a home safe' }, designRationale: ['parallel items only because the narration lists them', 'each habit has its own icon'],
    sceneSpec: { schemaVersion: 'claude-scene-spec/v1', sceneId: 'list_homesafety_example', title: 'Three Safe Habits', template: 'list_icon', elements: [
      { id: 'guard', prim: 'object', slot: 'item', anchor: 'mention:guard', concept: 'shield', label: 'PROTECT', fill: 'green', origin: O },
      { id: 'locked', prim: 'object', slot: 'item', anchor: 'mention:locked', concept: 'key', label: 'LOCK UP', fill: 'yellow', origin: O },
      { id: 'alarm', prim: 'object', slot: 'item', anchor: 'mention:alarm', concept: 'bell', label: 'ALERT', fill: 'orange', origin: O },
    ], edges: [] } },
  { ...base, id: 'stack-storage-01', domain: 'computing', teachingSkill: 'process', visualMechanism: 'chain', complexity: 2,
    requiredCapabilities: ['box', 'object'], inputIntent: { learningDelta: 'Show a lookup passing down through storage layers until it finds data' }, designRationale: ['layers read top to bottom', 'arrows only between neighbours'],
    sceneSpec: { schemaVersion: 'claude-scene-spec/v1', sceneId: 'stack_storage_example', title: 'A Lookup Goes Down', template: 'layered_stack', elements: [
      { id: 'app', prim: 'box', slot: 'layer', anchor: 'mention:app', text: 'APP', fill: 'purple', origin: O },
      { id: 'fastcopy', prim: 'box', slot: 'layer', anchor: 'mention:fastcopy', text: 'FAST COPY', fill: 'blue', origin: O },
      { id: 'store', prim: 'object', slot: 'layer', anchor: 'mention:store', concept: 'database server', label: 'DATABASE', fill: 'grey', origin: O },
    ], edges: [{ from: 'app', to: 'fastcopy', label: 'ASKS', origin: O }, { from: 'fastcopy', to: 'store', label: 'MISSES', style: 'dashed', origin: O }] } },
  { ...base, id: 'cycle-battery-01', domain: 'electronics', teachingSkill: 'process', visualMechanism: 'cycle', complexity: 2,
    requiredCapabilities: ['object', 'box'], inputIntent: { learningDelta: 'Show a rechargeable cell repeating the same stages' }, designRationale: ['stages in a ring', 'the last arrow closes the loop'],
    sceneSpec: { schemaVersion: 'claude-scene-spec/v1', sceneId: 'cycle_battery_example', title: 'Charge, Use, Repeat', template: 'cycle', elements: [
      { id: 'charge', prim: 'object', slot: 'node', anchor: 'mention:charge', concept: 'battery charging', label: 'CHARGE', fill: 'green', origin: O },
      { id: 'hold', prim: 'box', slot: 'node', anchor: 'mention:hold', text: 'HOLD ENERGY', origin: O },
      { id: 'drain', prim: 'object', slot: 'node', anchor: 'mention:drain', concept: 'battery low', label: 'DRAIN', fill: 'red', origin: O },
    ], edges: [{ from: 'charge', to: 'hold', origin: O }, { from: 'hold', to: 'drain', origin: O }, { from: 'drain', to: 'charge', origin: O }] } },
  { ...base, id: 'formula-speed-01', domain: 'kinematics', teachingSkill: 'derivation', visualMechanism: 'equation', complexity: 3,
    requiredCapabilities: ['formula', 'text'], inputIntent: { learningDelta: 'Build the speed formula one term at a time' }, designRationale: ['each term appears when named', 'callouts explain the parts'],
    sceneSpec: { schemaVersion: 'claude-scene-spec/v1', sceneId: 'formula_speed_example', title: 'Speed Is A Ratio', template: 'formula_focus', elements: [
      { id: 'eq', prim: 'formula', slot: 'formula', anchor: 'mention:speed', parts: [{ tex: 'v', anchor: 'mention:speed' }, { tex: '=' }, { tex: '\\frac{d}{t}', anchor: 'mention:ratio' }], origin: O },
      { id: 'dist', prim: 'text', slot: 'callout', anchor: 'mention:distance', text: 'D: DISTANCE COVERED', size: 'note', origin: O },
      { id: 'dur', prim: 'text', slot: 'callout', anchor: 'mention:duration', text: 'T: TIME TAKEN', size: 'note', origin: O },
    ], edges: [] } },
  { ...base, id: 'plot-cooling-01', domain: 'thermal physics', teachingSkill: 'mechanism', visualMechanism: 'trajectory', complexity: 2,
    requiredCapabilities: ['plot', 'text'], inputIntent: { learningDelta: 'Show a hot drink cooling quickly at first and then slowly' }, designRationale: ['the curve carries the change', 'a tangent shows the early rate'],
    sceneSpec: { schemaVersion: 'claude-scene-spec/v1', sceneId: 'plot_cooling_example', title: 'Cooling Slows Down', template: 'plot_focus', elements: [
      { id: 'curve', prim: 'plot', slot: 'plot', anchor: 'mention:curve', fn: 'exp', params: [60, -0.3, 20], domain: [0, 10], markers: [{ x: 0, label: 'HOT' }, { x: 8, label: 'NEAR ROOM' }], tangentAt: 1, tangentAnchor: 'mention:rate', xLabel: 'TIME', yLabel: 'TEMPERATURE', origin: O },
      { id: 'note', prim: 'text', slot: 'callout', anchor: 'after:curve', text: 'FAST AT FIRST, THEN SLOW', size: 'note', origin: O },
    ], edges: [] } },
];

export const SCENE_EXEMPLARS: readonly SceneExemplar[] = [...BANK_V1, ...BANK_V2_ADDITIONS];
```

If `exemplars.ts` load-time validation rejects an entry (for example, a slot capacity, a label word count, or an `after:` anchor), fix **that entry's data** in `exampleBank.v2.ts` and keep its template and mechanism. Never change the validator. If a concept name fails the rung-2 test, replace it with an exact name from `node -e "console.log(require('./src/experimental/hypothesis/v1_claude/catalog/data/streamline.json').entries.map(e=>e.name).join('\n'))"` that literally depicts the same thing.

- [ ] **Step 4: Point the loader at v2 and bump the bank version**

In `planner/exemplars.ts`:
- Change both `import`/`export` lines that reference `'../fewshots/exampleBank.v1.js'` to `'../fewshots/exampleBank.v2.js'`.
- `export const EXAMPLE_BANK_VERSION = 'mechanism-bank/v4';`

- [ ] **Step 5: Run tests and the full offline gate**

Run: `npm run build && node --test dist/src/experimental/hypothesis/v1_claude/__tests__/exemplar-bank-v2.test.js && npm run typecheck:hypothesis && npm run test:hypothesis`
Expected: all green. Existing tests that count bank entries or assert `mechanism-bank/v3` must be reported to the user as required amendments. Do not edit them.

- [ ] **Step 6: Checkpoint** — HANDOFF entry "Task 5". Record that all 15 entries are `experimental`/`pending`, and that zero-shot is still the default arm.

---

### Task 6: Deterministic scene-richness metrics

**Why:** "Richer visuals" needs a number that a prompt change can move. This metric is structural and deterministic. It is a diagnostic only, never E1/E5 quality evidence.

**Files:**
- Create: `src/experimental/hypothesis/v1_claude/harness/sceneRichness.ts`
- Test: `src/experimental/hypothesis/v1_claude/__tests__/scene-richness.test.ts`

**Interfaces:**
- Consumes: `SceneSpec`, `ResolvedScene` (`types.ts`).
- Produces:
  - `export interface SceneRichness { sceneId: string; template: string; elementCount: number; primitiveKinds: string[]; objectCount: number; objectShare: number; edgeCount: number; factualEdgeCount: number; isListScene: boolean; rungCounts: Record<'2' | '3' | '4', number> }`
  - `export interface RichnessSummary { scenes: number; meanElements: number; meanObjectShare: number; meanEdges: number; listSceneRate: number; templateDiversity: number; primitiveDiversity: number; textFallbackShare: number }`
  - `export function sceneRichness(spec: SceneSpec, resolved?: ResolvedScene): SceneRichness`
  - `export function summarizeRichness(rows: SceneRichness[]): RichnessSummary`

- [ ] **Step 1: Write the failing tests**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { sceneRichness, summarizeRichness } from '../harness/sceneRichness.js';
import { resolveScene } from '../resolveScene.js';
import type { SceneSpec } from '../types.js';

const chain: SceneSpec = { schemaVersion: 'claude-scene-spec/v1', sceneId: 's1', title: 'A To B', template: 'chain', elements: [
  { id: 'a', prim: 'object', slot: 'node', anchor: 'mention:a', concept: 'store', label: 'STORE' },
  { id: 'b', prim: 'box', slot: 'node', anchor: 'mention:b', text: 'B' },
], edges: [{ from: 'a', to: 'b', origin: 'illustrative-example' }] } as SceneSpec;
const list: SceneSpec = { schemaVersion: 'claude-scene-spec/v1', sceneId: 's2', title: 'Items', template: 'list_icon', elements: [
  { id: 'x', prim: 'box', slot: 'item', anchor: 'mention:x', text: 'X' },
  { id: 'y', prim: 'box', slot: 'item', anchor: 'mention:y', text: 'Y' },
  { id: 'z', prim: 'box', slot: 'item', anchor: 'mention:z', text: 'Z' },
], edges: [] } as SceneSpec;

test('sceneRichness counts structure and rungs', () => {
  const row = sceneRichness(chain, resolveScene(chain));
  assert.equal(row.elementCount, 2);
  assert.equal(row.objectCount, 1);
  assert.equal(row.objectShare, 0.5);
  assert.equal(row.edgeCount, 1);
  assert.equal(row.isListScene, false);
  assert.deepEqual(row.primitiveKinds, ['box', 'object']);
  assert.equal(row.rungCounts['2'] + row.rungCounts['3'] + row.rungCounts['4'], 1);
});

test('list_icon and unconnected boxes count as list scenes', () => {
  assert.equal(sceneRichness(list).isListScene, true);
  const unconnectedChain = { ...list, template: 'chain' } as SceneSpec;
  assert.equal(sceneRichness(unconnectedChain).isListScene, true);
});

test('summarizeRichness aggregates deterministically', () => {
  const summary = summarizeRichness([sceneRichness(chain), sceneRichness(list)]);
  assert.equal(summary.scenes, 2);
  assert.equal(summary.listSceneRate, 0.5);
  assert.equal(summary.templateDiversity, 2);
  assert.equal(summary.meanEdges, 0.5);
});

test('summarizeRichness of no scenes is all zeros, not NaN', () => {
  const summary = summarizeRichness([]);
  for (const value of Object.values(summary)) assert.equal(value, 0);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run build && node --test dist/src/experimental/hypothesis/v1_claude/__tests__/scene-richness.test.js`
Expected: FAIL with `Cannot find module '../harness/sceneRichness.js'`.

- [ ] **Step 3: Implement `harness/sceneRichness.ts`**

```ts
import type { ResolvedScene, SceneSpec } from '../types.js';

/** Structural diagnostics only. They never establish teaching clarity, style, or Simi parity. */
export interface SceneRichness { sceneId: string; template: string; elementCount: number; primitiveKinds: string[]; objectCount: number; objectShare: number; edgeCount: number; factualEdgeCount: number; isListScene: boolean; rungCounts: Record<'2' | '3' | '4', number> }
export interface RichnessSummary { scenes: number; meanElements: number; meanObjectShare: number; meanEdges: number; listSceneRate: number; templateDiversity: number; primitiveDiversity: number; textFallbackShare: number }

const NON_LIST_WITHOUT_EDGES = new Set(['title_card', 'compare_2', 'formula_focus', 'plot_focus', 'list_icon']);

export function sceneRichness(spec: SceneSpec, resolved?: ResolvedScene): SceneRichness {
  const elementCount = spec.elements.length;
  const objectCount = spec.elements.filter((e) => e.prim === 'object').length;
  const edgeCount = spec.edges.length;
  const rungCounts: Record<'2' | '3' | '4', number> = { '2': 0, '3': 0, '4': 0 };
  for (const element of resolved?.elements ?? []) if (element.resolution) rungCounts[String(element.resolution.rung) as '2' | '3' | '4'] += 1;
  return {
    sceneId: spec.sceneId,
    template: spec.template,
    elementCount,
    primitiveKinds: [...new Set(spec.elements.map((e) => e.prim))].sort(),
    objectCount,
    objectShare: elementCount ? objectCount / elementCount : 0,
    edgeCount,
    factualEdgeCount: spec.edges.filter((e) => Boolean(e.factualRelation)).length,
    isListScene: spec.template === 'list_icon' || (edgeCount === 0 && elementCount >= 3 && !NON_LIST_WITHOUT_EDGES.has(spec.template)),
    rungCounts,
  };
}

export function summarizeRichness(rows: SceneRichness[]): RichnessSummary {
  const n = rows.length;
  const mean = (pick: (r: SceneRichness) => number) => (n ? rows.reduce((s, r) => s + pick(r), 0) / n : 0);
  const objects = rows.reduce((s, r) => s + r.rungCounts['2'] + r.rungCounts['3'] + r.rungCounts['4'], 0);
  return {
    scenes: n,
    meanElements: mean((r) => r.elementCount),
    meanObjectShare: mean((r) => r.objectShare),
    meanEdges: mean((r) => r.edgeCount),
    listSceneRate: mean((r) => Number(r.isListScene)),
    templateDiversity: new Set(rows.map((r) => r.template)).size,
    primitiveDiversity: new Set(rows.flatMap((r) => r.primitiveKinds)).size,
    textFallbackShare: objects ? rows.reduce((s, r) => s + r.rungCounts['4'], 0) / objects : 0,
  };
}
```

The `as SceneSpec` casts in the test exist only because the literal omits optional typing. If `SceneSpec` requires a field the literal lacks, add that field to the literal. Do not weaken the type.

- [ ] **Step 4: Run tests and the full offline gate**

Run: `npm run build && node --test dist/src/experimental/hypothesis/v1_claude/__tests__/scene-richness.test.js && npm run typecheck:hypothesis && npm run test:hypothesis`
Expected: all green.

- [ ] **Step 5: Checkpoint** — HANDOFF entry "Task 6".

---

### Task 7: Diagnostic S6 planning while S5 stays failed

**Why:** Every video made so far skipped S6 because S5 hard-fails. Each scene was therefore the deterministic `list_icon` fallback, so no generated SceneSpec has ever been seen. An explicit opt-in lets S6 run for diagnosis. The run keeps every S5 hard failure, so it stays `failed` and cannot enter C6/E1/E5.

**Files:**
- Modify: `src/experimental/hypothesis/v1_claude/planner/plan.ts` (export `shouldSkipPaidPlanning`)
- Modify: `src/experimental/hypothesis/v1_claude/pipeline/runLive.ts` (`LiveRunContext`, the `plannerSkipped` line, the S6 cache input)
- Modify: `src/experimental/hypothesis/v1_claude/lessonCli.ts` (parse flag, pass into context, record in the summary)
- Test: `src/experimental/hypothesis/v1_claude/__tests__/diagnostic-planning.test.ts`

**Interfaces:**
- Produces: `export function shouldSkipPaidPlanning(input: { hasHandAuthoredSpec: boolean; hardAlignmentFailureCount: number; planDespiteAlignmentFailure: boolean }): boolean`
- Produces: `LiveRunContext.planDespiteAlignmentFailure?: boolean`; soft failure code `planner-ran-on-uncalibrated-alignment`.

- [ ] **Step 1: Write the failing tests**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldSkipPaidPlanning } from '../planner/plan.js';

test('default behaviour still skips paid planning after hard S5 failures', () => {
  assert.equal(shouldSkipPaidPlanning({ hasHandAuthoredSpec: false, hardAlignmentFailureCount: 3, planDespiteAlignmentFailure: false }), true);
});

test('explicit diagnostic opt-in runs S6 despite hard S5 failures', () => {
  assert.equal(shouldSkipPaidPlanning({ hasHandAuthoredSpec: false, hardAlignmentFailureCount: 3, planDespiteAlignmentFailure: true }), false);
});

test('clean alignment never skips, and hand-authored specs never call the planner', () => {
  assert.equal(shouldSkipPaidPlanning({ hasHandAuthoredSpec: false, hardAlignmentFailureCount: 0, planDespiteAlignmentFailure: false }), false);
  assert.equal(shouldSkipPaidPlanning({ hasHandAuthoredSpec: true, hardAlignmentFailureCount: 3, planDespiteAlignmentFailure: true }), false);
});
```

The last case returns `false` because a hand-authored spec takes the `handAuthored` branch before any skip decision matters. This mirrors the current `!sceneInput.spec && ...` condition.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run build && node --test dist/src/experimental/hypothesis/v1_claude/__tests__/diagnostic-planning.test.js`
Expected: FAIL with `has no exported member 'shouldSkipPaidPlanning'`.

- [ ] **Step 3: Implement the helper in `planner/plan.ts`**

```ts
/**
 * Paid S6 planning is skipped after hard S5 alignment failures unless the
 * caller explicitly opts in for diagnosis. The opt-in never removes the S5
 * failures, so the run cannot pass publish gates.
 */
export function shouldSkipPaidPlanning(input: { hasHandAuthoredSpec: boolean; hardAlignmentFailureCount: number; planDespiteAlignmentFailure: boolean }): boolean {
  return !input.hasHandAuthoredSpec && input.hardAlignmentFailureCount > 0 && !input.planDespiteAlignmentFailure;
}
```

- [ ] **Step 4: Wire it into `pipeline/runLive.ts`**

- Add to `LiveRunContext`:
```ts
  /** Diagnostic only: run paid S6 even when S5 has hard failures. The S5 failures remain, so the run stays failed. */
  planDespiteAlignmentFailure?: boolean;
```
- Import `shouldSkipPaidPlanning` from `../planner/plan.js`.
- Replace `const plannerSkipped = !sceneInput.spec && hardAlignmentFailureCount > 0;` with:
```ts
    const plannerSkipped = shouldSkipPaidPlanning({ hasHandAuthoredSpec: Boolean(sceneInput.spec), hardAlignmentFailureCount, planDespiteAlignmentFailure: Boolean(ctx.planDespiteAlignmentFailure) });
```
- Directly after the `hardAlignmentFailureCount` declaration (before the scene loop), add:
```ts
  if (ctx.planDespiteAlignmentFailure && hardAlignmentFailureCount > 0) {
    failures.push({ code: 'planner-ran-on-uncalibrated-alignment', stage: 'planner', message: `S6 ran by explicit diagnostic opt-in despite ${hardAlignmentFailureCount} hard S5 failure(s); this run cannot publish`, hard: false });
  }
```
- In the S6 `ctx.artifactStore.run(...)` input object, change `{ plannerInput, promptAudit, hardAlignmentFailureCount }` to `{ plannerInput, promptAudit, hardAlignmentFailureCount, planDespiteAlignmentFailure: Boolean(ctx.planDespiteAlignmentFailure) }`.

- [ ] **Step 5: Add the CLI flag in `lessonCli.ts`**

Parse `--plan-despite-alignment-failure` as a boolean flag, following how `lessonCli.ts` already parses `--prompt-arm` and `--example-order`. Pass it as `planDespiteAlignmentFailure` in the `LiveRunContext` object handed to `runHypothesisLive`, and add `planDespiteAlignmentFailure` to the per-lesson summary JSON that the CLI writes.

- [ ] **Step 6: Run tests and the full offline gate**

Run: `npm run build && node --test dist/src/experimental/hypothesis/v1_claude/__tests__/diagnostic-planning.test.js && npm run typecheck:hypothesis && npm run test:hypothesis`
Expected: all green. `publish-status.test.ts` must pass unmodified. It proves that a run with hard S5 failures cannot be `passed`.

- [ ] **Step 7: Checkpoint** — HANDOFF entry "Task 7".

---

### Task 8: S6 calibration harness (`scene:calibrate`)

**Why:** `plan:calibrate` moved S3 from 0% to 40% by measurement. S6 needs the same loop. This harness replays cached S1–S5 artifacts from existing run directories, runs S6 per prompt arm (`zero`, `text`, `mechanism`, `diverse`), and reports valid-scene rate, planner-gate failures, fallback rate, richness, and cost. Results are labelled `diagnostic-calibration`. They are never E5 evidence, because S5 is uncalibrated and no video is reviewed.

**Files:**
- Create: `src/experimental/hypothesis/v1_claude/planner/sceneInput.ts`
- Modify: `src/experimental/hypothesis/v1_claude/pipeline/runLive.ts` (use `buildPlannerSceneInput`)
- Create: `src/experimental/hypothesis/v1_claude/harness/sceneCalibration.ts`
- Create: `src/experimental/hypothesis/v1_claude/harness/sceneCalibrationCli.ts`
- Modify: `package.json` (add a script)
- Test: `src/experimental/hypothesis/v1_claude/__tests__/scene-calibration.test.ts`

**Interfaces:**
- Consumes: `planScene` and `plannerProblems` (`planner/plan.ts`); `compileScenePlanningContext` and `PromptArm` (`planner/context.ts`, `planner/exemplars.ts`); `lessonToLiveInput` and `PreparedLesson` (`pipeline/lesson.ts`); `rankConcepts` (`catalog/semantic.ts`); `sceneRichness`, `summarizeRichness` (Task 6); `PersistentBudgetLedger`.
- Produces:
  - `export function buildPlannerSceneInput(args: { sceneId: string; narrationScene: { rawText: string; plainText: string; mentions: Array<{ id: string; phrase: string }> }; teachingContext: PlannerSceneInput['teachingContext']; mentionCandidates: Map<string, Array<{ name: string; score: number }>>; previousElements: PlannerSceneInput['previousElements'] }): PlannerSceneInput`
  - `export interface SceneCalibrationItem { caseId: string; sceneId: string; buildInput: (arm: PromptArm, previous: PlannerSceneInput['previousElements']) => PlannerSceneInput }`
  - `export interface SceneCalibrationAttempt { caseId: string; sceneId: string; arm: PromptArm; attempt: number; valid: boolean; failureCodes: string[]; repairs: number; costUsd: number; richness?: SceneRichness }`
  - `export interface SceneCalibrationReport { resultClass: 'diagnostic-calibration'; generatedAt: string; model: string; arms: Array<{ arm: PromptArm; attempts: number; valid: number; validRate: number; failureCodeCounts: Record<string, number>; richness: RichnessSummary; totalCostUsd: number }>; attempts: SceneCalibrationAttempt[] }`
  - `export async function runSceneCalibration(opts: { items: SceneCalibrationItem[]; arms: PromptArm[]; repeats: number; model: string; apiKey: string; budgetLedger?: PersistentBudgetLedger; perSceneBudgetUsd?: number; fetcher?: typeof fetch }): Promise<SceneCalibrationReport>`
  - `export async function loadSceneCalibrationItems(runDirs: string[]): Promise<SceneCalibrationItem[]>`

- [ ] **Step 1: Write the failing tests**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { runSceneCalibration, type SceneCalibrationItem } from '../harness/sceneCalibration.js';
import type { PlannerSceneInput } from '../planner/prompt.js';

const input: PlannerSceneInput = { sceneId: 'cal_scene', raw: 'The [[src|source]] feeds the [[dst|target]].', plainText: 'The source feeds the target.', mentions: [{ id: 'src', phrase: 'source' }, { id: 'dst', phrase: 'target' }] };
const item: SceneCalibrationItem = { caseId: 'synthetic', sceneId: 'cal_scene', buildInput: () => input };
const spec = { schemaVersion: 'claude-scene-spec/v1', sceneId: 'cal_scene', title: 'Source Feeds Target', template: 'chain', elements: [
  { id: 'src', prim: 'box', slot: 'node', anchor: 'mention:src', text: 'SOURCE', origin: 'illustrative-example' },
  { id: 'dst', prim: 'box', slot: 'node', anchor: 'mention:dst', text: 'TARGET', origin: 'illustrative-example' },
], edges: [{ from: 'src', to: 'dst', origin: 'illustrative-example' }] };
const reply = (content: string) => new Response(JSON.stringify({ id: 'g', model: 'test/model', choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 5, cost: 0.0002 } }), { status: 200 });

test('scene calibration reports valid rate, richness, and cost per arm', async () => {
  const report = await runSceneCalibration({ items: [item], arms: ['zero'], repeats: 2, model: 'test/model', apiKey: 'test-only', fetcher: async () => reply(JSON.stringify(spec)) });
  assert.equal(report.resultClass, 'diagnostic-calibration');
  assert.equal(report.arms[0].attempts, 2);
  assert.equal(report.arms[0].valid, 2);
  assert.equal(report.arms[0].validRate, 1);
  assert.equal(report.arms[0].richness.meanEdges, 1);
  assert.ok(Math.abs(report.arms[0].totalCostUsd - 0.0004) < 1e-9);
});

test('an invalid scene after repair is recorded as invalid without a fallback', async () => {
  const report = await runSceneCalibration({ items: [item], arms: ['zero'], repeats: 1, model: 'test/model', apiKey: 'test-only', fetcher: async () => reply('{"not":"a scene"}') });
  assert.equal(report.arms[0].valid, 0);
  assert.equal(report.attempts[0].repairs, 1);
  assert.ok(report.attempts[0].failureCodes.includes('planner-repair-failed'));
  assert.equal(report.attempts[0].richness, undefined);
});
```

If `planScene` reports repair failure under a different code than `planner-repair-failed` (the code is `${stage}-repair-failed` with `stage: 'planner'`), use the code it actually emits. Read `llm/structuredCall.ts` to confirm; do not change it.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run build && node --test dist/src/experimental/hypothesis/v1_claude/__tests__/scene-calibration.test.js`
Expected: FAIL with `Cannot find module '../harness/sceneCalibration.js'`.

- [ ] **Step 3: Extract `buildPlannerSceneInput` into `planner/sceneInput.ts`**

```ts
import type { PlannerSceneInput } from './prompt.js';

/** The one place that turns narration, teaching context, and ranked candidates into S6 input. Shared by runLive and harnesses. */
export function buildPlannerSceneInput(args: {
  sceneId: string;
  narrationScene: { rawText: string; plainText: string; mentions: Array<{ id: string; phrase: string }> };
  teachingContext: PlannerSceneInput['teachingContext'];
  mentionCandidates: Map<string, Array<{ name: string; score: number }>>;
  previousElements: PlannerSceneInput['previousElements'];
}): PlannerSceneInput {
  return {
    sceneId: args.sceneId,
    raw: args.narrationScene.rawText,
    plainText: args.narrationScene.plainText,
    mentions: args.narrationScene.mentions.map((m) => ({ id: m.id, phrase: m.phrase })),
    teachingContext: args.teachingContext,
    candidates: Object.fromEntries(args.narrationScene.mentions.map((m) => [m.id, (args.mentionCandidates.get(m.phrase.trim().toLowerCase()) ?? []).map((c) => ({ name: c.name, score: c.score }))])),
    previousElements: args.previousElements,
  };
}
```

In `pipeline/runLive.ts`, replace the inline `const plannerInput: PlannerSceneInput = { ... };` literal with:

```ts
    const plannerInput: PlannerSceneInput = buildPlannerSceneInput({ sceneId: sceneInput.sceneId, narrationScene, teachingContext: sceneInput.teachingContext, mentionCandidates, previousElements });
```

`runLive` must produce identical planner inputs. The existing `source-scene-planner.test.ts` and `e2e.test.ts` prove it; they must pass unmodified.

- [ ] **Step 4: Implement `harness/sceneCalibration.ts`**

```ts
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { planScene } from '../planner/plan.js';
import type { PlannerSceneInput } from '../planner/prompt.js';
import { compileScenePlanningContext } from '../planner/context.js';
import type { PromptArm } from '../planner/exemplars.js';
import { buildPlannerSceneInput } from '../planner/sceneInput.js';
import { lessonToLiveInput, type PreparedLesson } from '../pipeline/lesson.js';
import { rankConcepts } from '../catalog/semantic.js';
import { resolveScene } from '../resolveScene.js';
import type { PersistentBudgetLedger } from '../pipeline/budgetLedger.js';
import { sceneRichness, summarizeRichness, type RichnessSummary, type SceneRichness } from './sceneRichness.js';

/**
 * Diagnostic S6 calibration on cached S1-S5 artifacts. It measures prompt arms
 * against the unchanged planner gates. Output is never E5 evidence: S5 is
 * uncalibrated and no timed video is reviewed.
 */
export interface SceneCalibrationItem { caseId: string; sceneId: string; buildInput: (arm: PromptArm, previous: PlannerSceneInput['previousElements']) => PlannerSceneInput }
export interface SceneCalibrationAttempt { caseId: string; sceneId: string; arm: PromptArm; attempt: number; valid: boolean; failureCodes: string[]; repairs: number; costUsd: number; richness?: SceneRichness }
export interface SceneCalibrationReport {
  resultClass: 'diagnostic-calibration';
  generatedAt: string;
  model: string;
  arms: Array<{ arm: PromptArm; attempts: number; valid: number; validRate: number; failureCodeCounts: Record<string, number>; richness: RichnessSummary; totalCostUsd: number }>;
  attempts: SceneCalibrationAttempt[];
}

export async function runSceneCalibration(opts: { items: SceneCalibrationItem[]; arms: PromptArm[]; repeats: number; model: string; apiKey: string; budgetLedger?: PersistentBudgetLedger; perSceneBudgetUsd?: number; fetcher?: typeof fetch }): Promise<SceneCalibrationReport> {
  const attempts: SceneCalibrationAttempt[] = [];
  for (const arm of opts.arms) {
    for (let attempt = 1; attempt <= opts.repeats; attempt++) {
      let previous: PlannerSceneInput['previousElements'];
      let previousCase = '';
      for (const item of opts.items) {
        if (item.caseId !== previousCase) { previous = undefined; previousCase = item.caseId; }
        let input: PlannerSceneInput;
        try {
          input = item.buildInput(arm, previous);
        } catch (error) {
          attempts.push({ caseId: item.caseId, sceneId: item.sceneId, arm, attempt, valid: false, failureCodes: ['scene-context-invalid'], repairs: 0, costUsd: 0 });
          continue;
        }
        const result = await planScene(input, { model: opts.model, apiKey: opts.apiKey, remainingBudgetUsd: opts.perSceneBudgetUsd ?? 0.05, budgetLedger: opts.budgetLedger, fetcher: opts.fetcher, fallback: false });
        const valid = Boolean(result.spec) && !result.failures.some((f) => f.hard);
        attempts.push({
          caseId: item.caseId, sceneId: item.sceneId, arm, attempt, valid,
          failureCodes: [...new Set(result.failures.map((f) => f.code))].sort(),
          repairs: result.usage.repairs, costUsd: result.usage.costUsd,
          ...(result.spec ? { richness: sceneRichness(result.spec, resolveScene(result.spec)) } : {}),
        });
        previous = result.spec?.elements.map((e) => ({ id: e.id, prim: e.prim, ...(e.label ? { label: e.label } : {}), ...(e.conceptIds ? { conceptIds: e.conceptIds } : {}) }));
      }
    }
  }
  const arms = opts.arms.map((arm) => {
    const rows = attempts.filter((a) => a.arm === arm);
    const failureCodeCounts: Record<string, number> = {};
    for (const row of rows) for (const code of row.failureCodes) failureCodeCounts[code] = (failureCodeCounts[code] ?? 0) + 1;
    const valid = rows.filter((r) => r.valid).length;
    return {
      arm, attempts: rows.length, valid, validRate: rows.length ? valid / rows.length : 0, failureCodeCounts,
      richness: summarizeRichness(rows.flatMap((r) => (r.richness ? [r.richness] : []))),
      totalCostUsd: rows.reduce((s, r) => s + r.costUsd, 0),
    };
  });
  return { resultClass: 'diagnostic-calibration', generatedAt: new Date().toISOString(), model: opts.model, arms, attempts };
}

interface NarrationFile { scenes: Array<{ sceneId: string; rawText: string; plainText: string; mentions: Array<{ id: string; phrase: string }> }> }
interface AlignedFile { mentions: Array<{ sceneId: string; mentionId: string; startMs: number; endMs: number }> }

/** Rebuild S6 inputs from a completed run directory's cached S1-S5 artifacts. No provider calls. */
export async function loadSceneCalibrationItems(runDirs: string[]): Promise<SceneCalibrationItem[]> {
  const items: SceneCalibrationItem[] = [];
  for (const dir of runDirs) {
    const prepared = JSON.parse(await readFile(path.join(dir, 'lesson-prep.json'), 'utf8')) as PreparedLesson;
    const narration = JSON.parse(await readFile(path.join(dir, 'narration.json'), 'utf8')) as NarrationFile;
    const aligned = JSON.parse(await readFile(path.join(dir, 'aligned-audio.json'), 'utf8')) as AlignedFile;
    const caseId = path.basename(dir);
    const live = lessonToLiveInput(caseId, prepared);
    const mentionCandidates = await rankConcepts(narration.scenes.flatMap((s) => s.mentions.map((m) => m.phrase)), 5);
    for (const scene of live.scenes) {
      const narrationScene = narration.scenes.find((s) => s.sceneId === scene.sceneId);
      if (!narrationScene || !scene.sceneContract || !scene.lessonBible) continue;
      const mentionTimes = aligned.mentions.filter((m) => m.sceneId === scene.sceneId).map((m) => ({ id: m.mentionId, startMs: m.startMs, endMs: m.endMs }));
      items.push({
        caseId, sceneId: scene.sceneId,
        buildInput: (arm, previous) => {
          const plannerInput = buildPlannerSceneInput({ sceneId: scene.sceneId, narrationScene, teachingContext: scene.teachingContext, mentionCandidates, previousElements: previous });
          plannerInput.planningContext = compileScenePlanningContext(plannerInput, scene.sceneContract!, scene.lessonBible!, mentionTimes, arm, 'streamline-catalog-v1', live.sourceDoc?.sourceId, caseId, 'ranked');
          return plannerInput;
        },
      });
    }
  }
  return items;
}
```

If `HypothesisLiveInput` names its scenes, contract, bible, or source-document fields differently than `scenes`, `sceneContract`, `lessonBible`, and `sourceDoc`, use the real names from `runLive.ts` (it reads `sceneInput.sceneContract`, `sceneInput.lessonBible`, and `input.sourceDoc`). After Task 10 lands, replace the `'streamline-catalog-v1'` literal with `catalogVersion()` from `catalog/registry.ts`.

- [ ] **Step 5: Implement `harness/sceneCalibrationCli.ts` and the npm script**

The CLI parses `--runs=<dir1,dir2,...>`, `--arms=zero,text,mechanism,diverse` (default `zero,mechanism`), `--repeats=<n>` (default 2), `--model=<id>` (default `process.env.OPENROUTER_SCENE_MODEL ?? 'anthropic/claude-sonnet-5'`), and `--budget=<usd>` (default `1.00`, and it refuses values above `1.00`). It reads `OPENROUTER_API_KEY` from `.env` the same way `planCalibrationCli.ts` does (mirror that file's env loading exactly). It creates a `PersistentBudgetLedger` at `.data/scene-calibration/<ISO date>/budget-ledger.json` with the budget. It writes `harness/reports/<YYYY-MM-DD>-scene-calibration.json` and a Markdown table `harness/reports/<YYYY-MM-DD>-scene-calibration.md` with columns `arm | attempts | valid | validRate | listSceneRate | meanObjectShare | meanEdges | templateDiversity | cost`. The first line of the Markdown is: `Result class: diagnostic-calibration — not E5 evidence; S5 is uncalibrated and no video was reviewed.`

Add to `package.json` scripts:

```json
"scene:calibrate": "npm run build && node dist/src/experimental/hypothesis/v1_claude/harness/sceneCalibrationCli.js"
```

- [ ] **Step 6: Run tests and the full offline gate**

Run: `npm run build && node --test dist/src/experimental/hypothesis/v1_claude/__tests__/scene-calibration.test.js && npm run typecheck:hypothesis && npm run test:hypothesis`
Expected: all green.

- [ ] **Step 7: Checkpoint** — HANDOFF entry "Task 8". The paid calibration run itself is Task 14.

---

### Task 9: Icon library ingest (pure, deterministic)

**Why:** The user will supply an icon library. Its format is unknown, so ingest works from a manifest contract and normalizes every SVG into the same raw format that `catalog/streamline.ts` renders: ink strokes, then `main`, `white`, and `ink` fills. The output is byte-stable. Bad files are rejected one by one with a reason.

**Files:**
- Create: `src/experimental/hypothesis/v1_claude/catalog/libraryIngest.ts`
- Create: `scripts/ingest-icon-library.mjs`
- Modify: `package.json` (add a script)
- Test: `src/experimental/hypothesis/v1_claude/__tests__/library-ingest.test.ts`

**Interfaces:**
- Consumes: `LICENSE_ALLOWLIST` (`catalog/normalize.ts`), `svgPathProperties` (`svg-path-properties`).
- Produces:
  - `export interface IconLibraryManifest { schemaVersion: 'icon-library-manifest/v1'; libraryId: string; version: string; license: string; attribution: string; icons: Array<{ file: string; names: string[]; tags?: string[]; meaning?: string; category?: string }> }`
  - `export interface LibraryRawEntry { id: string; set: string; name: string; tags: string[]; category: string | null; vb: { w: number; h: number }; strokes: Array<{ d: string; len: number; w: number }>; fills: Array<{ d: string; role: 'main' | 'white' | 'ink'; rule?: 'evenodd' }>; license: string; contentHash: string }`
  - `export interface LibraryCatalog { schemaVersion: 'claude-catalog/v2'; libraryId: string; version: string; license: string; attribution: string; entries: LibraryRawEntry[] }`
  - `export function ingestSvg(svg: string, meta: { id: string; set: string; name: string; tags: string[]; category: string | null; license: string }): { ok: true; entry: LibraryRawEntry } | { ok: false; reason: string }`
  - `export function ingestLibrary(manifest: IconLibraryManifest, readSvg: (file: string) => string): { catalog: LibraryCatalog; rejected: Array<{ file: string; reason: string }> }`
  - `export const MAX_ICON_PATHS = 40`

- [ ] **Step 1: Write the failing tests**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { ingestLibrary, ingestSvg, type IconLibraryManifest } from '../catalog/libraryIngest.js';

const strokeIcon = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>';
const duotone = '<svg viewBox="0 0 48 48"><path d="M4 4h40v40H4z" fill="#8fbffa"/><path d="M10 10h6v6h-6z" fill="#ffffff"/><path d="M4 4h40v40H4z" fill="none" stroke="#2859c5" stroke-width="3"/></svg>';
const meta = (id: string) => ({ id, set: 'testlib', name: id, tags: [], category: null, license: 'MIT' });
const files: Record<string, string> = {
  'clock.svg': strokeIcon,
  'box.svg': duotone,
  'moved.svg': '<svg viewBox="0 0 24 24"><path transform="translate(2,2)" d="M0 0h10" stroke="#000"/></svg>',
  'ref.svg': '<svg viewBox="0 0 24 24"><defs><path id="p" d="M0 0h1"/></defs><use href="#p"/></svg>',
  'grad.svg': '<svg viewBox="0 0 24 24"><path d="M0 0h10v10z" fill="url(#g)" stroke="#000"/></svg>',
  'noink.svg': '<svg viewBox="0 0 24 24"><path d="M0 0h10v10z" fill="#8fbffa"/></svg>',
};
const manifest: IconLibraryManifest = { schemaVersion: 'icon-library-manifest/v1', libraryId: 'testlib', version: '1.0.0', license: 'MIT', attribution: 'Test icons (MIT)', icons: Object.keys(files).map((file) => ({ file, names: [file.replace('.svg', '')] })) };

test('stroke-only currentColor icons become ink strokes with lengths', () => {
  const result = ingestSvg(strokeIcon, meta('clock'));
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.equal(result.entry.strokes.length, 2);
  assert.ok(result.entry.strokes.every((s) => s.len > 0 && s.w === 2));
  assert.equal(result.entry.fills.length, 0);
  assert.deepEqual(result.entry.vb, { w: 24, h: 24 });
});

test('duotone icons map fills to main, white, and ink roles', () => {
  const result = ingestSvg(duotone, meta('box'));
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.deepEqual(result.entry.fills.map((f) => f.role), ['main', 'white']);
  assert.equal(result.entry.strokes.length, 1);
});

test('bad files are rejected individually with reasons', () => {
  const { catalog, rejected } = ingestLibrary(manifest, (file) => files[file]);
  assert.deepEqual(catalog.entries.map((e) => e.id), ['testlib:box', 'testlib:clock']);
  assert.deepEqual(Object.fromEntries(rejected.map((r) => [r.file, r.reason.split(':')[0]])), {
    'grad.svg': 'unsupported-paint', 'moved.svg': 'transform', 'noink.svg': 'no-ink', 'ref.svg': 'unsupported-element',
  });
});

test('ingest output is byte-stable and independent of manifest order', () => {
  const a = JSON.stringify(ingestLibrary(manifest, (f) => files[f]).catalog);
  const reversed = { ...manifest, icons: [...manifest.icons].reverse() };
  const b = JSON.stringify(ingestLibrary(reversed, (f) => files[f]).catalog);
  assert.equal(a, b);
});

test('a non-allowlisted license rejects the whole library', () => {
  assert.throws(() => ingestLibrary({ ...manifest, license: 'CC-BY-NC-4.0' }, (f) => files[f]), /license CC-BY-NC-4.0 is not allowlisted/);
});

test('icons over the path budget are rejected', () => {
  const many = `<svg viewBox="0 0 24 24">${Array.from({ length: 41 }, (_, i) => `<path d="M${i} 0h1" stroke="#000"/>`).join('')}</svg>`;
  const result = ingestSvg(many, meta('many'));
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /^too-many-paths/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run build && node --test dist/src/experimental/hypothesis/v1_claude/__tests__/library-ingest.test.js`
Expected: FAIL with `Cannot find module '../catalog/libraryIngest.js'`.

- [ ] **Step 3: Implement `catalog/libraryIngest.ts`**

```ts
import { createHash } from 'node:crypto';
import { svgPathProperties } from 'svg-path-properties';
import { LICENSE_ALLOWLIST } from './normalize.js';

/**
 * Offline, deterministic SVG icon ingest into the house raw catalog format.
 * Supported: <svg viewBox>, <g>, <path>, <circle>, <ellipse>, <rect>, <line>,
 * <polyline>, <polygon>; presentation attributes inherited through <g>.
 * Rejected per file: transforms, <use>/<defs>/<image>/<text>/<style>/<script>/
 * <mask>/<clipPath>/gradients/patterns, unknown colors, no ink, > 40 paths.
 */
export const MAX_ICON_PATHS = 40;

export interface IconLibraryManifest { schemaVersion: 'icon-library-manifest/v1'; libraryId: string; version: string; license: string; attribution: string; icons: Array<{ file: string; names: string[]; tags?: string[]; meaning?: string; category?: string }> }
export interface LibraryRawEntry { id: string; set: string; name: string; tags: string[]; category: string | null; vb: { w: number; h: number }; strokes: Array<{ d: string; len: number; w: number }>; fills: Array<{ d: string; role: 'main' | 'white' | 'ink'; rule?: 'evenodd' }>; license: string; contentHash: string }
export interface LibraryCatalog { schemaVersion: 'claude-catalog/v2'; libraryId: string; version: string; license: string; attribution: string; entries: LibraryRawEntry[] }

const REJECT_TAGS = /<(use|defs|image|text|style|script|mask|clipPath|linearGradient|radialGradient|pattern|foreignObject)\b/i;
const SHAPE_TAGS = /<(\/?)(svg|g|path|circle|ellipse|rect|line|polyline|polygon)((?:\s[^>]*?)?)(\/?)>/g;
const attrsOf = (s: string): Record<string, string> => Object.fromEntries([...s.matchAll(/([a-zA-Z:-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
const INHERITED = ['fill', 'stroke', 'stroke-width', 'fill-rule'];
const num = (v: string | undefined, fallback = 0): number => (v === undefined || v === '' ? fallback : Number(v));
const r3 = (n: number): string => String(Math.round(n * 1000) / 1000);

function shapeToPath(tag: string, a: Record<string, string>): string | undefined {
  switch (tag) {
    case 'path': return a.d;
    case 'circle': { const cx = num(a.cx), cy = num(a.cy), r = num(a.r); return `M${r3(cx - r)} ${r3(cy)}a${r3(r)} ${r3(r)} 0 1 0 ${r3(2 * r)} 0a${r3(r)} ${r3(r)} 0 1 0 ${r3(-2 * r)} 0z`; }
    case 'ellipse': { const cx = num(a.cx), cy = num(a.cy), rx = num(a.rx), ry = num(a.ry); return `M${r3(cx - rx)} ${r3(cy)}a${r3(rx)} ${r3(ry)} 0 1 0 ${r3(2 * rx)} 0a${r3(rx)} ${r3(ry)} 0 1 0 ${r3(-2 * rx)} 0z`; }
    case 'rect': {
      const x = num(a.x), y = num(a.y), w = num(a.width), h = num(a.height);
      const rx = Math.min(num(a.rx, num(a.ry)), w / 2), ry = Math.min(num(a.ry, num(a.rx)), h / 2);
      if (!rx && !ry) return `M${r3(x)} ${r3(y)}h${r3(w)}v${r3(h)}h${r3(-w)}z`;
      return `M${r3(x + rx)} ${r3(y)}h${r3(w - 2 * rx)}a${r3(rx)} ${r3(ry)} 0 0 1 ${r3(rx)} ${r3(ry)}v${r3(h - 2 * ry)}a${r3(rx)} ${r3(ry)} 0 0 1 ${r3(-rx)} ${r3(ry)}h${r3(-(w - 2 * rx))}a${r3(rx)} ${r3(ry)} 0 0 1 ${r3(-rx)} ${r3(-ry)}v${r3(-(h - 2 * ry))}a${r3(rx)} ${r3(ry)} 0 0 1 ${r3(rx)} ${r3(-ry)}z`;
    }
    case 'line': return `M${r3(num(a.x1))} ${r3(num(a.y1))}L${r3(num(a.x2))} ${r3(num(a.y2))}`;
    case 'polyline':
    case 'polygon': {
      const pts = (a.points ?? '').trim().split(/[\s,]+/).map(Number);
      if (pts.length < 4 || pts.some((p) => !Number.isFinite(p))) return undefined;
      let d = `M${r3(pts[0])} ${r3(pts[1])}`;
      for (let i = 2; i + 1 < pts.length; i += 2) d += `L${r3(pts[i])} ${r3(pts[i + 1])}`;
      return tag === 'polygon' ? `${d}z` : d;
    }
    default: return undefined;
  }
}

/** 'ink' | 'white' | 'main' for a paint value, or undefined when unsupported. Dark means relative luminance < 0.35. */
function paintRole(value: string): 'ink' | 'white' | 'main' | undefined {
  const v = value.trim().toLowerCase();
  if (v === 'currentcolor' || v === 'black') return 'ink';
  if (v === 'white') return 'white';
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(v)?.[1];
  if (!hex) return undefined;
  const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  if (lum >= 0.97) return 'white';
  return lum < 0.35 ? 'ink' : 'main';
}

const lengthOf = (d: string): number => { try { return new svgPathProperties(d).getTotalLength(); } catch { return 0; } };

export function ingestSvg(svg: string, meta: { id: string; set: string; name: string; tags: string[]; category: string | null; license: string }): { ok: true; entry: LibraryRawEntry } | { ok: false; reason: string } {
  const bad = REJECT_TAGS.exec(svg);
  if (bad) return { ok: false, reason: `unsupported-element: <${bad[1]}>` };
  if (/\stransform="/i.test(svg)) return { ok: false, reason: 'transform: flatten transforms before ingest' };
  const stack: Array<Record<string, string>> = [{}];
  let vb: { w: number; h: number } | undefined;
  const strokes: LibraryRawEntry['strokes'] = [];
  const fills: LibraryRawEntry['fills'] = [];
  for (const m of svg.matchAll(SHAPE_TAGS)) {
    const [, closing, tag, rawAttrs, selfClosing] = m;
    if (closing) { if (tag === 'g' || tag === 'svg') stack.pop(); continue; }
    const own = attrsOf(rawAttrs);
    const inherited = Object.fromEntries(INHERITED.filter((k) => stack[stack.length - 1][k] !== undefined).map((k) => [k, stack[stack.length - 1][k]]));
    const attrs = { ...inherited, ...own };
    if (tag === 'svg') {
      const box = (own.viewBox ?? '').trim().split(/[\s,]+/).map(Number);
      if (box.length !== 4 || box.some((n) => !Number.isFinite(n)) || box[2] <= 0 || box[3] <= 0) return { ok: false, reason: 'no-viewbox: a numeric viewBox is required' };
      if (box[0] !== 0 || box[1] !== 0) return { ok: false, reason: 'transform: viewBox origin must be 0 0' };
      vb = { w: box[2], h: box[3] };
      if (!selfClosing) stack.push(attrs);
      continue;
    }
    if (tag === 'g') { if (!selfClosing) stack.push(attrs); continue; }
    const d = shapeToPath(tag, own);
    if (!d) return { ok: false, reason: `bad-geometry: <${tag}>` };
    const fill = attrs.fill ?? 'black';
    const stroke = attrs.stroke;
    if (/^url\(/i.test(fill) || (stroke && /^url\(/i.test(stroke))) return { ok: false, reason: 'unsupported-paint: gradients and patterns are not allowed' };
    if (fill.toLowerCase() !== 'none') {
      const role = paintRole(fill);
      if (!role) return { ok: false, reason: `unknown-color: fill ${fill}` };
      fills.push({ d, role, ...(attrs['fill-rule'] === 'evenodd' ? { rule: 'evenodd' as const } : {}) });
    }
    if (stroke && stroke.toLowerCase() !== 'none') {
      const role = paintRole(stroke);
      if (role !== 'ink') return { ok: false, reason: `unknown-color: stroke ${stroke} is not dark ink` };
      strokes.push({ d, len: Math.round(lengthOf(d) * 100) / 100, w: num(attrs['stroke-width'], 1) });
    }
  }
  if (!vb) return { ok: false, reason: 'no-viewbox: missing <svg> root' };
  if (strokes.length === 0) return { ok: false, reason: 'no-ink: the reveal needs at least one dark outline stroke' };
  if (strokes.length + fills.length > MAX_ICON_PATHS) return { ok: false, reason: `too-many-paths: ${strokes.length + fills.length} > ${MAX_ICON_PATHS}` };
  const body = { id: meta.id, set: meta.set, name: meta.name, tags: [...meta.tags].sort(), category: meta.category, vb, strokes, fills, license: meta.license };
  const contentHash = createHash('sha256').update(JSON.stringify(body)).digest('hex');
  return { ok: true, entry: { ...body, contentHash } };
}

const slug = (file: string): string => file.replace(/\.svg$/i, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function ingestLibrary(manifest: IconLibraryManifest, readSvg: (file: string) => string): { catalog: LibraryCatalog; rejected: Array<{ file: string; reason: string }> } {
  if (manifest.schemaVersion !== 'icon-library-manifest/v1') throw new Error(`unsupported manifest schema ${String(manifest.schemaVersion)}`);
  if (!LICENSE_ALLOWLIST.includes(manifest.license)) throw new Error(`license ${manifest.license} is not allowlisted`);
  if (!/^[a-z0-9-]+$/.test(manifest.libraryId)) throw new Error('libraryId must be lowercase letters, digits, and hyphens');
  const entries: LibraryRawEntry[] = [];
  const rejected: Array<{ file: string; reason: string }> = [];
  const icons = [...manifest.icons].sort((a, b) => a.file.localeCompare(b.file));
  const seen = new Set<string>();
  for (const icon of icons) {
    const id = `${manifest.libraryId}:${slug(icon.file)}`;
    if (seen.has(id)) { rejected.push({ file: icon.file, reason: `duplicate-id: ${id}` }); continue; }
    seen.add(id);
    const names = icon.names.map((n) => n.trim().toLowerCase()).filter(Boolean);
    if (!names.length) { rejected.push({ file: icon.file, reason: 'no-name: at least one name is required' }); continue; }
    let svg: string;
    try { svg = readSvg(icon.file); } catch (error) { rejected.push({ file: icon.file, reason: `unreadable: ${error instanceof Error ? error.message : String(error)}` }); continue; }
    const result = ingestSvg(svg, { id, set: manifest.libraryId, name: names[0], tags: [...(icon.tags ?? []), ...names.slice(1)], category: icon.category ?? null, license: manifest.license });
    if (result.ok) entries.push(result.entry); else rejected.push({ file: icon.file, reason: result.reason });
  }
  entries.sort((a, b) => a.id.localeCompare(b.id));
  return { catalog: { schemaVersion: 'claude-catalog/v2', libraryId: manifest.libraryId, version: manifest.version, license: manifest.license, attribution: manifest.attribution, entries }, rejected };
}
```

The regex parser handles attribute-style SVG only. Inline `style="..."` paint is not read. An icon that relies on it ends as `no-ink` or has missing fills. That limit is recorded in the ingest report, not hidden (Task 11).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run build && node --test dist/src/experimental/hypothesis/v1_claude/__tests__/library-ingest.test.js`
Expected: PASS (6 tests). If a test fails because of a parsing edge in the synthetic SVGs, fix `libraryIngest.ts`. Do not change the expected rejection reasons.

- [ ] **Step 5: Create `scripts/ingest-icon-library.mjs` and the npm script**

```js
#!/usr/bin/env node
// Offline icon-library ingest. Usage: node scripts/ingest-icon-library.mjs <libraryDir> [outDir]
// <libraryDir>/manifest.json must follow icon-library-manifest/v1. SVG paths in the manifest are relative to <libraryDir>.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ingestLibrary } from '../dist/src/experimental/hypothesis/v1_claude/catalog/libraryIngest.js';

const [libraryDir, outDir = 'src/experimental/hypothesis/v1_claude/catalog/data'] = process.argv.slice(2);
if (!libraryDir) { console.error('usage: ingest-icon-library.mjs <libraryDir> [outDir]'); process.exit(2); }
const manifest = JSON.parse(readFileSync(join(libraryDir, 'manifest.json'), 'utf8'));
const { catalog, rejected } = ingestLibrary(manifest, (file) => {
  const full = resolve(libraryDir, file);
  if (!full.startsWith(resolve(libraryDir))) throw new Error('path escapes library directory');
  return readFileSync(full, 'utf8');
});
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, `${catalog.libraryId}.json`), `${JSON.stringify(catalog)}\n`);
writeFileSync(join(outDir, `${catalog.libraryId}.ingest-report.json`), `${JSON.stringify({ libraryId: catalog.libraryId, version: catalog.version, accepted: catalog.entries.length, rejected }, null, 2)}\n`);
console.log(`accepted ${catalog.entries.length}, rejected ${rejected.length} → ${join(outDir, `${catalog.libraryId}.json`)}`);
```

Add to `package.json` scripts:

```json
"icons:ingest": "npm run build && node scripts/ingest-icon-library.mjs"
```

- [ ] **Step 6: Run the full offline gate**

Run: `npm run typecheck:hypothesis && npm run test:hypothesis`
Expected: all green.

- [ ] **Step 7: Checkpoint** — HANDOFF entry "Task 9", including the manifest contract, so the user knows what to supply.

---

### Task 10: Multi-library catalog registry and catalog version

**Why:** Loading and ranking are hard-wired to `streamline.json` and `streamline.emb.bin`, and the catalog version is the literal `'streamline-catalog-v1'` in three places. A new library must participate in retrieval, the ladder's house-style preference, attribution, and cache keys.

**Files:**
- Create: `src/experimental/hypothesis/v1_claude/catalog/registry.ts`
- Modify: `src/experimental/hypothesis/v1_claude/catalog/streamline.ts` (generalize the loader over the registry)
- Modify: `src/experimental/hypothesis/v1_claude/catalog/semantic.ts` (`allCatalogEntries`, `catalogMatrix`, `rankConcepts`)
- Modify: `src/experimental/hypothesis/v1_claude/catalog/ladder.ts` (`isHouse`)
- Modify: `src/experimental/hypothesis/v1_claude/pipeline/runLive.ts` (replace the three `'streamline-catalog-v1'` literals)
- Modify: `scripts/embed-catalog.mjs` (embed every enabled library)
- Test: `src/experimental/hypothesis/v1_claude/__tests__/catalog-registry.test.ts`

**Interfaces:**
- Consumes: `LibraryCatalog` (Task 9); the existing Streamline `RawCatalog` (`claude-catalog/v1`).
- Produces:
  - `export interface CatalogLibrary { libraryId: string; file: string; embeddings: string; house: boolean }`
  - `export const ENABLED_LIBRARIES: readonly CatalogLibrary[]` (default: Streamline only, `house: true`)
  - `export function catalogVersion(libraries?: readonly CatalogLibrary[], dataDir?: string): string` returns `catalog-<first 16 hex of sha256 over each library's id, file bytes hash, and embeddings bytes hash>`
  - `export function isHouseSource(source: string): boolean`
  - `loadCatalogLibraries(libraries?: readonly CatalogLibrary[]): { attribution: string[]; entries: CatalogEntry[] }` in `catalog/streamline.ts`; `loadStreamlineCatalog()` stays exported with identical behavior for existing callers.

- [ ] **Step 1: Write the failing tests**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ENABLED_LIBRARIES, catalogVersion, isHouseSource } from '../catalog/registry.js';
import { CATALOG_DATA_DIR, loadCatalogLibraries, loadStreamlineCatalog } from '../catalog/streamline.js';

test('default registry is Streamline only and marked house style', () => {
  assert.deepEqual(ENABLED_LIBRARIES.map((l) => [l.libraryId, l.house]), [['streamline', true]]);
  assert.equal(isHouseSource('streamline:plump-color'), true);
  assert.equal(isHouseSource('generated'), false);
});

test('default multi-library load equals the legacy Streamline load', () => {
  const legacy = loadStreamlineCatalog().entries.map((e) => e.id);
  assert.deepEqual(loadCatalogLibraries().entries.map((e) => e.id), legacy);
});

test('catalog version is stable and changes when an enabled library changes', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'hyp-catalog-'));
  try {
    await copyFile(path.join(CATALOG_DATA_DIR, 'streamline.json'), path.join(dir, 'streamline.json'));
    await copyFile(path.join(CATALOG_DATA_DIR, 'streamline.emb.bin'), path.join(dir, 'streamline.emb.bin'));
    const before = catalogVersion(ENABLED_LIBRARIES, dir);
    assert.equal(catalogVersion(ENABLED_LIBRARIES, dir), before);
    assert.match(before, /^catalog-[0-9a-f]{16}$/);
    await writeFile(path.join(dir, 'streamline.emb.bin'), Buffer.alloc(8));
    assert.notEqual(catalogVersion(ENABLED_LIBRARIES, dir), before);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run build && node --test dist/src/experimental/hypothesis/v1_claude/__tests__/catalog-registry.test.js`
Expected: FAIL with `Cannot find module '../catalog/registry.js'`.

- [ ] **Step 3: Implement `catalog/registry.ts`**

```ts
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Enabled icon libraries in retrieval priority order. `house` libraries share
 * the renderer's style family and are preferred by the ladder. Adding a
 * library is a reviewed change: ingest it (scripts/ingest-icon-library.mjs),
 * embed it (npm run catalog:build), then list it here.
 */
export interface CatalogLibrary { libraryId: string; file: string; embeddings: string; house: boolean }

export const ENABLED_LIBRARIES: readonly CatalogLibrary[] = [
  { libraryId: 'streamline', file: 'streamline.json', embeddings: 'streamline.emb.bin', house: true },
];

const HOUSE_PREFIXES = (): string[] => ENABLED_LIBRARIES.filter((l) => l.house).map((l) => `${l.libraryId}:`);
export const isHouseSource = (source: string): boolean => HOUSE_PREFIXES().some((prefix) => source.startsWith(prefix));

const fileHash = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex');

export function catalogVersion(libraries: readonly CatalogLibrary[] = ENABLED_LIBRARIES, dataDir?: string): string {
  const dir = dataDir ?? catalogDataDir();
  const h = createHash('sha256');
  for (const lib of libraries) h.update(`${lib.libraryId}\n${fileHash(resolve(dir, lib.file))}\n${fileHash(resolve(dir, lib.embeddings))}\n${lib.house}\n`);
  return `catalog-${h.digest('hex').slice(0, 16)}`;
}

// Resolved lazily to avoid an import cycle with streamline.ts.
let dataDir: string | undefined;
export function setCatalogDataDir(dir: string): void { dataDir = dir; }
function catalogDataDir(): string {
  if (!dataDir) throw new Error('catalog data dir not initialised; import catalog/streamline.js first');
  return dataDir;
}
```

In `catalog/streamline.ts`, call `setCatalogDataDir(CATALOG_DATA_DIR)` at module load. Streamline entry `source` values start with `streamline:`, so `libraryId: 'streamline'` matches them.

- [ ] **Step 4: Generalize loading and ranking**

In `catalog/streamline.ts`:
- Keep `renderRaw` and `RawEntry`. Accept both `claude-catalog/v1` and `claude-catalog/v2` files (a v2 entry has the same fields plus `contentHash`).
- Add `loadCatalogLibraries(libraries = ENABLED_LIBRARIES)`. It loads each library file in order and maps entries exactly as today. `source` is `streamline:<set suffix>` for the Streamline file (unchanged) and `<libraryId>:<set>` for v2 files. Attribution comes from each file. Memoize per library-list key.
- `loadStreamlineCatalog()` returns `{ attribution: <Streamline attribution>, entries: <Streamline entries> }`, the same as today.

In `catalog/semantic.ts`:
- `allCatalogEntries()` returns `[...loadCatalogLibraries().entries, ...CATALOG]`.
- `catalogMatrix()` concatenates each enabled library's `.emb.bin`, in registry order, into one `Float32Array`.
- `rankConcepts` uses `loadCatalogLibraries().entries` in place of `loadStreamlineCatalog().entries`. The row-count check and the `(score desc, id asc)` sort stay as they are.

In `catalog/ladder.ts`: replace `const isHouse = (e: CatalogEntry) => e.source.startsWith('streamline:');` with `const isHouse = (e: CatalogEntry) => isHouseSource(e.source);` and import `isHouseSource`.

In `pipeline/runLive.ts`: replace every `'streamline-catalog-v1'` literal (the `const catalogVersion` and the S7 `catalogVersion:` key) with the value of `catalogVersion()` from `../catalog/registry.js`, computed once per run. Use a local name such as `const activeCatalogVersion = catalogVersion();` so it does not shadow the import. In `harness/sceneCalibration.ts`, replace the literal the same way.

In `scripts/embed-catalog.mjs`: loop over the registry's file list (duplicate the list as a JS constant with a comment pointing to `registry.ts`, because the script runs before `tsc`). Write `<libraryId>.emb.bin` per library, with rows in each file's entry order.

- [ ] **Step 5: Run tests and the full offline gate**

Run: `npm run build && node --test dist/src/experimental/hypothesis/v1_claude/__tests__/catalog-registry.test.js && npm run typecheck:hypothesis && npm run test:hypothesis`
Expected: all green. `catalog.test.ts`, `streamline.test.ts`, and `semantic-loader.test.ts` pass unmodified.

- [ ] **Step 6: Checkpoint** — HANDOFF entry "Task 10". Note that warm S6/S7 caches are invalidated once by the new catalog-version string. This is intended.

---

### Task 11: Ingest the user's icon library (blocked until supplied)

**Why:** Tasks 9–10 are the mechanism. This task applies them to the real library the user supplies.

**Precondition:** the user has given, in chat, a directory path, the library's license (SPDX), and the attribution text. If any is missing, mark this task `unmeasured` in HANDOFF and continue with Task 12.

**Files:**
- Create: `<libraryDir>/manifest.json` if the user's library does not already have one. Write it into a copy under `.data/icon-libraries/<libraryId>/`, never into the user's original directory.
- Create: `src/experimental/hypothesis/v1_claude/catalog/data/<libraryId>.json`, `<libraryId>.ingest-report.json`, `<libraryId>.emb.bin`
- Modify: `src/experimental/hypothesis/v1_claude/catalog/registry.ts` (`ENABLED_LIBRARIES`)
- Test: `src/experimental/hypothesis/v1_claude/__tests__/catalog-registry.test.ts` (add one test)

- [ ] **Step 1: Inspect the library before touching it**

Run: `ls -la <libraryDir> | head -50 && find <libraryDir> -name '*.svg' | wc -l && find <libraryDir> -iname '*license*' -o -iname '*.json' | head`
Report the file count, license file, and any existing metadata to the user. If the license is not in `LICENSE_ALLOWLIST`, stop and tell the user. Do not add it to the allowlist.

- [ ] **Step 2: Build the manifest from the library's own metadata**

If the library ships metadata (for example, an Iconify JSON, a `tags.json`, or a `categories.json`), map it to `icon-library-manifest/v1` with a one-off script under `scripts/` named `manifest-from-<libraryId>.mjs`. Names and tags come from that metadata or from the file name (hyphens to spaces). Never hand-add topic tags. Write the manifest to `.data/icon-libraries/<libraryId>/manifest.json` and copy the SVGs next to it.

- [ ] **Step 3: Ingest and review the rejection report**

Run: `npm run icons:ingest -- .data/icon-libraries/<libraryId>`
Expected: `accepted N, rejected M`. Report the rejection reasons grouped by code. If more than 30% are rejected for `transform` or `unknown-color`, tell the user and propose a separate plan amendment for a pre-flatten step (for example, `svgo --config` with `convertTransform`). Do not add that step silently.

- [ ] **Step 4: Embed and enable**

Add `{ libraryId: '<libraryId>', file: '<libraryId>.json', embeddings: '<libraryId>.emb.bin', house: <true only if the user confirms it should share the house style, else false> }` to `ENABLED_LIBRARIES` after Streamline, and to the list in `scripts/embed-catalog.mjs`. Run: `npm run catalog:build`
Expected: both `.emb.bin` files are written. The row count equals the accepted entry count.

- [ ] **Step 5: Add a regression test**

Append to `catalog-registry.test.ts`:

```ts
test('the user library is enabled, licensed, and loads every accepted entry', () => {
  const lib = ENABLED_LIBRARIES.find((l) => l.libraryId !== 'streamline');
  assert.ok(lib, 'user library must be registered');
  const loaded = loadCatalogLibraries().entries.filter((e) => e.source.startsWith(`${lib!.libraryId}:`));
  assert.ok(loaded.length > 0);
  for (const entry of loaded) assert.ok(['MIT', 'ISC', 'Apache-2.0', 'CC0-1.0', 'CC-BY-4.0'].includes(entry.license), entry.id);
});
```

- [ ] **Step 6: Run the full offline gate**

Run: `npm run typecheck:hypothesis && npm run test:hypothesis`
Expected: all green.

- [ ] **Step 7: Checkpoint** — HANDOFF entry "Task 11": accepted/rejected counts, reasons, and the house decision. E3 (normalization coherence) and E4 (thresholds) remain `unmeasured`. The icons are available, but their visual quality has not been judged.

---

### Task 12: Deterministic icon selection (query-embedding cache and lesson pins)

**Why:** Two sources of drift remain. First, query embeddings are computed live each run, so a model-download or runtime change can alter scores. Second, a persistent concept can receive different icons in different scenes when the planner words it differently. Cached query vectors and lesson-level pins remove both.

**Files:**
- Create: `src/experimental/hypothesis/v1_claude/catalog/queryEmbeddingCache.ts`
- Create: `src/experimental/hypothesis/v1_claude/catalog/iconPins.ts`
- Modify: `src/experimental/hypothesis/v1_claude/catalog/semantic.ts` (`rankConcepts` accepts an optional cache)
- Modify: `src/experimental/hypothesis/v1_claude/catalog/ladder.ts` (`resolveObject` accepts `pin`)
- Modify: `src/experimental/hypothesis/v1_claude/resolveScene.ts` (`ResolveOptions.pins`)
- Modify: `src/experimental/hypothesis/v1_claude/pipeline/runLive.ts` (keep pins across scenes; pass the cache)
- Modify: `src/experimental/hypothesis/v1_claude/pipeline/versions.ts` (`resolve` version)
- Test: `src/experimental/hypothesis/v1_claude/__tests__/icon-determinism.test.ts`

**Interfaces:**
- Produces:
  - `export interface IconPin { assetId: string; rung: 2 | 3; score: number }`
  - `export function iconPinKey(element: { concept: string; conceptIds?: string[] }): string`
  - `export function collectPins(resolved: ResolvedScene, into: ReadonlyMap<string, IconPin>): Map<string, IconPin>` (returns a new map; never mutates `into`)
  - `export class QueryEmbeddingCache { constructor(filePath: string, model: string); get(text: string): Float32Array | undefined; set(text: string, vector: Float32Array): void; flush(): Promise<void> }`
  - `rankConcepts(queries: string[], k?: number, cache?: QueryEmbeddingCache)`
  - `resolveObject(concept, opts: { ...existing; pin?: IconPin }, catalog?)`
  - `ResolveOptions.pins?: ReadonlyMap<string, IconPin>`
  - `VISUAL_STAGE_VERSIONS.resolve = 'resvg-text-metrics-bundled-kalam-5-icon-pins'`

- [ ] **Step 1: Write the failing tests**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { collectPins, iconPinKey } from '../catalog/iconPins.js';
import { QueryEmbeddingCache } from '../catalog/queryEmbeddingCache.js';
import { resolveObject } from '../catalog/ladder.js';
import { allCatalogEntries } from '../catalog/semantic.js';
import { resolveScene } from '../resolveScene.js';
import type { SceneSpec } from '../types.js';

const scene = (sceneId: string, concept: string): SceneSpec => ({ schemaVersion: 'claude-scene-spec/v1', sceneId, title: 'T', template: 'list_icon', elements: [
  { id: 'a', prim: 'object', slot: 'item', anchor: 'mention:a', concept, label: 'A', conceptIds: ['store_front'] },
  { id: 'b', prim: 'box', slot: 'item', anchor: 'mention:b', text: 'B' },
], edges: [] } as SceneSpec);

test('iconPinKey prefers sorted conceptIds and falls back to the normalized concept', () => {
  assert.equal(iconPinKey({ concept: 'Store', conceptIds: ['z', 'a'] }), 'concepts:a,z');
  assert.equal(iconPinKey({ concept: '  Shipping_Truck ' }), 'concept:shipping truck');
});

test('same conceptIds keep one icon across scenes', () => {
  const first = resolveScene(scene('s1', 'store'));
  const pins = collectPins(first, new Map());
  const second = resolveScene(scene('s2', 'shop building'), { pins });
  assert.equal(second.elements[0].resolution?.assetId, first.elements[0].resolution?.assetId);
  assert.equal(second.elements[0].resolution?.rung, first.elements[0].resolution?.rung);
});

test('collectPins never overwrites an existing pin and never pins text fallbacks', () => {
  const first = resolveScene(scene('s1', 'store'));
  const pins = collectPins(first, new Map());
  const again = collectPins(resolveScene(scene('s2', 'zzqxwv')), pins);
  assert.equal(again.get('concepts:store_front')?.assetId, pins.get('concepts:store_front')?.assetId);
  // 'zzqxwv' shares no token with any catalog entry, so it resolves at rung 4 (text box) and must not be pinned.
  const unknown = scene('s3', 'zzqxwv');
  const fallbackScene = { ...unknown, elements: [{ ...unknown.elements[0], conceptIds: ['other'] }, unknown.elements[1]] } as SceneSpec;
  const resolvedFallback = resolveScene(fallbackScene);
  assert.equal(resolvedFallback.elements[0].resolution?.rung, 4);
  assert.equal(collectPins(resolvedFallback, new Map()).has('concepts:other'), false);
});

test('resolution is independent of catalog array order', () => {
  const catalog = allCatalogEntries();
  const a = resolveObject('store', { size: { w: 200, h: 260 } }, catalog).resolution.assetId;
  const b = resolveObject('store', { size: { w: 200, h: 260 } }, [...catalog].reverse()).resolution.assetId;
  assert.equal(a, b);
});

test('query embedding cache round-trips vectors by model and text', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'hyp-qcache-'));
  try {
    const file = path.join(dir, 'q.json');
    const cache = new QueryEmbeddingCache(file, 'model-a');
    cache.set('Store', Float32Array.from([0.5, 0.25]));
    await cache.flush();
    const reread = new QueryEmbeddingCache(file, 'model-a');
    assert.deepEqual([...reread.get('store')!], [0.5, 0.25]);
    assert.equal(new QueryEmbeddingCache(file, 'model-b').get('store'), undefined);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
```

The "independent of catalog array order" test can fail today when two house entries share the same exact name, because `exactOf` returns the first match in array order. That is a real determinism bug. Step 3 fixes it.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run build && node --test dist/src/experimental/hypothesis/v1_claude/__tests__/icon-determinism.test.js`
Expected: FAIL with `Cannot find module '../catalog/iconPins.js'`.

- [ ] **Step 3: Implement pins, the order-independent exact match, and the ladder hook**

`catalog/iconPins.ts`:

```ts
import type { ResolvedScene } from '../types.js';

/** Lesson-level icon consistency: the first confident icon for a concept is reused in later scenes. */
export interface IconPin { assetId: string; rung: 2 | 3; score: number }

export function iconPinKey(element: { concept: string; conceptIds?: string[] }): string {
  if (element.conceptIds?.length) return `concepts:${[...element.conceptIds].sort().join(',')}`;
  return `concept:${element.concept.trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ')}`;
}

export function collectPins(resolved: ResolvedScene, into: ReadonlyMap<string, IconPin>): Map<string, IconPin> {
  const next = new Map(into);
  for (const element of resolved.elements) {
    if (element.element.prim !== 'object' || !element.resolution?.assetId) continue;
    if (element.resolution.rung !== 2 && element.resolution.rung !== 3) continue;
    const key = iconPinKey(element.element);
    if (!next.has(key)) next.set(key, { assetId: element.resolution.assetId, rung: element.resolution.rung, score: element.resolution.score });
  }
  return next;
}
```

In `catalog/ladder.ts` `resolveObject`:
- Add `pin?: IconPin` to `opts` (import the type).
- Make `exactOf` order-independent:
```ts
  const exactOf = (pool: CatalogEntry[]) => pool.filter((e) => e.names.some((n) => wanted.has(n.toLowerCase()))).sort((a, b) => a.id.localeCompare(b.id))[0];
```
- Before `let best`, add:
```ts
  const pinnedEntry = opts.pin ? catalog.find((e) => e.id === opts.pin!.assetId) : undefined;
```
- Change `let best: ... | undefined;` to `let best: ... | undefined = pinnedEntry ? { entry: pinnedEntry, score: opts.pin!.score, rung: opts.pin!.rung } : undefined;` and wrap the existing `if (houseExact) ... else if ...` chain in `if (!best) { ... }`.

In `resolveScene.ts`:
- Add `pins?: ReadonlyMap<string, IconPin>` to `ResolveOptions`.
- In the `object` branch, pass `pin: options.pins?.get(iconPinKey(element))` to `resolveObject`.

- [ ] **Step 4: Implement the query embedding cache and wire it**

`catalog/queryEmbeddingCache.ts`:

```ts
import { readFileSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

/** Content-addressed query vectors: key = sha256(model + "\n" + normalized text). Values are base64 Float32 bytes. */
export class QueryEmbeddingCache {
  private readonly entries: Record<string, string>;
  private dirty = false;
  constructor(private readonly filePath: string, private readonly model: string) {
    try { this.entries = JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, string>; } catch { this.entries = {}; }
  }
  private key(text: string): string { return createHash('sha256').update(`${this.model}\n${text.trim().toLowerCase()}`).digest('hex'); }
  get(text: string): Float32Array | undefined {
    const value = this.entries[this.key(text)];
    if (!value) return undefined;
    const bytes = Buffer.from(value, 'base64');
    return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  }
  set(text: string, vector: Float32Array): void { this.entries[this.key(text)] = Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength).toString('base64'); this.dirty = true; }
  async flush(): Promise<void> {
    if (!this.dirty) return;
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const sorted = Object.fromEntries(Object.entries(this.entries).sort(([a], [b]) => a.localeCompare(b)));
    const tmp = `${this.filePath}.${process.pid}.tmp`;
    await writeFile(tmp, `${JSON.stringify(sorted)}\n`, 'utf8');
    await rename(tmp, this.filePath);
    this.dirty = false;
  }
}
```

In `catalog/semantic.ts` `rankConcepts(queries, k = 8, cache?)`: embed only the queries missing from the cache, store new vectors with `cache.set`, and score from the cached or fresh vectors. The sort stays `(score desc, id asc)`. Export the model id constant as `EMBEDDING_MODEL` so callers can construct the cache.

In `pipeline/runLive.ts`:
- Create one `QueryEmbeddingCache` per run at `path.join(<stage-cache directory used by the artifact store, or options.outputDir>, 'query-embeddings.json')` with `EMBEDDING_MODEL`. Pass it to both `rankConcepts` calls, and `await cache.flush()` after the scene loop.
- Before the scene loop: `let iconPins: Map<string, IconPin> = new Map();`
- S7 cache input becomes `{ spec: planned.spec, candidates: resolutionCandidates, pins: [...iconPins.entries()].sort(([a], [b]) => a.localeCompare(b)) }`, and both `resolveScene(...)` calls pass `{ candidates: resolutionCandidates, pins: iconPins }`.
- After `resolved` is known: `iconPins = collectPins(resolved, iconPins);`

In `pipeline/versions.ts`: set `resolve: 'resvg-text-metrics-bundled-kalam-5-icon-pins'`.

- [ ] **Step 5: Run tests and the full offline gate**

Run: `npm run build && node --test dist/src/experimental/hypothesis/v1_claude/__tests__/icon-determinism.test.js && npm run typecheck:hypothesis && npm run test:hypothesis`
Expected: all green. If an existing test pins the old `resolve` version string, report it as a required amendment. Do not edit it.

- [ ] **Step 6: Replay determinism check (offline)**

Run the existing offline e2e test twice and compare generated SVG hashes, using the determinism assertions `e2e.test.ts` already has (it requires byte-identical SVG on replay). Expected: PASS both times.

- [ ] **Step 7: Checkpoint** — HANDOFF entry "Task 12".

---

### Task 13: S1–S4 reliability harness (`reliability:run`)

**Why:** "Generate without failing" needs a number. This harness runs `prepareLesson` cold (S1–S4) N times per source and reports the pass rate per stage and failure codes. It uses the Task 1 transport retries, the Task 2 anchoring, and the Task 3 guard, and it changes no contract.

**Files:**
- Create: `src/experimental/hypothesis/v1_claude/harness/reliability.ts`
- Create: `src/experimental/hypothesis/v1_claude/harness/reliabilityCli.ts`
- Modify: `package.json` (add a script)
- Test: `src/experimental/hypothesis/v1_claude/__tests__/reliability-harness.test.ts`

**Interfaces:**
- Consumes: `prepareLesson`, `PreparedLesson` (`pipeline/lesson.ts`); `loadSourceDoc` (`plan/sourceIntake.ts`); `PersistentBudgetLedger`.
- Produces:
  - `export interface ReliabilityAttempt { sourceId: string; durationSec: number; attempt: number; reached: 'S2' | 'S3' | 'S4' | 'done'; passed: boolean; failureCodes: string[]; transportRetries: number; anchoredEvidence: boolean; costUsd: number; durationMs: number }`
  - `export interface ReliabilityReport { generatedAt: string; model: string; attempts: ReliabilityAttempt[]; byStage: { s2PassRate: number; s3PassRate: number; s4PassRate: number; endToEndPassRate: number }; failureCodeCounts: Record<string, number>; totalCostUsd: number }`
  - `export async function runReliability(opts: { sources: Array<{ id: string; path: string }>; durationsSec: number[]; repeats: number; model: string; apiKey: string; budgetLedger: PersistentBudgetLedger; fetcher?: typeof fetch }): Promise<ReliabilityReport>`
  - `export function summarizeReliability(attempts: ReliabilityAttempt[]): Pick<ReliabilityReport, 'byStage' | 'failureCodeCounts' | 'totalCostUsd'>`

- [ ] **Step 1: Write the failing test (pure summary)**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeReliability, type ReliabilityAttempt } from '../harness/reliability.js';

const row = (reached: ReliabilityAttempt['reached'], codes: string[] = []): ReliabilityAttempt => ({ sourceId: 's', durationSec: 60, attempt: 1, reached, passed: reached === 'done', failureCodes: codes, transportRetries: 0, anchoredEvidence: false, costUsd: 0.01, durationMs: 1 });

test('stage pass rates are conditional on reaching the stage', () => {
  const summary = summarizeReliability([row('done'), row('S3', ['plan-repair-failed']), row('S2', ['concepts-repair-failed']), row('done')]);
  assert.equal(summary.byStage.s2PassRate, 0.75);
  assert.equal(summary.byStage.s3PassRate, 2 / 3);
  assert.equal(summary.byStage.s4PassRate, 1);
  assert.equal(summary.byStage.endToEndPassRate, 0.5);
  assert.deepEqual(summary.failureCodeCounts, { 'concepts-repair-failed': 1, 'plan-repair-failed': 1 });
  assert.ok(Math.abs(summary.totalCostUsd - 0.04) < 1e-9);
});

test('an empty run summarizes to zeros', () => {
  const summary = summarizeReliability([]);
  assert.deepEqual(summary.byStage, { s2PassRate: 0, s3PassRate: 0, s4PassRate: 0, endToEndPassRate: 0 });
});
```

`reached` names the stage where the attempt stopped (`'done'` means S4 completed). An attempt that reached S3 passed S2. S4 pass rate is taken over attempts that reached S4 or `done`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run build && node --test dist/src/experimental/hypothesis/v1_claude/__tests__/reliability-harness.test.js`
Expected: FAIL with `Cannot find module '../harness/reliability.js'`.

- [ ] **Step 3: Implement `harness/reliability.ts`**

```ts
import { prepareLesson } from '../pipeline/lesson.js';
import { loadSourceDoc } from '../plan/sourceIntake.js';
import type { PersistentBudgetLedger } from '../pipeline/budgetLedger.js';

/** Cold S1-S4 reliability measurement. It never changes what counts as a pass. */
export interface ReliabilityAttempt { sourceId: string; durationSec: number; attempt: number; reached: 'S2' | 'S3' | 'S4' | 'done'; passed: boolean; failureCodes: string[]; transportRetries: number; anchoredEvidence: boolean; costUsd: number; durationMs: number }
export interface ReliabilityReport { generatedAt: string; model: string; attempts: ReliabilityAttempt[]; byStage: { s2PassRate: number; s3PassRate: number; s4PassRate: number; endToEndPassRate: number }; failureCodeCounts: Record<string, number>; totalCostUsd: number }

const rate = (num: number, den: number): number => (den ? num / den : 0);

export function summarizeReliability(attempts: ReliabilityAttempt[]): Pick<ReliabilityReport, 'byStage' | 'failureCodeCounts' | 'totalCostUsd'> {
  const reachedS3 = attempts.filter((a) => a.reached !== 'S2').length;
  const reachedS4 = attempts.filter((a) => a.reached === 'S4' || a.reached === 'done').length;
  const done = attempts.filter((a) => a.reached === 'done').length;
  const failureCodeCounts: Record<string, number> = {};
  for (const attempt of attempts) for (const code of attempt.failureCodes) failureCodeCounts[code] = (failureCodeCounts[code] ?? 0) + 1;
  return {
    byStage: { s2PassRate: rate(reachedS3, attempts.length), s3PassRate: rate(reachedS4, reachedS3), s4PassRate: rate(done, reachedS4), endToEndPassRate: rate(done, attempts.length) },
    failureCodeCounts: Object.fromEntries(Object.entries(failureCodeCounts).sort(([a], [b]) => a.localeCompare(b))),
    totalCostUsd: attempts.reduce((s, a) => s + a.costUsd, 0),
  };
}

export async function runReliability(opts: { sources: Array<{ id: string; path: string }>; durationsSec: number[]; repeats: number; model: string; apiKey: string; budgetLedger: PersistentBudgetLedger; fetcher?: typeof fetch }): Promise<ReliabilityReport> {
  const attempts: ReliabilityAttempt[] = [];
  for (const source of opts.sources) {
    const sourceDoc = await loadSourceDoc(source.path);
    for (const durationSec of opts.durationsSec) {
      for (let attempt = 1; attempt <= opts.repeats; attempt++) {
        const started = Date.now();
        const prepared = await prepareLesson(
          { source: sourceDoc.text, sourceDoc, sourceFormat: sourceDoc.format, targetDurationSec: durationSec },
          { model: opts.model, apiKey: opts.apiKey, budgetUsd: 0.1, budgetLedger: opts.budgetLedger, fetcher: opts.fetcher },
        );
        const hard = prepared.failures.filter((f) => f.hard);
        const reached: ReliabilityAttempt['reached'] = !prepared.graph ? 'S2' : !prepared.plan || hard.some((f) => f.stage === 'plan') ? 'S3' : !prepared.script ? 'S4' : 'done';
        attempts.push({
          sourceId: source.id, durationSec, attempt, reached, passed: reached === 'done' && hard.length === 0,
          failureCodes: [...new Set(hard.map((f) => f.code))].sort(),
          transportRetries: prepared.failures.filter((f) => f.code.endsWith('-transport-retry')).length,
          anchoredEvidence: prepared.failures.some((f) => f.code === 'concepts-evidence-anchored'),
          costUsd: prepared.usage.costUsd, durationMs: Date.now() - started,
        });
      }
    }
  }
  return { generatedAt: new Date().toISOString(), model: opts.model, attempts, ...summarizeReliability(attempts) };
}
```

`prepareLesson` has no artifact store here, so every call is cold. If `PreparedLesson` names `graph`, `plan`, `script`, or `usage` differently, use the real field names from `pipeline/lesson.ts` (the `preparedResult` calls show `graph`, `plan`, `analysis`, and `script`).

- [ ] **Step 4: Implement `harness/reliabilityCli.ts` and the npm script**

It parses `--sources=<id:path,...>` (default: the five `.data/sources/{ocean-tides,bicycle-balance,composting,rainbow-formation,mirror-images}.md`), `--durations=60` (comma list; values above 60 are accepted but must be reported separately, because long-form is unimplemented), `--repeats=3`, `--model=<id>` (default `process.env.OPENROUTER_CONTENT_MODEL`), and `--budget=<usd>` (default and maximum `1.00`). Env loading mirrors `planCalibrationCli.ts`. The ledger lives at `.data/reliability/<ISO date>/budget-ledger.json`. It writes `harness/reports/<YYYY-MM-DD>-reliability.{json,md}`. The Markdown shows the byStage table and failure codes ranked by count.

```json
"reliability:run": "npm run build && node dist/src/experimental/hypothesis/v1_claude/harness/reliabilityCli.js"
```

- [ ] **Step 5: Run tests and the full offline gate**

Run: `npm run build && node --test dist/src/experimental/hypothesis/v1_claude/__tests__/reliability-harness.test.js && npm run typecheck:hypothesis && npm run test:hypothesis`
Expected: all green.

- [ ] **Step 6: Checkpoint** — HANDOFF entry "Task 13".

---

### Task 14: Paid measurements and the evidence ledger

**Precondition:** the user approves in chat each paid command below and its cap. Without approval, record each measurement as `unmeasured` and finish the docs step.

**Files:**
- Create: `harness/reports/2026-MM-DD-reliability.{json,md}`, `harness/reports/2026-MM-DD-scene-calibration.{json,md}` (written by the CLIs)
- Modify: `hypothesis/v1_claude/02-IMPLEMENTATION-PLAN.md` (status table rows), `hypothesis/v1_claude/03-VALIDATION-HARNESS.md` (status ledger), `docs/ARCHITECTURE.md` (new modules and commands), `docs/HANDOFF.md` (dated entry)

- [ ] **Step 1: S1–S4 reliability, 60 s, cold** (paid, cap $1.00)

Run: `npm run reliability:run -- --durations=60 --repeats=3 --budget=1.00`
Expected: a report exists. Record `s2PassRate`, `s3PassRate`, `s4PassRate`, `endToEndPassRate`, transport-retry counts, and anchored-evidence counts. Compare with the 2026-09-25 baseline (S3 v4: 6/15). No target is forced. If the end-to-end rate is below 0.8, the top failure code becomes the next bounded task in HANDOFF.

- [ ] **Step 2: Produce diagnostic S6 scenes on already-prepared lessons** (paid, cap $0.30 per lesson)

Run, for each of `ocean-tides`, `bicycle-balance`, and `composting`, reusing cached S1–S5 through `--stage-cache` exactly as the E5 docs describe:
`npm run run:lesson -- --source=.data/sources/<id>.md --duration=60 --plan-despite-alignment-failure --prompt-arm=zero --stage-cache=<existing stage-cache dir of that run> --out=.data/hypothesis-runs/claude/diagnostic-s6/<id>-zero`
Expected: `status=failed` with the S5 hard failures still present, plus `planner-ran-on-uncalibrated-alignment`. Real S6 SceneSpecs exist (`scene-spec.*.json` without `planner-fallback`). Do not score or judge these videos.

- [ ] **Step 3: S6 prompt-arm calibration** (paid, cap $1.00)

Run: `npm run scene:calibrate -- --runs=.data/hypothesis-runs/claude/phase0-live/ocean-tides-60s-mixed,.data/hypothesis-runs/claude/phase0-live/bicycle-balance-60s-mixed,.data/hypothesis-runs/claude/phase0-live/composting-60s-mixed3 --arms=zero,mechanism,diverse --repeats=2 --budget=1.00`
Expected: a report with validRate, listSceneRate, meanObjectShare, meanEdges, templateDiversity, and cost per arm. Record the numbers. Zero-shot stays the production default. An arm may become the default only after held-out, human-judged timed-video review (E5), which needs S5 calibration first.

- [ ] **Step 4: Update the evidence ledgers**

Add rows to the `02-IMPLEMENTATION-PLAN.md` status table and the `03-VALIDATION-HARNESS.md` status ledger for: transport retries (tested), evidence anchoring (tested), prompt builder and v13 (tested), bank v4 (implemented, all pending review), richness metric (tested), diagnostic S6 opt-in (tested), scene calibration (measured values, or `unmeasured`), icon ingest (tested), registry (tested), user library (measured counts, or `unmeasured`), icon pins and query cache (tested), reliability (measured values, or `unmeasured`). Add the new commands and modules to `docs/ARCHITECTURE.md`. Use only the status words `implemented`, `tested`, `passed`, `failed`, and `unmeasured`.

Append one `docs/HANDOFF.md` entry that lists every command, result, cost, limitation, and the next bounded task. It must restate that C6/E1/E5 remain `unmeasured`, that S5 calibration still needs two human reviewers, and that long-form (5/10 min) is still unimplemented (`maxConcepts` cap of 14).

- [ ] **Step 5: Final offline gate**

Run: `npm run typecheck:hypothesis && npm run test:hypothesis`
Expected: all green, including `plan-lock.test.ts`.

---

## Out of scope (named so nobody slips it in)

- Long-form lessons (5/10/30/60 min), section-parallel planning, and changing the `maxConcepts = Math.min(14, …)` cap. These need their own plan.
- RAG integration.
- Changing S5 aligners, fabricating word durations, or marking calibration measured without two human reviewers.
- Changing `TAU_HIGH_EMB`/`TAU_MID_EMB` without an E4 labeled dataset.
- Promoting any exemplar to `approved`, or making a retrieval arm the default.
- Rough.js or freehand rendering (E7), parallel S6 per scene, and a live player speed-up.
- Any edit under `src/experimental/hypothesis/shared/**`.

## Self-review record

- **Spec coverage:** harness (Tasks 6, 8, 13, 14); richer visuals through few-shots (Tasks 4, 5, 7); better prompt builder (Task 3); deterministic icons and the user's library (Tasks 9, 10, 11, 12); generation that does not fail (Tasks 1, 2, 3, 7, 12, 13, with the precise meaning stated in the header); strict, uneditable plan (lock, read-only mode, Task 0 test, CLAUDE.md rule).
- **Placeholder scan:** one value is deliberately captured at run time (the v12 prompt hash in Task 3 Step 1), and the step that produces it is exact. Task 11 depends on user-supplied data and states what happens when it is absent.
- **Type consistency:** `ProviderNotDispatchedError`, `anchorQuote`, `buildPrompt`, `schemaKeywordLeaks`, `RECIPE_CARDS`, `sceneRichness`, `shouldSkipPaidPlanning`, `buildPlannerSceneInput`, `runSceneCalibration`, `ingestLibrary`, `catalogVersion`, `isHouseSource`, `loadCatalogLibraries`, `IconPin`, `iconPinKey`, `collectPins`, `QueryEmbeddingCache`, and `runReliability` are each defined once and used with the same signature.
- **Review Focus:** each of the five lines has a named test in its owning task.
