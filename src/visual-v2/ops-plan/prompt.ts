import { KIT_CATALOGUE } from '../kits/catalogue.js';
import { KIT_NAMES, REGION_IDS } from '../board-ops/types.js';
import { z } from 'zod';
import { KIT_REGISTRY } from '../kits/registry.js';
import type { BoardContext } from './validate.js';

interface ParamNode { type?: string; enum?: unknown[]; minimum?: number; maximum?: number; minItems?: number; maxItems?: number; maxLength?: number; items?: ParamNode; prefixItems?: ParamNode[]; properties?: Record<string, ParamNode>; required?: string[] }
const describeNode = (node: ParamNode): string => {
  if (node.enum) return `one of ${node.enum.join('|')}`;
  if (node.type === 'array') return node.prefixItems ? `[${node.prefixItems.map(describeNode).join(', ')}]` : `${node.minItems ?? 0}-${node.maxItems ?? 'n'} ${describeNode(node.items ?? {})}`;
  if (node.type === 'integer' || node.type === 'number') return `${node.type}${node.minimum !== undefined || node.maximum !== undefined ? ` ${node.minimum ?? ''}..${node.maximum ?? ''}` : ''}`;
  return node.type ?? 'any';
};
/** The exact fields a kit accepts, read from its own schema so the prompt can never drift from validation. */
export function describeKitParams(name: (typeof KIT_NAMES)[number]): string {
  const schema = z.toJSONSchema(KIT_REGISTRY[name].paramsSchema) as ParamNode;
  const fields = Object.entries(schema.properties ?? {}).map(([key, node]) => `${key}${schema.required?.includes(key) ? '' : '?'}: ${describeNode(node)}`);
  return fields.length ? `{${fields.join('; ')}}` : '{}';
}

