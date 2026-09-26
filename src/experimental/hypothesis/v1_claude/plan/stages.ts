import { z } from 'zod';
import { addUsage, emptyUsage, structuredCall, type StructuredCallResult } from '../llm/structuredCall.js';
import { parseMarkers } from '../narration/markers.js';
import { spokenForm } from '../narration/spokenForm.js';
import { ConceptGraphSchema, RELATION_TYPES, SECTION_KINDS, SECTION_TITLE_MAX_WORDS, TEACHING_SKILLS, VISUAL_MECHANISMS, ScriptSchema, TeachingPlanSchema, type ConceptGraph, type Script, type TeachingPlan } from './schemas.js';
import { SCENE_SEC, WORDS_PER_SEC, analyzeTeachingPlan } from './analyze.js';
import type { StageRunRecord } from '../../shared/contracts.js';
import { sourceDocFromText, sourcePrompt, type SourceDoc, type SourceBundle } from './sourceDoc.js';
import { anchorQuote, type AnchorMatch } from './evidenceAnchor.js';
import type { PersistentBudgetLedger } from '../pipeline/budgetLedger.js';
import { teachingContractProblems } from './contracts.js';
import { CONCEPT_STRUCTURE_GUIDANCE, PLAN_COMPONENT_GUIDANCE, relationalGraphProblems } from './goalShape.js';
import { schemaKeywordLeaks } from '../prompt/builder.js';

/**
 * S2 -> S3 -> S4 (claude_pipeline.md §1-§4). Mid-tier ("flash") model; every
 * output is zod-validated plus semantic checks, with exactly one repair.
 * The hypothesis order is preserved: the narration script is final before any
 * scene is planned (no pre-narration visual story, claude_pipeline.md §27).
 */
export interface StageModel {
  model: string;
  apiKey: string;
  remainingBudgetUsd: number;
  budgetLedger?: PersistentBudgetLedger;
  /** Test seam for deterministic stage-contract tests; production defaults to global fetch. */
  fetcher?: typeof fetch;
}

export interface LessonRequest {
  /** Prompt and/or source text (plain text or Markdown). */
  source: string;
  /** What the learner wants (may be empty). */
  instruction?: string;
  targetDurationSec: number;
  /** Learner level, used for depth and examples, never to change facts. */
  audience?: string;
  sourceDoc?: SourceDoc;
  sourceBundle?: SourceBundle;
  sources?: LessonSourceInput[];
  sourceFormat?: SourceDoc['format'];
  /** Internal scope used by the hierarchical planner; IDs and labels come from its global syllabus. */
  conceptScope?: Array<{ id: string; label: string; definition: string }>;
}

export type LessonSourceInput =
  | { kind: 'document'; path: string }
  | { kind: 'url'; url: string }
  | { kind: 'text'; text: string; format?: SourceDoc['format']; title?: string };

// ---------------------------------------------------------------------------
// S2 — ConceptGraph
// ---------------------------------------------------------------------------

