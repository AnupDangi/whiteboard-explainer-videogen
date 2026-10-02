import type { SceneSpec, TemplateId } from '../shared/types.js';
import { safeParseSceneSpec, validateSceneSpecStructure } from '../shared/schema.js';
import type { SceneContract } from '../plan/schemas.js';
import { sha256, stableJson } from '../shared/artifacts.js';
import { SCENE_EXEMPLARS } from './fewshots/exampleBank.v2.js';
export { SCENE_EXEMPLARS } from './fewshots/exampleBank.v2.js';

export const EXAMPLE_BANK_VERSION = 'mechanism-bank/v5-layout-recipes';
export const EXAMPLE_RANK_VERSION = 'mechanism-rank/v2';
export const EXAMPLE_NEAR_DUPLICATE_THRESHOLD = 0.72;
export const EXAMPLE_WEIGHTS = { skill: 0.35, mechanism: 0.25, template: 0.20, complexity: 0.10, domain: 0.05, quality: 0.05 } as const;
export type PromptArm = 'zero' | 'text' | 'mechanism' | 'diverse';

export interface SceneExemplar {
  id: string;
  sourceId?: string;
  goldenId?: string;
  sourceClass: 'hand-authored-example';
  reviewStatus: 'experimental' | 'approved';
  provenance: { source: string; authoring: string; thirdPartyAssets: boolean; evaluationSplit: 'none' | 'train' | 'development' | 'test' };
  review: {
    factuality: 'pending' | 'passed' | 'failed';
    visual: 'pending' | 'passed' | 'failed';
    license: 'pending' | 'passed' | 'failed';
    leakage: 'pending' | 'passed' | 'failed';
    human: 'pending' | 'passed' | 'failed';
    reviewer?: string;
    reviewedAt?: string;
  };
  domain: string;
  teachingSkill: SceneContract['teachingSkill'];
  visualMechanism: SceneContract['candidateMechanisms'][number];
  complexity: 1 | 2 | 3;
  qualityScore: number;
  requiredCapabilities: string[];
  inputIntent: { learningDelta: string };
  designRationale: string[];
  sceneSpec: SceneSpec;
}

const REQUIRED_REVIEWS = ['factuality', 'visual', 'license', 'leakage', 'human'] as const;

/** Promotion is a reviewed offline action; incomplete bank metadata must fail closed. */
export function exemplarPromotionProblems(example: SceneExemplar): string[] {
  const problems: string[] = [];
  if (!example.provenance.source.trim() || !example.provenance.authoring.trim()) problems.push('provenance source and authoring method are required');
  if (typeof example.provenance.thirdPartyAssets !== 'boolean') problems.push('third-party asset provenance must be explicit');
  if (!['none', 'train', 'development', 'test'].includes(example.provenance.evaluationSplit)) problems.push('exemplar evaluation split must be declared');
  if (example.reviewStatus === 'approved') {
    for (const key of REQUIRED_REVIEWS) if (example.review[key] !== 'passed') problems.push(`${key} review must pass before exemplar approval`);
    if (!example.review.reviewer?.trim()) problems.push('an identified human reviewer is required before exemplar approval');
    if (!example.review.reviewedAt || Number.isNaN(Date.parse(example.review.reviewedAt))) problems.push('a valid review timestamp is required before exemplar approval');
  }
  return problems;
}


for (const example of SCENE_EXEMPLARS) {
  const governanceProblems = exemplarPromotionProblems(example);
  if (governanceProblems.length) throw new Error(`Invalid exemplar governance ${example.id}: ${governanceProblems.join('; ')}`);
  const parsed = safeParseSceneSpec(example.sceneSpec);
  if (!parsed.success) throw new Error(`Invalid structural exemplar ${example.id}: ${parsed.error.message}`);
  const problems = validateSceneSpecStructure(parsed.data);
  if (problems.length) throw new Error(`Invalid structural exemplar ${example.id}: ${problems.map((problem) => problem.message).join('; ')}`);
}
export const EXAMPLE_BANK_HASH = sha256(stableJson(SCENE_EXEMPLARS));

export interface ExemplarQuery {
  sceneContract: SceneContract;
  domain?: string;
  sourceId?: string;
  caseId?: string;
  capabilities: string[];
  arm: PromptArm;
}

export interface SelectedExemplar { exemplar: SceneExemplar; score: number }

/** Fields from an exemplar that are actually supplied to the Scene Planner. */
export function exemplarPromptRecord({ exemplar }: SelectedExemplar) {
  return {
    id: exemplar.id,
    intent: exemplar.inputIntent.learningDelta,
    spec: exemplar.sceneSpec,
    rationale: exemplar.designRationale,
    provenance: exemplar.sourceClass,
  };
}

