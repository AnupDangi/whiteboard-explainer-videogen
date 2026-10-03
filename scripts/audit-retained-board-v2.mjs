#!/usr/bin/env node
/** Read-only revalidation of retained V2 snapshots and optional offline replay of recorded drafts/patches. Never calls a provider. */
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

async function modules() {
  const root = path.resolve(import.meta.dirname, '..', 'dist', 'src');
  const [validator, draft, reducer, timeline, layout, evidence, patcher] = await Promise.all([
    import(pathToFileURL(path.join(root, 'visual-v2/ops-plan/validate.js')).href),
    import(pathToFileURL(path.join(root, 'visual-v2/ops-plan/types.js')).href),
    import(pathToFileURL(path.join(root, 'visual-v2/board-state/reducer.js')).href),
    import(pathToFileURL(path.join(root, 'visual-v2/timeline/compile.js')).href),
    import(pathToFileURL(path.join(root, 'visual-v2/layout/sceneLayout.js')).href),
    import(pathToFileURL(path.join(root, 'plan/evidenceAnchor.js')).href),
    import(pathToFileURL(path.join(root, 'structured/jsonPointerRepair.js')).href),
  ]);
  return { ...validator, ...draft, ...reducer, ...timeline, ...layout, ...evidence, ...patcher };
}

async function jsonOrMissing(file) {
  try { return { value: JSON.parse(await readFile(file, 'utf8')) }; }
  catch (error) { return { error: error?.code === 'ENOENT' ? 'missing' : `unreadable: ${error.message}` }; }
}

