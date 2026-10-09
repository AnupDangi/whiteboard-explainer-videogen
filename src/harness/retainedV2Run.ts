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
import { iconCardSide } from '../visual-v2/renderer/visuals.js';
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

export async function loadRetainedV2Run(runDir: string, options: { composition?: 'labels' | 'icon-cards' } = {}): Promise<RetainedV2Run> {
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
    const scene = compileScene(sceneId, typeof section.title === 'string' ? section.title : sceneId, timeline, lessonId, concepts, prior, { composition: options.composition ?? 'labels' });
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
  const pictures: IconUse[] = audit.evidence.flatMap((evidence) => {
    if (evidence.depictionFamily !== 'pictorial' || !evidence.meaningful || !evidence.resolvedAssetId) return [];
    const rect = elementRect(scene, evidence.elementId);
    const houseFamily = catalog.get(evidence.resolvedAssetId)?.houseFamily;
    return [{ elementId: evidence.elementId, referent: referentOf(elementLabel(scene, evidence.elementId)), assetId: evidence.resolvedAssetId, ...(houseFamily ? { houseFamily } : {}), sidePx: rect ? Math.min(rect.w, rect.h) : 0, kind: 'entity-picture' as const }];
  });
  // A planned badge counts only when the renderer will actually draw it (same fit rule as iconCard).
  const badges: IconUse[] = [...(scene.badges ?? [])].flatMap(([elementId, badge]) => {
    const rect = elementRect(scene, elementId);
    const side = rect ? iconCardSide(rect, elementLabel(scene, elementId)) : null;
    if (side === null) return [];
    return [{ elementId, referent: badge.referent, assetId: badge.assetId, ...(badge.houseFamily ? { houseFamily: badge.houseFamily } : {}), sidePx: side, kind: 'badge' as const }];
  });
  return [...pictures, ...badges];
}
