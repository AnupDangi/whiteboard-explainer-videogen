import type {Scene,SceneTemplate} from '../types/engine.js';

const REQUIRED:Record<SceneTemplate,string[][]>= {
  tls_handshake:[['tls','https','handshake','client','server','request','response','certificate','key']],
  supply_demand:[['supply'],['demand'],['price','quantity','equilibrium','market']],
  attention_matrix:[['attention','query','key','score','weight','matrix']],
  dna_fork:[['dna','strand','replication','replicate','unzipp','complement']],
  tectonic_section:[['plate','tectonic','ridge','mantle','convection','subduction']],
  fluid_flow:[['fluid','flow','pressure','velocity','viscosity','navier','stokes']],
  sleep_perception:[['ghost','haunt','paranormal','sleep'],['experience','felt','interpretation','context']],
  trust_path:[['spiritual','leader','leadership','trust'],['reason','question','accountability','compassion']],
  scam_funnel:[['dark-web','dark web','scam','phishing','credential','fraud'],['pressure','verify','safety','protect','urgent']],
};

/** Validate that a deterministic domain grammar is semantically compatible with the
 * scene. A visually polished but unrelated chart is worse than a plain whiteboard. */
export function validateTemplateSemantics(scene:Pick<Scene,'id'|'template'|'title'|'narration'|'nodes'>):void {
  const template=scene.template;if(!template)return;
  const haystack=[scene.title,scene.narration,...scene.nodes.map(node=>node.label),...scene.nodes.map(node=>node.keyPoint||'')].join(' ').toLowerCase();
  const groups=REQUIRED[template];
  if(!groups?.every(group=>group.some(term=>haystack.includes(term))))throw new Error(`Template ${template} is incompatible with scene ${scene.id}; narrated semantics do not match the domain grammar`);
}
