import { iconUsesFor, loadRetainedV2Run } from './retainedV2Run.js';
import { measureV2Scene, summarizeV2Richness, type IconUse, type V2RichnessSummary, type V2SceneRichness } from './v2Richness.js';

export interface RichnessRunReport {
  runDir: string;
  lessonId: string;
  complete: boolean;
  status: 'loaded' | 'unavailable';
  reason?: string;
  hardFailures: number | null;
  timelineReplayMismatches: number;
  summary: V2RichnessSummary;
  scenes: V2SceneRichness[];
  icons: Array<IconUse & { sceneId: string }>;
  /** Exact-name matches that fit but have no verdict yet (not drawn): the review sheet lists them. */
  pendingReview: Array<{ sceneId: string; referent: string; assetId: string }>;
}
export interface RichnessReport { schemaVersion: 'v2-richness/v1'; composition: 'labels' | 'icon-cards'; runs: RichnessRunReport[]; pooled: V2RichnessSummary }

export async function richnessReport(runDirs: readonly string[], options: { composition?: 'labels' | 'icon-cards' } = {}): Promise<RichnessReport> {
  const composition = options.composition ?? 'labels';
  const runs: RichnessRunReport[] = [];
  for (const runDir of runDirs) {
    const run = await loadRetainedV2Run(runDir, { composition });
    const perScene = run.scenes.map(({ scene }) => ({ scene, icons: iconUsesFor(scene) }));
    const scenes = perScene.map(({ scene, icons }) => measureV2Scene({ sceneId: scene.sceneId, states: scene.timeline.states, icons }));
    runs.push({
      runDir: run.runDir, lessonId: run.lessonId, complete: run.complete, status: run.status, ...(run.reason ? { reason: run.reason } : {}),
      hardFailures: run.hardFailures, timelineReplayMismatches: run.scenes.filter((item) => !item.timelineReplayMatches).length,
      summary: summarizeV2Richness(scenes), scenes,
      icons: perScene.flatMap(({ scene, icons }) => icons.map((icon) => ({ ...icon, sceneId: scene.sceneId }))),
      pendingReview: run.scenes.flatMap(({ scene }) => (scene.pendingBadges ?? []).map((badge) => ({ sceneId: scene.sceneId, referent: badge.referent, assetId: badge.assetId }))),
    });
  }
  const pooled = summarizeV2Richness(runs.filter((run) => run.complete && run.status === 'loaded').flatMap((run) => run.scenes));
  return { schemaVersion: 'v2-richness/v1', composition, runs, pooled };
}
