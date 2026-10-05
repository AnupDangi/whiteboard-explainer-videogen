#!/usr/bin/env node
// Offline replay of retained first-scene S6 (board-ops) model outputs through the current validator and deterministic
// salvage. No provider call. Reports, per retained run, whether the model's FIRST response was valid, how many validator
// problems it had, whether salvage alone made it valid, and which changes it made. This measures the effect of the code
// path on real model output; it is not a lesson result.
//
//   node scripts/s6-salvage-replay.mjs <results-root> [--json out.json]
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { pathToFileURL } from 'node:url';

const root = process.argv[2];
if (!root) { console.error('usage: node scripts/s6-salvage-replay.mjs <results-root> [--json out.json]'); process.exit(2); }
const jsonOut = process.argv.includes('--json') ? process.argv[process.argv.indexOf('--json') + 1] : undefined;
const dist = (file) => import(pathToFileURL(path.resolve('dist/src', file)).href);
const { SceneBoardDraftSchema } = await dist('visual-v2/ops-plan/types.js');
const { validateSceneBoard } = await dist('visual-v2/ops-plan/validate.js');
const { salvageAttempt } = await dist('visual-v2/ops-plan/salvage.js');
const { emptyBoardState } = await dist('visual-v2/board-state/reducer.js');
const { anchorQuote } = await dist('plan/evidenceAnchor.js');
const { parseCandidates } = await dist('llm/structuredCall.js');
const { compileProviderSchema, providerForModel } = await dist('structured/providerSchema.js');
const { $schema: _drop, ...wireSchema } = z.toJSONSchema(SceneBoardDraftSchema);

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full); else yield full;
  }
}

const rows = [];
for await (const file of walk(root)) {
  if (path.basename(file) !== 'raw-model-output.json' || !file.includes(`${path.sep}board-ops${path.sep}`)) continue;
  const boardDir = path.dirname(file);
  const runDir = path.resolve(boardDir, '..', '..', '..');
  let prep;
  try { prep = JSON.parse(await readFile(path.join(runDir, 'lesson-prep.json'), 'utf8')); } catch { continue; }
  const raw = JSON.parse(await readFile(file, 'utf8'));
  const subject = String(raw.subject ?? '');
  const sceneId = subject.replace(/^scene\s+/, '');
  const key = Object.keys(prep.beatPlans ?? {}).find((k) => k.endsWith(sceneId.replace(/^\d+-/, '')) || sceneId.endsWith(k) || k === sceneId);
  const section = prep.plan?.sections?.find((s) => s.id === key);
  if (!key || !section) { rows.push({ run: path.relative(root, runDir), subject, skipped: 'scene not found in lesson-prep.json' }); continue; }
  const narration = prep.beatNarrations[key];
  const ctx = {
    sceneId: key, title: section.title, beats: prep.beatPlans[key],
    narration: narration.beatSpans.map((span) => ({ beatId: span.beatId, sentences: span.sentenceSpans.map((s) => narration.text.slice(s.charStart, s.charEnd)) })),
    concepts: section.conceptIds.flatMap((id) => { const c = prep.graph.concepts.find((x) => x.id === id); return c ? [{ id: c.id, label: c.label, evidence: c.evidence.map((e) => ({ spanId: e.spanId, quote: e.quote })) }] : []; }),
    grounding: { verify: (spanId, quote) => anchorQuote(prep.sourceDoc, spanId, quote)?.ref.quote },
    initial: emptyBoardState(),
  };
  const first = raw.responses?.[0]?.content ?? '';
  const optionalPaths = compileProviderSchema(wireSchema, providerForModel(raw.model)).optionalPaths;
  const withoutSalvage = parseCandidates(first, SceneBoardDraftSchema, (draft) => validateSceneBoard(draft, ctx), optionalPaths);
  let lastAttempt;
  const withSalvage = parseCandidates(first, SceneBoardDraftSchema, (draft) => validateSceneBoard(draft, ctx), optionalPaths, (draft) => {
    lastAttempt = salvageAttempt(draft, ctx);
    return lastAttempt && lastAttempt.remaining.length === 0 ? { value: lastAttempt.value, entries: lastAttempt.entries } : undefined;
  });
  const problemCount = withoutSalvage.ok ? 0 : withoutSalvage.issues.length;
  rows.push({
    run: path.relative(root, runDir), subject, model: raw.model,
    firstResponseValid: withoutSalvage.ok, validatorProblems: problemCount,
    validAfterSalvage: withSalvage.ok, salvageChanges: withSalvage.ok ? (withSalvage.salvaged ?? 0) : 0,
    remainingProblems: withSalvage.ok ? [] : lastAttempt ? lastAttempt.remaining.map((p) => (typeof p === 'string' ? p : `${p.path}: ${p.message}`.slice(0, 220))) : [withoutSalvage.ok ? '' : withoutSalvage.error.slice(0, 300)],
    salvageEntries: lastAttempt ? lastAttempt.entries.length : undefined,
  });
}

const considered = rows.filter((r) => !r.skipped);
const summary = {
  retainedFirstScenes: considered.length,
  firstResponseValid: considered.filter((r) => r.firstResponseValid).length,
  validAfterSalvageWithoutAnyModelRepair: considered.filter((r) => r.validAfterSalvage).length,
};
console.log(JSON.stringify({ summary, rows }, null, 2));
if (jsonOut) await writeFile(jsonOut, `${JSON.stringify({ summary, rows }, null, 2)}\n`, 'utf8');