async function historicalBoardRecord(run, sceneId) {
  const root = path.join(run, 'structured', 'board-ops');
  let dirs;
  try { dirs = await readdir(root, { withFileTypes: true }); }
  catch { return { status: 'unavailable' }; }
  for (const entry of dirs.filter((item) => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const dir = path.join(root, entry.name);
    const report = await jsonOrMissing(path.join(dir, 'report.json'));
    if (report.value?.subject !== `scene ${sceneId}`) continue;
    const [raw, validation, repairs] = await Promise.all([
      jsonOrMissing(path.join(dir, 'raw-model-output.json')),
      jsonOrMissing(path.join(dir, 'validation-errors.json')),
      jsonOrMissing(path.join(dir, 'repair-patches.json')),
    ]);
    return {
      status: raw.value ? 'captured' : 'partial',
      rawResponseCaptured: Boolean(raw.value),
      validationAttempts: (validation.value?.errors ?? []).map((attempt) => ({
        attempt: attempt.attempt,
        issues: (attempt.issues ?? []).map(({ path: issuePath, message }) => ({ path: issuePath, message })),
      })),
      repairs: (repairs.value?.repairs ?? []).map((repair) => ({
        repairIndex: repair.repairIndex, mode: repair.mode, targets: repair.targets ?? [],
        patches: (repair.patches ?? []).map((patch) => ({ op: patch.op, path: patch.path })),
      })),
      rawResponses: raw.value?.responses ?? [],
      repairPatchValues: repairs.value?.repairs ?? [],
    };
  }
  return { status: 'unavailable' };
}

function replayHistoricalResponses(record, ctx, modules) {
  const output = [];
  const initial = (record.rawResponses ?? []).find((response) => {
    try { const value = JSON.parse(response.content); return object(value) && Array.isArray(value.ops) && object(value.transition); }
    catch { return false; }
  });
  if (!initial) return { status: 'unavailable', attempts: [] };
  let raw;
  try { raw = JSON.parse(initial.content); }
  catch (error) { return { status: 'unavailable', reason: error.message, attempts: [] }; }
  let parsed = modules.SceneBoardDraftSchema.safeParse(raw);
  if (!parsed.success) return { status: 'schema-invalid', attempts: [{ attempt: initial.attempt, phase: 'initial-draft', problems: parsed.error.issues.map((issue) => ({ path: `/${issue.path.join('/')}`, message: issue.message })) }] };
  const currentFindings = (draft) => modules.validateSceneBoard(draft, ctx).map(({ path: issuePath, message }) => ({ path: issuePath, message }));
  output.push({ attempt: initial.attempt, phase: 'initial-draft', currentValidatorProblems: currentFindings(parsed.data) });
  for (const repair of record.repairPatchValues.slice().sort((a, b) => a.repairIndex - b.repairIndex)) {
    if (repair.mode !== 'patch' || !repair.patches?.length) { output.push({ repairIndex: repair.repairIndex, phase: repair.mode, status: 'not-replayable' }); continue; }
    try {
      const patched = modules.applyPatches(parsed.data, repair.patches);
      const next = modules.SceneBoardDraftSchema.safeParse(patched);
      if (!next.success) {
        output.push({ repairIndex: repair.repairIndex, phase: 'recorded-repair', status: 'schema-invalid', problems: next.error.issues.map((issue) => ({ path: `/${issue.path.join('/')}`, message: issue.message })) });
        break;
      }
      parsed = next;
      output.push({ repairIndex: repair.repairIndex, phase: 'recorded-repair', targets: repair.targets ?? [], patchCount: repair.patches.length, currentValidatorProblems: currentFindings(parsed.data) });
    } catch (error) {
      output.push({ repairIndex: repair.repairIndex, phase: 'recorded-repair', status: 'patch-failed', message: error.message });
      break;
    }
  }
  return { status: 'replayed-offline', attempts: output };
}

const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

export async function auditRetainedBoard(runDir) {
  const run = path.resolve(runDir);
  const prep = await jsonOrMissing(path.join(run, 'lesson-prep.json'));
  const base = {
    schemaVersion: 'retained-board-audit/v1', runDir: run,
    evidenceKind: 'retained-accepted-snapshots',
    caveat: 'Current validator findings apply to retained accepted snapshots. Separately retained raw S6 and repair records are summarized per scene when available; absence of those records is not inferred from the accepted snapshot.',
    historicalRawS6AndRepairStatus: 'reported-per-scene-when-captured',
  };
  if (prep.error || !Array.isArray(prep.value?.plan?.sections)) return {
    ...base, status: 'unavailable', reason: `lesson-prep.json ${prep.error ?? 'has no plan.sections'}`,
    scenes: [], counts: { acceptedSnapshotValid: 0, acceptedSnapshotInvalid: 0, unavailable: 0 },
  };
  const m = await modules();
  let carried = m.emptyBoardState();
  let prior;
  let contextAvailable = true;
  const scenes = [];
  for (const section of prep.value.plan.sections) {
    const sceneId = section?.id;
    const historical = typeof sceneId === 'string' ? await historicalBoardRecord(run, sceneId) : { status: 'unavailable' };
    const file = typeof sceneId === 'string' && /^[a-zA-Z0-9_-]+$/.test(sceneId)
      ? path.join(run, 'v2', `scene.${sceneId}.json`) : undefined;
    const snapshot = file ? await jsonOrMissing(file) : { error: 'unsafe or absent scene id' };
    if (snapshot.error || !contextAvailable) {
      scenes.push({ sceneId: sceneId ?? null, status: 'unavailable', reason: !contextAvailable ? 'inherited reducer/layout context unavailable after an earlier scene' : `accepted snapshot ${snapshot.error}`, artifact: file ? path.relative(run, file) : null, historical });
      if (snapshot.error) contextAvailable = false;
      continue;
    }
    const saved = snapshot.value;
    const parsed = m.SceneBoardDraftSchema.safeParse({ transition: saved?.transition, ops: saved?.ops });
    if (!parsed.success) {
      scenes.push({ sceneId, status: 'accepted-snapshot-invalid', artifact: path.relative(run, file), currentValidatorProblems: parsed.error.issues.map((issue) => ({ path: `/${issue.path.join('/')}`, message: issue.message })), historical });
      contextAvailable = false;
      continue;
    }
    const beats = prep.value.beatPlans?.[sceneId];
    const narration = prep.value.beatNarrations?.[sceneId];
    if (!Array.isArray(beats) || !Array.isArray(narration?.beatSpans) || !Array.isArray(section.conceptIds) || !object(prep.value.graph) || !Array.isArray(saved.beatTimings)) {
      scenes.push({ sceneId, status: 'unavailable', artifact: path.relative(run, file), reason: 'saved preparation or scene timing lacks context needed for current validation', historical });
      contextAvailable = false;
      continue;
    }
    const ctx = {
      sceneId, title: section.title, beats,
      narration: narration.beatSpans.map((span) => ({ beatId: span.beatId, sentences: span.sentenceSpans.map((s) => narration.text.slice(s.charStart, s.charEnd)) })),
      concepts: section.conceptIds.flatMap((id) => { const concept = prep.value.graph.concepts?.find((item) => item.id === id); return concept ? [{ id: concept.id, label: concept.label, evidence: (concept.evidence ?? []).map((e) => ({ spanId: e.spanId, quote: e.quote })) }] : []; }),
      initial: carried,
      ...(prior ? { prior } : {}),
      grounding: { verify: (spanId, quote) => m.anchorQuote(prep.value.sourceDoc, spanId, quote)?.ref.quote },
    };
    let problems;
    try { problems = m.validateSceneBoard(parsed.data, ctx); }
    catch (error) { problems = [{ path: '/', message: `current validator threw: ${error.message}` }]; }
    const { rawResponses: _rawResponses, repairPatchValues: _repairPatchValues, ...historicalSummary } = historical;
    scenes.push({ sceneId, status: problems.length ? 'accepted-snapshot-invalid' : 'accepted-snapshot-valid', artifact: path.relative(run, file), currentValidatorProblems: problems, historical: { ...historicalSummary, offlineReplay: replayHistoricalResponses(historical, ctx, m) } });
    // Reconstruct the same state and geometry the runner carried to the next scene.
    // A current validator failure may be a newer rule; continue when reducer replay is sound.
    try {
      const initial = m.startScene(carried, parsed.data.transition, sceneId);
      const compiled = m.compileSceneTimeline({ ops: parsed.data.ops, initial, beats: saved.beatTimings });
      carried = compiled.states.at(-1);
      prior = { state: carried, geometry: m.layoutScene(compiled.states, prior) };
    } catch (error) {
      scenes.at(-1).replayError = error.message;
      contextAvailable = false;
    }
  }
  const counts = {
    acceptedSnapshotValid: scenes.filter((scene) => scene.status === 'accepted-snapshot-valid').length,
    acceptedSnapshotInvalid: scenes.filter((scene) => scene.status === 'accepted-snapshot-invalid').length,
    unavailable: scenes.filter((scene) => scene.status === 'unavailable').length,
  };
  return { ...base, status: counts.unavailable ? 'incomplete' : counts.acceptedSnapshotInvalid ? 'current-validation-failures' : 'current-validation-valid', scenes, counts };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const runDir = process.argv[2];
  if (!runDir || process.argv.length !== 3) {
    process.stderr.write('Usage: node scripts/audit-retained-board-v2.mjs <saved-run-directory>\n');
    process.exitCode = 2;
  } else {
    auditRetainedBoard(runDir).then((report) => { process.stdout.write(`${JSON.stringify(report, null, 2)}\n`); }).catch((error) => {
      process.stderr.write(`Retained board audit failed: ${error.message}\n`);
      process.exitCode = 2;
    });
  }
}