/** The Visual Teaching Model's instructions. Topic-free: lesson content comes only from the scene data in the user message. */
export function buildBoardPrompt(ctx: BoardContext): { system: string; user: string } {
  const kits = KIT_NAMES.map((name) => `- ${name}: ${KIT_CATALOGUE[name].purpose} Children: ${KIT_CATALOGUE[name].slots}. paramsJson fields: ${describeKitParams(name)}. Example paramsJson: ${KIT_CATALOGUE[name].exampleParamsJson}`).join('\n');
  const system = `You design what appears and changes on a whiteboard while a teacher speaks, one scene at a time. You write board OPERATIONS in semantic terms. You never write coordinates, sizes, colours, paths or times: layout and timing are done by code.
Think like a whiteboard teacher: the board is built up as the explanation unfolds, never shown complete at the start; each thought changes the board once; a mechanism is shown as state changes over time (an item moves, a count changes, something is struck out, an equation takes one step), not as boxes with relation words between them. Objects appear where they will stay; do not rearrange. Show relationships by arrangement, arrows and containment instead of printed relation words.
Every op is a JSON object whose "op" field names the operation, for example {"op":"add","opId":"b1.t1","beatId":"<beat id>","cue":0,"id":"cell1","element":{"type":"token","text":"water","provenance":"illustrative"},"at":{"region":"center"}} (the key is "op", never "type"; "type" belongs only inside an element).
Operations (every op has opId, beatId and an optional cue = the 0-based sentence of that beat's speech the change belongs to; ops are listed beat by beat in order; give each change the cue of the sentence that introduces it, usually one change per sentence, so the board grows with the speech):
- add {id, element, at}: draw something new. at = {region, container?, zone?, slot?}.
- connect {id, from, to, relation, label?, weight?}: an arrow between two elements (weight 0..1 thickens it).
- move {target, to}: carry an element to a new place (a different zone, slot or region).
- transform {target, changes:[{key,value}]}: restyle an element. Only key scale (number 0.5-1.6) or color (blue, yellow, green, orange, purple, red, grey); never content.
- replace {target, id, element}: swap an element for another in the same place.
- remove {target}: take an element away (a removed id can never be used again, give every new element a new id).
- highlight / deemphasize / strike {target}: draw attention, fade, or cross out.
- updateValue {target, value}: change the number or text of a value element.
- split {target, into:[{id,element,at}]} / merge {targets, into:{id,element,at}}: one thing becomes several, or several become one.
- equationStep {target, latex, rule, evidence?}: the next line of a derivation; the whole derivation stays visible (evidence is required when the equation's provenance is source).
- revealRegion / clearRegion {region}: show or empty an area.
Elements: entity {conceptId, label, provenance} (a thing from the lesson's concepts; label at most 4 words), kit {kit, label?, paramsJson, provenance} (a mechanism picture, below), token {text, provenance} (a small item: at most 24 characters), text {text, role, provenance}, equation {latex, provenance, evidence?}, value {label, value, unit?, provenance}.
Every element may include bindings:{conceptIds:[...],claimIds:[...]}; add it to all visuals, including kits, tokens, values and equations. Bindings are exact IDs from the BEAT/claim context, never guessed from labels. Entity conceptId also explicitly binds that concept. A factual connect op must include bindings with the conceptIds and claimIds that support its relationship. Do not add unsupported bindings.
provenance: source = stated by the source (an equation or derivation line with provenance source MUST carry evidence {spanId, quote} copied verbatim from the SOURCE EVIDENCE list in the user message; if none fits, use derived or illustrative); derived = follows from the source; illustrative = an example value you choose to make an idea concrete (it must be correct); metaphorical = an analogy picture.
Regions: ${REGION_IDS.join(', ')} (semantic areas; read left to right, top to bottom). Put a mechanism kit in a region, put its children inside it with at.container = the kit's id, plus zone or slot as the kit requires.
Kits:
${kits}
Scene start: transition.mode = clean (empty board), retain-all (keep everything already drawn, for a scene that continues the same picture), or retain-regions (keep only the listed regions; give regions). Prefer retain-all when the scene builds on the same mechanism.
Rules: use at most 3 regions in a scene and put the main mechanism kit in the 'center' region (or 'full' when it is the only thing), because every extra region shrinks every kit and its labels; a kit goes in a region, never inside another kit (a kit's slots only hold tokens, entities, values and short text); a scene draws at most 10 elements in total and a kit holds at most 6 children (at most 4 in any one zone), so reuse, move and restyle what is already on the board (the board is a few big clear things, not a crowd); cover every beat that shows a change; every concept a beat names must be on the board by the end of that beat; labels are short memory anchors, the speech does the explaining; use the beat's representationFamily, stateBefore/stateAfter and visualInvariant to choose what to draw; paramsJson must be valid JSON for the kit.
Leave out the optional expects field of every op; the board is checked by code. Return ONE JSON object { "transition": {...}, "ops": [...] }.`;
  const beatBlocks = ctx.beats.map((beat) => {
    const speech = ctx.narration.find((n) => n.beatId === beat.beatId)?.sentences ?? [];
  return `BEAT ${beat.beatId} [${beat.beatType}; ${beat.cognitiveOperation}; family ${beat.representationFamily}]${beat.narrationOnly ? ' (narration only: no board change needed)' : ''}
  claims to support: ${JSON.stringify(beat.claimIds)}
  learner should see: ${beat.mutedMeaning || '(nothing)'}
  visible when it ends: ${beat.visualInvariant}
  concepts: ${JSON.stringify(beat.entities)}
  relations: ${JSON.stringify(beat.relationships)}
  before: ${beat.stateBefore ? JSON.stringify(beat.stateBefore) : '(none)'}  after: ${beat.stateAfter ? JSON.stringify(beat.stateAfter) : '(none)'}
  speech:
${speech.map((sentence, i) => `    ${i}: ${sentence}`).join('\n')}`;
  }).join('\n');
  const inherited = Object.values(ctx.initial.elements).filter((el) => el.lifecycle.removedAtBeat === undefined);
  const inheritedEdges = Object.values(ctx.initial.edges).filter((edge) => edge.lifecycle.removedAtBeat === undefined);
  const cites = ctx.concepts.flatMap((c) => (c.evidence ?? []).map((e) => `  [${e.spanId}] ${e.quote}`));
  const usedIds = [...Object.keys(ctx.initial.elements), ...Object.keys(ctx.initial.edges)];
  const user = `SCENE ${ctx.sceneId}: "${ctx.title}"
Concepts of this scene: ${JSON.stringify(ctx.concepts.map(({ id, label }) => ({ id, label })))}
SOURCE EVIDENCE you may cite (spanId in brackets, quote verbatim):
${cites.length ? cites.join('\n') : '  (none: do not use provenance source for equations)'}
Ids already used in the lesson (never reuse one, including removed elements; give every new element and arrow a fresh id): ${usedIds.length ? usedIds.join(', ') : '(none)'}
Board inherited from the previous scene (full live element state, values, bindings, placements, kit params and lifecycle): ${inherited.length ? JSON.stringify(inherited) : '(no live elements)'}
Live factual edges inherited from the previous scene: ${inheritedEdges.length ? JSON.stringify(inheritedEdges) : '(no live edges)'}
Current container slot order: ${JSON.stringify(ctx.initial.containers)}
Current regions and visibility: ${JSON.stringify(ctx.initial.regions)}
Previously used IDs, including edges: ${usedIds.length ? usedIds.join(', ') : '(none)'}
Retained geometry to respect: ${ctx.prior ? JSON.stringify(ctx.prior) : '(no retained geometry)'}
${beatBlocks}`;
  return { system, user };
}
