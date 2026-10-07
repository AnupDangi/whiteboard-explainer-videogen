import { checkPicturesVisually } from '../assets/pictureCheck.js';
import { allCatalogEntries, rankConcepts, type Candidate } from '../assets/semantic.js';
import type { CatalogEntry } from '../assets/catalog.js';
import { resolveObject, APPROVED_METAPHORS } from '../assets/ladder.js';
import { bridgeConceptFor, bridgeDiagramsForConcept } from '../assets/bridge.js';
import { classifyDiagramAdapter } from '../assets/diagramAdapters.js';
import { referentKeys } from '../assets/referent.js';
import { chooseSceneFamily } from '../assets/sceneFamily.js';
import { isSemanticTopology } from '../render/semanticCore.js';
import { isNumericReferent, judgeDepictions, proposeDepictionNouns, selectDepictions, type DirectorItem } from '../assets/depictionDirector.js';
import type { PersistentBudgetLedger } from '../run/budgetLedger.js';
import type { CallUsage } from '../llm/structuredCall.js';
import { emptyUsage } from '../llm/structuredCall.js';
import type { ConceptGraph, TeachingPlan } from '../plan/schemas.js';
import type { StageFailure } from '../shared/types.js';

/**
 * Visual Discovery (S3.5, final_plan/01 §2 + Simi benchmark §§6, 38). After the teaching plan is locked and
 * BEFORE narration and board planning, resolve every scene concept to the depiction that will really be
 * drawn: a pictorial icon, a reviewed metaphor, a diagram recipe, a topology, or an honest label.
 * Narration and board are then written around what exists, instead of discovering after the fact that a
 * named object has no picture. The vocabulary names concepts and depiction kinds; provider asset IDs stay
 * internal (`entryId`, used only by the resolver and the lock).
 */
export type Depiction =
  | { kind: 'icon'; entryId: string; rung: string; houseFamily?: string }
  | { kind: 'metaphor'; structure: string; reconnectTerm: string; role?: string; topology?: string }
  | { kind: 'diagram'; diagramRef: string; topology: string }
  | { kind: 'topology'; topology: string }
  | { kind: 'exact'; renderer: 'math' }
  | { kind: 'labelled' };

export interface VocabularyConcept { conceptId: string; label: string; conceptKind: string; depiction: Depiction }
export interface VisualVocabulary { sceneId: string; family?: string; concepts: VocabularyConcept[] }

const PROBE_SIZE = { w: 300, h: 300 };
const PICTORIAL = /^R(3|4|6|7|8)-/;

/** Synchronous part: decide a depiction from an exact catalog hit, reviewed metaphor, diagram recipe or intent topology. */
export function probeDepiction(
  concept: { id: string; label: string; kind: string },
  options: { catalog: CatalogEntry[]; sceneFamily?: string; lessonDomain?: string; topologyHint?: string; validatedEntryId?: string },
): Depiction {
  if (concept.kind === 'formula') return { kind: 'exact', renderer: 'math' };
  const key = referentKeys(concept.label)[0] ?? concept.label.toLowerCase();
  // Keep discovery aligned with the typed renderer and semantic BoardOps compiler:
  // catalog pictures depict canonical entities only. Processes, quantities, rules,
  // and events must be represented by their structure or remain honest labels.
  if (concept.kind === 'entity') {
    const literal = resolveObject(concept.label, {
      size: PROBE_SIZE, visualStrategy: 'literal',
      ...(options.sceneFamily ? { sceneFamily: options.sceneFamily } : {}),
      ...(options.lessonDomain ? { lessonDomain: options.lessonDomain } : {}),
      ...(options.validatedEntryId ? { validatedAssetId: options.validatedEntryId } : {}),
    }, options.catalog).resolution;
    if (literal.assetId && literal.strategy && PICTORIAL.test(literal.strategy)) return { kind: 'icon', entryId: literal.assetId, rung: literal.strategy, ...(literal.houseFamily ? { houseFamily: literal.houseFamily } : {}) };
  }
  const metaphor = APPROVED_METAPHORS[key];
  if (metaphor) return { kind: 'metaphor', structure: metaphor.structure, reconnectTerm: metaphor.reconnectTerm, ...(metaphor.role ? { role: metaphor.role } : {}), ...(metaphor.topology ? { topology: metaphor.topology } : {}) };
  const bridgeConcept = bridgeConceptFor(concept.label);
  if (bridgeConcept) {
    for (const diagram of bridgeDiagramsForConcept(bridgeConcept.conceptId)) {
      const decision = classifyDiagramAdapter(diagram);
      if (decision.status === 'compiled') return { kind: 'diagram', diagramRef: diagram.ref, topology: decision.topology };
    }
  }
  if (options.topologyHint && isSemanticTopology(options.topologyHint)) return { kind: 'topology', topology: options.topologyHint };
  return { kind: 'labelled' };
}

