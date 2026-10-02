import { sha256 } from '../shared/artifacts.js';

/** One visual-planning instruction block. Layout, representation and safety remain code-owned. */
export const SCENE_DIRECTOR_SKILL_VERSION = 'scene-director/v1';
export const SCENE_DIRECTOR_SKILL = `Explain one learning change per scene. Compose visible relationships that teach the source mechanism. Reuse terminology and representations for persistent concepts across scenes. Prefer a clear labelled shape to an unrelated icon. Treat example SceneSpecs as composition demonstrations only; copy no example facts, labels, numbers, or relationships. Use source citations for every factual visual value and mark an invented demonstration as illustrative-example. Never output coordinates, SVG, executable code, or unsupported claims.`;
export const SCENE_DIRECTOR_SKILL_HASH = sha256(SCENE_DIRECTOR_SKILL);