export async function buildConceptGraph(req: LessonRequest, m: StageModel): Promise<StructuredCallResult<ConceptGraph>> {
  const sourceDoc = req.sourceDoc ?? sourceDocFromText(req.source, req.sourceFormat ?? 'text');
  // Bound graph size to the lesson's actual teaching time. The model still
  // selects source-grounded concepts; this is a generic capacity limit.
  const maxConcepts = Math.min(14, req.conceptScope?.length ?? Math.max(3, Math.ceil(req.targetDurationSec / 10)));
  const maxRelations = Math.min(24, maxConcepts * 2);
  const maxPrerequisites = Math.min(20, maxConcepts * 2);
  // A full-size concept graph (label/kind/definition/1-3 evidence quotes per concept, endpoints/type/evidence
  // per relation) does not fit the generic 4000-token structuredCall default: a live run truncated mid-object
  // at exactly that ceiling. Scale the completion budget from the same capacity numbers above instead of a
  // flat constant, matching the pattern writeScript already uses for its own (smaller) per-scene maxTokens.
  const maxConceptGraphTokens = Math.min(8000, 800 + maxConcepts * 350 + maxRelations * 250 + maxPrerequisites * 20);
  const scopeRule = req.conceptScope?.length ? `\n- This is a bounded module. Use every supplied syllabus concept exactly once in concepts, keeping each exact id and label unchanged; do not add concepts outside this scope.\nGLOBAL MODULE CONCEPTS:\n${JSON.stringify(req.conceptScope)}` : '';
  const system = `You extract the teachable structure of a source for a narrated whiteboard lesson.
Return ONE JSON object: { "concepts": [...], "relations": [...], "prerequisites": [...] }.
- concepts: at most ${maxConcepts} ideas a learner must understand, in teaching order. Prefer the minimum set needed for this lesson; omit incidental details. id: lowercase snake_case. label: <=4 words. kind: entity|process|quantity|formula|event|role|rule. definition: one plain sentence grounded in the source. evidence: 1-3 exact {spanId, quote} references; quote must occur verbatim in that source span.
- ${CONCEPT_STRUCTURE_GUIDANCE}
- For mathematical ideas give "latex" (valid TeX, no $ signs) when there is a formula, and set "level": "multi-step" when understanding it takes several dependent steps (e.g. a derivation, an algorithm, a rule applied repeatedly), otherwise "one-step".
- relations: at most ${maxRelations} directed links between concept ids (causes, feeds, contains, compares, transforms, requires, produces, opposes). Keep only the most important source-stated teaching relations; include 1-3 exact evidence references for each. Do not create summary/model nodes to collect several facts.
- prerequisites: at most ${maxPrerequisites} { concept, needs } links, only when a concept cannot be understood without another one.
- Never invent facts that are not in the source. Keep it to what fits the requested duration (about one concept per 10-15 seconds).${scopeRule}`;
  const user = `Target duration: ${req.targetDurationSec} seconds.${req.audience ? `\nAudience: ${req.audience}.` : ''}${req.instruction ? `\nLearner request: ${req.instruction}` : ''}

SOURCE DOCUMENT (text is exact source; span index preserves markdown structure and positions):
${sourcePrompt(sourceDoc)}`;
  const result = await structuredCall({
    stage: 'concepts', subject: 'concept graph', model: m.model, apiKey: m.apiKey, system, user,
    schema: ConceptGraphSchema, schemaName: 'concept_graph', maxTokens: maxConceptGraphTokens, remainingBudgetUsd: m.remainingBudgetUsd, budgetLedger: m.budgetLedger, fetcher: m.fetcher,
    validate: (g) => {
      const ids = new Set(g.concepts.map((c) => c.id));
      const problems: string[] = [];
      if (g.concepts.length > maxConcepts) problems.push(`concept graph has ${g.concepts.length} concepts; at most ${maxConcepts} fit this ${req.targetDurationSec}-second lesson`);
      if (g.relations.length > maxRelations) problems.push(`concept graph has ${g.relations.length} relations; at most ${maxRelations} fit this lesson`);
      if (g.prerequisites.length > maxPrerequisites) problems.push(`concept graph has ${g.prerequisites.length} prerequisites; at most ${maxPrerequisites} fit this lesson`);
      problems.push(...relationalGraphProblems(req.instruction, g.concepts.length, g.relations.length, Boolean(req.conceptScope?.length)));
      if (req.conceptScope?.length) {
        const expected = new Map(req.conceptScope.map((concept) => [concept.id, concept]));
        if (g.concepts.length !== expected.size) problems.push(`module graph must contain all ${expected.size} syllabus concepts exactly once`);
        for (const concept of g.concepts) {
          const sourceConcept = expected.get(concept.id);
          if (!sourceConcept) problems.push(`module graph added concept ${concept.id} outside the syllabus scope`);
          else if (concept.label !== sourceConcept.label) problems.push(`module graph changed the global label for ${concept.id}; use "${sourceConcept.label}" exactly`);
        }
      }
      if (ids.size !== g.concepts.length) problems.push('concept ids must be unique');
      const leaked = schemaKeywordLeaks(g.concepts.map((c) => c.id));
      if (leaked.length) problems.push(`concept ids ${leaked.map((id) => `"${id}"`).join(', ')} are JSON field names, not source concepts; give each concept a snake_case id derived from its own label`);
      const relationIds = g.relations.map((r) => `${r.from}|${r.type}|${r.to}`);
      if (new Set(relationIds).size !== relationIds.length) problems.push('relations must be unique');
      for (const r of g.relations) if (r.from === r.to) problems.push(`relation ${r.from} -> ${r.to} links a concept to itself; a relation must connect two different concepts`);
      const checkEvidence = (owner: string, evidence: Array<{ spanId: string; quote: string }>) => {
        if (evidence.length === 0) problems.push(`${owner} has no source evidence`);
        for (const ref of evidence) if (!anchorQuote(sourceDoc, ref.spanId, ref.quote)) problems.push(`${owner} evidence quote is absent from source span ${ref.spanId}; copy the words exactly as they appear in that span`);
      };
      for (const c of g.concepts) checkEvidence(`concept ${c.id}`, c.evidence);
      for (const r of g.relations) {
        if (!ids.has(r.from) || !ids.has(r.to)) problems.push(`relation ${r.from}->${r.to} references an unknown concept`);
        checkEvidence(`relation ${r.from}->${r.to}`, r.evidence);
      }
      for (const p of g.prerequisites) if (!ids.has(p.concept) || !ids.has(p.needs)) problems.push(`prerequisite ${p.concept}<-${p.needs} references an unknown concept`);
      return problems;
    },
  });
  if (!result.value) return result as unknown as StructuredCallResult<ConceptGraph>;
  const anchorCounts: Record<AnchorMatch, number> = { exact: 0, normalized: 0, relocated: 0 };
  const enrich = (refs: Array<{ spanId: string; quote: string }>) => refs.map((ref) => {
    const anchored = anchorQuote(sourceDoc, ref.spanId, ref.quote)!;
    anchorCounts[anchored.match] += 1;
    return anchored.ref;
  });
  const enriched = {
    concepts: result.value.concepts.map(({ evidence, ...c }) => ({ ...c, evidence: enrich(evidence) })),
    relations: result.value.relations.map(({ evidence, ...r }) => ({ ...r, evidence: enrich(evidence) })),
    prerequisites: result.value.prerequisites,
  };
  const failures = anchorCounts.normalized + anchorCounts.relocated > 0
    ? [...result.failures, { code: 'concepts-evidence-anchored', stage: 'concepts', message: `evidence anchored to verbatim source: ${anchorCounts.exact} exact, ${anchorCounts.normalized} normalized, ${anchorCounts.relocated} relocated`, hard: false }]
    : result.failures;
  return { ...result, failures, value: enriched };
}

