import type {Plan,Scene} from '../shared/types.js';
import type {NodeKind} from '../shared/vocabulary.js';
import {hasIcon} from './icons.js';

/** Deterministic layout compiler (plan Next item 1): composes scenes WITHOUT the Visual
 *  Director LLM call (~19s/chapter, now the slowest pipeline stage). The Teaching Planner
 *  already emits visualIntent per node — for the common compositions (compare, timeline,
 *  hierarchy, branch, convergence, plain flow) deterministic code can decide layout,
 *  kind and emphasis from the same signals the director prompt teaches. Scenes the
 *  keyword table cannot confidently dress still go to the director. All downstream
 *  validators (kind collision, preflight, overlap) run unchanged on the result. */

/** High-precision label→kind hints. Conservative: only mappings that are near-certain.
 *  A node that maps to nothing stays generic — and a scene with too many generics is
 *  NOT auto-directed (the director's contextual choice beats keyword boxes). */
const KIND_HINTS:Array<[RegExp,NodeKind]>=[
  [/\b(user|customer|person|people|viewer|student|teacher)\b/i,'user'],
  [/\b(database|datastore|storage|store)\b/i,'database'],
  [/\b(token)s?\b/i,'token'],
  [/\b(model|neural network|transformer|llm|moe)\b/i,'model'],
  [/\b(server|backend|host|gpus?|hardware)\b/i,'server'],
  [/\b(api|interface|endpoint)\b/i,'api'],
  [/\b(cloud)\b/i,'cloud'],
  [/\b(cache|memory|buffer|kv cache)\b/i,'memory'],
  [/\b(search|retriev)/i,'search'],
  [/\b(vector|embedding)\b/i,'vector'],
  [/\b(cost|price|\$|budget|flops)\b/i,'graph'],
  // Quantity labels: the noun may be separated ("671B total params", "37B active params").
  [/\d[\d,.]*\s*[bmtk]?[\w\s-]*\b(parameters?|params?|tokens?|activations?|gpus?|flops?|examples?|instances?|items?|rows?|cases?)\b/i,'graph'],
  [/\b(fp\d+|bf16|precision|quantiz\w*)\b/i,'process'],
  [/\b(key|credential)\b/i,'key'],
  [/\b(document|file|paper)\b/i,'document'],
  [/\b(lock|security|encrypt)/i,'lock'],
  [/\b(warning|risk|failure|danger)\b/i,'warning'],
  [/\b(success|win|best|outperform|efficien)/i,'success'],
  [/\b(example|instance)\b/i,'example'],
  [/\b(result|outcome|conclusion)\b/i,'result'],
  [/\b(input)\b/i,'input'],
  [/\b(output)\b/i,'output'],
  [/\b(process|step|stage|phase|pipeline)\b/i,'process'],
  [/\b(loop|cycle|iteration)\b/i,'loop'],
  [/\b(question|query|ask)/i,'request'],
  [/\b(agent)\b/i,'agent'],
  [/\b(idea|insight|concept|approach|method|technique|architecture|design)\b/i,'idea'],
  [/\b(container|payload|value)\b/i,'container'],
  [/\b(request|call)\b/i,'request'],
  [/\b(response|return)\b/i,'response'],
  // Routing / MoE / training vocabulary (live-run labels the table missed).
  [/\b(routing|router|dispatch|sparse|mixture|expert)s?\b/i,'process'],
  [/\b(training|train|pretrain|fine-?tun|distill)\w*\b/i,'process'],
  [/\b(efficien\w*|performance|throughput|speed|faster|optimiz\w*)\b/i,'success'],
  [/\b(attention|transformer|layer|network)\b/i,'model'],
  [/\b(scale|scaling|size|growth)\b/i,'graph'],
  [/\b(ratio|percent|proportion|fraction)\b/i,'probability'],
  // Directive/annotation labels the content model emits for framing notes.
  [/^(show|shows|visualize|visualise|visualizes|contrast|compare|highlight|indicates?|illustrates?)\b/i,'note'],
];

/** Number shape: a quantity the narration names should render as a big badge. */
const QUANTITY_HINT=/\b\d[\d,.]*\s*(b|m|billion|million|trillion|%|percent|x|days?|hours?|tokens?)?\b/i;

function inferKind(label:string):NodeKind|undefined {
  for(const [pattern,kind] of KIND_HINTS)if(pattern.test(label))return kind;
  return undefined;
}

function inferLayout(scene:Scene):Scene['layout'] {
  const intents=scene.nodes.map(n=>`${n.visualIntent||''} ${n.label}`).join(' ').toLowerCase();
  if(/\b(compare|contrast|side by side|versus|vs\.?|before\/after)\b/.test(intents))return 'compare';
  if(/\b(timeline|sequence|step|order|stages?)\b/.test(intents))return 'timeline';
  if(/\b(hierarch|tree|parent|root)\b/.test(intents))return 'hierarchy';
  if(/\b(branch|options?|choices?|alternative)\b/.test(intents))return 'branch';
  if(/\b(converge|merge|combine|into one|results? in)\b/.test(intents))return 'convergence';
  if(/\b(radial|central|hub|spokes?)\b/.test(intents))return 'radial';
  return 'flow';
}

function inferShape(kind:NodeKind|undefined,label:string):Scene['nodes'][number]['shape'] {
  if(QUANTITY_HINT.test(label)&&kind!=='container')return 'number';
  if(kind&&hasIcon(kind))return 'icon';
  return 'box';
}

/** A scene is auto-directable when most MODEL-authored nodes map to a concrete kind.
 *  Structural nodes synthesized by the engine (beat fills, the takeaway board) carry
 *  `auto:true` and are excluded. A small allowance for unclassifiable labels keeps the
 *  common chapter on the deterministic path (no ~20s director call) while genuinely
 *  ambiguous scenes still get the director. */
function sceneAutoDirectable(scene:Scene):boolean {
  if(scene.nodes.length<2||scene.nodes.length>6)return false;
  const authored=scene.nodes.filter(n=>!n.auto);
  if(!authored.length)return false;
  const generic=authored.filter(n=>!inferKind(n.label)).length;
  const allowance=authored.length>=4?2:1;
  return generic<=allowance;
}

/** Compose a chapter without the director call. Chapter-level: BOTH scenes must be
 *  auto-directable (the director schema is chapter-scoped, so partial composition
 *  would need a second call anyway — just use the call). */
export function canAutoDirect(plan:Plan):boolean {
  return plan.scenes.every(sceneAutoDirectable);
}

/** Labels the keyword table could not classify (diagnostics for the auto-direct skip). */
export function unmappedLabels(plan:Plan):string[] {
  const out:string[]=[];
  for(const scene of plan.scenes)for(const n of scene.nodes)if(!n.auto&&!inferKind(n.label))out.push(n.label);
  return out;
}

export function autoDirect(plan:Plan,keyPoints:string[]=[]):Plan {
  return {...plan,scenes:plan.scenes.map(scene=>{
    const layout=inferLayout(scene);
    const nodes=scene.nodes.map(node=>{
      const kind=inferKind(node.label);
      const shape=inferShape(kind,node.label);
      const emphasis=keyPoints.length>0&&node.keyPoint===keyPoints[0];
      return {...node,kind,shape,emphasis:emphasis||undefined};
    });
    return {...scene,layout,nodes};
  })};
}
