/** Knowledge stage types (`Architecture_plan.md` §11-15). Parallel graph maps
 *  each return a `GraphFragment`; one reducer turns them into a `BaseConceptGraph`
 *  owned by the source. A lesson narrows it to a `FocusedConceptGraph` without
 *  mutating the base. All IDs are model-authored semantic keys, never geometry. */
export const SEMANTIC_TYPES=['entity','material','process','state','quantity','equation','location','role'] as const;
export type SemanticType=typeof SEMANTIC_TYPES[number];

export interface FragmentEvidence {id:string;quote:string;section?:string;chunkId?:string}
export interface FragmentConcept {key:string;canonicalName:string;aliases:string[];semanticType:SemanticType;evidenceRefs:string[]}
export interface FragmentRelation {from:string;to:string;type:string;evidenceRefs:string[]}
export interface FragmentClaim {id:string;statement:string;critical:boolean;evidenceRefs:string[];conceptKeys?:string[]}
export interface FragmentMechanism {id:string;statement:string;conceptKeys:string[];evidenceRefs:string[]}
export interface FragmentPrerequisite {before:string;after:string;reason?:string}
export interface FragmentTerm {key:string;definition:string}

/** What one graph-map call returns. Every claim/mechanism carries evidenceRefs. */
export interface GraphFragment {
  concepts:FragmentConcept[];
  relations:FragmentRelation[];
  claims:FragmentClaim[];
  mechanisms:FragmentMechanism[];
  prerequisites:FragmentPrerequisite[];
  terminology:FragmentTerm[];
  evidence:FragmentEvidence[];
}

/** Source-owned, cacheable, immutable to user focus. */
export interface BaseConceptGraph {
  version:1;
  concepts:FragmentConcept[];
  relations:FragmentRelation[];
  claims:FragmentClaim[];
  mechanisms:FragmentMechanism[];
  prerequisites:FragmentPrerequisite[];
  terminology:FragmentTerm[];
  evidence:FragmentEvidence[];
  centralConcepts:string[];
  thesis:string;
}

/** `BaseConceptGraph` narrowed by a user prompt; still source truth. */
export interface FocusedConceptGraph {
  version:1;
  baseHash:string;
  focus:string;
  concepts:FragmentConcept[];
  relations:FragmentRelation[];
  claims:FragmentClaim[];
  mechanisms:FragmentMechanism[];
  prerequisites:FragmentPrerequisite[];
  terminology:FragmentTerm[];
}
