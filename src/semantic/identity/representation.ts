/** Representation Resolver (Wave 3).
 *
 *  Tiered concept -> representation mapping. Never hard-fails: when no curated
 *  asset matches, the resolver falls back to a labeled primitive and records a
 *  visible warning (counted in eval metrics as `representation fallback`).
 *  The runtime owns this decision; the model only sees the candidate list plus
 *  an explicit primitive-fallback note. Translation utility — not the identity
 *  authority (`harness/registry.ts`).
 */
import {COMPOSITION_FAMILIES,REPRESENTATION_FAMILIES,type CompositionFamily,type RepresentationRequest, type RepresentationResolution, type RepresentationCandidate, type RepresentationSpec} from '../representation.js';
import { ASSETS } from '../assets/registry.js';
import { searchAssets } from '../assets/search.js';
import type { VisualArchetype } from '../types.js';
import {cacheSynthesisSpec} from '../representation-synthesis.js';

interface RepresentationConcept {
  id: string;
  canonicalName: string;
  aliases: string[];
  semanticType?: string;
  visualFamily?: string;
}

interface RepresentationDecision {
  /** Curated asset candidates (may be empty when falling back). */
  candidates: { id: string }[];
  representation?:RepresentationSpec;
  /** Non-null when the resolver degraded to a non-curated representation.
   *  `not-applicable` is not a degradation: the concept is one an icon could
   *  never represent (an equation), so no search is attempted and no warning is
   *  raised — the director supplies the matching primitive instead. */
  fallback: 'asset' | 'primitive-label' | 'composition' | 'not-applicable' | null;
  /** Asset chosen by the tier-2 substring match (when fallback === 'asset'). */
  fallbackAssetId?: string;
  warnings: string[];
}

const STYLE_FAMILY = 'chalk-ink-v2';
/** The last-resort composition for a concept that declares no visualFamily.
 *  Mirrors the heal the knowledge path already applies. */
const FAMILY_BY_SEMANTIC_TYPE:Record<string,string>={process:'signal',state:'container',quantity:'quantity',entity:'component_group',material:'component_group',location:'container',role:'component_group'};

function wordsOf(s: string): Set<string> {
  return new Set(
    s
      .normalize('NFKC')
      .toLowerCase()
      .split(/[^a-z0-9]+/g)
      .filter(w => w.length > 1),
  );
}

/** Tier 1: strict scored search, unioned across every candidate archetype. */
function strictCandidates(
  concept: RepresentationConcept,
  archetypes: readonly VisualArchetype[],
): { id: string }[] {
  const merged = new Map<string, number>();
  for (const archetype of archetypes) {
    for (const hit of searchAssets(
      {
        name: concept.canonicalName,
        tags: concept.aliases,
        semanticType: concept.semanticType,
        archetype,
        styleFamily: STYLE_FAMILY,
      },
      8,
    )) {
      // Prefer assets that also support the primary (first) candidate archetype:
      // the director usually keeps it, and an incompatible pick fails compile.
      const supportsPrimary = ASSETS.find(a => a.id === hit.id)?.archetypes.includes(archetypes[0]);
      const boost = supportsPrimary ? 5 : 0;
      merged.set(hit.id, Math.max(merged.get(hit.id) ?? 0, hit.score + boost));
    }
  }
  return [...merged.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 8)
    .map(([id]) => ({ id }));
}

/** Tier 2: substring word-overlap against aliases/tags, still constrained to an
 *  asset that supports at least one candidate archetype (otherwise the compiler
 *  would reject it as incompatible). */
function substringFallback(
  concept: RepresentationConcept,
  archetypes: readonly VisualArchetype[],
): string | undefined {
  const conceptWords = wordsOf([concept.id, concept.canonicalName, ...concept.aliases].join(' '));
  let best: { id: string; overlap: number } | undefined;
  for (const asset of ASSETS) {
    /** Only an ALIAS is a semantic match; a tag is merely thematic. The
     *  refrigeration parts are tagged `cycle`, so "Discovery Loop" matched
     *  `physics.compressor.v2` on that single word and would have drawn a coolant
     *  compressor for a machine-learning concept - a false match is worse than a
     *  labelled box. An alias hit is weighted so it always outranks incidental
     *  tag overlap, and a concept with no alias hit does not match at all. */
    const aliasWords = wordsOf(asset.aliases.join(' ')),tagWords = wordsOf(asset.tags.join(' '));
    let aliasHits = 0,tagHits = 0;
    for (const w of conceptWords) { if (aliasWords.has(w)) aliasHits++; else if (tagWords.has(w)) tagHits++; }
    if (aliasHits === 0) continue;
    const overlap = aliasHits * 2 + tagHits;
    if (!best || overlap > best.overlap || (overlap === best.overlap && asset.id < best.id)) {
      best = { id: asset.id, overlap };
    }
  }
  return best?.id;
}