// ---------------------------------------------------------------------------
// S3 — TeachingPlan
// ---------------------------------------------------------------------------

/** Inputs every S3 prompt variant closes over — never lesson content, only request/graph shape. */
interface PlanPromptContext {
  scenes: number;
  req: LessonRequest;
  graph: ConceptGraph;
  conceptIdChecklist: string;
}
type PlanPromptBuilder = (ctx: PlanPromptContext) => { system: string; user: string };

/** Keep model-visible shape limits aligned with the Zod schema and generated-plan validator. */
export const TEACHING_PLAN_PROMPT_SCHEMA_RULES = `SCHEMA LIMITS — follow these exactly; the output is rejected if they are violated:
- Output exactly the documented top-level fields: targetDurationSec, intro, lessonBible, sections, recap. targetDurationSec is positive and must equal the requested duration.
- intro.sourceTitle is 1-80 characters. intro.sections has at most 12 strings, each 1-80 characters.
- lessonBible is required for generated plans. audience is 1-120 characters; optional domain is 1-50 characters; terminology has at most 14 entries, each with a graph concept ID and an exact concept label of at most 4 words; persistentConceptIds has at most 14 graph concept IDs.
- sections has 1-40 entries. Each id is a unique lowercase snake_case token of 1-40 characters. Each title is 1-${SECTION_TITLE_MAX_WORDS} words (and at most ${SECTION_TITLE_MAX_WORDS * 12} characters); each goal is 1-240 characters. kind must be exactly one of: ${SECTION_KINDS.join(', ')}. conceptIds has at most 6 graph IDs and must be nonempty for generated plans. budgetSec is positive.
- Every generated section requires a contract. learningDelta is 1-240 characters and exactly equals goal; targetDurationSec is positive and exactly equals budgetSec; requiredConceptIds has 1-8 IDs and exactly equals conceptIds; requiredRelations has at most 24 entries and each type must be one of: ${RELATION_TYPES.join(', ')} (and must match the graph). evidenceSpanIds has 1-96 valid cited span IDs. teachingSkill is exactly one of: ${TEACHING_SKILLS.join(', ')}. candidateMechanisms has 1-3 values, each exactly one of: ${VISUAL_MECHANISMS.join(', ')}.
- recap.keyPoints has at most 6 strings, each 1-160 characters.
- The schema also rejects unknown fields at every object level. All IDs must use lowercase snake_case and be at most 40 characters. Follow the requested duration, scene budget, graph coverage, relation, evidence, and teaching rules above as well as these shape limits.`;

