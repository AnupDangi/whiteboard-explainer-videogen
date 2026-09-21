import type {Plan,Scene} from '../types/engine.js';
import type {NodeKind} from '../domain/registry.js';
import {QUANTITY_HINT,DEFAULT_NODE_SHAPE,resolveLayout} from '../domain/registry.js';
import {hasIcon} from '../domain/icons.js';
import {resolveKind} from '../visual/kind-resolver.js';

/** Deterministic layout compiler (plan Next item 1): composes scenes WITHOUT the Visual
 *  Director LLM call (~19s/chapter, now the slowest pipeline stage). The Teaching Planner
 *  already emits visualIntent per node — for the common compositions (compare, timeline,
 *  hierarchy, branch, convergence, plain flow) deterministic code can decide layout,
 *  kind and emphasis from the same signals the director prompt teaches. Scenes the
 *  keyword table cannot confidently dress still go to the director. All downstream
 *  validators (kind collision, preflight, overlap) run unchanged on the result. */

/** Number shape: a quantity the narration names should render as a big badge. */
function inferKind(label:string):NodeKind|undefined {
  // The vocabulary resolver is the sole semantic representation selector. It is
  // deliberately conservative: unresolved labels remain generic and are allowed to
  // fall through to the contextual director instead of receiving a misleading icon.
  return resolveKind(label);
}

function inferLayout(scene:Scene):Scene['layout'] {
  const intents=scene.nodes.map(n=>`${n.visualIntent||''} ${n.label}`).join(' ').toLowerCase();
  return resolveLayout(intents);
}

function inferShape(kind:NodeKind|undefined,label:string):Scene['nodes'][number]['shape'] {
  if(QUANTITY_HINT.test(label)&&kind!=='container')return 'number';
  if(kind&&hasIcon(kind))return 'icon';
  return DEFAULT_NODE_SHAPE;
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