export function resolveRepresentation(
  concept: RepresentationConcept,
  archetypes: readonly VisualArchetype[],
): RepresentationDecision {
  /** Routing before search. An equation is not an entity: no icon library holds
   *  a glyph for `2x + 3 = 11`, so searching wastes a tier and then reports a
   *  degradation that is not one — which is precisely what hides the genuine
   *  gaps in the degradation metric. The director renders equations with the
   *  equation primitive. */
  if (concept.semanticType === 'equation') {
    return { candidates: [], fallback: 'not-applicable', warnings: [] };
  }
  const strict = strictCandidates(concept, archetypes);
  if (strict.length > 0) return { candidates: strict, fallback: null, warnings: [] };
  const fallbackAssetId = substringFallback(concept, archetypes);
  if (fallbackAssetId) {
    return {
      candidates: [{ id: fallbackAssetId }],
      fallback: 'asset',
      fallbackAssetId,
      warnings: [
        `representation fallback: concept ${concept.id} matched ${fallbackAssetId} by alias substring (no strict candidate)`,
      ],
    };
  }
  const family=REPRESENTATION_FAMILIES.find(f=>f===concept.visualFamily);
  if(family)return {candidates:[],representation:{family},fallback:'composition',warnings:[]};
  /** No usable visualFamily. The knowledge path heals one from semanticType,
   *  but the teaching path does not, so a hero with neither an asset nor a
   *  family reached a bare label and tripped the hard "hero has no
   *  representation" gate, failing the whole job (measured live). A composition
   *  is a real representation, so derive the family here where BOTH paths pass.
   *  Recorded, because it is a change to what the scene shows. */
  const derived=FAMILY_BY_SEMANTIC_TYPE[concept.semanticType??''];
  if(derived)return {candidates:[],representation:{family:derived as typeof REPRESENTATION_FAMILIES[number]},fallback:'composition',warnings:[`representation fallback: ${concept.id} has no visualFamily; using the ${derived} composition for ${concept.semanticType}`]};
  return {
    candidates: [],
    fallback: 'primitive-label',
    warnings: [
      `representation fallback: no curated asset for ${concept.id}; direct primitive label`,
    ],
  };
}

/** Additive typed resolver boundary with provenance and feasibility checks. */
export function resolveRepresentationRequest(request:RepresentationRequest):RepresentationResolution {
  const archetype=request.archetype as VisualArchetype;
  const decision=resolveRepresentation({id:request.conceptKey,canonicalName:request.conceptKey,aliases:[],semanticType:request.semanticType},[archetype]);
  const warnings=[...decision.warnings];
  const candidates:RepresentationCandidate[]=decision.candidates.flatMap(candidate=>{
    const asset=ASSETS.find(a=>a.id===candidate.id);
    if(!asset)return [];
    const missingAnchors=(request.requiredAnchors??[]).filter(anchor=>!asset.anchors[anchor]&&!asset.anchorAliases?.[anchor]);
    const missingStates=(request.requiredStates??[]).filter(state=>!asset.states[state as keyof typeof asset.states]);
    if(missingAnchors.length||missingStates.length){warnings.push(`representation infeasible: ${asset.id} missing ${[...missingAnchors,...missingStates].join(', ')}`);return [];}
    return [{source:asset.type==='diagram_template'?'template':'asset',ref:asset.id,semanticScore:1,archetypeScore:asset.archetypes.includes(archetype)?1:0,anchors:Object.keys(asset.anchors),states:Object.keys(asset.states),confidence:.95} satisfies RepresentationCandidate];
  });
  if(candidates.length)return {request,candidates,selected:candidates[0],warnings};
  /** The archetype's own composition family is more specific than one derived
   *  from semanticType, so it is tried first on the typed path. */
  const family=(Object.entries(COMPOSITION_FAMILIES) as [CompositionFamily,readonly string[]][]).find(([,archetypes])=>archetypes.includes(request.archetype))?.[0];
  if(family){const composition:RepresentationCandidate={source:'composition',ref:`composition:${family}`,semanticScore:.72,archetypeScore:1,anchors:[...(request.requiredAnchors??[])],states:['neutral','highlighted','activated'],confidence:.7};return {request,candidates:[composition],selected:composition,warnings};}
  if(decision.representation){
    const composition:RepresentationCandidate={source:'composition',ref:`family:${decision.representation.family}`,semanticScore:.8,archetypeScore:1,anchors:[],states:['neutral','highlighted','activated'],confidence:.75};
    return {request,candidates:[composition],selected:composition,warnings};
  }
  const template=ASSETS.find(asset=>asset.type==='diagram_template'&&asset.archetypes.includes(archetype));
  if(template){const candidate:RepresentationCandidate={source:'template',ref:template.id,semanticScore:.6,archetypeScore:1,anchors:Object.keys(template.anchors),states:Object.keys(template.states),confidence:.65};return {request,candidates:[candidate],selected:candidate,warnings};}
  if(['entity','material','process','state'].includes(request.semanticType)){
    const synthesized=cacheSynthesisSpec({semanticSubject:request.conceptKey,parts:[{key:'body',primitive:request.semanticType==='process'?'path':'ellipse',semanticRole:request.semanticType}],requestedAnchors:request.requiredAnchors??[],styleFamily:request.styleFamily});
    const candidate:RepresentationCandidate={source:'generated',ref:`synthesis:${synthesized.hash}`,semanticScore:.55,archetypeScore:.6,anchors:[...(request.requiredAnchors??[])],states:['neutral','highlighted','activated'],confidence:.55};
    warnings.push(`representation fallback: ${request.conceptKey} uses validated declarative synthesis`);return {request,candidates:[candidate],selected:candidate,warnings};
  }
  const abstraction:RepresentationCandidate={source:'abstraction',ref:'primitive:label',semanticScore:.35,archetypeScore:.25,anchors:['center'],states:['neutral'],confidence:.3,degradation:'No feasible curated representation; label abstraction retained.'};
  warnings.push(`representation fallback: ${request.conceptKey} reduced to semantic label abstraction`);
  return {request,candidates:[abstraction],selected:abstraction,warnings};
}

/** Director-prompt hint appended only for concepts that need the primitive fallback. */
export function primitiveFallbackNote(conceptIds: string[]): string {
  if (!conceptIds.length) return '';
  return (
    `No curated asset matches ${conceptIds.join(', ')}; ` +
    `represent each with primitiveRef "label" (never invent an asset ID).`
  );
}
