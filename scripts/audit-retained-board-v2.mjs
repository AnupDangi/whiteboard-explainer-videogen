#!/usr/bin/env node
/** Read-only revalidation of retained accepted V2 scene snapshots. Never replays provider responses. */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

async function modules() {
  const root = path.resolve(import.meta.dirname, '..', 'dist', 'src');
  const [validator, draft, reducer, timeline, layout, evidence] = await Promise.all([
    import(pathToFileURL(path.join(root, 'visual-v2/ops-plan/validate.js')).href),
    import(pathToFileURL(path.join(root, 'visual-v2/ops-plan/types.js')).href),
    import(pathToFileURL(path.join(root, 'visual-v2/board-state/reducer.js')).href),
    import(pathToFileURL(path.join(root, 'visual-v2/timeline/compile.js')).href),
    import(pathToFileURL(path.join(root, 'visual-v2/layout/sceneLayout.js')).href),
    import(pathToFileURL(path.join(root, 'plan/evidenceAnchor.js')).href),
  ]);
  return { ...validator, ...draft, ...reducer, ...timeline, ...layout, ...evidence };
}

async function jsonOrMissing(file) {
  try { return { value: JSON.parse(await readFile(file, 'utf8')) }; }
  catch (error) { return { error: error?.code === 'ENOENT' ? 'missing' : `unreadable: ${error.message}` }; }
}

const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

export async function auditRetainedBoard(runDir) {
  const run = path.resolve(runDir);
  const prep = await jsonOrMissing(path.join(run, 'lesson-prep.json'));
  const base = {
    schemaVersion: 'retained-board-audit/v1', runDir: run,
    evidenceKind: 'retained-accepted-snapshots',
    caveat: 'These are retained accepted scene snapshots, not original raw S6 responses or repair transcripts. Current validator findings cannot be assigned to the historical model or repair rounds.',
    historicalRawS6AndRepairStatus: 'unmeasured',
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
    const file = typeof sceneId === 'string' && /^[a-zA-Z0-9_-]+$/.test(sceneId)
      ? path.join(run, 'v2', `scene.${sceneId}.json`) : undefined;
    const snapshot = file ? await jsonOrMissing(file) : { error: 'unsafe or absent scene id' };
    if (snapshot.error || !contextAvailable) {
      scenes.push({ sceneId: sceneId ?? null, status: 'unavailable', reason: !contextAvailable ? 'inherited reducer/layout context unavailable after an earlier scene' : `accepted snapshot ${snapshot.error}`, artifact: file ? path.relative(run, file) : null });
      continue;
    }
    const saved = snapshot.value;
    const parsed = m.SceneBoardDraftSchema.safeParse({ transition: saved?.transition, ops: saved?.ops });
    if (!parsed.success) {
      scenes.push({ sceneId, status: 'accepted-snapshot-invalid', artifact: path.relative(run, file), currentValidatorProblems: parsed.error.issues.map((issue) => ({ path: `/${issue.path.join('/')}`, message: issue.message })), historicalValidatorProblems: 'unavailable' });
      contextAvailable = false;
      continue;
    }
    const beats = prep.value.beatPlans?.[sceneId];
    const narration = prep.value.beatNarrations?.[sceneId];
    if (!Array.isArray(beats) || !Array.isArray(narration?.beatSpans) || !Array.isArray(section.conceptIds) || !object(prep.value.graph) || !Array.isArray(saved.beatTimings)) {
      scenes.push({ sceneId, status: 'unavailable', artifact: path.relative(run, file), reason: 'saved preparation or scene timing lacks context needed for current validation' });
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
    scenes.push({ sceneId, status: problems.length ? 'accepted-snapshot-invalid' : 'accepted-snapshot-valid', artifact: path.relative(run, file), currentValidatorProblems: problems, historicalValidatorProblems: 'unavailable' });
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
