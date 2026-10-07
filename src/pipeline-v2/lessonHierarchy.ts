import { z } from 'zod';
import type { ModulePlan, Syllabus } from '../plan/hierarchical.js';
import type { ConceptGraph, TeachingPlan } from '../plan/schemas.js';
import type { TeachingBeat } from '../teaching/beat-plan/types.js';
import { stableJson } from '../shared/artifacts.js';

const id = z.string().min(1);
const ids = z.array(id);
const ms = z.number().int().nonnegative();
const terminologySchema = z.object({ conceptId: id, label: z.string().min(1) }).strict();
const sceneSchema = z.object({
  sceneId: id,
  order: z.number().int().positive(),
  conceptIds: ids,
  claimIds: ids,
  beatIds: ids,
  speechStartMs: ms,
  speechDurationMs: ms,
  speechEndMs: ms,
  windowEndMs: ms,
}).strict();
const checkpointSchema = z.object({
  afterSceneId: id,
  speechTimeMs: ms,
  windowEndMs: ms,
  cumulativeConceptIds: ids,
  cumulativeClaimIds: ids,
  terminology: z.array(terminologySchema),
}).strict();
const sourceChapterSchema = z.object({
  chapterId: id,
  title: z.string().min(1),
  goal: z.string().min(1),
  requestedBudgetMs: ms,
  plannedBudgetMs: ms,
  conceptIds: ids,
  evidenceSpanIds: ids,
  recallOfChapterIds: ids,
  sceneIds: ids,
}).strict();
const hierarchySourceSchema = z.object({
  schemaVersion: z.literal('lesson-hierarchy-input/v1'),
  chapters: z.array(sourceChapterSchema).min(1),
}).strict();
export const LessonHierarchyInputArtifactSchema = z.object({
  schemaVersion: z.literal('lesson-hierarchy-input/v1'),
  mode: z.enum(['syllabus', 'flat-compatibility']),
  chapters: z.array(sourceChapterSchema),
}).strict();
const chapterSchema = z.object({
  chapterId: id,
  order: z.number().int().positive(),
  title: z.string().min(1),
  goal: z.string().min(1),
  requestedBudgetMs: ms,
  plannedBudgetMs: ms,
  conceptIds: ids,
  evidenceSpanIds: ids,
  recallOfChapterIds: ids,
  sceneIds: ids,
  scenes: z.array(sceneSchema).min(1),
  actualSpeechDurationMs: ms,
  timelineDurationMs: ms,
  checkpoint: checkpointSchema,
}).strict();

export const LessonHierarchySchema = z.object({
  schemaVersion: z.literal('lesson-hierarchy/v1'),
  mode: z.enum(['syllabus', 'flat-compatibility']),
  source: hierarchySourceSchema.nullable(),
  chapters: z.array(chapterSchema).min(1),
}).strict();
export type LessonHierarchy = z.infer<typeof LessonHierarchySchema>;
export type LessonHierarchyInputArtifact = z.infer<typeof LessonHierarchyInputArtifactSchema>;

export interface FinalHierarchyScene {
  sceneId: string;
  durationMs: number;
  startMs: number;
  endMs: number;
}

export interface LessonHierarchyInput {
  syllabus?: Syllabus;
  modules?: ModulePlan[];
  plan: TeachingPlan;
  graph: ConceptGraph;
  beatPlans: Record<string, TeachingBeat[]>;
  scenes: FinalHierarchyScene[];
}

const unique = (values: string[]): string[] => [...new Set(values)];
const sameStrings = (left: string[], right: string[]): boolean => left.length === right.length && left.every((value, index) => value === right[index]);
const sameSet = (left: string[], right: string[]): boolean => left.length === right.length && new Set(left).size === left.length && new Set(right).size === right.length && left.every((value) => right.includes(value));