/** Production default until a calibration run (`harness/planCalibrationCli.ts`) measures a challenger ahead of it. */
const buildV3BaselinePrompt: PlanPromptBuilder = ({ scenes, req, graph, conceptIdChecklist }) => ({
  system: `You are a teaching architect. Turn a concept graph into a time-budgeted plan for a narrated whiteboard video, one scene per section.
Return ONE JSON object: { "targetDurationSec", "intro": {"sourceTitle","sections"}, "lessonBible": {"audience","domain"?,"terminology","persistentConceptIds"}, "sections": [...], "recap": {"keyPoints"} }.
Rules:
- The bible audience is the supplied audience or "general learner"; optional domain is a broad subject label used only as a low-weight example-retrieval signal. Terminology entries use unique concept IDs and exact labels from the graph. List every concept used in more than one section in persistentConceptIds; each persistent concept needs exactly one terminology entry and must keep that canonical name across scenes. Do not invent visual facts or icon choices.
- Assign concepts explicitly before writing each section: choose one or more exact concept IDs from the graph, put those IDs in section.conceptIds, then copy the identical nonempty ID list to contract.requiredConceptIds. These two arrays are required for EVERY section, including intro and recap. Never leave either array empty, and never put concept IDs only in the contract. Do not invent IDs or use concept labels in place of IDs.
- The contract has learningDelta (exactly the section goal), targetDurationSec (exactly section budgetSec), requiredConceptIds (exactly section conceptIds), requiredRelations (every graph relation whose two endpoints appear in this section, each as {from,to,type}), evidenceSpanIds (all cited span IDs for those concepts and relations), teachingSkill (definition|mechanism|comparison|process|derivation|application|recap), candidateMechanisms (1-3 advisory values from focus|chain|convergence|fan_out|weighted_blend|cycle|threshold|comparison|trajectory|equation|state_transition). A mechanism is a generic visual idea, never a lesson-specific drawing instruction.
- ${PLAN_COMPONENT_GUIDANCE}
- Before returning, verify section-by-section that conceptIds and requiredConceptIds are identical and nonempty, every ID occurs in the supplied graph, every required relation is included, and evidenceSpanIds exactly covers the listed concepts and relations. If a section is only an intro or recap, anchor it to the graph concepts it introduces or reviews; do not create an ungrounded scene.
- Order by prerequisites: a concept is never taught before what it needs.
- Math: build intuition before notation. For a multi-step idea, give each step its own "step" section (the learner sees one move at a time), then an "example" or "recap". A one-step idea fits in one "explain" section.
- Budgets: every section ${SCENE_SEC.min}-${SCENE_SEC.max} seconds (about 18 s is ideal); the budgets MUST sum to targetDurationSec exactly. Use about ${scenes} sections for ${req.targetDurationSec} s — fewer, richer scenes beat many tiny ones.
- If any concept has level "multi-step", at least 2 sections must have kind "step" (one per step of that idea).
- Lessons of 45 s or more end with a short "recap" section. Very short lessons may skip the intro section.

${TEACHING_PLAN_PROMPT_SCHEMA_RULES}`,
  user: `targetDurationSec: ${req.targetDurationSec}\nAudience: ${req.audience ?? 'general learner'}${req.instruction ? `\nLearner request: ${req.instruction}` : ''}

VALID CONCEPT IDS (copy IDs exactly into both arrays for every section):
${conceptIdChecklist}

REQUIRED MAPPING SHAPE (illustrative placeholders only; replace every value with graph-backed data):
{"sections":[{"conceptIds":["<graph_concept_id>"],"contract":{"requiredConceptIds":["<same_graph_concept_id>"]}}]}

CONCEPT GRAPH:
${JSON.stringify(graph, null, 1)}`,
});

/**
 * Candidate variant targeting the one root failure mode found across live cold attempts:
 * the model empties a section's conceptIds (usually while self-correcting something else
 * during its one repair), which mechanically fails the conceptIds/contract match AND makes
 * that section's relations vanish from every SceneContract. The rule paragraph is rewritten
 * with an explicit, harder-to-miss consequence, and the mapping placeholder becomes one small,
 * fully worked, topic-neutral example (fake ids) instead of a bare shape — never real content.
 */
