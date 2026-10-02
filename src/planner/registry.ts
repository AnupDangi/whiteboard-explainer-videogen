import { BOARD_PROMPT_VERSION, BOARD_SCHEMA_VERSION, BOARD_STAGE_VERSION, buildBoardPrompt, planBoardScene, skipBoardAfterAlignmentFailure } from './board.js';
import { SCENE_PROMPT_VERSION } from './context.js';
import { planScene, skipPlanAfterAlignmentFailure, type PlanSceneOptions, type PlanSceneResult } from './plan.js';
import { buildScenePlannerPrompt, type PlannerSceneInput } from './prompt.js';

/**
 * An S6 scene planner: turns one scene's narration, mentions and teaching
 * context into a validated SceneSpec. The model only ever returns data that
 * the planner's own schema and validators accept.
 *
 * Adding a planner: implement this interface and `registerScenePlanner` it;
 * `--scene-planner=<id>` then selects it and its versions enter the S6 cache key.
 */
export interface ScenePlanner {
  id: string;
  schemaVersion: string;
  stageVersion: string;
  promptVersion: string;
  /** The prompt does not read the previous scene's board, so all scenes may be planned concurrently. */
  independentScenes: boolean;
  buildPrompt(input: PlannerSceneInput): { system: string; user: string };
  plan(input: PlannerSceneInput, options: PlanSceneOptions): Promise<PlanSceneResult>;
  /** A failed diagnostic result, without a paid call, after a hard S5 alignment failure. */
  skipAfterAlignmentFailure(input: PlannerSceneInput, failureCount: number): PlanSceneResult;
}

const boardPlanner: ScenePlanner = {
  id: 'board-v2',
  schemaVersion: BOARD_SCHEMA_VERSION,
  stageVersion: BOARD_STAGE_VERSION,
  promptVersion: BOARD_PROMPT_VERSION,
  independentScenes: true,
  buildPrompt: buildBoardPrompt,
  plan: planBoardScene,
  skipAfterAlignmentFailure: skipBoardAfterAlignmentFailure,
};

/** The earlier free-form primitive planner, kept for rollback and prompt calibration. */
const sceneSpecPlanner: ScenePlanner = {
  id: 'scene-spec-v1',
  schemaVersion: 'claude-scene-spec/v1',
  stageVersion: '4',
  promptVersion: SCENE_PROMPT_VERSION,
  independentScenes: false,
  buildPrompt: buildScenePlannerPrompt,
  plan: planScene,
  skipAfterAlignmentFailure: skipPlanAfterAlignmentFailure,
};

export const DEFAULT_SCENE_PLANNER = boardPlanner.id;

const planners = new Map<string, ScenePlanner>([boardPlanner, sceneSpecPlanner].map((planner) => [planner.id, planner]));

export function registerScenePlanner(planner: ScenePlanner): void {
  planners.set(planner.id, planner);
}

export function scenePlannerIds(): string[] {
  return [...planners.keys()];
}

export function scenePlanner(id: string = DEFAULT_SCENE_PLANNER): ScenePlanner {
  const planner = planners.get(id);
  if (!planner) throw new Error(`unknown scene planner "${id}"; available: ${scenePlannerIds().join(', ')}`);
  return planner;
}
