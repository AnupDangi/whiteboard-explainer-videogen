import { sha256, stableJson } from '../../shared/artifacts.js';
import type { LessonBible, SceneContract } from '../plan/schemas.js';
import type { EvidenceReference } from '../../shared/contracts.js';
import type { PlannerSceneInput } from './prompt.js';
import { TEMPLATE_SLOTS } from './prompt.js';
import { TAU_MID_EMB } from '../catalog/ladder.js';
import { EXAMPLE_BANK_HASH, EXAMPLE_BANK_VERSION, EXAMPLE_RANK_VERSION, exemplarContextRecord, selectExemplars, type PromptArm, type SelectedExemplar } from './exemplars.js';
import { SCENE_DIRECTOR_SKILL_HASH, SCENE_DIRECTOR_SKILL_VERSION } from './sceneDirectorSkill.js';
import { RECIPE_VERSION } from './recipes.js';

export const SCENE_PROMPT_VERSION = 'scene-planner-prompt-v13';
export const SCENE_SKILL_VERSION = SCENE_DIRECTOR_SKILL_VERSION;
export const CANDIDATE_FEASIBILITY_VERSION = `catalog-embedding-min-${TAU_MID_EMB}-v1`;
export type ExampleOrder = 'ranked' | 'reverse';

const relationKey = (relation: { from: string; to: string; type: string }): string => `${relation.from}|${relation.type}|${relation.to}`;

export interface ScenePlanningContext {
  schemaVersion: 'scene-planning-context/v2';
  sceneContract: SceneContract;
  lessonBible: LessonBible;
  narration: { raw: string; plainText: string; mentions: PlannerSceneInput['mentions'] };
  teachingContext: PlannerSceneInput['teachingContext'];
  evidence: EvidenceReference[];
  visualCandidates: PlannerSceneInput['candidates'];
  availableTemplates: Array<{ id: string; slots: Array<{ name: string; capacity: number | 'many' }> }>;
  mentionTimes: Array<{ id: string; startMs: number; endMs: number }>;
  previousElements: PlannerSceneInput['previousElements'];
  promptArm: PromptArm;
  exampleOrder: ExampleOrder;
  examples: SelectedExemplar[];
  versions: { prompt: string; skill: string; skillHash: string; bank: string; bankHash: string; rank: string; catalog: string; candidateFeasibility: string; recipes: string };
  contextHash: string;
}

/** S4/S5 add anchors and timing to S3's semantic contract without a second planning call. */
export function compileScenePlanningContext(input: PlannerSceneInput, contract: SceneContract, bible: LessonBible, mentionTimes: ScenePlanningContext['mentionTimes'], arm: PromptArm, catalogVersion: string, sourceId?: string, caseId?: string, exampleOrder: ExampleOrder = 'ranked'): ScenePlanningContext {
  if (arm === 'zero' && exampleOrder !== 'ranked') throw new Error('example order permutation requires a retrieval prompt arm');
  const requiredConceptIds = contract.requiredConceptIds;
  const suppliedConceptIds = (input.teachingContext?.concepts ?? []).map((concept) => concept.id);
  if (new Set(requiredConceptIds).size !== requiredConceptIds.length || new Set(suppliedConceptIds).size !== suppliedConceptIds.length ||
    requiredConceptIds.length !== suppliedConceptIds.length || requiredConceptIds.some((id) => !suppliedConceptIds.includes(id))) {
    throw new Error(`${input.sceneId}: source concept context must exactly match SceneContract.requiredConceptIds`);
  }
  const requiredRelationKeys = contract.requiredRelations.map(relationKey);
  const suppliedRelationKeys = (input.teachingContext?.relations ?? []).map(relationKey);
  if (new Set(requiredRelationKeys).size !== requiredRelationKeys.length || new Set(suppliedRelationKeys).size !== suppliedRelationKeys.length ||
    requiredRelationKeys.length !== suppliedRelationKeys.length || requiredRelationKeys.some((key) => !suppliedRelationKeys.includes(key))) {
    throw new Error(`${input.sceneId}: source relation context must exactly match SceneContract.requiredRelations`);
  }
  const sourceRefs = input.teachingContext?.sourceEvidenceRefs ?? [];
  const allowed = new Set(contract.evidenceSpanIds);
  const evidence = sourceRefs.filter((ref) => allowed.has(ref.spanId));
  const present = new Set(evidence.map((ref) => ref.spanId));
  if (!evidence.length || evidence.length !== sourceRefs.length || contract.evidenceSpanIds.some((spanId) => !present.has(spanId))) throw new Error(`${input.sceneId}: SceneContract evidence does not match source-grounded teaching context`);
  const sourceRefKeys = new Set(sourceRefs.map((ref) => stableJson(ref)));
  if ((input.teachingContext?.concepts ?? []).some((concept) => !concept.evidenceRefs.length || concept.evidenceRefs.some((ref) => !sourceRefKeys.has(stableJson(ref))))) {
    throw new Error(`${input.sceneId}: each required source concept must retain its evidence references in the scene evidence context`);
  }
  if ((input.teachingContext?.relations ?? []).some((relation) => !relation.evidenceRefs.length || relation.evidenceRefs.some((ref) => !sourceRefKeys.has(stableJson(ref))))) {
    throw new Error(`${input.sceneId}: each required source relation must retain its evidence references in the scene evidence context`);
  }
  const seen = new Set(mentionTimes.map((mention) => mention.id));
  if (input.mentions.some((mention) => !seen.has(mention.id))) throw new Error(`${input.sceneId}: missing measured mention alignment`);
  const visualCandidates = Object.fromEntries(Object.entries(input.candidates ?? {}).map(([mentionId, candidates]) => [mentionId, candidates.filter((candidate) => candidate.score >= TAU_MID_EMB)]));
  const capabilities = ['box', 'pill', 'text', 'operator', 'meter', 'tokenStrip', 'matrix', 'formula', 'plot', 'numberLine', 'shape', 'container', 'cylinder', 'stack', 'axis', 'hill'];
  if (Object.values(visualCandidates).some((candidates) => candidates.length > 0)) capabilities.push('object');
  const rankedExamples = selectExemplars({ sceneContract: contract, domain: bible.domain, sourceId, caseId, capabilities, arm });
  const examples = exampleOrder === 'reverse' ? [...rankedExamples].reverse() : rankedExamples;
  const availableTemplates = Object.entries(TEMPLATE_SLOTS).map(([id, slots]) => ({ id, slots }));
  const versions = { prompt: SCENE_PROMPT_VERSION, skill: SCENE_SKILL_VERSION, skillHash: SCENE_DIRECTOR_SKILL_HASH, bank: EXAMPLE_BANK_VERSION, bankHash: EXAMPLE_BANK_HASH, rank: EXAMPLE_RANK_VERSION, catalog: catalogVersion, candidateFeasibility: CANDIDATE_FEASIBILITY_VERSION, recipes: RECIPE_VERSION };
  const payload = { sceneContract: contract, lessonBible: bible, narration: { raw: input.raw, plainText: input.plainText, mentions: input.mentions }, teachingContext: input.teachingContext, evidence, visualCandidates, availableTemplates, mentionTimes, previousElements: input.previousElements, promptArm: arm, exampleOrder, examples: examples.map(exemplarContextRecord), versions };
  return { schemaVersion: 'scene-planning-context/v2', ...payload, examples, contextHash: sha256(stableJson(payload)) };
}