/** The v4/v5 system prompt depends only on `scenes`/`req`, never `graph` — factored out so v5 can reuse it without also building (and discarding) v4's `user` text, which re-serializes the whole concept graph. */
const buildV4SystemPrompt = ({ scenes, req }: Pick<PlanPromptContext, 'scenes' | 'req'>): string => `You are a teaching architect. Turn a concept graph into a time-budgeted plan for a narrated whiteboard video, one scene per section.
Return ONE JSON object: { "targetDurationSec", "intro": {"sourceTitle","sections"}, "lessonBible": {"audience","domain"?,"terminology","persistentConceptIds"}, "sections": [...], "recap": {"keyPoints"} }.
Rules:
- The bible audience is the supplied audience or "general learner"; optional domain is a broad subject label used only as a low-weight example-retrieval signal. Terminology entries use unique concept IDs and exact labels from the graph. List every concept used in more than one section in persistentConceptIds; each persistent concept needs exactly one terminology entry and must keep that canonical name across scenes. Do not invent visual facts or icon choices.
- Assign concepts explicitly before writing each section: choose one or more exact concept IDs from the graph, put those IDs in section.conceptIds, then copy the identical nonempty ID list to contract.requiredConceptIds. These two arrays are REQUIRED and must never be empty for ANY section, including intro and recap — not even while correcting a different problem. If a section genuinely should not exist without concepts, delete that entire section rather than leaving its conceptIds empty. Do not invent IDs or use concept labels in place of IDs. Every graph relation whose two endpoints are BOTH assigned to a section must appear in that section's contract.requiredRelations — if you move a concept out of a section, move its relations (and their other endpoint) with it; never leave a relation stranded with no section.
- The contract has learningDelta (exactly the section goal), targetDurationSec (exactly section budgetSec), requiredConceptIds (exactly section conceptIds), requiredRelations (every graph relation whose two endpoints appear in this section, each as {from,to,type}), evidenceSpanIds (all cited span IDs for those concepts and relations), teachingSkill (definition|mechanism|comparison|process|derivation|application|recap), candidateMechanisms (1-3 advisory values from focus|chain|convergence|fan_out|weighted_blend|cycle|threshold|comparison|trajectory|equation|state_transition). A mechanism is a generic visual idea, never a lesson-specific drawing instruction.
- Before returning, verify section-by-section that conceptIds and requiredConceptIds are identical and nonempty, every ID occurs in the supplied graph, every required relation is included, and evidenceSpanIds exactly covers the listed concepts and relations. If a section is only an intro or recap, anchor it to the graph concepts it introduces or reviews; do not create an ungrounded scene.
- Order by prerequisites: a concept is never taught before what it needs.
- Math: build intuition before notation. For a multi-step idea, give each step its own "step" section (the learner sees one move at a time), then an "example" or "recap". A one-step idea fits in one "explain" section.
- Budgets: every section ${SCENE_SEC.min}-${SCENE_SEC.max} seconds (about 18 s is ideal); the budgets MUST sum to targetDurationSec exactly. Use about ${scenes} sections for ${req.targetDurationSec} s — fewer, richer scenes beat many tiny ones.
- If any concept has level "multi-step", at least 2 sections must have kind "step" (one per step of that idea).
- Lessons of 45 s or more end with a short "recap" section. Very short lessons may skip the intro section.

${TEACHING_PLAN_PROMPT_SCHEMA_RULES}`;

const buildV4ExplicitConceptsPrompt: PlanPromptBuilder = ({ scenes, req, graph, conceptIdChecklist }) => ({
  system: buildV4SystemPrompt({ scenes, req }),
  user: `targetDurationSec: ${req.targetDurationSec}\nAudience: ${req.audience ?? 'general learner'}${req.instruction ? `\nLearner request: ${req.instruction}` : ''}

VALID CONCEPT IDS (copy IDs exactly into both arrays for every section):
${conceptIdChecklist}

WORKED EXAMPLE (a fictional graph unrelated to yours — shows the exact required shape only, never real content). Given concepts concept_a, concept_b and one relation {"from":"concept_a","to":"concept_b","type":"causes"}, a correctly filled section looks like:
{"id":"sec_1","title":"Example title","goal":"Example goal sentence","kind":"explain","conceptIds":["concept_a","concept_b"],"budgetSec":18,"contract":{"learningDelta":"Example goal sentence","targetDurationSec":18,"requiredConceptIds":["concept_a","concept_b"],"requiredRelations":[{"from":"concept_a","to":"concept_b","type":"causes"}],"evidenceSpanIds":["<span ids covering both concepts and the relation>"],"teachingSkill":"mechanism","candidateMechanisms":["chain"]}}
Notice conceptIds and requiredConceptIds are identical and nonempty, and the relation appears in requiredRelations only because BOTH its endpoints are in conceptIds. Replace every value with graph-backed data from YOUR concept graph below — do not reuse concept_a/concept_b or this example's facts.

CONCEPT GRAPH:
${JSON.stringify(graph, null, 1)}`,
});

/**
 * Candidate variant targeting the root failure mode found in the 2026-09-25/26
 * reliability run (conditional S3 pass rate 0.231, down from v4's measured 40%):
 * raw model output showed `lessonBible.terminology: []` and every section's
 * `contract.requiredRelations: []`, on both the initial attempt and the repair,
 * despite a real persistentConceptIds list and real graph relations. v4's worked
 * example never shows `terminology` filled at all, and its `requiredRelations`
 * example covers only the trivial 2-concept/1-relation case — real failing
 * sections have 3-4 concepts and 2+ relations. Same text as v4 everywhere except
 * the worked example, which now shows a full lessonBible (terminology filled)
 * and a 3-concept/2-relation section, matching the shape that was failing.
 */
