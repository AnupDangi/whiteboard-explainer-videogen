import { z } from 'zod';
import { addUsage, emptyUsage, structuredCall, type StructuredCallResult } from '../llm/structuredCall.js';
import { emptyTrace, mergeTraces } from '../structured/trace.js';
import { recordCoercion } from '../structured/coercionLedger.js';
import { ensureClaimMarkers, parseMarkers, resolveClaimSpans, stripStrayMarkerBrackets } from '../narration/markers.js';
import { spokenForm } from '../narration/spokenForm.js';
import { vocabularyPromptBlock, type VisualVocabulary } from '../planner/visualDiscovery.js';
import { splitSpokenSentences } from '../narration/sentences.js';
import { ConceptGraphSchema, ScopedConceptGraphSchema, TeachingPlanDraftSchema, RELATION_TYPES, SECTION_KINDS, VISUAL_CONCEPT_TYPES, VISUAL_INTENT_STRATEGIES, VISUAL_FORMS, SECTION_TITLE_MAX_WORDS, TEACHING_SKILLS, VISUAL_MECHANISMS, TeachingPlanSchema, type ConceptGraph, type Script, type TeachingPlan } from './schemas.js';
import { SCENE_SEC, WORDS_PER_SEC, analyzeTeachingPlan, sceneCountFor } from './analyze.js';
import type { StageRunRecord } from '../shared/contracts.js';
import { createEvidenceLedgerFromClaims, type GroundingMode } from '../evidence/ledger.js';
import { sourceDocFromText, spanExcerptPrompt, type SourceDoc, type SourceBundle } from '../intake/sourceDoc.js';
import { CANONICAL_RELATION_WORDING } from '../evidence/claimIdentity.js';
import { anchorQuote, type AnchorMatch } from './evidenceAnchor.js';
import type { PersistentBudgetLedger } from '../run/budgetLedger.js';
import { canonicalizePlanClaims, continuityProblems, deriveTeachingPlan, teachingContractProblems, teachingDirectorProblems } from './contracts.js';
import { CONCEPT_STRUCTURE_GUIDANCE, PLAN_COMPONENT_GUIDANCE, relationalGraphProblems } from './goalShape.js';
import { schemaKeywordLeaks } from '../planner/builder.js';

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
  /** Visual Discovery output per section id (discovery/visualDiscovery.ts); narration is written around it. */
  visualVocabulary?: Readonly<Record<string, VisualVocabulary>>;
  /** Called as soon as one scene's final narration exists (S4 writes scenes in parallel), so speech synthesis can start while slower scenes are still being written. Never affects the result. */
  onSceneScript?: (scene: { sectionId: string; text: string; plainText: string }) => void;
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
  /** Evidence policy for this lesson. OPEN_EXPLANATION remains disabled until unverified claims have their own ledger status. */
  groundingMode?: GroundingMode;
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