/** Prompt content plus retrieval metadata, used for reproducible context hashes. */
export function exemplarContextRecord(selected: SelectedExemplar) {
  return { ...exemplarPromptRecord(selected), score: selected.score };
}

const wordSet = (value: string): Set<string> => new Set(value.toLowerCase().match(/[a-z]{3,}/g) ?? []);
const textSimilarity = (a: string, b: string): number => {
  const left = wordSet(a); const right = wordSet(b);
  return [...left].filter((word) => right.has(word)).length / Math.max(1, new Set([...left, ...right]).size);
};
/** Retrieval exclusion policy: evaluation-derived, target-bound and lexically near-duplicate examples never enter a prompt. */
export function exemplarRetrievalProblems(example: SceneExemplar, query: ExemplarQuery): string[] {
  const problems: string[] = [];
  for (const review of REQUIRED_REVIEWS) {
    if (example.review[review] === 'failed') problems.push(`exemplar has failed ${review} review`);
  }
  if (example.provenance.evaluationSplit === 'development' || example.provenance.evaluationSplit === 'test') problems.push('exemplar belongs to a held-out evaluation split');
  if (example.goldenId) problems.push(`exemplar derives from evaluation golden ${example.goldenId}`);
  if (query.sourceId && example.sourceId === query.sourceId) problems.push('exemplar derives from the target source');
  if ((query.caseId && example.goldenId === query.caseId) || example.id === query.caseId || example.id === query.sourceId) problems.push('exemplar identifies the target lesson');
  if (textSimilarity(example.inputIntent.learningDelta, query.sceneContract.learningDelta) >= EXAMPLE_NEAR_DUPLICATE_THRESHOLD) problems.push('exemplar intent is a lexical near-duplicate of the target intent');
  return problems;
}
const complexityOf = (contract: SceneContract): 1 | 2 | 3 => contract.requiredConceptIds.length > 4 || contract.requiredRelations.length > 3 || contract.teachingSkill === 'derivation' ? 3 : contract.requiredConceptIds.length > 2 || contract.requiredRelations.length > 1 ? 2 : 1;
const templateFit = (template: TemplateId, mechanisms: SceneContract['candidateMechanisms']): boolean => mechanisms.some((mechanism) => ({ comparison: 'compare_2', focus: 'title_card', trajectory: 'plot_focus', equation: 'formula_focus', state_transition: 'chain' } as Record<string, TemplateId>)[mechanism] === template || mechanism === template);

/** Deterministic experimental retrieval. No model calls and no topic-keyed scene branches. */
export function selectExemplars(query: ExemplarQuery): SelectedExemplar[] {
  if (query.arm === 'zero') return [];
  const complexity = complexityOf(query.sceneContract);
  const count = complexity === 3 ? 3 : complexity === 2 ? 2 : query.sceneContract.teachingSkill === 'definition' || query.sceneContract.teachingSkill === 'recap' ? 0 : 1;
  const available = new Set(query.capabilities);
  const ranked = SCENE_EXEMPLARS.filter((example) =>
    example.requiredCapabilities.every((capability) => available.has(capability)) &&
    exemplarRetrievalProblems(example, query).length === 0)
    .map((exemplar) => {
      const score = query.arm === 'text'
        ? textSimilarity(exemplar.inputIntent.learningDelta, query.sceneContract.learningDelta)
        : EXAMPLE_WEIGHTS.skill * Number(exemplar.teachingSkill === query.sceneContract.teachingSkill)
          + EXAMPLE_WEIGHTS.mechanism * Number(query.sceneContract.candidateMechanisms.includes(exemplar.visualMechanism))
          + EXAMPLE_WEIGHTS.template * Number(templateFit(exemplar.sceneSpec.template, query.sceneContract.candidateMechanisms))
          + EXAMPLE_WEIGHTS.complexity * (1 - Math.abs(exemplar.complexity - complexity) / 2)
          + EXAMPLE_WEIGHTS.domain * Number(Boolean(query.domain) && exemplar.domain === query.domain)
          + EXAMPLE_WEIGHTS.quality * (exemplar.qualityScore / 5);
      return { exemplar, score };
    }).sort((a, b) => b.score - a.score || a.exemplar.id.localeCompare(b.exemplar.id)).slice(0, 8);
  if (query.arm !== 'diverse') return ranked.slice(0, count);
  const chosen: SelectedExemplar[] = [];
  const usedMechanisms = new Set<string>();
  for (const candidate of ranked) {
    if (chosen.length >= count) break;
    if (usedMechanisms.has(candidate.exemplar.visualMechanism) && ranked.some((other) => !usedMechanisms.has(other.exemplar.visualMechanism) && !chosen.includes(other))) continue;
    chosen.push(candidate); usedMechanisms.add(candidate.exemplar.visualMechanism);
  }
  return chosen;
}