const buildV5FullyWorkedExamplePrompt: PlanPromptBuilder = ({ scenes, req, graph, conceptIdChecklist }) => ({
  system: buildV4SystemPrompt({ scenes, req }),
  user: `targetDurationSec: ${req.targetDurationSec}\nAudience: ${req.audience ?? 'general learner'}${req.instruction ? `\nLearner request: ${req.instruction}` : ''}

VALID CONCEPT IDS (copy IDs exactly into both arrays for every section):
${conceptIdChecklist}

WORKED EXAMPLE (a fictional graph unrelated to yours — shows the exact required shape only, never real content). Given concepts concept_a ("Example A"), concept_b ("Example B"), concept_c ("Example C") and two relations {"from":"concept_a","to":"concept_b","type":"causes"} and {"from":"concept_b","to":"concept_c","type":"produces"}, a correctly filled lessonBible and section look like:
{"lessonBible":{"audience":"general learner","terminology":[{"conceptId":"concept_a","label":"Example A"},{"conceptId":"concept_b","label":"Example B"},{"conceptId":"concept_c","label":"Example C"}],"persistentConceptIds":["concept_a","concept_b","concept_c"]}}
{"id":"sec_1","title":"Example title","goal":"Example goal sentence","kind":"explain","conceptIds":["concept_a","concept_b","concept_c"],"budgetSec":18,"contract":{"learningDelta":"Example goal sentence","targetDurationSec":18,"requiredConceptIds":["concept_a","concept_b","concept_c"],"requiredRelations":[{"from":"concept_a","to":"concept_b","type":"causes"},{"from":"concept_b","to":"concept_c","type":"produces"}],"evidenceSpanIds":["<span ids covering all three concepts and both relations>"],"teachingSkill":"mechanism","candidateMechanisms":["chain"]}}
Notice conceptIds and requiredConceptIds are identical and nonempty, terminology has one entry per concept in persistentConceptIds (never an empty array when persistentConceptIds is nonempty), and requiredRelations lists EVERY relation whose two endpoints are BOTH in this section's conceptIds — not just one of them, not an empty array. A section with 3+ concepts commonly has 2+ relations; list all of them. Replace every value with graph-backed data from YOUR concept graph below — do not reuse concept_a/concept_b/concept_c or this example's facts.

CONCEPT GRAPH:
${JSON.stringify(graph, null, 1)}`,
});

export const PLAN_PROMPT_VARIANTS = {
  'v3-baseline': buildV3BaselinePrompt,
  'v4-explicit-concepts': buildV4ExplicitConceptsPrompt,
  'v5-fully-worked-example': buildV5FullyWorkedExamplePrompt,
} as const;
export type PlanPromptVariant = keyof typeof PLAN_PROMPT_VARIANTS;
/**
 * Adopted 2026-09-26 from a measured `plan:calibrate` run: v4 47%, v5 53%, v5 also cheaper.
 * Full adoption rationale, per-source breakdown (including a real composting regression this
 * aggregate hides), and the repair-path caveat are in `docs/HANDOFF.md`'s 2026-09-26 entry —
 * read that, not just this comment, before touching the default again. Data:
 * `harness/reports/2026-09-25-plan-calibration.{json,md}`.
 * Change this only after a new `plan:calibrate` run measures a variant ahead of it.
 */
export const DEFAULT_PLAN_PROMPT_VARIANT: PlanPromptVariant = 'v5-fully-worked-example';

/**
 * Completion allowance for the full S3 JSON plan. A live 5-minute module with
 * 7 concepts and 6 relations requested exactly 4,500 tokens and was cut at
 * that boundary; section contracts repeat IDs, timings, relations, and source
 * spans, so scene count must contribute directly to the allowance.
 */
export function teachingPlanTokenBudget(sceneCount: number, conceptCount: number, relationCount: number): number {
  if (![sceneCount, conceptCount, relationCount].every(Number.isFinite) || sceneCount < 1 || conceptCount < 0 || relationCount < 0) {
    throw new Error('teaching plan token budget inputs must be finite and non-negative (with at least one scene)');
  }
  return Math.min(10_000, 1_500 + Math.ceil(sceneCount) * 500 + Math.ceil(conceptCount) * 150 + Math.ceil(relationCount) * 100);
}