/** Build explicit chapter membership/checkpoints from prepared hierarchy and the final, measured V2 scene clock. */
export function buildLessonHierarchy(input: LessonHierarchyInput): LessonHierarchy {
  const { syllabus, modules } = input;
  const flatCompatibility = !syllabus && !modules;
  if (!flatCompatibility && (!syllabus || !modules)) throw new Error('hierarchical lesson requires both syllabus and prepared modules');
  if (syllabus && modules && (syllabus.modules.length !== modules.length || !modules.length)) throw new Error('syllabus and prepared module counts do not match');

  const planSections = input.plan.sections;
  const sectionById = new Map(planSections.map((section) => [section.id, section]));
  if (sectionById.size !== planSections.length) throw new Error('global plan contains duplicate scene ids');
  const finalSceneById = new Map(input.scenes.map((scene) => [scene.sceneId, scene]));
  if (finalSceneById.size !== input.scenes.length || finalSceneById.size !== planSections.length) throw new Error('final V2 audio clock does not cover each planned scene exactly once');
  const graphConcepts = new Map(input.graph.concepts.map((concept) => [concept.id, concept]));
  const chapterIds = new Set<string>();
  const seenConceptIds: string[] = [];
  const seenClaimIds: string[] = [];
  const chapters: LessonHierarchy['chapters'] = [];
  const flattenedSceneIds: string[] = [];

  if (flatCompatibility) {
    const scenes = planSections.map((section, sceneIndex) => {
      const final = finalSceneById.get(section.id);
      const beats = input.beatPlans[section.id];
      if (!final || !beats?.length) throw new Error(`flat lesson scene ${section.id} is missing final timing or teaching beats`);
      return sceneSchema.parse({
        sceneId: section.id,
        order: sceneIndex + 1,
        conceptIds: [...section.conceptIds],
        claimIds: section.contract?.essentialClaims.map((claim) => claim.id) ?? [],
        beatIds: beats.map((beat) => beat.beatId),
        speechStartMs: final.startMs,
        speechDurationMs: final.durationMs,
        speechEndMs: final.startMs + final.durationMs,
        windowEndMs: final.endMs,
      });
    });
    const conceptIds = unique(scenes.flatMap((scene) => scene.conceptIds));
    const claimIds = unique(scenes.flatMap((scene) => scene.claimIds));
    const evidenceSpanIds = unique(planSections.flatMap((section) => section.contract?.essentialClaims.flatMap((claim) => claim.evidenceSpanIds) ?? []));
    const last = scenes.at(-1)!;
    const first = scenes[0]!;
    const terminology = conceptIds.map((conceptId) => {
      const concept = graphConcepts.get(conceptId);
      if (!concept) throw new Error(`flat lesson refers to unknown graph concept ${conceptId}`);
      return { conceptId, label: concept.label };
    });
    chapters.push(chapterSchema.parse({
      chapterId: 'flat-compatibility', order: 1, title: 'Flat compatibility lesson', goal: 'Preserve the ordered scene plan as a single chapter.',
      requestedBudgetMs: input.plan.targetDurationSec * 1000, plannedBudgetMs: input.plan.targetDurationSec * 1000,
      conceptIds, evidenceSpanIds,
      recallOfChapterIds: [], sceneIds: scenes.map((scene) => scene.sceneId), scenes,
      actualSpeechDurationMs: scenes.reduce((sum, scene) => sum + scene.speechDurationMs, 0),
      timelineDurationMs: last.windowEndMs - first.speechStartMs,
      checkpoint: { afterSceneId: last.sceneId, speechTimeMs: last.speechEndMs, windowEndMs: last.windowEndMs, cumulativeConceptIds: conceptIds, cumulativeClaimIds: claimIds, terminology },
    }));
    return LessonHierarchySchema.parse({ schemaVersion: 'lesson-hierarchy/v1', mode: 'flat-compatibility', source: null, chapters });
  }

  const sourceChapters: z.infer<typeof sourceChapterSchema>[] = [];
  for (const [index, [syllabusModule, module]] of syllabus!.modules.map((item, i) => [item, modules![i]!] as const).entries()) {
    if (module.moduleId !== syllabusModule.id || module.title !== syllabusModule.title || module.goal !== syllabusModule.goal) {
      throw new Error(`syllabus module ${syllabusModule.id} does not match its prepared module`);
    }
    if (module.requestedBudgetSec !== undefined && module.requestedBudgetSec !== syllabusModule.budgetSec) {
      throw new Error(`syllabus module ${syllabusModule.id} requested budget does not match its prepared module`);
    }
    if (!sameStrings(module.conceptIds, syllabusModule.conceptIds)) throw new Error(`syllabus module ${syllabusModule.id} concept order differs from its prepared module`);
    if (chapterIds.has(module.moduleId)) throw new Error(`duplicate chapter id ${module.moduleId}`);
    chapterIds.add(module.moduleId);
    if (syllabusModule.recallOfModuleIds.some((recallId) => !chapterIds.has(recallId) || recallId === module.moduleId)) {
      throw new Error(`chapter ${module.moduleId} recalls a chapter that is not earlier in the syllabus`);
    }

    const moduleSections = module.plan.sections;
    if (!moduleSections.length) throw new Error(`chapter ${module.moduleId} has no planned scenes`);
    const moduleSceneIds = moduleSections.map((section) => section.id);
    for (const section of moduleSections) {
      const globalSection = sectionById.get(section.id);
      if (!globalSection || stableJson(globalSection) !== stableJson(section)) throw new Error(`chapter ${module.moduleId} scene ${section.id} differs from the global lesson plan`);
      if (!finalSceneById.has(section.id)) throw new Error(`chapter ${module.moduleId} scene ${section.id} has no final V2 audio timing`);
      if (!input.beatPlans[section.id]?.length) throw new Error(`chapter ${module.moduleId} scene ${section.id} has no teaching beats`);
    }
    const chapterConceptIds = unique(moduleSections.flatMap((section) => section.conceptIds));
    if (!sameSet(chapterConceptIds, syllabusModule.conceptIds)) throw new Error(`chapter ${module.moduleId} syllabus concepts do not match the concepts taught by its scenes`);
    const orderedChapterConceptIds = [...syllabusModule.conceptIds];
    for (const conceptId of orderedChapterConceptIds) if (!graphConcepts.has(conceptId)) throw new Error(`chapter ${module.moduleId} refers to unknown graph concept ${conceptId}`);

    const scenes = moduleSections.map((section, sceneIndex) => {
      const final = finalSceneById.get(section.id)!;
      const beats = input.beatPlans[section.id]!;
      const claimIds = section.contract?.essentialClaims.map((claim) => claim.id) ?? [];
      const ref = {
        sceneId: section.id,
        order: sceneIndex + 1,
        conceptIds: [...section.conceptIds],
        claimIds,
        beatIds: beats.map((beat) => beat.beatId),
        speechStartMs: final.startMs,
        speechDurationMs: final.durationMs,
        speechEndMs: final.startMs + final.durationMs,
        windowEndMs: final.endMs,
      };
      return sceneSchema.parse(ref);
    });
    const first = scenes[0]!;
    const last = scenes.at(-1)!;
    const actualSpeechDurationMs = scenes.reduce((sum, scene) => sum + scene.speechDurationMs, 0);
    const timelineDurationMs = last.windowEndMs - first.speechStartMs;
    if (timelineDurationMs < actualSpeechDurationMs) throw new Error(`chapter ${module.moduleId} timeline is shorter than its measured speech`);
    seenConceptIds.push(...orderedChapterConceptIds);
    seenClaimIds.push(...scenes.flatMap((scene) => scene.claimIds));
    const cumulativeConceptIds = unique(seenConceptIds);
    const cumulativeClaimIds = unique(seenClaimIds);
    const terminology = cumulativeConceptIds.map((conceptId) => {
      const concept = graphConcepts.get(conceptId)!;
      return { conceptId, label: concept.label };
    });
    flattenedSceneIds.push(...moduleSceneIds);
    sourceChapters.push({
      chapterId: module.moduleId,
      title: module.title,
      goal: module.goal,
      requestedBudgetMs: syllabusModule.budgetSec * 1000,
      plannedBudgetMs: module.budgetSec * 1000,
      conceptIds: orderedChapterConceptIds,
      evidenceSpanIds: unique(syllabusModule.evidenceSpanIds),
      recallOfChapterIds: [...syllabusModule.recallOfModuleIds],
      sceneIds: moduleSceneIds,
    });
    chapters.push(chapterSchema.parse({
      chapterId: module.moduleId,
      order: index + 1,
      title: module.title,
      goal: module.goal,
      requestedBudgetMs: syllabusModule.budgetSec * 1000,
      plannedBudgetMs: module.budgetSec * 1000,
      conceptIds: orderedChapterConceptIds,
      evidenceSpanIds: unique(syllabusModule.evidenceSpanIds),
      recallOfChapterIds: [...syllabusModule.recallOfModuleIds],
      sceneIds: moduleSceneIds,
      scenes,
      actualSpeechDurationMs,
      timelineDurationMs,
      checkpoint: {
        afterSceneId: last.sceneId,
        speechTimeMs: last.speechEndMs,
        windowEndMs: last.windowEndMs,
        cumulativeConceptIds,
        cumulativeClaimIds,
        terminology,
      },
    }));
  }

  if (!sameStrings(flattenedSceneIds, planSections.map((section) => section.id))) throw new Error('chapter scene order/partition does not match the global lesson plan');
  if (finalSceneById.size !== flattenedSceneIds.length) throw new Error('hierarchy leaves a final V2 scene unassigned');
  return LessonHierarchySchema.parse({ schemaVersion: 'lesson-hierarchy/v1', mode: 'syllabus', source: { schemaVersion: 'lesson-hierarchy-input/v1', chapters: sourceChapters }, chapters });
}

