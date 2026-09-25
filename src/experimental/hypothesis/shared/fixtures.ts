import type {GoldenCase} from './contracts.js';
import type {EvidenceRef,TeachingBeat,TextProvenance} from '../../../types/contracts.js';

const provenance:TextProvenance={origin:'lesson-plan',generatedBy:'golden-fixture-v1'};
const evidence=(caseId:string,index:number):EvidenceRef[]=>[{sourceId:`golden:${caseId}`,blockId:`beat-${index}`,origin:'source'}];
const beat=(caseId:string,index:number,text:string,label:string,visualIntent:string,operation:'introduce'|'connect'|'update'|'emphasize'='introduce'):TeachingBeat=>({
  id:`${caseId}_beat_${index}`,sceneId:`${caseId}_scene`,claimIds:[`${caseId}_claim_${index}`],evidence:evidence(caseId,index),role:index===0?'define':'explain',spokenText:{text,provenance:{...provenance,evidence:evidence(caseId,index)}},displayText:{text:label,provenance:{origin:'representation',generatedBy:'golden-fixture-v1'}},visualIntent,visualMutation:{operation,subjectId:`${caseId}_concept_${index}`},targetDurationMs:10_000,
});

export const GOLDEN_CASES:GoldenCase[]=[
  {schemaVersion:'golden-case/v1',id:'transformer-attention',title:'Transformer Attention',targetDurationMs:30_000,teachingBeats:[
    beat('transformer-attention',0,'A query represents what one token is looking for.','Query','Introduce one query token.'),
    beat('transformer-attention',1,'The query compares with every key to produce relevance scores.','Compare keys','Trace one-to-many comparisons and scores.','connect'),
    beat('transformer-attention',2,'Softmax turns scores into weights that blend the value vectors.','Weighted values','Transform scores into weights and aggregate values.','update'),
  ],requiredClaims:['query','relevance scores','weights'],requiredRelations:[{from:'query',to:'keys',type:'compares'},{from:'scores',to:'weights',type:'transforms'},{from:'weights',to:'values',type:'aggregates'}],learnerInference:'Attention compares a query to keys and uses normalized scores to blend values.',misconception:'Attention simply selects one token.'},
  {schemaVersion:'golden-case/v1',id:'gradient-descent',title:'Gradient Descent',targetDurationMs:30_000,teachingBeats:[
    beat('gradient-descent',0,'A loss function assigns a height to every parameter choice.','Loss surface','Show parameters as a point on a loss curve.'),
    beat('gradient-descent',1,'The gradient points uphill, so the negative gradient points downhill.','Negative gradient','Connect slope direction to the update direction.','connect'),
    beat('gradient-descent',2,'Repeated small steps move the parameters toward a local minimum.','Iterative steps','Animate several decreasing updates.','update'),
  ],sourceContext:{equations:['\\theta_{t+1}=\\theta_t-\\eta\\nabla L(\\theta_t)']},requiredClaims:['loss function','negative gradient','local minimum'],requiredRelations:[{from:'gradient',to:'update',type:'opposes'},{from:'update',to:'loss',type:'reduces'}],learnerInference:'Gradient descent repeatedly moves parameters opposite the local slope to reduce loss.',misconception:'The gradient itself points toward the minimum.'},
  {schemaVersion:'golden-case/v1',id:'photosynthesis',title:'Photosynthesis',targetDurationMs:30_000,teachingBeats:[
    beat('photosynthesis',0,'Leaves receive light while roots supply water and air supplies carbon dioxide.','Inputs','Introduce the three material and energy inputs.'),
    beat('photosynthesis',1,'Inside chloroplasts, light energy drives reactions that build sugar.','Chloroplast','Zoom into the leaf and transform inputs.','connect'),
    beat('photosynthesis',2,'The plant stores chemical energy in glucose and releases oxygen.','Outputs','Trace glucose storage and oxygen release.','update'),
  ],requiredClaims:['light energy','glucose','oxygen'],requiredRelations:[{from:'light',to:'chloroplast',type:'feeds'},{from:'chloroplast',to:'glucose',type:'produces'},{from:'chloroplast',to:'oxygen',type:'produces'}],learnerInference:'Photosynthesis converts light energy, water, and carbon dioxide into stored sugar while releasing oxygen.',misconception:'Plants obtain their food directly from soil.'},
  {schemaVersion:'golden-case/v1',id:'electromagnetic-induction',title:'Electromagnetic Induction',targetDurationMs:30_000,teachingBeats:[
    beat('electromagnetic-induction',0,'Magnetic flux measures how much magnetic field passes through a coil.','Magnetic flux','Show field lines crossing a coil.'),
    beat('electromagnetic-induction',1,'Moving the magnet changes that flux through the coil.','Changing flux','Animate motion and changing field-line crossings.','update'),
    beat('electromagnetic-induction',2,'The changing flux induces a current whose field opposes the change.','Induced current','Trace current direction and opposing field.','connect'),
  ],sourceContext:{equations:['\\mathcal{E}=-\\frac{d\\Phi_B}{dt}']},requiredClaims:['magnetic flux','changing flux','induced current'],requiredRelations:[{from:'magnet motion',to:'flux',type:'changes'},{from:'flux change',to:'current',type:'causes'},{from:'induced field',to:'flux change',type:'opposes'}],learnerInference:'A change in magnetic flux induces a current that resists the change.',misconception:'A stationary magnet always produces current in a nearby coil.'},
];

export const SYNTHETIC_SOURCE_CASE:GoldenCase={schemaVersion:'golden-case/v1',id:'synthetic-source-figure',title:'Synthetic Source-Figure Plumbing',targetDurationMs:30_000,teachingBeats:[beat('synthetic-source-figure',0,'A request enters the router, splits across two workers, and rejoins at the verifier.','Novel router','Trace the supplied architecture figure.')],sourceContext:{text:'A synthetic architecture used only to test source-figure plumbing.',figures:[{id:'synthetic-router',caption:'Router, workers, and verifier',mediaType:'image/svg+xml'}]},requiredClaims:['router','workers','verifier'],requiredRelations:[{from:'router',to:'workers',type:'fans-out'},{from:'workers',to:'verifier',type:'converges'}],learnerInference:'The architecture splits work and then verifies the combined result.',misconception:'The workers execute sequentially.',sealed:false};

export const goldenById=(id:string):GoldenCase=>{
  const found=[...GOLDEN_CASES,SYNTHETIC_SOURCE_CASE].find(item=>item.id===id);if(!found)throw new Error(`Unknown golden case ${id}`);return structuredClone(found);
};
