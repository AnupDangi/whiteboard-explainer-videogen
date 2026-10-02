import { GOLDEN_CASES } from '../shared/fixtures.js';

/**
 * S4 marked-narration scripts for the live-run golden cases OTHER than
 * transformer-attention (which already has hand-authored raw+spec pairs in
 * attentionScenes.ts). Per claude_pipeline.md §2, the full S1-S3 ingestion
 * pipeline is out of scope for this experiment; frozen `TeachingBeat[]`
 * (shared/fixtures.ts) stand in as the frozen teaching-plan input, and this
 * file is the (also frozen/hand-authored) S4 stand-in: each `raw` string
 * below is the corresponding TeachingBeat's own `spokenText.text` VERBATIM,
 * with `[[id|phrase]]` markers wrapped around existing substrings only —
 * no narration content is invented, reworded, or drawn from
 * requiredClaims/requiredRelations (those remain evaluation-only, see
 * shared/evaluation.ts). Stripping the markers reproduces the original
 * spokenText byte-for-byte (see __tests__/liveFixtures.test.ts).
 */

export interface LiveScriptScene {
  sceneId: string;
  raw: string;
  /** Index into the golden case's teachingBeats array this scene mirrors (for teaching-context framing only). */
  beatIndex: number;
}

export interface LiveCaseScript {
  caseId: string;
  scenes: LiveScriptScene[];
}

export const LIVE_NARRATION_SCRIPTS: Record<string, LiveCaseScript> = {
  'gradient-descent': {
    caseId: 'gradient-descent',
    scenes: [
      { sceneId: 'gd_s1_loss_surface', beatIndex: 0, raw: 'A [[loss|loss function]] assigns [[height|a height]] to every [[params|parameter choice]].' },
      { sceneId: 'gd_s2_negative_gradient', beatIndex: 1, raw: 'The [[grad|gradient]] points uphill, so the [[neggrad|negative gradient]] points downhill.' },
      { sceneId: 'gd_s3_iterative_steps', beatIndex: 2, raw: '[[steps|Repeated small steps]] move the parameters toward [[minimum|a local minimum]].' },
    ],
  },
  photosynthesis: {
    caseId: 'photosynthesis',
    scenes: [
      { sceneId: 'ph_s1_inputs', beatIndex: 0, raw: 'Leaves receive [[light|light]] while roots supply [[water|water]] and air supplies [[co2|carbon dioxide]].' },
      { sceneId: 'ph_s2_chloroplast', beatIndex: 1, raw: 'Inside [[chloroplast|chloroplasts]], light energy drives reactions that build [[sugar|sugar]].' },
      { sceneId: 'ph_s3_outputs', beatIndex: 2, raw: 'The plant stores chemical energy in [[glucose|glucose]] and releases [[oxygen|oxygen]].' },
    ],
  },
  'electromagnetic-induction': {
    caseId: 'electromagnetic-induction',
    scenes: [
      { sceneId: 'emi_s1_flux', beatIndex: 0, raw: '[[flux|Magnetic flux]] measures how much magnetic field passes through [[coil|a coil]].' },
      { sceneId: 'emi_s2_changing_flux', beatIndex: 1, raw: 'Moving [[magnet|the magnet]] changes [[fluxchange|that flux]] through the coil.' },
      { sceneId: 'emi_s3_induced_current', beatIndex: 2, raw: 'The changing flux induces [[current|a current]] whose field [[opposing|opposes the change]].' },
    ],
  },
};

/** Teaching-plan display context for a scene (displayText/visualIntent/equations only — never requiredClaims/requiredRelations/learnerInference/misconception). */
export function teachingContextFor(caseId: string, beatIndex: number): { displayText?: string; visualIntent?: string; equations?: string[] } {
  const golden = GOLDEN_CASES.find((g) => g.id === caseId);
  const beat = golden?.teachingBeats[beatIndex];
  return {
    displayText: beat?.displayText?.text,
    visualIntent: beat?.visualIntent,
    equations: golden?.sourceContext?.equations,
  };
}
