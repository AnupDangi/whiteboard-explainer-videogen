/** Bounded semantic representations. Geometry is constructed by trusted renderers. */
export const REPRESENTATION_FAMILIES=['signal','quantity','component_group','container','system'] as const;
export interface RepresentationSpec {
 family:typeof REPRESENTATION_FAMILIES[number];
 count?:number;
 value?:number;
 phase?:number;
 cycles?:number;
 afterValue?:number;
 afterPhase?:number;
}
export type RepresentationSource='asset'|'composition'|'template'|'generated'|'abstraction';
export interface RepresentationProvenance {source:RepresentationSource;ref:string;anchors:string[];states:string[];confidence?:number;degradation?:string}
export interface RepresentationRequest {
  conceptKey:string;
  semanticType:string;
  role:'hero'|'support'|'material'|'annotation';
  mentalModel:string;
  archetype:string;
  requiredParts?:string[];
  requiredStates?:string[];
  requiredAnchors?:string[];
  styleFamily:string;
}
export interface RepresentationCandidate {
  source:RepresentationSource;
  ref:string;
  semanticScore:number;
  archetypeScore:number;
  anchors:string[];
  states:string[];
  confidence:number;
  degradation?:string;
}
export interface RepresentationResolution {
  request:RepresentationRequest;
  candidates:RepresentationCandidate[];
  selected?:RepresentationCandidate;
  warnings:string[];
}
export const COMPOSITION_FAMILIES={
 plant_inputs:['convergence','structural_diagram'],before_after:['transformation','state_machine'],compression:['transformation','comparison'],pipeline:['flow','numbered_steps'],routing:['branch','flow'],matrix:['matrix_operation'],cycle:['cycle'],timeline:['timeline'],trajectory:['trajectory'],comparison:['comparison'],input_output:['convergence','flow'],container_parts:['structural_diagram','cross_section'],cause_feedback:['cause_effect','cycle','branch'],equations_matrices:['equation_walkthrough','matrix_operation'],comparison_selection:['comparison','hierarchy']
} as const;
export type CompositionFamily=keyof typeof COMPOSITION_FAMILIES;

export interface SynthesizedIllustrationSpec {
 semanticSubject:string;
 parts:{key:string;primitive:'path'|'ellipse'|'rect'|'polygon'|'line';semanticRole:string}[];
 requestedAnchors:string[];
 styleFamily:string;
}