export async function buildTeachingPlan(req: LessonRequest, graph: ConceptGraph, m: StageModel, variant: PlanPromptVariant = DEFAULT_PLAN_PROMPT_VARIANT): Promise<StructuredCallResult<TeachingPlan>> {
  const scenes = Math.max(1, Math.round(req.targetDurationSec / 18));
  const conceptIdChecklist = graph.concepts.map((concept) => `- ${concept.id}: ${concept.label}`).join('\n');
  const { system, user } = PLAN_PROMPT_VARIANTS[variant]({ scenes, req, graph, conceptIdChecklist });
  // Every section includes a full contract, so output size tracks scenes as well
  // as graph size. Scale from both, with a bounded 10k completion ceiling.
  const maxTeachingPlanTokens = teachingPlanTokenBudget(scenes, graph.concepts.length, graph.relations.length);
  const result = await structuredCall({
    stage: 'plan', subject: 'teaching plan', model: m.model, apiKey: m.apiKey, system, user,
    schema: TeachingPlanSchema, schemaName: 'teaching_plan', maxTokens: maxTeachingPlanTokens, remainingBudgetUsd: m.remainingBudgetUsd, budgetLedger: m.budgetLedger, fetcher: m.fetcher,
    // The deterministic analyser's blocking checks run INSIDE validation, against the model's raw
    // output. Nothing here mutates the plan before it is checked: a missing SceneContract or an
    // unsupported relation must surface as a real problem and consume the one repair call, never
    // get silently fixed and reported as clean.
    validate: (p) => {
      const problems: string[] = [];
      if (p.targetDurationSec !== req.targetDurationSec) problems.push(`targetDurationSec must be ${req.targetDurationSec}`);
      if (relationalGraphProblems(req.instruction, graph.concepts.length, graph.relations.length, Boolean(req.conceptScope?.length)).length) problems.push('the learner request needs a relationship among distinct source concepts; repair the source concept graph before writing a plan');
      problems.push(...analyzeTeachingPlan(p, graph).findings.filter((f) => f.severity === 'error').map((f) => f.message));
      problems.push(...teachingContractProblems(p, graph, req.audience ?? 'general learner'));
      const leakedIds = schemaKeywordLeaks(p.sections.flatMap((s) => [...s.conceptIds, ...(s.contract?.requiredConceptIds ?? [])]));
      if (leakedIds.length) problems.push(`section concept ids ${[...new Set(leakedIds)].map((id) => `"${id}"`).join(', ')} are JSON field names; use only ids from VALID CONCEPT IDS`);
      return problems;
    },
  });
  return result;
}

// ---------------------------------------------------------------------------
// S4 — Script with [[id|phrase]] mention markers
// ---------------------------------------------------------------------------

export const MENTIONS_PER_SCENE = { min: 3, max: 8 };
/** Audio is the master clock, so length only needs to be roughly right; the tolerance keeps scenes from being thin. */
const WORD_TOLERANCE = 0.4;