/** Serialize the source-side projection separately so a context edit cannot silently change chapter allocations. */
export function lessonHierarchyInputArtifact(hierarchy: LessonHierarchy): LessonHierarchyInputArtifact {
  return LessonHierarchyInputArtifactSchema.parse({
    schemaVersion: 'lesson-hierarchy-input/v1',
    mode: hierarchy.mode,
    chapters: hierarchy.source?.chapters ?? [],
  });
}

type JsonRecord = Record<string, unknown>;
const recordOf = (value: unknown): JsonRecord | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : undefined;
const arrayOf = (value: unknown): unknown[] | undefined => Array.isArray(value) ? value : undefined;
const stringArray = (value: unknown): string[] | undefined => Array.isArray(value) && value.every((item) => typeof item === 'string') ? value as string[] : undefined;

/** Independently check hierarchy membership, checkpoint projections, and final scene/audio timing in a lock. */
export function lessonHierarchyProblems(contextBytes: Buffer, scenes: Array<{ sceneId: string; startMs: number; endMs: number }>, alignmentBytes?: Buffer, inputBytes?: Buffer): string[] {
  let context: JsonRecord;
  try { context = recordOf(JSON.parse(contextBytes.toString('utf8'))) ?? {}; } catch { return []; }
  const contextVersion = context.schemaVersion === 'lesson-context/v12' ? 'v12' : context.schemaVersion === 'lesson-context/v11' ? 'v11' : context.schemaVersion === 'lesson-context/v10' ? 'v10' : context.schemaVersion === 'lesson-context/v9' ? 'v9' : context.schemaVersion === 'lesson-context/v8' ? 'v8' : undefined;
  if (!contextVersion) return [];
  if (!Object.hasOwn(context, 'lessonHierarchy')) return [`lesson context ${contextVersion} has no lessonHierarchy field`];
  if (context.lessonHierarchy === null) return [`lesson context ${contextVersion} must carry a non-null structural hierarchy`];
  const parsed = LessonHierarchySchema.safeParse(context.lessonHierarchy);
  if (!parsed.success) return parsed.error.issues.map((issue) => `lesson hierarchy is malformed at ${issue.path.join('.') || '<root>'}: ${issue.message}`);

  const problems: string[] = [];
  const hierarchy = parsed.data;
  if (!inputBytes) return [`lesson context ${contextVersion} hierarchy input artifact is not pinned by the V2 lock`];
  let inputValue: unknown;
  try { inputValue = JSON.parse(inputBytes.toString('utf8')); } catch { return ['locked lesson hierarchy input artifact is invalid JSON']; }
  const parsedInput = LessonHierarchyInputArtifactSchema.safeParse(inputValue);
  if (!parsedInput.success) return parsedInput.error.issues.map((issue) => `locked lesson hierarchy inputs are malformed at ${issue.path.join('.') || '<root>'}: ${issue.message}`);
  const hierarchyInput = parsedInput.data;
  if (hierarchyInput.mode !== hierarchy.mode) return ['lesson hierarchy mode does not match its separately locked input artifact'];
  if (stableJson(hierarchy.source?.chapters ?? []) !== stableJson(hierarchyInput.chapters)) return ['lesson hierarchy metadata differs from its separately locked input artifact'];
  if ((hierarchy.mode === 'syllabus' && !hierarchyInput.chapters.length) || (hierarchy.mode === 'flat-compatibility' && hierarchyInput.chapters.length)) {
    return ['lesson hierarchy mode is inconsistent with its separately locked input artifact'];
  }
  const plan = recordOf(context.plan);
  const sections = arrayOf(plan?.sections)?.map(recordOf).filter((section): section is JsonRecord => Boolean(section)) ?? [];
  const planSceneIds = sections.map((section) => typeof section.id === 'string' ? section.id : '');
  const lockedSceneIds = scenes.map((scene) => scene.sceneId);
  const flattened = hierarchy.chapters.flatMap((chapter) => chapter.sceneIds);
  if (new Set(hierarchy.chapters.map((chapter) => chapter.chapterId)).size !== hierarchy.chapters.length) problems.push('lesson hierarchy has duplicate chapter ids');
  if (!sameStrings(flattened, planSceneIds)) problems.push('lesson hierarchy chapters do not partition plan scenes in lesson order');
  if (!sameStrings(flattened, lockedSceneIds)) problems.push('lesson hierarchy scenes do not match the ordered V2 scene lock');

  let alignment: JsonRecord | undefined;
  try { alignment = alignmentBytes ? recordOf(JSON.parse(alignmentBytes.toString('utf8'))) : undefined; } catch { /* reported below */ }
  const alignedScenes = arrayOf(alignment?.scenes)?.map(recordOf).filter((scene): scene is JsonRecord => Boolean(scene)) ?? [];
  const alignmentById = new Map(alignedScenes.flatMap((scene) => typeof scene['sceneId'] === 'string' ? [[scene['sceneId'], scene] as const] : []));
  const sectionById = new Map(sections.flatMap((section) => typeof section.id === 'string' ? [[section.id, section] as const] : []));
  const beatPlans = recordOf(context.beatPlans) ?? {};
  const graph = recordOf(context.graph);
  const graphConcepts = arrayOf(graph?.concepts)?.map(recordOf).filter((concept): concept is JsonRecord => Boolean(concept)) ?? [];
  const labels = new Map(graphConcepts.flatMap((concept) => typeof concept.id === 'string' && typeof concept.label === 'string' ? [[concept.id, concept.label] as const] : []));
  const sourceDoc = recordOf(context.sourceDoc);
  const sourceSpanIds = new Set((arrayOf(sourceDoc?.spans) ?? []).flatMap((span) => {
    const parsedSpan = recordOf(span);
    return typeof parsedSpan?.id === 'string' ? [parsedSpan.id] : [];
  }));
  const source = hierarchy.source;
  if (hierarchy.mode === 'syllabus') {
    if (!source) problems.push('syllabus hierarchy has no pinned module inputs');
    else {
      if (source.chapters.length !== hierarchy.chapters.length) problems.push('hierarchy chapter count differs from pinned syllabus/module inputs');
      for (const [index, chapter] of hierarchy.chapters.entries()) {
        const input = source.chapters[index];
        if (!input) continue;
        if (chapter.chapterId !== input.chapterId || chapter.title !== input.title || chapter.goal !== input.goal
          || chapter.requestedBudgetMs !== input.requestedBudgetMs || chapter.plannedBudgetMs !== input.plannedBudgetMs
          || !sameStrings(chapter.conceptIds, input.conceptIds) || !sameStrings(chapter.evidenceSpanIds, input.evidenceSpanIds)
          || !sameStrings(chapter.recallOfChapterIds, input.recallOfChapterIds) || !sameStrings(chapter.sceneIds, input.sceneIds)) {
          problems.push(`chapter ${chapter.chapterId} metadata differs from its pinned syllabus/module inputs`);
        }
      }
    }
  } else {
    if (source !== null) problems.push('flat compatibility hierarchy unexpectedly carries syllabus inputs');
    if (hierarchy.chapters.length !== 1 || hierarchy.chapters[0]?.chapterId !== 'flat-compatibility') problems.push('flat compatibility hierarchy must contain its single explicit chapter');
    const flat = hierarchy.chapters[0];
    const targetMs = typeof plan?.targetDurationSec === 'number' ? plan.targetDurationSec * 1000 : undefined;
    if (!flat || flat.title !== 'Flat compatibility lesson' || flat.goal !== 'Preserve the ordered scene plan as a single chapter.'
      || targetMs === undefined || flat.requestedBudgetMs !== targetMs || flat.plannedBudgetMs !== targetMs
      || !sameStrings(flat.sceneIds, planSceneIds)
      || !sameSet(flat.evidenceSpanIds, unique(sections.flatMap((section) => arrayOf(recordOf(section.contract)?.essentialClaims)?.flatMap((claim) => stringArray(recordOf(claim)?.evidenceSpanIds) ?? []) ?? [])))) {
      problems.push('flat compatibility chapter does not match the canonical lesson plan');
    }
  }
  const allConceptIds: string[] = [];
  const allClaimIds: string[] = [];
  const chapterIds: string[] = [];

  for (const [chapterIndex, chapter] of hierarchy.chapters.entries()) {
    if (chapter.order !== chapterIndex + 1) problems.push(`chapter ${chapter.chapterId} has unstable order`);
    if (chapterIds.includes(chapter.chapterId)) problems.push(`chapter ${chapter.chapterId} is duplicated`);
    if (chapter.recallOfChapterIds.some((id) => !chapterIds.includes(id))) problems.push(`chapter ${chapter.chapterId} recalls a chapter that is not earlier`);
    chapterIds.push(chapter.chapterId);
    if (!sameStrings(chapter.sceneIds, chapter.scenes.map((scene) => scene.sceneId))) problems.push(`chapter ${chapter.chapterId} scene refs differ from its sceneIds`);
    const expectedConceptIds: string[] = [];
    let speechTotal = 0;
    let previousSceneIndex = -1;
    for (const [sceneIndex, sceneRef] of chapter.scenes.entries()) {
      if (sceneRef.order !== sceneIndex + 1) problems.push(`chapter ${chapter.chapterId} scene ${sceneRef.sceneId} has unstable order`);
      const lockedIndex = scenes.findIndex((scene) => scene.sceneId === sceneRef.sceneId);
      const section = sectionById.get(sceneRef.sceneId);
      if (lockedIndex < 0 || !section) { problems.push(`chapter ${chapter.chapterId} references unknown scene ${sceneRef.sceneId}`); continue; }
      if (lockedIndex <= previousSceneIndex) problems.push(`chapter ${chapter.chapterId} scene order is not chronological`);
      previousSceneIndex = lockedIndex;
      const lockScene = scenes[lockedIndex]!;
      const aligned = alignmentById.get(sceneRef.sceneId);
      if (sceneRef.speechStartMs !== lockScene.startMs || sceneRef.windowEndMs !== lockScene.endMs) problems.push(`chapter ${chapter.chapterId} scene ${sceneRef.sceneId} timing differs from the V2 scene lock`);
      if (!aligned || typeof aligned.durationMs !== 'number' || sceneRef.speechDurationMs !== aligned.durationMs || sceneRef.speechEndMs !== sceneRef.speechStartMs + sceneRef.speechDurationMs) problems.push(`chapter ${chapter.chapterId} scene ${sceneRef.sceneId} speech timing differs from final alignment`);
      const concepts = stringArray(section.conceptIds) ?? [];
      const claims = arrayOf(recordOf(section.contract)?.essentialClaims)?.map(recordOf).filter((claim): claim is JsonRecord => Boolean(claim)).flatMap((claim) => typeof claim.id === 'string' ? [claim.id] : []) ?? [];
      const beats = arrayOf(beatPlans[sceneRef.sceneId])?.map(recordOf).filter((beat): beat is JsonRecord => Boolean(beat)).flatMap((beat) => typeof beat.beatId === 'string' ? [beat.beatId] : []) ?? [];
      if (!sameStrings(sceneRef.conceptIds, concepts)) problems.push(`chapter ${chapter.chapterId} scene ${sceneRef.sceneId} concepts differ from its canonical plan`);
      if (!sameStrings(sceneRef.claimIds, claims)) problems.push(`chapter ${chapter.chapterId} scene ${sceneRef.sceneId} claims differ from its canonical plan`);
      if (!sameStrings(sceneRef.beatIds, beats)) problems.push(`chapter ${chapter.chapterId} scene ${sceneRef.sceneId} beats differ from its pinned beat plan`);
      expectedConceptIds.push(...concepts);
      speechTotal += sceneRef.speechDurationMs;
    }
    const canonicalChapterConceptIds = unique(expectedConceptIds);
    if (!sameSet(chapter.conceptIds, canonicalChapterConceptIds)) problems.push(`chapter ${chapter.chapterId} concepts do not match its canonical scenes`);
    if (chapter.requestedBudgetMs <= 0 || chapter.plannedBudgetMs <= 0) problems.push(`chapter ${chapter.chapterId} has a non-positive budget`);
    for (const spanId of chapter.evidenceSpanIds) if (!sourceSpanIds.has(spanId)) problems.push(`chapter ${chapter.chapterId} references unknown source evidence span ${spanId}`);
    if (chapter.scenes.length) {
      const first = chapter.scenes[0]!;
      const last = chapter.scenes.at(-1)!;
      if (chapter.actualSpeechDurationMs !== speechTotal) problems.push(`chapter ${chapter.chapterId} speech duration does not match its final scene alignments`);
      if (chapter.timelineDurationMs !== last.windowEndMs - first.speechStartMs) problems.push(`chapter ${chapter.chapterId} timeline duration does not match its locked scene windows`);
      if (chapter.checkpoint.afterSceneId !== last.sceneId || chapter.checkpoint.speechTimeMs !== last.speechEndMs || chapter.checkpoint.windowEndMs !== last.windowEndMs) problems.push(`chapter ${chapter.chapterId} checkpoint does not land after its final scene`);
    }
    allConceptIds.push(...chapter.conceptIds);
    allClaimIds.push(...chapter.scenes.flatMap((scene) => scene.claimIds));
    const cumulativeConceptIds = unique(allConceptIds);
    const cumulativeClaimIds = unique(allClaimIds);
    if (!sameStrings(chapter.checkpoint.cumulativeConceptIds, cumulativeConceptIds)) problems.push(`chapter ${chapter.chapterId} cumulative concept checkpoint is inconsistent`);
    if (!sameStrings(chapter.checkpoint.cumulativeClaimIds, cumulativeClaimIds)) problems.push(`chapter ${chapter.chapterId} cumulative claim checkpoint is inconsistent`);
    const expectedTerminology = cumulativeConceptIds.map((conceptId) => ({ conceptId, label: labels.get(conceptId) ?? '' }));
    if (expectedTerminology.some((term) => !term.label) || stableJson(chapter.checkpoint.terminology) !== stableJson(expectedTerminology)) problems.push(`chapter ${chapter.chapterId} terminology checkpoint differs from the canonical concept graph`);
  }
  return problems;
}
