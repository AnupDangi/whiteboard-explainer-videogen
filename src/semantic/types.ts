import type {RepresentationSpec,RepresentationProvenance} from './representation.js';
import type {AssetDefinition} from './assets/types.js';
/** V2 semantic contracts. Models never own pixel geometry. */
export const ARCHETYPES = ['simple_explanation','numbered_steps','flow','cause_effect','branch','convergence','comparison','hierarchy','timeline','cycle','structural_diagram','cross_section','spatial_process','transformation','state_machine','equation_walkthrough','matrix_operation','chart','trajectory'] as const;
export type VisualArchetype = typeof ARCHETYPES[number];
/** Advertised motions must equal implemented motions. `move`, `split` and
 *  `merge` were advertised in the prompt and accepted by the schema, but the
 *  renderer's state machine has no branch for them, so an emitted one simply
 *  timed its beat and animated nothing. They are removed until implemented. */
export const MOTIONS = ['draw','reveal','trace','flow','fill','highlight','pulse','morph','replace','fade'] as const;
export type MotionKind = typeof MOTIONS[number];
export const ROLES = ['hero','support','structure','material','data','equation','annotation','label','decorative_support'] as const;
export const ZONES = ['center','upper_left','upper_right','lower_left','lower_right','left','right','bottom','top'] as const;
export type LayoutZone = typeof ZONES[number];
export const RELATIONS = ['causes','flows_to','contains','part_of','transforms_to','depends_on','labels','compares_with','activates','inhibits','moves_toward'] as const;

/** Relation types that annotate or compare rather than carry a structural edge.
 *  Graph layouts - flow ranks, cycle rings - must ignore them: a `labels` arc
 *  leaving a node is not a second outgoing path. The director's cycle synthesis
 *  already excluded them, but the compiler's ring walk counted them, so a
 *  labelled cycle node looked like it had two outgoing arcs and the whole scene
 *  failed to compile with "Cycle requires one outgoing relation per primary
 *  representation". Flow had the exclusion; cycle did not. */