/** Deterministic S4 checks for ONE scene: markers parse, the spoken length fits the section budget, mentions are usable anchors. */
export function validateSceneText(text: string, section: TeachingPlan['sections'][number]): string[] {
  const problems: string[] = [];
  if (/\[\[[^\]]*\[\[/.test(text)) problems.push('nested markers');
  const { plainText, mentions } = parseMarkers(text);
  if (/\[\[|\]\]/.test(plainText)) problems.push('malformed marker (use [[id|spoken words]])');
  const words = plainText.trim().split(/\s+/).filter(Boolean).length;
  const budget = section.budgetSec * WORDS_PER_SEC;
  if (words < budget * (1 - WORD_TOLERANCE) || words > budget * (1 + WORD_TOLERANCE)) {
    problems.push(`${words} spoken words, needs ${Math.round(budget * (1 - WORD_TOLERANCE))}-${Math.round(budget * (1 + WORD_TOLERANCE))} (${section.budgetSec}s at ${WORDS_PER_SEC} words/s)`);
  }
  if (mentions.length < MENTIONS_PER_SCENE.min || mentions.length > MENTIONS_PER_SCENE.max) problems.push(`${mentions.length} markers, needs ${MENTIONS_PER_SCENE.min}-${MENTIONS_PER_SCENE.max}`);
  const seen = new Set<string>();
  for (const mm of mentions) {
    if (!/^[a-z0-9_]+$/.test(mm.id)) problems.push(`marker id "${mm.id}" must be lowercase snake_case`);
    if (seen.has(mm.id)) problems.push(`marker id "${mm.id}" used twice`);
    seen.add(mm.id);
  }
  return problems;
}

/** Whole-script checks: one scene per section, in plan order, each scene valid. */
export function validateScript(script: Script, plan: TeachingPlan): string[] {
  const problems: string[] = [];
  if (script.scenes.length !== plan.sections.length) problems.push(`expected ${plan.sections.length} scenes (one per section), got ${script.scenes.length}`);
  plan.sections.forEach((section, i) => {
    const scene = script.scenes[i];
    if (!scene) return;
    if (scene.sectionId !== section.id) problems.push(`scene ${i + 1} must have sectionId "${section.id}", got "${scene.sectionId}"`);
    problems.push(...validateSceneText(scene.text, section).map((p) => `${section.id}: ${p}`));
  });
  return problems;
}

const SceneTextSchema = z.object({ text: z.string().min(1).max(2000) }).strict();

/**
 * S4 is written one scene per call, in parallel: a flash model reliably hits
 * one scene's word and marker budget, but not six at once (observed live).
 * Each scene sees the whole plan so the narration stays one continuous lesson,
 * and each scene gets its own single repair.
 */
export async function writeScript(req: LessonRequest, graph: ConceptGraph, plan: TeachingPlan, m: StageModel): Promise<StructuredCallResult<Script> & { sceneStageRuns: StageRunRecord[] }> {
  const system = `You write the narration for ONE scene of a whiteboard teaching video. A tutor speaks while drawing each thing as it is named.
Return ONE JSON object: { "text": "..." }.

MENTION MARKERS (required): wrap each phrase whose drawing should appear the moment it is spoken as [[id|spoken words]].
- The spoken words stay in the sentence exactly as said; id is lowercase snake_case, unique within the scene.
- The scene needs ${MENTIONS_PER_SCENE.min} to ${MENTIONS_PER_SCENE.max} markers, spread from the first sentence to the last. Mark the concrete things the board shows: objects, quantities, symbols of a formula, each step.
- Example (18 s, ${Math.round(18 * WORDS_PER_SEC)} words, 5 markers):
  "Picture [[line|a straight line]] climbing across the page. Pick [[two_points|two points]] on it, one on the left and one further right. The sideways distance between them is [[run|the run]], and the upward distance is [[rise|the rise]]. Divide the rise by the run, and that single number is [[slope|the slope]] of the line."

SPOKEN TEXT ONLY: this text goes straight to a text-to-speech voice. Write every symbol as the words a teacher would say — "P of A given B", "x squared", "theta t plus one", "eta times the gradient" — never symbols, LaTeX, | [ ] or equations. The board shows the notation; the voice explains it.
LENGTH (required): spoken at ${WORDS_PER_SEC} words per second — write the number of words you are given (count them).
STYLE: warm, plain, second person; short sentences; this scene's single idea only (earlier scenes already covered theirs, later scenes will cover theirs); intuition before notation; for math, say what each symbol means as it appears and walk steps in order. No markdown, lists, or stage directions. Facts only from the source.`;
  const outline = plan.sections.map((s, i) => `${i + 1}. [${s.kind}] ${s.title} — ${s.goal}`).join('\n');
  const perScene = m.remainingBudgetUsd / Math.max(1, plan.sections.length);
  const results = await Promise.all(
    plan.sections.map((section, i) => {
      const startedAtMs = Date.now();
      const concepts = section.conceptIds.map((c) => graph.concepts.find((x) => x.id === c)).filter(Boolean);
      const words = Math.round(section.budgetSec * WORDS_PER_SEC);
      const user = `${req.audience ? `Audience: ${req.audience}\n` : ''}LESSON OUTLINE:
${outline}

WRITE SCENE ${i + 1}: "${section.title}" (${section.kind})
Goal: ${section.goal}
Concepts: ${JSON.stringify(concepts)}
Length: about ${words} words (${section.budgetSec} s). Markers: ${MENTIONS_PER_SCENE.min}-${MENTIONS_PER_SCENE.max}.

SOURCE (facts must come from these source spans; evidence stays attached in the concept graph):
${sourcePrompt(req.sourceDoc ?? sourceDocFromText(req.source, req.sourceFormat ?? 'text'))}`;
      return structuredCall({
        stage: 'script', subject: `scene ${section.id}`, model: m.model, apiKey: m.apiKey, system, user,
        schema: SceneTextSchema, schemaName: 'scene_narration', remainingBudgetUsd: perScene, maxTokens: 2500,
        validate: (v) => validateSceneText(v.text, section), budgetLedger: m.budgetLedger, fetcher: m.fetcher,
      }).then((result) => ({ section, result, startedAtMs, completedAtMs: Date.now() }));
    }),
  );
  const usage = emptyUsage();
  const failures = results.flatMap(({ result }) => result.failures);
  const rawResponses = results.flatMap(({ result }) => result.rawResponses);
  for (const { result } of results) addUsage(usage, result.usage);
  const sceneStageRuns: StageRunRecord[] = results.map(({ section, result, startedAtMs, completedAtMs }) => ({
    stage: `S4-narration-script:${section.id}`,
    kind: 'provider',
    status: result.failures.some((failure) => failure.hard) || !result.value ? 'failed' : 'completed',
    durationMs: completedAtMs - startedAtMs,
    startedAt: new Date(startedAtMs).toISOString(),
    completedAt: new Date(completedAtMs).toISOString(),
    apiCostUsd: result.usage.costUsd,
    cacheHit: false,
    fallbackCount: 0,
    usage: { ...result.usage, fallbacks: 0, cacheHits: 0 },
    failures: result.failures.map((failure) => ({ code: failure.code, stage: failure.stage, message: failure.message, hard: failure.hard })),
  }));
  if (results.some(({ result }) => !result.value)) return { usage, failures, rawResponses, sceneStageRuns };
  const script: Script = { scenes: results.map(({ section, result }) => ({ sectionId: section.id, text: spokenForm(result.value!.text) })) };
  return { value: script, usage, failures, rawResponses, sceneStageRuns };
}
