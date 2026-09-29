import type { ExampleOrder } from '../planner/context.js';
import type { PromptArm } from '../planner/exemplars.js';
import { LessonBibleSchema, SceneContractSchema } from '../plan/schemas.js';

interface PromptExperimentRunShape {
  runClass?: string;
  sourceDoc?: unknown;
  scenes: Array<{ spec?: unknown; sceneContract?: unknown; lessonBible?: unknown }>;
}

/** E5 treatments are meaningful only on a fully source-grounded generated-planner run. */
export function promptExperimentEligibilityProblems(run: PromptExperimentRunShape, arm: PromptArm, order: ExampleOrder): string[] {
  const problems: string[] = [];
  if (!['zero', 'text', 'mechanism', 'diverse'].includes(arm)) problems.push(`unknown prompt arm ${String(arm)}`);
  if (!['ranked', 'reverse'].includes(order)) problems.push(`unknown exemplar order ${String(order)}`);
  if (arm === 'zero' && order !== 'ranked') problems.push('example order permutation requires a retrieval prompt arm');
  if (arm === 'zero') return problems;
  if (run.runClass !== 'generated-lesson') problems.push('E5 retrieval arms require explicit generated-lesson provenance');
  if (!run.sourceDoc || typeof run.sourceDoc !== 'object') problems.push('E5 retrieval arms require the source document used for concept extraction');
  if (run.scenes.length === 0) problems.push('E5 retrieval arms require at least one planned scene');
  for (const [index, scene] of run.scenes.entries()) {
    if (scene.spec) problems.push(`scene ${index + 1} contains a hand-authored SceneSpec`);
    if (!SceneContractSchema.safeParse(scene.sceneContract).success || !LessonBibleSchema.safeParse(scene.lessonBible).success) {
      problems.push(`scene ${index + 1} lacks a schema-valid SceneContract or LessonBible`);
    }
  }
  return problems;
}
