// Draw-geometry shapes ported from the retired ChatGPT hypothesis track
// (chatgpt/types.ts, Stage L/M). Kept local so the draw/ modules stay
// independent of the SceneSpec type system until they are wired into render/.

export interface RoughGeometry {
  seed: number;
  paths: Array<{d: string; strokeWidth: number}>;
}

export interface FreehandStroke {
  kind: 'freehand-stroke';
  gesture: 'underline' | 'circle' | 'checkmark' | 'cross' | 'scribble' | 'freehand-arrow';
  points: Array<[number, number, number?]>; // x, y, optional pressure
}