export const NON_STRUCTURAL_RELATIONS:readonly string[]=['labels','compares_with'];
export type CollisionPolicy = 'forbid'|'allow'|'contain'|'overlay'|'touch';
export type AssetRef = string;
export type ObjectState = 'neutral'|'highlighted'|'activated'|'before'|'after'|'hidden';
export type EasingKind = 'linear'|'ease_in_out';
export interface EvidenceRef {id:string;sourceId:string;quote:string}
export interface ClaimRequirement {id:string;statement:string;critical:boolean;evidenceRefs:string[]}
export interface MechanismRequirement extends ClaimRequirement {conceptIds:string[];requiresStateChange:boolean}
export interface ConceptIdentity {id:string;canonicalName:string;aliases:string[];semanticType:'entity'|'material'|'process'|'state'|'quantity'|'equation'|'location'|'role';visualFamily?:string;/** A single concrete noun an icon library would actually have, chosen by the model from the lesson context. Icon search uses this, never the concept name: `Legislative Bill` never matches an icon, `document` does. */visualQuery?:string;preferredColorRole?:string;evidenceRefs:string[]}
export interface StateChangeRequirement {conceptId:string;fromState:string;toState:string}
export interface SemanticBeat {id:string;purpose:string;narrationDraft:string;requirementIds:string[];introduce:string[];reinforce:string[];transform:StateChangeRequirement[];relationFocus:string[];evidenceRefs:string[];intentionalPause?:string}
export interface SemanticRelationRequirement {id:string;fromConceptId:string;toConceptId:string;relationType:typeof RELATIONS[number];targetAnchor?:string}
export interface SemanticScenePlan {id:string;centralConceptId:string;teachingGoal:string;learnerShouldUnderstand:string;mentalModel:string;beats:SemanticBeat[];requiredConceptIds:string[];requiredRelations:SemanticRelationRequirement[];candidateArchetypes:VisualArchetype[];continuity:{keepFromPrevious:string[];prepareForNext:string[]}}
export interface TeachingPlanV2 {version:2;lessonGoal:string;learnerAssumption:string;centralQuestion:string;requiredClaims:ClaimRequirement[];requiredMechanisms:MechanismRequirement[];conceptRegistry:ConceptIdentity[];scenes:SemanticScenePlan[];misconceptions:{claim:string;correction:string}[];evidenceRefs:EvidenceRef[]}
export interface ObjectAnchorRef {objectId:string;anchor:string}
export interface VisualObject {representation?:RepresentationSpec;representationProvenance?:RepresentationProvenance;id:string;conceptId?:string;label:string;role:typeof ROLES[number];assetRef?:AssetRef;primitiveRef?:'label'|'rectangle'|'circle'|'equation';parentId?:string;children:string[];state:ObjectState;allowedStates:ObjectState[];importance:'primary'|'secondary'|'tertiary';preferredZone?:LayoutZone;collisionPolicy:CollisionPolicy}
export interface VisualRelation {layoutFeedback?:boolean;id:string;from:ObjectAnchorRef;to:ObjectAnchorRef;relationType:typeof RELATIONS[number];visualForm:'arrow'|'flow'|'leader'|'brace'|'containment'|'none';label?:string}
export interface SpokenAnchor {text:string;occurrence:number}
export interface VisualAction {id:string;type:MotionKind;objectIds:string[];relationIds:string[];anchor?:SpokenAnchor;durationMs:number;leadMs:number;easing:EasingKind;fromState?:ObjectState;toState?:ObjectState}
export interface VisualBeat {id:string;narration:string;actions:VisualAction[];intentionalPause?:string}
/** How each continuity action is realised at runtime — no action may be
 *  computed, validated and then ignored:
 *   KEEP        persistent object, visible from t=0 (continuity.keepFromPrevious)
 *   REMOVE      the concept is absent from this scene, so nothing is drawn
 *   REINTRODUCE the concept returns as a new object with a reveal/draw action
 *   TRANSFORM   a state-changing action (morph/replace) reaches toState
 *   REPLACE     the object is drawn as toRepresentation
 *   MOVE        the object is kept and placed at its newly computed position
 *  MOVE expresses the planner's position intent, not an animated tween: the
 *  renderer has no positional interpolation, and none is promised. */
export type ContinuityAction = 'KEEP'|'MOVE'|'TRANSFORM'|'REPLACE'|'REMOVE'|'REINTRODUCE';
export interface ContinuityDecision {conceptId:string;action:ContinuityAction;fromRepresentation?:string;toRepresentation?:string;fromState?:ObjectState;toState?:ObjectState}
export interface SceneContinuity {keepFromPrevious:string[];prepareForNext:string[];transitions?:ContinuityDecision[]}
export interface VisualSceneV2 {version:2;id:string;title:string;teachingGoal:string;mentalModel:string;archetype:VisualArchetype;objects:VisualObject[];relations:VisualRelation[];beats:VisualBeat[];continuity:SceneContinuity}
export interface Point {x:number;y:number}
export interface Rect extends Point {w:number;h:number}
export interface CompiledVisualAction extends VisualAction {beatId:string;startMs:number;anchorMs:number;signedLagMs:number}
export interface CompiledObject extends VisualObject,Rect {anchors:Record<string,Point>;fontSize:number;lines:string[];zIndex:number}
export interface CompiledRelation extends VisualRelation {points:Point[]}
export interface WordTiming {word:string;startMs:number;endMs:number}
export type TimingSource = 'provider'|'aligner'|'semantic-segment'|'estimated';
export interface VisualTiming {kind:string;words:WordTiming[];durationMs:number;timingSource?:TimingSource}
/** `assetCatalog` carries any representation the static registry does not hold
 *  (a converted or synthesized asset), so the browser, the exporter and a replay
 *  all render from the same embedded data with no registry entry and no network.
 *  It lives on the compiled scene only: `visualSceneSchema` is closed to unknown
 *  fields and the model must never emit an asset. */
export interface CompiledSceneV2 {version:2;scene:VisualSceneV2;objects:CompiledObject[];relations:CompiledRelation[];actions:CompiledVisualAction[];timing:VisualTiming;durationMs:number;diagnostics:string[];assetCatalog?:Record<string,AssetDefinition>}