/** Most source text one S2 call sees; a module's scoped spans are far below this. */
const S2_SOURCE_MAX_CHARS = 60_000;
const S2_RELATION_GUIDANCE: Record<(typeof RELATION_TYPES)[number], string> = {
  causes: 'one concept brings about another', feeds: 'one concept supplies or feeds another', contains: 'one concept contains another',
  compares: 'the source explicitly compares the concepts', transforms: 'the same source-described referent changes identity or state into the target, not merely supplies energy or material used to make it', requires: 'one concept depends on another',
  produces: 'the source participant or process makes the actual output named by the evidence, not a substitute concept naming its production or release action', opposes: 'the source states an opposition', supports: 'the cited evidence supports the claim concept',
  excepts: 'one rule explicitly has the other concept as its exception', branches: 'a decision explicitly branches on the target condition',
  precedes: 'the source explicitly states that the first event occurs before the second',
};

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
  const scoped = Boolean(req.conceptScope?.length);
  const scopeRule = scoped ? `\n- This is a bounded module. Use every supplied syllabus concept exactly once in concepts, keeping each exact id and label unchanged; do not add concepts outside this scope. The syllabus already cites each concept's evidence, so give concept "evidence": [] and spend your effort on the relations between these concepts, each with exact evidence.\nGLOBAL MODULE CONCEPTS:\n${JSON.stringify(req.conceptScope)}` : '';
  const system = `You extract the teachable structure of a source for a narrated whiteboard lesson.
Return ONE JSON object: { "concepts": [...], "relations": [...], "prerequisites": [...] }.
- concepts: at most ${maxConcepts} ideas a learner must understand, in teaching order. Prefer the minimum set needed for this lesson; omit incidental details. id: lowercase snake_case. label: <=4 words. kind: entity|process|quantity|formula|event|role|rule. definition: one plain sentence grounded in the source. evidence: 1-3 exact {spanId, quote} references; quote must occur verbatim in that source span. Evidence quotes: one plain sentence or clause of at most 200 characters in ordinary words; never quote equations, symbols or figure fragments that text extraction may have split.
- ${CONCEPT_STRUCTURE_GUIDANCE}
- For mathematical ideas give "latex" (valid TeX, no $ signs) when there is a formula, and set "level": "multi-step" when understanding it takes several dependent steps (e.g. a derivation, an algorithm, a rule applied repeatedly), otherwise "one-step".
- relations: at most ${maxRelations} directed links between concept ids. Allowed types and meaning: ${RELATION_TYPES.map((type) => `${type} = ${S2_RELATION_GUIDANCE[type]}`).join('; ')}. Choose a specialized type only when the source evidence explicitly supports that meaning. Keep only the most important source-stated teaching relations; include 1-3 exact evidence references for each. Do not create summary/model nodes to collect several facts.
- A relation needs evidence for its exact participants, predicate, and direction, not merely a quote that mentions related terms. Prefer a self-contained source clause naming those participants and the asserted relationship; do not clip away the subject or cite an unresolved pronoun as its only identity. Match the endpoints to their canonical definitions as well as their labels. Energy or material supplied to a process is not by itself evidence that the supplier transforms into the product. Keep the actual output distinct from its production or release action. If the fixed concept scope cannot truthfully express a relation, do not change IDs, rename a participant, or invent a claim to rescue it; include only relationships supported for the existing concept identities.
- prerequisites: at most ${maxPrerequisites} { concept, needs } links, only when a concept cannot be understood without another one.
- Never invent facts that are not in the source. Keep it to what fits the requested duration (about one concept per 10-15 seconds).${scopeRule}`;
  const user = `Target duration: ${req.targetDurationSec} seconds.${req.audience ? `\nAudience: ${req.audience}.` : ''}${req.instruction ? `\nLearner request: ${req.instruction}` : ''}

SOURCE (each span's exact text under its span ID; cite a span by copying words from the text shown under that ID):
${spanExcerptPrompt(sourceDoc, { maxChars: S2_SOURCE_MAX_CHARS })}`;
  let relationQuotesAsked = false;
  const result = await structuredCall({
    stage: 'concepts', subject: 'concept graph', model: m.model, apiKey: m.apiKey, system, user,
    schema: scoped ? ScopedConceptGraphSchema : ConceptGraphSchema, schemaName: 'concept_graph', maxTokens: maxConceptGraphTokens, remainingBudgetUsd: m.remainingBudgetUsd, budgetLedger: m.budgetLedger, fetcher: m.fetcher,
    validate: (g) => {
      // A relation that links a concept to itself or repeats another carries no fact and is dropped at once. One whose quotes do
      // not anchor is first reported to the model (a fixable quote); if it is still unanchored after that ask, it is dropped
      // (the concepts stay) rather than failing the lesson. Evidence is never rewritten.
      const seenRelations = new Set<string>();
      g.relations = g.relations.flatMap((relation, index) => {
        const key = `${relation.from}|${relation.type}|${relation.to}`;
        if (relation.from === relation.to || seenRelations.has(key)) { recordCoercion({ path: `/relations/${index}`, oldValue: key, newValue: undefined, reason: 'self-or-duplicate-relation-dropped', semanticRisk: 'semantic' }); return []; }
        if (relationQuotesAsked && !relation.evidence.some((ref) => anchorQuote(sourceDoc, ref.spanId, ref.quote))) { recordCoercion({ path: `/relations/${index}`, oldValue: key, newValue: undefined, reason: 'unanchored-relation-dropped', semanticRisk: 'semantic' }); return []; }
        seenRelations.add(key);
        return [relation.evidence.length && relationQuotesAsked ? { ...relation, evidence: relation.evidence.filter((ref) => anchorQuote(sourceDoc, ref.spanId, ref.quote)) } : relation];
      });
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
          // Labels, definitions and concept evidence are replaced by the syllabus values (pipeline/lesson.ts), so only scope is checked.
          if (!sourceConcept) problems.push(`module graph added concept ${concept.id} outside the syllabus scope`);
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
      if (!scoped) for (const c of g.concepts) checkEvidence(`concept ${c.id}`, c.evidence);
      const beforeRelationProblems = problems.length;
      for (const r of g.relations) {
        if (!ids.has(r.from) || !ids.has(r.to)) problems.push(`relation ${r.from}->${r.to} references an unknown concept`);
        checkEvidence(`relation ${r.from}->${r.to}`, r.evidence);
      }
      if (problems.length > beforeRelationProblems) relationQuotesAsked = true;
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
    // Scoped modules receive their concept evidence from the syllabus; unchecked model quotes are never anchored.
    concepts: result.value.concepts.map(({ evidence, ...c }) => ({ ...c, evidence: scoped ? [] : enrich(evidence) })),
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
- Every generated section requires a contract. learningDelta is 1-240 characters and exactly equals goal; targetDurationSec is positive and exactly equals budgetSec; requiredConceptIds has 1-8 IDs and exactly equals conceptIds; requiredRelations has at most 24 entries and each type must be one of: ${RELATION_TYPES.join(', ')} (and must match the graph). evidenceSpanIds has 1-96 valid cited span IDs. essentialClaims has 1-8 atomic statements, each with a unique id, explicit epistemicType, linked section conceptIds, graph relations between those concepts, and evidenceSpanIds from the linked concepts/relations (0-96 only for unverified_explanation under OPEN_EXPLANATION). A claim may name at most one directed graph relation; every listed relation must be stated explicitly in the same claim with both concept labels and the correct direction/predicate. Split separate outcomes or relations into separate atomic claims; do not let a predicate in one clause appear to connect concepts in another. epistemicType is exactly one of direct_source, derived_relation, pedagogical_bridge, illustrative_example, analogy, unverified_explanation. Use derived_relation only when the claim lists a graph relation; use direct_source when it states a sourced fact without asserting a graph relation. Mark examples and analogies with explicit wording in the statement. An unverified_explanation has no graph relation or cited span and must say it is not verified by the supplied source. Provide one semanticVisualIntent for each visualized claim and no semanticVisualIntent for an unverified_explanation. teachingSkill is exactly one of: ${TEACHING_SKILLS.join(', ')}. candidateMechanisms has 1-3 values, each exactly one of: ${VISUAL_MECHANISMS.join(', ')}.
- recap.keyPoints has at most 6 strings, each 1-160 characters.
- A recap is a synthesis, contrast, or source-supported transfer that gives the learner a new combined takeaway. It is the final scene, has a distinct learningDelta, and at least one essential claim links two or more concepts or a source-backed relation. Do not repeat an earlier claim as a recap; if the source graph cannot support an integrative recap, omit the recap rather than inventing one.
- The schema also rejects unknown fields at every object level. All IDs must use lowercase snake_case and be at most 40 characters. Follow the requested duration, scene budget, graph coverage, relation, evidence, and teaching rules above as well as these shape limits.`;

function groundingPolicyPrompt(mode: GroundingMode = 'STRICT_SOURCE'): string {
  if (mode === 'SOURCE_PLUS_BACKGROUND') return `GROUNDING POLICY (SOURCE_PLUS_BACKGROUND):
- Every direct_source or derived_relation claim must cite only primary-source spans. A background span cannot support a factual claim, even when the same claim also cites a primary span.
- A pedagogical_bridge may cite hash-pinned primary or background spans; preserve each reference's sourceRole. Every claim still needs provenance.
- Keep illustrative_example and analogy claims explicitly typed and visibly framed; they never establish factual truth.
- Do not treat background material as primary evidence or remove provenance labels.`;
  if (mode === 'OPEN_EXPLANATION') return `GROUNDING POLICY (OPEN_EXPLANATION):
- Direct-source and derived-relation claims remain factual and require only hash-pinned primary-source spans. Background evidence cannot support them.
- A pedagogical_bridge may cite primary or background evidence. If an essential explanation cannot be verified by the supplied source, classify it as unverified_explanation, give it no graph relation or evidenceSpanIds, and say explicitly “not verified by the supplied source.” Never present it as a source fact or graph-derived relation.
- Keep examples and analogies explicitly typed and visibly framed; they do not establish factual truth. Do not label a factual claim unverified merely to avoid citing it.`;
  return `GROUNDING POLICY (STRICT_SOURCE):
- Every direct_source, derived_relation, or pedagogical_bridge claim must cite hash-pinned primary-source spans only. Background spans cannot support claims.
- Keep illustrative_example and analogy claims explicitly typed and visibly framed; they never establish factual truth.
- Do not remove provenance labels.`;
}

/** Production default until a calibration run (`harness/planCalibrationCli.ts`) measures a challenger ahead of it. */
const buildV3BaselinePrompt: PlanPromptBuilder = ({ scenes, req, graph, conceptIdChecklist }) => ({
  system: `You are a teaching architect. Turn a concept graph into a time-budgeted plan for a narrated whiteboard video, one scene per section.
Return ONE JSON object: { "targetDurationSec", "intro": {"sourceTitle","sections"}, "lessonBible": {"audience","domain"?,"terminology","persistentConceptIds"}, "sections": [...], "recap": {"keyPoints"} }.
Rules:
- The bible audience is the supplied audience or "general learner"; optional domain is a broad subject label used only as a low-weight example-retrieval signal. Terminology entries use unique concept IDs and exact labels from the graph. List every concept used in more than one section in persistentConceptIds; each persistent concept needs exactly one terminology entry and must keep that canonical name across scenes. Do not invent visual facts or icon choices.
- Assign concepts explicitly before writing each section: choose one or more exact concept IDs from the graph, put those IDs in section.conceptIds, then copy the identical nonempty ID list to contract.requiredConceptIds. These two arrays are required for EVERY section, including intro and recap. Never leave either array empty, and never put concept IDs only in the contract. Do not invent IDs or use concept labels in place of IDs.
- The contract has learningDelta (exactly the section goal), targetDurationSec (exactly section budgetSec), requiredConceptIds (exactly section conceptIds), requiredRelations (every graph relation whose two endpoints appear in this section, each as {from,to,type}), evidenceSpanIds (all cited span IDs for those concepts and relations), essentialClaims (1-8 atomic statements with id, statement, epistemicType, linked conceptIds, linked relations, evidenceSpanIds), teachingSkill (definition|mechanism|comparison|process|derivation|application|recap), candidateMechanisms (1-3 advisory values from focus|chain|convergence|fan_out|weighted_blend|cycle|threshold|comparison|trajectory|equation|state_transition). A mechanism is a generic visual idea, never a lesson-specific drawing instruction.
- ${PLAN_COMPONENT_GUIDANCE}
- Before returning, verify section-by-section that conceptIds and requiredConceptIds are identical and nonempty, every ID occurs in the supplied graph, every required relation is included, and evidenceSpanIds exactly covers the listed concepts and relations. If a section is only an intro or recap, anchor it to the graph concepts it introduces or reviews; do not create an ungrounded scene.
- Order by prerequisites: a concept is never taught before what it needs.
- Math: build intuition before notation. For a multi-step idea, give each step its own "step" section (the learner sees one move at a time), then an "example" or "recap". A one-step idea fits in one "explain" section.
- Budgets: every section ${SCENE_SEC.min}-${SCENE_SEC.max} seconds (about 18 s is ideal); the budgets MUST sum to targetDurationSec exactly. Use about ${scenes} sections for ${req.targetDurationSec} s — fewer, richer scenes beat many tiny ones.
- If any concept has level "multi-step", at least 2 sections must have kind "step" (one per step of that idea).
- When source evidence supports synthesis, contrast, or transfer, lessons of 45 s or more end with a short "recap" section. If the graph has no supported relation or combined takeaway, do not fabricate a recap scene. Very short lessons may skip the intro section.

${TEACHING_PLAN_PROMPT_SCHEMA_RULES}`,
  user: `targetDurationSec: ${req.targetDurationSec}\nAudience: ${req.audience ?? 'general learner'}${req.instruction ? `\nLearner request: ${req.instruction}` : ''}
${groundingPolicyPrompt(req.groundingMode)}

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
- The contract has learningDelta (exactly the section goal), targetDurationSec (exactly section budgetSec), requiredConceptIds (exactly section conceptIds), requiredRelations (every graph relation whose two endpoints appear in this section, each as {from,to,type}), evidenceSpanIds (all cited span IDs for those concepts and relations), essentialClaims (1-8 atomic statements with id, statement, epistemicType, linked conceptIds, linked relations, evidenceSpanIds), teachingSkill (definition|mechanism|comparison|process|derivation|application|recap), candidateMechanisms (1-3 advisory values from focus|chain|convergence|fan_out|weighted_blend|cycle|threshold|comparison|trajectory|equation|state_transition). A mechanism is a generic visual idea, never a lesson-specific drawing instruction.
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
${groundingPolicyPrompt(req.groundingMode)}

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
${groundingPolicyPrompt(req.groundingMode)}

VALID CONCEPT IDS (copy IDs exactly into both arrays for every section):
${conceptIdChecklist}

WORKED EXAMPLE (a fictional graph unrelated to yours — shows the exact required shape only, never real content). Given concepts concept_a ("Example A"), concept_b ("Example B"), concept_c ("Example C") and two relations {"from":"concept_a","to":"concept_b","type":"causes"} and {"from":"concept_b","to":"concept_c","type":"produces"}, a correctly filled lessonBible and section look like:
{"lessonBible":{"audience":"general learner","terminology":[{"conceptId":"concept_a","label":"Example A"},{"conceptId":"concept_b","label":"Example B"},{"conceptId":"concept_c","label":"Example C"}],"persistentConceptIds":["concept_a","concept_b","concept_c"]}}
{"id":"sec_1","title":"Example title","goal":"Example goal sentence","kind":"explain","conceptIds":["concept_a","concept_b","concept_c"],"budgetSec":18,"contract":{"learningDelta":"Example goal sentence","targetDurationSec":18,"requiredConceptIds":["concept_a","concept_b","concept_c"],"requiredRelations":[{"from":"concept_a","to":"concept_b","type":"causes"},{"from":"concept_b","to":"concept_c","type":"produces"}],"evidenceSpanIds":["<span ids covering all three concepts and both relations>"],"teachingSkill":"mechanism","candidateMechanisms":["chain"]}}
Notice conceptIds and requiredConceptIds are identical and nonempty, terminology has one entry per concept in persistentConceptIds (never an empty array when persistentConceptIds is nonempty), and requiredRelations lists EVERY relation whose two endpoints are BOTH in this section's conceptIds — not just one of them, not an empty array. A section with 3+ concepts commonly has 2+ relations; list all of them. Replace every value with graph-backed data from YOUR concept graph below — do not reuse concept_a/concept_b/concept_c or this example's facts.

CONCEPT GRAPH:
${JSON.stringify(graph, null, 1)}`,
});

/**
 * v6: the model writes the teaching decisions only (TeachingPlanDraftSchema);
 * code derives every SceneContract and the LessonBible from the draft and the
 * graph (plan/contracts.ts deriveTeachingPlan). v3-v5 made the model copy
 * those fields and failed on the copies (0-53% measured pass rates); the one
 * real decision that remains is grouping related concepts in one section.
 */
/** Teaching Director guidance (final_plan/03 §10-11; Simi benchmark §§2, 14-16, 38-45). Generic, never topic-specific. */
const TEACHING_DIRECTOR_GUIDANCE = `TEACHING DIRECTOR. For every scene decide, before writing claims:
 - visualForm: the ONE picture that carries this scene: ${VISUAL_FORMS.join(' | ')}. process = a mechanism or relation of ideas (the default); comparison = two things side by side; array = a list of values or positions the scene walks through (a sorted list, a search range, steps in a sequence); geometry = a figure with named sides or parts; formula = an equation; plot = a function or trend; number-line, matrix, worked-example (one numeric computation) or code when the idea is exactly that. Choose the exact form whenever the idea is mathematical, geometric or algorithmic; never a process box for a list of numbers or a figure. If every claim in the scene is an unverified_explanation, omit visualForm; never use it to depict an unverified claim.
 - mentalModel: ONE sentence naming the model the learner should hold after the scene (what sits where and how it connects). If you cannot say it in one sentence the scene is overloaded; split it.
- misconceptionRisk: 0-2 wrong ideas a learner could form here; state each as the wrong idea itself.
- essentialClaims: each claim includes an explicit epistemicType: direct_source (source-stated fact with no listed graph relation), derived_relation (source-backed graph relation), pedagogical_bridge (source-backed connection for learning), illustrative_example (explicitly framed example), analogy (explicitly framed analogy), or unverified_explanation (uncited explanatory claim allowed only in OPEN_EXPLANATION). For example/analogy, use wording such as “for example” or “think of … as”; never label an ordinary factual assertion as an example or analogy to avoid evidence requirements. An unverified_explanation has no graph relation or source spans and says it is “not verified by the supplied source.”
 - semanticVisualIntents: exactly one per visualized claim: {"claimId","conceptType","strategy","conceptIds","roles"}. Give no visual intent to an unverified_explanation, which is narrated without depiction. conceptType is one of ${VISUAL_CONCEPT_TYPES.join('|')}. strategy is one of ${VISUAL_INTENT_STRATEGIES.join('|')}: literal for a concrete object you can point at; metaphor for an abstraction with a familiar structural analogy; state-change for before/after; topology for a relation shape (chain, cycle, feedback, fork, merge, hierarchy, comparison); diagram for a mechanism; math/plot/code for exact notation. conceptIds must be concepts of that claim. roles: 0-4 functional roles (for example filter, gate, limit, source) only when the claim is about a role, not an object.
 - Scene arc: orient (what question this scene answers), introduce ONE idea, let the board draw source-backed visual claims, connect it to what is already drawn, then interpret it. An unverified_explanation remains speech only. Put the cause before its effect.
 - Terms to remember get a retrieval hook: where it is, what it does, what it affects, or what it contrasts with. Two easily confused terms share one comparison scene that shows one difference at a time.
 - An analogy is allowed only when it preserves a real relationship of the concept; the scene after it must reconnect it to the real term. A later scene uses an earlier idea in a NEW role; it never restates it.
 - Architectures and systems: teach the whole first (its parts as labelled blocks inside it, in the order data flows), then one scene per part: what it takes in, what it does, what it passes on. When the source says a part repeats N times, say the number in the claim. Components are boxes, not pictures of unrelated objects; give them a picture only when a standard symbol for that very thing exists. Mathematics inside a component is shown as its formula, built one transformation per beat, then read aloud symbol by symbol.
 - Exact subjects get exact pictures, never boxes of words: a geometric idea shows its figure first (a figure with named sides), then the relation as a formula; a numeric method shows a worked example one transformation per scene beat; an algorithm shows its data (a list of values) and the part being examined or discarded at each step; a function or rate shows a plot or number line; a proof states what is known, what is wanted, the key move, and why each step follows. Say in the claim which picture carries it (strategy math, plot, diagram or code).
 - Match the teaching shape to the domain (set "domain"): math = meaning, then symbols, then one transformation per step; biology or science = actors, state, mechanism, cause and effect, consequence; chemistry = observation, particles, then equation; software or systems = components, boundaries, data flow, state and storage, failure path; law = actors, rule, conditions, exception, decision; psychology = context, trigger, internal state, response, feedback, and never overstate certainty.`;

const buildV6DerivedContractsPrompt: PlanPromptBuilder = ({ scenes, req, graph, conceptIdChecklist }) => ({
  system: `You are a teaching architect. Turn a concept graph into a time-budgeted plan for a narrated whiteboard video, one scene per section.
Return ONE JSON object: { "targetDurationSec", "intro": {"sourceTitle","sections"}, "domain"?, "sections": [...], "recap": {"keyPoints"} }.
Each section is {"id","title","goal","kind","conceptIds","budgetSec","teachingSkill","candidateMechanisms","essentialClaims","visualForm","mentalModel","misconceptionRisk","semanticVisualIntents"}.
${TEACHING_DIRECTOR_GUIDANCE}
Rules:
 - conceptIds: the 1-6 exact graph concept IDs this scene teaches (from VALID CONCEPT IDS). Code attaches each scene's relations and source evidence from the graph: a relation is taught only in a section whose conceptIds contain BOTH of its endpoints, and every graph relation must be taught somewhere. So put related concepts in the same section (see RELATIONS TO TEACH).
 - A concept may appear again in a later section (to build on it or recap it); it keeps its graph label everywhere.
 - teachingSkill: one of ${TEACHING_SKILLS.join(', ')}. candidateMechanisms: 1-3 of ${VISUAL_MECHANISMS.join(', ')} — ways the board could show this scene.
 - essentialClaims: 1-8 atomic claims this scene must teach; visualize only source-backed claims. Each is {"id","statement","epistemicType","conceptIds","relations","evidenceSpanIds"}; epistemicType is direct_source|derived_relation|pedagogical_bridge|illustrative_example|analogy|unverified_explanation. A derived_relation must list a graph relation; a direct_source must not. Examples and analogies need explicit wording in the statement and remain visibly nonfactual. An unverified_explanation is allowed only in OPEN_EXPLANATION, has no graph relation or evidenceSpanIds, is isolated to a narration-only beat later, and says it is “not verified by the supplied source.” Use a unique lowercase id across the whole lesson. Link only this section's concept IDs and graph relations between them. Cite span IDs from the linked concepts or relations; never cite an unrelated span. Do not list every graph node as a separate claim. Pick the essential statements that teach this scene's goal.
 - A relation-bearing claim lists at most one directed graph relation. Its statement must contain BOTH exact canonical endpoint labels and an explicit matching predicate in ONE directed clause. Do not replace an endpoint with a synonym or omit words from its canonical label, and do not borrow a predicate across separate clauses. Canonical active wording already accepted by the identity parser: ${RELATION_TYPES.map((type) => `${type}: ${CANONICAL_RELATION_WORDING[type]}`).join('; ')}. These are wording choices for a source-supported fact, not evidence that an edge is true. Keep the same participants, meaning, and direction as the cited source. If a graph edge conflicts with the canonical definitions or evidence, do not manufacture a claim, substitute a product for an action, rename an ID, or change the relation just to satisfy it; an inconsistent required contract must remain a validation failure.
- title: at most ${SECTION_TITLE_MAX_WORDS} words. Do not put a number (digits or a word like "three") in a title unless the source evidence for that section's concepts states it.
- ${PLAN_COMPONENT_GUIDANCE}
- Order by prerequisites: a concept is never taught before what it needs.
- Math: build intuition before notation. For a multi-step idea, give each step its own "step" section, then an "example" or "recap". A one-step idea fits in one "explain" section.
- Budgets: every section ${SCENE_SEC.min}-${SCENE_SEC.max} seconds (about 18 s is ideal); the integer budgets MUST sum to targetDurationSec exactly. Plan the complete section list first, including every required step section, then allocate duration across that whole list. Use about ${Math.min(Math.floor(req.targetDurationSec / SCENE_SEC.min), scenes + (graph.concepts.some((concept) => concept.level === 'multi-step') ? 1 : 0))} sections for ${req.targetDurationSec} s${graph.concepts.some((concept) => concept.level === 'multi-step') ? ' when a multi-step concept needs its required second step scene' : ''}. Before returning, check that sectionCount × ${SCENE_SEC.min} ≤ targetDurationSec ≤ sectionCount × ${SCENE_SEC.max}; if the sum is wrong, rebalance existing sections instead of adding a short section. Never make a section shorter than ${SCENE_SEC.min} seconds to satisfy a step, recap, or scene-count requirement.
- If any concept has level "multi-step", at least 2 sections must have kind "step".
- Lessons of 45 s or more end with a short "recap" section. Very short lessons may skip the intro section.
- domain (optional): a broad subject label of 1-50 characters.
- intro.sections: use short outline headings of 2-5 words, each under 60 characters; keep explanations in the section goals.
SCHEMA LIMITS: section ids are unique lowercase snake_case (at most 40 characters); goal 1-240 characters; kind one of ${SECTION_KINDS.join(', ')}; budgetSec positive; intro.sourceTitle 1-80 characters and intro.sections at most 12 strings of 1-80 characters; recap.keyPoints at most 6 strings of 1-160 characters; no other fields.`,
  user: `targetDurationSec: ${req.targetDurationSec}\nAudience: ${req.audience ?? 'general learner'}${req.instruction ? `\nLearner request: ${req.instruction}` : ''}
${groundingPolicyPrompt(req.groundingMode)}

VALID CONCEPT IDS:
${conceptIdChecklist}

RELATIONS TO TEACH (each needs one section containing both endpoints):
${graph.relations.map((relation) => `- ${relation.from} -${relation.type}-> ${relation.to}`).join('\n') || '- (none)'}

CONCEPT GRAPH:
${JSON.stringify(graph, null, 1)}`,
});

export const PLAN_PROMPT_VARIANTS = {
  'v3-baseline': buildV3BaselinePrompt,
  'v4-explicit-concepts': buildV4ExplicitConceptsPrompt,
  'v5-fully-worked-example': buildV5FullyWorkedExamplePrompt,
  'v6-derived-contracts': buildV6DerivedContractsPrompt,
} as const;

/** Which output each variant asks for: the full plan with copied contracts (v3-v5) or a draft whose contracts code derives (v6). */
export const PLAN_VARIANT_OUTPUT: Record<keyof typeof PLAN_PROMPT_VARIANTS, 'full' | 'draft'> = {
  'v3-baseline': 'full',
  'v4-explicit-concepts': 'full',
  'v5-fully-worked-example': 'full',
  'v6-derived-contracts': 'draft',
};
export type PlanPromptVariant = keyof typeof PLAN_PROMPT_VARIANTS;
/**
 * Adopted 2026-09-26 from a measured `plan:calibrate` run: v4 47%, v5 53%, v5 also cheaper.
 * Full adoption rationale, per-source breakdown (including a real composting regression this
 * aggregate hides), and the repair-path caveat are in `docs/HANDOFF.md`'s 2026-09-26 entry —
 * read that, not just this comment, before touching the default again. Data:
 * `harness/reports/2026-09-25-plan-calibration.{json,md}`.
 * Change this only after a new `plan:calibrate` run measures a variant ahead of it.
 */
export const DEFAULT_PLAN_PROMPT_VARIANT: PlanPromptVariant = 'v6-derived-contracts';

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

/** Completion allowance for a v6 draft: sections and source-backed claims, plus room for hidden reasoning. */
export function teachingPlanDraftTokenBudget(sceneCount: number, conceptCount: number): number {
  // Reasoning models spend part of the limit before any JSON, so the floor is generous (a cut-off plan is a lost call).
  return Math.min(12_000, 5_500 + Math.ceil(sceneCount) * 550 + Math.ceil(conceptCount) * 80);
}

export async function buildTeachingPlan(req: LessonRequest, graph: ConceptGraph, m: StageModel, variant: PlanPromptVariant = DEFAULT_PLAN_PROMPT_VARIANT): Promise<StructuredCallResult<TeachingPlan>> {
  // A graph that cannot support the request is an S2 problem the S3 model cannot repair: fail before calling it.
  const graphProblems = relationalGraphProblems(req.instruction, graph.concepts.length, graph.relations.length, Boolean(req.conceptScope?.length));
  if (graphProblems.length) {
    return { usage: emptyUsage(), rawResponses: [], reports: [], trace: emptyTrace(), failures: [{ code: 'plan-graph-not-relational', stage: 'plan', message: `teaching plan not attempted: ${graphProblems.join('; ')}`, hard: true }] };
  }
  const scenes = sceneCountFor(req.targetDurationSec);
  const audience = req.audience ?? 'general learner';
  const conceptIdChecklist = graph.concepts.map((concept) => `- ${concept.id}: ${concept.label}`).join('\n');
  const { system, user } = PLAN_PROMPT_VARIANTS[variant]({ scenes, req, graph, conceptIdChecklist });
  // The deterministic analyser's blocking checks run INSIDE validation, so every problem consumes the
  // model's one repair; nothing a model omitted is filled in and reported as clean.
  const planProblems = (p: TeachingPlan): string[] => {
    const problems: string[] = [];
    if (p.targetDurationSec !== req.targetDurationSec) problems.push(`targetDurationSec must be ${req.targetDurationSec}`);
    problems.push(...analyzeTeachingPlan(p, graph).findings.filter((f) => f.severity === 'error').map((f) => f.message));
    problems.push(...teachingContractProblems(p, graph, audience));
    try {
      const canonical = canonicalizePlanClaims(p, graph);
      createEvidenceLedgerFromClaims(canonical.sections.flatMap((section) => section.contract?.essentialClaims ?? []), req.groundingMode ?? 'STRICT_SOURCE');
    } catch (error) {
      problems.push(`grounding policy: ${error instanceof Error ? error.message : String(error)}`);
    }
    const leakedIds = schemaKeywordLeaks(p.sections.flatMap((s) => [...s.conceptIds, ...(s.contract?.requiredConceptIds ?? [])]));
    if (leakedIds.length) problems.push(`section concept ids ${[...new Set(leakedIds)].map((id) => `"${id}"`).join(', ')} are JSON field names; use only ids from VALID CONCEPT IDS`);
    return problems;
  };
  // S3's structured contract is large enough that hidden reasoning can consume
  // the completion allowance before the plan JSON starts. Keep reasoning
  // bounded on both the initial call and its single repair; schema and
  // semantic validation remain unchanged.
  const common = { stage: 'plan', subject: 'teaching plan', model: m.model, apiKey: m.apiKey, system, user, effort: 'low' as const, remainingBudgetUsd: m.remainingBudgetUsd, budgetLedger: m.budgetLedger, fetcher: m.fetcher };

  if (PLAN_VARIANT_OUTPUT[variant] === 'draft') {
    const result = await structuredCall({
      ...common, schema: TeachingPlanDraftSchema, schemaName: 'teaching_plan', maxTokens: teachingPlanDraftTokenBudget(scenes, graph.concepts.length),
      validate: (draft) => {
        const plan = deriveTeachingPlan(draft, graph, audience);
        const shape = TeachingPlanSchema.safeParse(plan);
        // Restatement is a teaching-quality rule: the first draft is asked to fix it, a repaired draft that still repeats
        // a claim is kept (and recorded below) rather than failing the lesson.
        // Restatement is a teaching-quality rule the S3 prompt already states; it is recorded below, never a reason to lose the plan.
        const restatement: string[] = [];
        // Report shape limits (e.g. a section whose concepts cite no evidence) together with every planning problem.
        return [...(shape.success ? [] : shape.error.issues.map((issue) => `derived plan ${issue.path.join('.')}: ${issue.message}`)), ...planProblems(plan), ...teachingDirectorProblems(plan), ...restatement];
      },
    });
    const { value, ...rest } = result;
    if (!value) return rest;
    const plan = deriveTeachingPlan(value, graph, audience);
    const repeats = continuityProblems(plan);
    return { ...rest, value: plan, failures: repeats.length ? [...rest.failures, { code: 'plan-continuity-restatement', stage: 'plan' as const, message: repeats.join('; '), hard: false }] : rest.failures };
  }
  // Full-plan variants (v3-v5): every section includes a copied contract, so output size tracks
  // scenes as well as graph size, with a bounded 10k completion ceiling.
  const result = await structuredCall({ ...common, schema: TeachingPlanSchema, schemaName: 'teaching_plan', maxTokens: teachingPlanTokenBudget(scenes, graph.concepts.length, graph.relations.length), validate: planProblems });
  return result.value ? { ...result, value: canonicalizePlanClaims(result.value, graph) } : result;
}

// ---------------------------------------------------------------------------
// S4 — Script with [[id|phrase]] mention markers
// ---------------------------------------------------------------------------

/** Drawable mentions per scene: at least 4 so a board can reach its node minimum, at most 7 (MAX_BOARD_NODES). */
export const MENTIONS_PER_SCENE = { min: 4, max: 7 };
/** Audio is the master clock, so length only needs to be roughly right; the tolerance keeps scenes from being thin. */
const WORD_TOLERANCE = 0.4;

/**
 * The spans a scene may state facts from: its contract's evidence spans, else its concepts'
 * cited spans. Sending only these (not the whole source to every parallel scene call) keeps
 * each S4 prompt small and on-topic; a section with no cited spans falls back to the bounded source.
 */
export function sectionSourcePrompt(doc: SourceDoc, section: TeachingPlan['sections'][number], graph: ConceptGraph): string {
  const ids = new Set(section.contract?.evidenceSpanIds ?? section.conceptIds.flatMap((conceptId) => graph.concepts.find((concept) => concept.id === conceptId)?.evidence.map((ref) => ref.spanId) ?? []));
  const spans = doc.spans.filter((span) => ids.has(span.id));
  return spanExcerptPrompt(doc, spans.length ? { spans, maxChars: S2_SOURCE_MAX_CHARS } : { maxChars: S2_SOURCE_MAX_CHARS });
}

/** Deterministic S4 checks for ONE scene: markers parse, the spoken length fits the section budget, mentions are usable anchors. */
type ClaimAnchor = { claimId: string; exactText?: string; sentenceIndex?: number };

/** Resolve model selectors against the actual speech. Public Script spans contain only verbatim speech. */
export function materializeClaimSpans(text: string, anchors: ReadonlyArray<ClaimAnchor>): Array<{ claimId: string; exactText: string }> {
  const { plainText } = parseMarkers(text);
  const sentences = splitSpokenSentences(plainText);
  return anchors.map((anchor) => {
    let exactText: string;
    if (anchor.sentenceIndex !== undefined) {
      exactText = sentences[anchor.sentenceIndex] ?? '';
      if (!exactText) throw new Error(`claim ${anchor.claimId} sentenceIndex ${anchor.sentenceIndex} is outside spoken text`);
      if (anchor.exactText !== undefined && anchor.exactText !== exactText) {
        // The model's verbatim quote is the stronger signal than its sentence count:
        // honour it when it is an exact, unique sentence of the speech; otherwise fail.
        // A quote that is only part of one sentence, or closest to one sentence, still names that sentence; with no
        // such sentence the selected index stands (the claim-coverage gates report a wrong pick instead of the script failing).
        const quoted = sentences.filter((sentence) => sentence === anchor.exactText);
        const containing = sentences.filter((sentence) => sentence.includes(anchor.exactText!));
        const wordSet = (value: string) => new Set(value.toLowerCase().match(/[a-z0-9]+/g) ?? []);
        const quoteWords = wordSet(anchor.exactText);
        const overlap = (sentence: string) => { const words = wordSet(sentence); const shared = [...quoteWords].filter((word) => words.has(word)).length; return shared / Math.max(1, Math.min(quoteWords.size, words.size)); };
        const closest = [...sentences].sort((a, b) => overlap(b) - overlap(a))[0];
        if (quoted.length === 1) exactText = quoted[0]!;
        else if (containing.length === 1) exactText = containing[0]!;
        else if (closest && overlap(closest) >= 0.7) exactText = closest;
      }
    } else {
      exactText = anchor.exactText ?? '';
      if (!exactText) throw new Error(`claim ${anchor.claimId} needs sentenceIndex or exactText`);
    }
    if (exactText.length > 500) throw new Error(`claim ${anchor.claimId} spoken span exceeds 500 characters`);
    // This also rejects repeated selections, so downstream offsets are unambiguous.
    resolveClaimSpans(text, [{ claimId: anchor.claimId, exactText }]);
    return { claimId: anchor.claimId, exactText };
  });
}

export function validateSceneText(text: string, section: TeachingPlan['sections'][number], claimSpans?: ReadonlyArray<ClaimAnchor>, options: { lengthCeilingOnly?: boolean } = {}): string[] {
  const problems: string[] = [];
  if (/\[\[[^\]]*\[\[/.test(text)) problems.push('nested markers');
  const { plainText, mentions } = parseMarkers(text);
  if (/\[\[|\]\]/.test(plainText)) problems.push('malformed marker (use [[id|spoken words]])');
  if (/(?:^|[.!?]\s+)(?:now[, ]+)?(?:show|display|draw|animate|render|highlight|reveal|place|write|cut to)\b/i.test(plainText)) {
    problems.push('visual stage direction in spoken narration; describe the idea to the learner instead');
  }
  const words = plainText.trim().split(/\s+/).filter(Boolean).length;
  const budget = section.budgetSec * WORDS_PER_SEC;
  // Compare rounded bounds (the model only ever sees the rounded range in the
  // message and prompt): an exact-boundary count must not fail float dust.
  const loWords = Math.round(budget * (1 - WORD_TOLERANCE));
  const hiWords = Math.round(budget * (1 + WORD_TOLERANCE));
  // Audio is the master clock: a scene that runs long still plays correctly, and the lesson-level budget delta is
  // recorded as a warning (av-duration-budget-delta). Only a scene beyond the hard pacing ceiling, or far too thin, fails.
  const hardCeiling = Math.round(SCENE_SEC.max * WORDS_PER_SEC);
  // `lengthCeilingOnly` (recovery of an over-long but otherwise valid draft): only the pacing ceiling and a minimum bind.
  // Recovery of a draft the model could not shorten: audio sets the clock, so up to 1.5x the scene ceiling (about 45 s) is kept.
  const upper = options.lengthCeilingOnly ? Math.round(hardCeiling * 1.5) : Math.max(hiWords, Math.min(hardCeiling, Math.round(budget * 1.8)));
  if (words < loWords || words > upper) {
    const direction = words > hiWords ? `cut at least ${words - hiWords} words` : `add at least ${loWords - words} words`;
    problems.push(`${words} spoken words, needs ${loWords}-${hiWords} (${section.budgetSec}s at ${WORDS_PER_SEC} words/s) — ${direction}`);
  }
  if (mentions.length < MENTIONS_PER_SCENE.min || mentions.length > MENTIONS_PER_SCENE.max) problems.push(`${mentions.length} markers, needs ${MENTIONS_PER_SCENE.min}-${MENTIONS_PER_SCENE.max}`);
  const seen = new Set<string>();
  for (const mm of mentions) {
    if (!/^[a-z0-9_]+$/.test(mm.id)) problems.push(`marker id "${mm.id}" must be lowercase snake_case`);
    if (seen.has(mm.id)) problems.push(`marker id "${mm.id}" used twice`);
    seen.add(mm.id);
  }
  if (section.contract?.essentialClaims) {
    const expected = section.contract.essentialClaims.map((claim) => claim.id);
    const actual = claimSpans?.map((span) => span.claimId) ?? [];
    for (const claimId of expected) if (actual.filter((id) => id === claimId).length !== 1) problems.push(`essential claim ${claimId} needs exactly one spoken span`);
    for (const claimId of actual) if (!expected.includes(claimId)) problems.push(`unknown spoken claim ${claimId}`);
    for (const span of claimSpans ?? []) {
      try { materializeClaimSpans(text, [span]); }
      catch (error) { problems.push(error instanceof Error ? error.message : String(error)); }
    }
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
    problems.push(...validateSceneText(scene.text, section, scene.claimSpans).map((p) => `${section.id}: ${p}`));
  });
  return problems;
}

const claimTokenSet = (value: string): Set<string> => new Set((value.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((token) => token.length > 3));

/**
 * Claim anchors are bookkeeping the code can complete: one anchor per expected claim, no unknown or repeated claim ids.
 * A claim the writer left without an anchor takes the spoken sentence that shares the most content words with its statement
 * (unused sentences first), which the claim-coverage gates then judge like any other pick.
 */
export function normalizeClaimAnchors(plainText: string, anchors: ReadonlyArray<ClaimAnchor>, expected: ReadonlyArray<{ id: string; statement: string }>): ClaimAnchor[] {
  const known = new Set(expected.map((claim) => claim.id));
  const seen = new Set<string>();
  const kept = anchors.filter((anchor, index) => {
    const ok = known.has(anchor.claimId) && !seen.has(anchor.claimId);
    if (ok) seen.add(anchor.claimId);
    else recordCoercion({ path: `/claimSpans/${index}`, oldValue: anchor, newValue: undefined, reason: 'claim-anchor-dropped-unknown-or-repeated', semanticRisk: 'semantic' });
    return ok;
  });
  const sentences = splitSpokenSentences(plainText);
  const used = new Set(kept.flatMap((anchor) => (anchor.sentenceIndex !== undefined ? [anchor.sentenceIndex] : [])));
  for (const claim of expected) {
    if (seen.has(claim.id) || !sentences.length) continue;
    const wanted = claimTokenSet(claim.statement);
    const score = (index: number): number => { const tokens = claimTokenSet(sentences[index]!); return [...wanted].filter((token) => tokens.has(token)).length; };
    const order = sentences.map((_, index) => index).sort((a, b) => Number(used.has(a)) - Number(used.has(b)) || score(b) - score(a) || a - b);
    kept.push({ claimId: claim.id, sentenceIndex: order[0]! });
    recordCoercion({ path: `/claimSpans/${claim.id}`, oldValue: undefined, newValue: { claimId: claim.id, sentenceIndex: order[0]! }, reason: 'claim-anchor-completed-from-best-sentence', semanticRisk: 'low' });
    used.add(order[0]!);
    seen.add(claim.id);
  }
  return kept;
}

/** More markers than the scene allows: unwrap the surplus (words stay), starting with markers outside claim sentences, last first. */
export function trimMarkers(rawText: string, claimSpans: ReadonlyArray<{ plainStart: number; plainEnd: number }>, max: number): string {
  const { mentions } = parseMarkers(rawText);
  if (mentions.length <= max) return rawText;
  const inClaim = (mention: { plainStart: number }) => claimSpans.some((span) => mention.plainStart >= span.plainStart && mention.plainStart < span.plainEnd);
  const order = [...mentions].map((mention, index) => ({ mention, index })).sort((a, b) => Number(inClaim(b.mention)) - Number(inClaim(a.mention)) || a.index - b.index);
  // In-claim markers come first and are kept longest; among the rest the earliest are kept, the latest dropped first.
  const drop = new Set(order.slice(max).map((entry) => entry.mention.id));
  recordCoercion({ path: '/text/markers', oldValue: mentions.length, newValue: max, reason: 'markers-trimmed-to-limit', semanticRisk: 'low' });
  return rawText.replace(/\[\[([a-zA-Z0-9_.-]+)\|([^\]|]*)\]\]/g, (full, id: string, phrase: string) => (drop.has(id) ? phrase : full));
}

const SceneTextSchema = z.object({ text: z.string().min(1).max(2000), claimSpans: z.array(z.object({ claimId: z.string().regex(/^[a-z0-9_]+$/), exactText: z.string().min(1).max(500).optional(), sentenceIndex: z.number().int().min(0).optional() }).strict()) }).strict();

/**
 * S4 is written one scene per call, in parallel: a flash model reliably hits
 * one scene's word and marker budget, but not six at once (observed live).
 * Each scene sees the whole plan so the narration stays one continuous lesson,
 * and each scene gets its own single repair.
 */
export async function writeScript(req: LessonRequest, graph: ConceptGraph, plan: TeachingPlan, m: StageModel): Promise<StructuredCallResult<Script> & { sceneStageRuns: StageRunRecord[] }> {
  const system = `You write the narration for ONE scene of a whiteboard teaching video. A tutor speaks while drawing each thing as it is named.
Return ONE JSON object: { "text": "...", "claimSpans": [{ "claimId": "...", "sentenceIndex": 0 }] }.

CLAIM SPANS (required): Each essential claim below must have exactly one claimSpans entry. Use sentenceIndex (zero-based, in spoken order after mention markers are removed) to select the complete sentence that expresses the claim. Code copies the exact spoken sentence and calculates its character offsets. Count sentences ending in a period, question mark, or exclamation point. Do not invent an exactText paraphrase. If you use exactText instead, it must occur exactly once, character-for-character, in the spoken text after markers are removed.

CLAIM COVERAGE (required): The selected spoken sentence must say the whole essential claim, including both endpoints and their relationship. Name each concept in the contract and state how they connect; do not replace a named endpoint with an implicit phrase such as "one input" or "that measurement". If the complete claim does not fit one sentence, rewrite the narration so it does, then select that exact sentence. Mention the concepts early enough for their board reveals to finish while the claim is spoken.

RECAP PACING: In a recap scene, state the connecting idea and name the concepts or relation being combined in the first sentence. Do not save a required concept mention or the synthesis until the closing clause; the board needs time to reveal before the spoken claim ends.

MENTION MARKERS (required): wrap each phrase whose drawing should appear the moment it is spoken as [[id|spoken words]].
- The spoken words stay in the sentence exactly as said; id is lowercase snake_case, unique within the scene.
- The scene needs ${MENTIONS_PER_SCENE.min} to ${MENTIONS_PER_SCENE.max} markers, spread from the first sentence to the last. Every claim sentence needs at least one marker inside it, on a thing that sentence names (a concept repeated in a later sentence is marked again there, with a different id). Mark the concrete things the board shows: objects, quantities, symbols of a formula, each step.
- Example (18 s, ${Math.round(18 * WORDS_PER_SEC)} words, 5 markers):
  "Picture [[line|a straight line]] climbing across the page. Pick [[two_points|two points]] on it, one on the left and one further right. The sideways distance between them is [[run|the run]], and the upward distance is [[rise|the rise]]. Divide the rise by the run, and that single number is [[slope|the slope]] of the line."

SPOKEN TEXT ONLY: this text goes straight to a text-to-speech voice. Write every symbol as the words a teacher would say — "P of A given B", "x squared", "theta t plus one", "eta times the gradient" — never symbols, LaTeX, | [ ] or equations. The board shows the notation; the voice explains it.
LENGTH (required): spoken at ${WORDS_PER_SEC} words per second — write the number of words you are given (count them).
TEACHING ARC: orient the learner with the question this scene answers; introduce one idea; say what it is and what it does (a retrieval hook: where, what it affects, or what it contrasts with); connect it to what is already known; end on the interpretation. The spoken text must work with the video hidden. Never narrate the drawing ("you can see", "on the left", "the arrow"); explain the idea and let the board carry the layout. When a concept is drawn as a metaphor, use the analogy once, then name the real term it stands for. Reuse an earlier idea in a new role; never restate it.
STYLE: warm, plain, second person; short sentences; this scene's single idea only (earlier scenes already covered theirs, later scenes will cover theirs); intuition before notation; for math, say what each symbol means as it appears and walk steps in order. No markdown, lists, or stage directions. Facts only from the source.`;
  const outline = plan.sections.map((s, i) => `${i + 1}. [${s.kind}] ${s.title} — ${s.goal}`).join('\n');
  const sourceDoc = req.sourceDoc ?? sourceDocFromText(req.source, req.sourceFormat ?? 'text');
  const perScene = m.remainingBudgetUsd / Math.max(1, plan.sections.length);
      // The text TTS will read, made structurally complete by code: stray brackets removed, one anchor per claim, marker count
      // within the cap, and a marker on each concept a claim sentence names. Spoken words never change.
  const makeFinalize = (section: TeachingPlan['sections'][number]) => (v: { text: string; claimSpans: ReadonlyArray<ClaimAnchor> }): { text: string; claimSpans: ClaimAnchor[] } => {
        const spoken = stripStrayMarkerBrackets(spokenForm(v.text));
        const expected = (section.contract?.essentialClaims ?? []).map((claim) => ({ id: claim.id, statement: claim.statement }));
        const labelsFor = (claimId: string) => (section.contract?.essentialClaims.find((claim) => claim.id === claimId)?.conceptIds ?? []).map((id) => graph.concepts.find((concept) => concept.id === id)?.label ?? '').filter(Boolean);
        try {
          const anchors = expected.length ? normalizeClaimAnchors(parseMarkers(spoken).plainText, v.claimSpans, expected) : [...v.claimSpans];
          const spans = materializeClaimSpans(spoken, anchors);
          const trimmed = trimMarkers(spoken, resolveClaimSpans(spoken, spans), MENTIONS_PER_SCENE.max);
          return { text: ensureClaimMarkers(trimmed, spans, labelsFor, MENTIONS_PER_SCENE.max), claimSpans: anchors };
        } catch { return { text: spoken, claimSpans: [...v.claimSpans] }; }
      };
  const results = await Promise.all(
    plan.sections.map((section, i) => {
      const startedAtMs = Date.now();
      const concepts = section.conceptIds.map((c) => graph.concepts.find((x) => x.id === c)).filter(Boolean);
      const finalizeScene = makeFinalize(section);
      const words = Math.round(section.budgetSec * WORDS_PER_SEC);
      const user = `${req.audience ? `Audience: ${req.audience}\n` : ''}LESSON OUTLINE:
${outline}

WRITE SCENE ${i + 1}: "${section.title}" (${section.kind})
Goal: ${section.goal}
Essential claims: ${JSON.stringify(section.contract?.essentialClaims ?? [])}
Concepts: ${JSON.stringify(concepts)}
${section.contract?.mentalModel ? `Mental model to build: ${section.contract.mentalModel}\n` : ''}${section.contract?.misconceptionRisk?.length ? `Prevent these misconceptions: ${section.contract.misconceptionRisk.join('; ')}\n` : ''}${section.contract?.priorKnowledge?.length ? `The learner already knows: ${section.contract.priorKnowledge.join(', ')}\n` : ''}${vocabularyPromptBlock(m.visualVocabulary?.[section.id])}${m.visualVocabulary?.[section.id] ? '\n' : ''}Length: about ${words} words (${section.budgetSec} s). Markers: ${MENTIONS_PER_SCENE.min}-${MENTIONS_PER_SCENE.max}.

SOURCE (facts must come from these source spans; evidence stays attached in the concept graph):
${sectionSourcePrompt(sourceDoc, section, graph)}`;
      return structuredCall({
        stage: 'script', subject: `scene ${section.id}`, model: m.model, apiKey: m.apiKey, system, user,
        schema: SceneTextSchema, schemaName: 'scene_narration', remainingBudgetUsd: perScene, maxTokens: 6000,
        // Checked in spoken form: that is what TTS reads (digits expand to words) and what the script stores.
        validate: (v) => { const done = finalizeScene(v); return validateSceneText(done.text, section, done.claimSpans); }, budgetLedger: m.budgetLedger, fetcher: m.fetcher,
      }).then((result) => {
        if (result.value) {
          try { const done = finalizeScene(result.value); m.onSceneScript?.({ sectionId: section.id, text: done.text, plainText: parseMarkers(done.text).plainText }); } catch { /* an observer must never change S4 */ }
          return { section, result, startedAtMs, completedAtMs: Date.now() };
        }
        // Audio is the master clock: a draft that is only longer than its budget (still inside the pacing ceiling, markers and
        // claims valid) is a pacing warning, not a missing script. Used when the model's repairs could not shorten it.
        for (const attempt of result.rawResponses) {
          try {
            const parsed = SceneTextSchema.safeParse(JSON.parse(attempt.content));
            if (!parsed.success) continue;
            const done = finalizeScene(parsed.data);
            if (validateSceneText(done.text, section, done.claimSpans, { lengthCeilingOnly: true }).length) continue;
            const recovered: StructuredCallResult<z.infer<typeof SceneTextSchema>> = { ...result, value: parsed.data, failures: [...result.failures.map((failure) => (/^script-(repair-failed|truncated-after-repair)$/.test(failure.code) ? { ...failure, hard: false } : failure)), { code: 'scene-over-budget', stage: 'script', message: `scene ${section.id}: kept an over-budget draft (audio sets the clock; the lesson-level budget delta is recorded)`, hard: false }] };
            return { section, result: recovered, startedAtMs, completedAtMs: Date.now() };
          } catch { /* content was not JSON */ }
        }
        return { section, result, startedAtMs, completedAtMs: Date.now() };
      });
    }),
  );
  const usage = emptyUsage();
  const failures = results.flatMap(({ result }) => result.failures);
  const rawResponses = results.flatMap(({ result }) => result.rawResponses);
  const reports = results.flatMap(({ result }) => result.reports);
  const trace = mergeTraces(results.map(({ result }) => result.trace));
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
  if (results.some(({ result }) => !result.value)) return { usage, failures, rawResponses, reports, trace, sceneStageRuns };
  const script: Script = { scenes: results.map(({ section, result }) => {
    const done = makeFinalize(section)(result.value!);
    return { sectionId: section.id, text: done.text, claimSpans: materializeClaimSpans(done.text, done.claimSpans) };
  }) };
  return { value: script, usage, failures, rawResponses, reports, trace, sceneStageRuns };
}
