import { BEAT_TYPES, COGNITIVE_OPERATIONS, PAUSE_INTENTS, REPRESENTATION_FAMILIES } from './types.js';
import { beatCountRange, type BeatContext } from './validate.js';

export interface BeatPromptScene { title: string; goal: string; learningDelta: string; mentalModel?: string; misconceptionRisk: string[]; priorKnowledge: string[] }

/** Topic-free: everything lesson-specific comes from the scene contract and concept graph passed in. */
export function buildBeatPrompt(ctx: BeatContext, scene: BeatPromptScene, concepts: ReadonlyArray<{ id: string; label: string; kind: string; definition: string }>): { system: string; user: string } {
  const range = beatCountRange(ctx.durationSec);
  const system = `You plan the teaching beats of ONE scene of a whiteboard teaching video. A beat is one change in the learner's understanding, about one spoken thought. You decide what changes in the learner's mind and what must become visible. You never write the narration, coordinates, drawings, asset names or timings.
Return ONE JSON object { "beats": [...] }. Each beat has: claimIds (the scene claim ids it teaches), learnerDelta (what the learner can do or see after it that they could not before), beatType (${BEAT_TYPES.join('|')}), cognitiveOperation (${COGNITIVE_OPERATIONS.join('|')}), representationFamily (${REPRESENTATION_FAMILIES.join('|')}: the kind of picture that carries the idea; choose the family that shows the mechanism, a state change over time is state_transition, a quantity that changes is quantity, never pick literal_object for a process), entities (scene concept ids with an optional role, count and state), relationships (only relations listed in the scene data), stateBefore and stateAfter when the beat changes something, misconceptionIds (m-ids this beat prevents), narrationGoal (what the speaker must make clear), visualInvariant (what is visible when the beat ends), mutedMeaning (what a viewer with the sound off concludes from the board; leave empty only when narrationOnly is true), narrationOnly, persistence (beat|scene|lesson: how long the drawn objects stay), pauseIntent (${PAUSE_INTENTS.join('|')}).
Rules: every scene claim is covered by at least one beat; each beat covers 1-3 claims; beats build on each other (the board grows or changes beat by beat, it is never complete at the first beat); use only the concept ids, relation triples and misconception ids given. A beat that repairs a misconception carries errorContrast: the shared reasoning both paths start from, the decision where they fork, the wrong step versus the correct step, why the wrong step tempts, the invariant it violates, and the repair — never a bare wrong/correct label pair.`;
  const user = `SCENE ${ctx.sceneId}: "${scene.title}" (${ctx.durationSec} s)
Goal: ${scene.goal}
Learner delta: ${scene.learningDelta}
${scene.mentalModel ? `Mental model: ${scene.mentalModel}\n` : ''}${scene.priorKnowledge.length ? `The learner already knows: ${scene.priorKnowledge.join(', ')}\n` : ''}Misconceptions to prevent: ${scene.misconceptionRisk.length ? scene.misconceptionRisk.map((text, i) => `m${i + 1}: ${text}`).join(' | ') : '(none)'}
Concepts: ${JSON.stringify(concepts.filter((c) => ctx.conceptIds.includes(c.id)).map(({ id, label, kind, definition }) => ({ id, label, kind, definition })))}
Graph relations you may use: ${JSON.stringify(ctx.relations)}
Scene claims (cover every one): ${JSON.stringify(ctx.claims.map(({ id, statement, conceptIds, relations }) => ({ id, statement, conceptIds, relations })))}
Plan ${range.min}-${range.max} beats.`;
  return { system, user };
}
