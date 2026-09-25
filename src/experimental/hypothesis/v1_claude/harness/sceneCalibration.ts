import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { planScene } from '../planner/plan.js';
import type { PlannerSceneInput } from '../planner/prompt.js';
import { compileScenePlanningContext } from '../planner/context.js';
import type { PromptArm } from '../planner/exemplars.js';
import { buildPlannerSceneInput } from '../planner/sceneInput.js';
import { lessonToLiveInput, type PreparedLesson } from '../pipeline/lesson.js';
import { rankConcepts } from '../catalog/semantic.js';
import { catalogVersion } from '../catalog/registry.js';
import { resolveScene } from '../resolveScene.js';
import type { PersistentBudgetLedger } from '../pipeline/budgetLedger.js';
import { sceneRichness, summarizeRichness, type RichnessSummary, type SceneRichness } from './sceneRichness.js';

/**
 * Diagnostic S6 calibration on cached S1-S5 artifacts. It measures prompt arms
 * against the unchanged planner gates. Output is never E5 evidence: S5 is
 * uncalibrated and no timed video is reviewed.
 */
export interface SceneCalibrationItem {
  caseId: string;
  sceneId: string;
  buildInput: (arm: PromptArm, previous: PlannerSceneInput['previousElements']) => PlannerSceneInput;
}

export interface SceneCalibrationAttempt {
  caseId: string;
  sceneId: string;
  arm: PromptArm;
  attempt: number;
  valid: boolean;
  failureCodes: string[];
  repairs: number;
  costUsd: number;
  richness?: SceneRichness;
}

export interface SceneCalibrationReport {
  resultClass: 'diagnostic-calibration';
  generatedAt: string;
  model: string;
  arms: Array<{
    arm: PromptArm;
    attempts: number;
    valid: number;
    validRate: number;
    failureCodeCounts: Record<string, number>;
    richness: RichnessSummary;
    totalCostUsd: number;
  }>;
  attempts: SceneCalibrationAttempt[];
}

export async function runSceneCalibration(opts: {
  items: SceneCalibrationItem[];
  arms: PromptArm[];
  repeats: number;
  model: string;
  apiKey: string;
  budgetLedger?: PersistentBudgetLedger;
  perSceneBudgetUsd?: number;
  fetcher?: typeof fetch;
}): Promise<SceneCalibrationReport> {
  const attempts: SceneCalibrationAttempt[] = [];
  for (const arm of opts.arms) {
    for (let attempt = 1; attempt <= opts.repeats; attempt++) {
      let previous: PlannerSceneInput['previousElements'];
      let previousCase = '';
      for (const item of opts.items) {
        if (item.caseId !== previousCase) {
          previous = undefined;
          previousCase = item.caseId;
        }

        let input: PlannerSceneInput;
        try {
          input = item.buildInput(arm, previous);
        } catch {
          attempts.push({ caseId: item.caseId, sceneId: item.sceneId, arm, attempt, valid: false, failureCodes: ['scene-context-invalid'], repairs: 0, costUsd: 0 });
          continue;
        }

        const result = await planScene(input, {
          model: opts.model,
          apiKey: opts.apiKey,
          remainingBudgetUsd: opts.perSceneBudgetUsd ?? 0.05,
          budgetLedger: opts.budgetLedger,
          fetcher: opts.fetcher,
          fallback: false,
        });
        const valid = Boolean(result.spec) && !result.failures.some((failure) => failure.hard);
        attempts.push({
          caseId: item.caseId,
          sceneId: item.sceneId,
          arm,
          attempt,
          valid,
          failureCodes: [...new Set(result.failures.map((failure) => failure.code))].sort(),
          repairs: result.usage.repairs,
          costUsd: result.usage.costUsd,
          ...(result.spec ? { richness: sceneRichness(result.spec, resolveScene(result.spec)) } : {}),
        });
        previous = result.spec?.elements.map((element) => ({
          id: element.id,
          prim: element.prim,
          ...(element.label ? { label: element.label } : {}),
          ...(element.conceptIds ? { conceptIds: element.conceptIds } : {}),
        }));
      }
    }
  }

  const arms = opts.arms.map((arm) => {
    const rows = attempts.filter((row) => row.arm === arm);
    const failureCodeCounts: Record<string, number> = {};
    for (const row of rows) for (const code of row.failureCodes) failureCodeCounts[code] = (failureCodeCounts[code] ?? 0) + 1;
    const valid = rows.filter((row) => row.valid).length;
    return {
      arm,
      attempts: rows.length,
      valid,
      validRate: rows.length ? valid / rows.length : 0,
      failureCodeCounts: Object.fromEntries(Object.entries(failureCodeCounts).sort(([a], [b]) => a.localeCompare(b))),
      richness: summarizeRichness(rows.flatMap((row) => row.richness ? [row.richness] : [])),
      totalCostUsd: rows.reduce((sum, row) => sum + row.costUsd, 0),
    };
  });
  return { resultClass: 'diagnostic-calibration', generatedAt: new Date().toISOString(), model: opts.model, arms, attempts };
}

interface NarrationFile {
  scenes: Array<{ sceneId: string; rawText: string; plainText: string; mentions: Array<{ id: string; phrase: string }> }>;
}

interface AlignedFile {
  mentions: Array<{ sceneId: string; mentionId: string; startMs: number; endMs: number }>;
}

/** Rebuild S6 inputs from a completed run directory's cached S1-S5 artifacts. No provider calls. */
export async function loadSceneCalibrationItems(runDirs: string[]): Promise<SceneCalibrationItem[]> {
  const items: SceneCalibrationItem[] = [];
  const activeCatalogVersion = catalogVersion();
  for (const dir of runDirs) {
    const prepared = JSON.parse(await readFile(path.join(dir, 'lesson-prep.json'), 'utf8')) as PreparedLesson;
    const narration = JSON.parse(await readFile(path.join(dir, 'narration.json'), 'utf8')) as NarrationFile;
    const aligned = JSON.parse(await readFile(path.join(dir, 'aligned-audio.json'), 'utf8')) as AlignedFile;
    const caseId = path.basename(dir);
    const live = lessonToLiveInput(caseId, prepared);
    const mentionCandidates = await rankConcepts(narration.scenes.flatMap((scene) => scene.mentions.map((mention) => mention.phrase)), 5);
    for (const scene of live.scenes) {
      const narrationScene = narration.scenes.find((candidate) => candidate.sceneId === scene.sceneId);
      if (!narrationScene || !scene.sceneContract || !scene.lessonBible) continue;
      const mentionTimes = aligned.mentions.filter((mention) => mention.sceneId === scene.sceneId).map((mention) => ({ id: mention.mentionId, startMs: mention.startMs, endMs: mention.endMs }));
      items.push({
        caseId,
        sceneId: scene.sceneId,
        buildInput: (arm, previous) => {
          const plannerInput = buildPlannerSceneInput({
            sceneId: scene.sceneId,
            narrationScene,
            teachingContext: scene.teachingContext,
            mentionCandidates,
            previousElements: previous,
          });
          plannerInput.planningContext = compileScenePlanningContext(
            plannerInput,
            scene.sceneContract!,
            scene.lessonBible!,
            mentionTimes,
            arm,
            activeCatalogVersion,
            live.sourceDoc?.sourceId,
            caseId,
            'ranked',
          );
          return plannerInput;
        },
      });
    }
  }
  return items;
}