export interface DiscoveryArgs {
  plan: TeachingPlan;
  graph: ConceptGraph;
  model: string;
  apiKey: string;
  remainingBudgetUsd: number;
  budgetLedger?: PersistentBudgetLedger;
  fetcher?: typeof fetch;
  /** Vision model that looks at each chosen picture beside its label (optional; without it the text judge stands). */
  visionModel?: string;
  /** Test seam: embedding retrieval and the model call that proposes drawable nouns. */
  rank?: typeof rankConcepts;
  direct?: typeof proposeDepictionNouns;
  judge?: typeof judgeDepictions;
  visualCheck?: typeof checkPicturesVisually;
}

export interface DiscoveryResult {
  /** Section id -> vocabulary (plain records: the stage artifact is JSON-cached and locked). */
  vocabularies: Record<string, VisualVocabulary>;
  /** Lesson concept id -> catalog entry id confirmed by semantic validation (consumed by S7). */
  validatedByConcept: Record<string, string>;
  usage: CallUsage;
  failures: StageFailure[];
}

export async function discoverVisualVocabulary(args: DiscoveryArgs): Promise<DiscoveryResult> {
  const catalog = allCatalogEntries();
  const concepts = new Map(args.graph.concepts.map((concept) => [concept.id, concept]));
  const lessonDomain = args.plan.lessonBible?.domain;
  const exactNames = new Set(catalog.flatMap((entry) => entry.names.map((name) => name.trim().toLowerCase())));

  // 1. Entity concepts with no exact icon and no reviewed metaphor: the Depiction Director names drawable nouns (using
  //    retrieved vocabulary), and code resolves each noun by exact name/alias. Formulas are exact notation, never icons.
  const seeds = [...new Map(args.plan.sections.flatMap((section) => (section.contract?.requiredConceptIds ?? section.conceptIds).map((id) => [id, concepts.get(id)] as const)).filter(([, concept]) => Boolean(concept)) as Array<[string, NonNullable<ReturnType<typeof concepts.get>>]>).values()];
  const needDirection = seeds.filter((concept) => concept.kind === 'entity' && !isNumericReferent(concept.label)
    && !exactNames.has((referentKeys(concept.label)[0] ?? '').toLowerCase()) && !APPROVED_METAPHORS[referentKeys(concept.label)[0] ?? '']);
  const usage = emptyUsage();
  const failures: StageFailure[] = [];
  const validatedByConcept = new Map<string, string>();
  const takenEntries = new Set<string>();
  const takenNouns = new Set<string>();
  if (needDirection.length) {
    try {
      const ranked = await (args.rank ?? rankConcepts)(needDirection.map((concept) => concept.label), 30);
      const items: DirectorItem[] = needDirection.map((concept) => {
        const seen = new Set<string>();
        const vocabulary = (ranked.get(concept.label.trim().toLowerCase()) ?? []).filter((candidate: Candidate) => candidate.score >= 0.25 && (seen.has(candidate.name) ? false : (seen.add(candidate.name), true))).map((candidate: Candidate) => candidate.name);
        return { referent: concept.label.trim().toLowerCase(), context: `${concept.kind}: ${concept.definition.slice(0, 160)}`, vocabulary };
      });
      const selected = await selectDepictions({ items, catalog, model: args.model, apiKey: args.apiKey, remainingBudgetUsd: args.remainingBudgetUsd, ...(args.budgetLedger ? { budgetLedger: args.budgetLedger } : {}), ...(args.fetcher ? { fetcher: args.fetcher } : {}), ...(lessonDomain ? { lessonDomain } : {}), takenEntries, takenNouns, ...(args.direct ? { propose: args.direct } : {}), ...(args.judge ? { judge: args.judge } : {}) });
      usage.calls += selected.usage.calls; usage.promptTokens += selected.usage.promptTokens; usage.completionTokens += selected.usage.completionTokens; usage.cachedTokens += selected.usage.cachedTokens; usage.costUsd += selected.usage.costUsd; usage.repairs += selected.usage.repairs;
      failures.push(...selected.failures);
      // A vision model looks at each chosen picture beside its label; pictures it rejects fall back to a labelled box.
      let rejectedByEye = new Set<string>();
      if (args.visionModel && selected.picks.size) {
        const checked = await (args.visualCheck ?? checkPicturesVisually)({ pictures: [...selected.picks].map(([referent, pick]) => ({ referent, label: referent, entryId: pick.entryId })), model: args.visionModel, apiKey: args.apiKey, remainingBudgetUsd: Math.max(0, args.remainingBudgetUsd - selected.usage.costUsd), ...(args.budgetLedger ? { budgetLedger: args.budgetLedger } : {}), ...(args.fetcher ? { fetcher: args.fetcher } : {}) });
        usage.calls += checked.usage.calls; usage.promptTokens += checked.usage.promptTokens; usage.completionTokens += checked.usage.completionTokens; usage.cachedTokens += checked.usage.cachedTokens; usage.costUsd += checked.usage.costUsd;
        failures.push(...checked.failures);
        rejectedByEye = checked.rejected;
        for (const referent of rejectedByEye) { const pick = selected.picks.get(referent); if (pick) { takenEntries.delete(pick.entryId); takenNouns.delete(pick.nounKey); } }
      }
      for (const concept of needDirection) {
        const referent = concept.label.trim().toLowerCase();
        const found = selected.picks.get(referent);
        if (found && !rejectedByEye.has(referent)) validatedByConcept.set(concept.id, found.entryId);
      }
    } catch (error) {
      failures.push({ code: 'visual-discovery-degraded', stage: 'discovery', message: `depiction direction skipped: ${error instanceof Error ? error.message : String(error)}`, hard: false });
    }
  }

  // 2. Per scene: probe, lock one primary family, re-probe concepts whose icon sits in another family.
  const vocabularies: Record<string, VisualVocabulary> = {};
  for (const section of args.plan.sections) {
    const ids = section.contract?.requiredConceptIds ?? section.conceptIds;
    const hints = new Map((section.contract?.semanticVisualIntents ?? []).flatMap((intent) => intent.topology ? intent.conceptIds.map((id) => [id, intent.topology!] as const) : []));
    const probe = (family?: string): VocabularyConcept[] => ids.flatMap((id) => {
      const concept = concepts.get(id);
      if (!concept) return [];
      const depiction = probeDepiction(concept, { catalog, ...(family ? { sceneFamily: family } : {}), ...(lessonDomain ? { lessonDomain } : {}), ...(hints.get(id) ? { topologyHint: hints.get(id)! } : {}), ...(validatedByConcept.get(id) ? { validatedEntryId: validatedByConcept.get(id)! } : {}) });
      return [{ conceptId: id, label: concept.label, conceptKind: concept.kind, depiction }];
    });
    let scene = probe();
    const family = chooseSceneFamily(scene.map((entry) => (entry.depiction.kind === 'icon' ? entry.depiction.houseFamily : undefined)));
    if (family) scene = probe(family);
    vocabularies[section.id] = { sceneId: section.id, ...(family ? { family } : {}), concepts: scene };
  }
  return { vocabularies, validatedByConcept: Object.fromEntries(validatedByConcept), usage, failures };
}

/** Prompt block shared by S4 and S6: concept label, kind and how it will be drawn. Never includes asset IDs. */
export function vocabularyPromptBlock(vocabulary: VisualVocabulary | undefined): string {
  if (!vocabulary?.concepts.length) return '';
  const line = (concept: VocabularyConcept): string => {
    const d = concept.depiction;
    const how = d.kind === 'icon' ? 'a real picture exists (draw it literally)'
      : d.kind === 'metaphor' ? `no picture; drawn as a metaphor for "${d.reconnectTerm}" (${d.structure}); the narration must tie it back to the real term "${d.reconnectTerm}"`
        : d.kind === 'diagram' ? `drawn as a ${d.topology} diagram`
          : d.kind === 'topology' ? `drawn as a ${d.topology} shape`
            : d.kind === 'exact' ? 'shown as an exact formula'
              : 'no picture exists; it becomes a short label, so teach it through its relationships, not by describing a drawing';
    return `- ${concept.label} (${concept.conceptKind}): ${how}`;
  };
  return `HOW EACH CONCEPT WILL BE DRAWN (decided before writing; do not contradict it):\n${vocabulary.concepts.map(line).join('\n')}`;
}
