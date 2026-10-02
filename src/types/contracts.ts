/**
 * Legacy teaching-beat contract still referenced by the frozen golden fixtures
 * (shared/fixtures.ts, hash-locked by scripts/baselines.mjs) and by
 * shared/contracts.ts. Everything else from the retired production runtime was
 * removed; do not add new types here.
 */
export interface EvidenceRef {sourceId:string;blockId:string;chunkId?:string;page?:number;sectionId?:string;origin:'source'|'background'}
export type PedagogicalRole='orient'|'define'|'explain'|'demonstrate'|'derive'|'compare'|'challenge'|'recap'|'transition';
type TextOrigin='source'|'lesson-plan'|'representation'|'formula'|'axis-unit'|'compiler';
export interface TextProvenance {origin:TextOrigin;evidence?:EvidenceRef[];generatedBy?:string}
interface ProvenancedText {text:string;provenance:TextProvenance}
export interface VisualMutation {operation:'introduce'|'update'|'emphasize'|'connect'|'remove'|'hold';subjectId?:string;relation?:string}
export interface TeachingBeat {id:string;sceneId:string;claimIds:string[];evidence:EvidenceRef[];role:PedagogicalRole;spokenText:ProvenancedText;displayText?:ProvenancedText;visualIntent:string;visualMutation:VisualMutation;targetDurationMs:number}
