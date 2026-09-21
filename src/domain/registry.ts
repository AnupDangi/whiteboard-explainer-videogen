/**
 * Central, data-driven domain registry.
 *
 * Single source of truth for the renderer's shape vocabulary, the scene-template
 * vocabulary, default node styling, the domain→template selection rules and the
 * equation/illustration heuristics. Nothing downstream should re-declare these
 * lists or hardcode fallback literals (`'box'`, `'idea'`, `'water'`, domain
 * keyword regexes, equation steps).
 *
 * The domain-keyed storage itself (kind→icon, kind→illustration, template→renderer,
 * keyword→kind) lives in `icons.ts`, `illustrations.ts`, `templates.ts` and
 * `vocabulary.ts`; this module owns the policy that selects from it.
 */
import {NODE_KINDS,LAYOUTS,KIND_KEYWORDS,type NodeKind,type LayoutName} from './vocabulary.js';
export {NODE_KINDS,LAYOUTS,KIND_KEYWORDS};
export type {NodeKind,LayoutName};

/** Every render primitive the compiler understands. */
export const NODE_SHAPES=['box','illustration','icon','image','equation','circle','square','bullet','number','annotation'] as const;
export type NodeShape=typeof NODE_SHAPES[number];

/** Every domain composition template the renderer ships. */
export const SCENE_TEMPLATES=['tls_handshake','supply_demand','attention_matrix','dna_fork','tectonic_section','fluid_flow','sleep_perception','trust_path','scam_funnel'] as const;
export type SceneTemplate=typeof SCENE_TEMPLATES[number];

/** Fallbacks used when a resolver cannot classify a label. */
export const DEFAULT_NODE_KIND:NodeKind='idea';
export const DEFAULT_NODE_SHAPE:NodeShape='box';

/** A label matching this reads as an equation even when no equation block exists. */
export const EQUATION_HINT=/\b(equation|formula|identity|momentum|continuity|navier[ -]?stokes)\b/i;

/** Kinds whose abstract line-art illustration reads as a blob at video scale;
 *  they keep their semantic icon instead of being promoted to a full figure. */
export const ILLUSTRATION_SUPPRESSED_KINDS:readonly NodeKind[]=['brain'];

interface DomainTemplateRule { template:SceneTemplate; pattern:RegExp }

/** Domain→template selection is data, not code: the first matching rule wins. */
const DOMAIN_TEMPLATE_RULES:readonly DomainTemplateRule[]=Object.freeze([
  {template:'fluid_flow',pattern:/\b(navier[ -]?stokes|fluid|viscosity|pressure gradient|velocity field|continuity equation|turbulence|flow)\b/i},
  {template:'sleep_perception',pattern:/\b(ghost|haunt|paranormal|sleep paralysis|felt experience)\b/i},
  {template:'trust_path',pattern:/\b(spiritual|spirituality|leader|leadership|compassion|blind obedience|trust)\b/i},
  {template:'scam_funnel',pattern:/\b(dark[- ]web|scam|phishing|credential|online fraud|manipulation)\b/i},
]);

export function resolveDomainTemplate(text:string):SceneTemplate|undefined {
  return DOMAIN_TEMPLATE_RULES.find(rule=>rule.pattern.test(text))?.template;
}

/** A label naming a quantity should render as a big number badge. */
export const QUANTITY_HINT=/\b\d[\d,.]*\s*(b|m|billion|million|trillion|%|percent|x|days?|hours?|tokens?)?\b/i;

interface LayoutHint { layout:LayoutName; pattern:RegExp }

/** Deterministic layout selection is data: first matching hint wins, else 'flow'. */
const LAYOUT_HINTS:readonly LayoutHint[]=Object.freeze([
  {layout:'compare',pattern:/\b(compare|contrast|side by side|versus|vs\.?|before\/after)\b/},
  {layout:'timeline',pattern:/\b(timeline|sequence|step|order|stages?)\b/},
  {layout:'hierarchy',pattern:/\b(hierarch|tree|parent|root)\b/},
  {layout:'branch',pattern:/\b(branch|options?|choices?|alternative)\b/},
  {layout:'convergence',pattern:/\b(converge|merge|combine|into one|results? in)\b/},
  {layout:'radial',pattern:/\b(radial|central|hub|spokes?)\b/},
]);

export function resolveLayout(text:string):LayoutName {
  return LAYOUT_HINTS.find(hint=>hint.pattern.test(text))?.layout??'flow';
}

/** Domain-specific composition data, kept out of the lowering code. */
export const TEMPLATE_SUPPORT_KIND:Readonly<Partial<Record<SceneTemplate,NodeKind>>>={'fluid_flow':'water'};
export const TEMPLATE_FALLBACK_KIND:Readonly<Partial<Record<SceneTemplate,NodeKind>>>={'fluid_flow':'pipeline'};

export const TEMPLATE_EDGE_LABEL:Readonly<Partial<Record<SceneTemplate,string>>>={'fluid_flow':'drives the flow','scam_funnel':'creates pressure'};
export const DEFAULT_EDGE_LABEL='leads to';

interface SupportLabels { early:string; final:string }
export const TEMPLATE_SUPPORT_LABELS:Readonly<Partial<Record<SceneTemplate,SupportLabels>>> = Object.freeze({
  trust_path:{early:'Ask for reasons',final:'Accountability keeps trust healthy'},
  scam_funnel:{early:'Notice the pressure',final:'Pause and verify'},
  sleep_perception:{early:'Check the context',final:'Keep causes separate from feelings'},
});
export const DEFAULT_SUPPORT_LABELS:SupportLabels=Object.freeze({early:'What to watch for',final:'Why it matters'});
