import {NODE_KINDS,LAYOUTS} from './vocabulary.js';
const str=(maxLength:number)=>({type:'string',minLength:1,maxLength});
const obj=(properties:Record<string,unknown>,required=Object.keys(properties))=>({type:'object',additionalProperties:false,properties,required});
const array=(items:unknown,minItems:number,maxItems:number)=>({type:'array',items,minItems,maxItems});
export const outlineSchema=(count:number)=>obj({title:str(90),chapters:array(obj({title:str(70),objective:str(300),arc:{type:'string',enum:['hook','build','example','payoff','recap']},keyPoints:array(str(60),1,5),teacherTone:{type:'string',maxLength:200}},['title','objective','arc','keyPoints']),count,count)});
// Stage 1 — Teaching Planner: content only. No layout/kind/emphasis — those are the Visual
// Director's job (stage 2), kept in a separate schema/call so content quality and visual
// quality can be validated, repaired and reasoned about independently.
// Each node carries keyPoint (the exact chapter key point it visualizes) and visualIntent
// (what the diagram should visually show for it — an arrow, a growth, a comparison). Both
// are the shared semantic-event link between teaching intent and the Visual Director's
// choices (V2 §8 storyboard): the director receives visualIntent as ground truth instead of
// re-guessing kind/shape/emphasis from the label text alone. Validated deterministically.
export const contentSchema=obj({version:{type:'integer',const:1},title:str(90),scenes:array(obj({id:str(40),title:str(70),narration:str(1800),beats:array(obj({id:str(40),narration:str(600)}),2,4),nodes:array(obj({id:str(40),label:str(120),anchor:str(100),keyPoint:str(60),visualIntent:str(80),beatId:str(40),conceptId:str(40)},['id','label','anchor','keyPoint','visualIntent']),2,6),edges:array(obj({from:str(40),to:str(40),label:{type:'string',maxLength:24}}),0,10),note:{type:'string',maxLength:170}},['id','title','narration','nodes','edges','note']),2,2)});
// Stage 2 — Visual Director: given validated content, choose composition topology per scene
// and a visual metaphor/emphasis per node. Never touches narration, wording or geometry.
// attachTo/position ride on every node (strict schemas require all fields) but are only
// meaningful with shape 'annotation': relative placement the compiler resolves (V2 §24) —
// never absolute coordinates. Sentinels for non-annotations: attachTo '' + position 'none'.
// A5: parameterized by scene count, matching outlineSchema's existing convention — the old
// fixed array(...,2,2) silently mismatched the critic-repair call, which sends exactly ONE
// scene per repair (see planner.ts's repairFromCritique); a strict-mode schema mismatch there
// meant repair calls never actually validated, so critic repairs have likely never applied.
export const directorSchema=(count:number)=>obj({scenes:array(obj({id:str(40),layout:{type:'string',enum:[...LAYOUTS]},nodes:array(obj({id:str(40),kind:{type:'string',enum:[...NODE_KINDS]},emphasis:{type:'boolean'},shape:{type:'string',enum:['box','illustration','icon','circle','square','bullet','number','annotation']},attachTo:{type:'string',maxLength:40},position:{type:'string',enum:['below','above','left','right','none']}}),2,6)}),count,count)});
