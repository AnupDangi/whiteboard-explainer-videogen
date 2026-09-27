/** Bump a stage version whenever its deterministic algorithm or relevant style contract changes. */
export const VISUAL_STAGE_VERSIONS = {
  resolve: 'resvg-text-metrics-bundled-kalam-7-box-labels',
  layout: 'template-layout-bundled-kalam-7-box-nodes',
  timeline: 'mention-timeline-2',
  render: 'svg-renderer-bundled-kalam-8-no-badges',
} as const;

/**
 * S5 (TTS + forced alignment) cache identity, shared by runLive.ts and
 * lesson.ts so both sites always agree on the stage/model identity. Bump
 * S5_STAGE_VERSION whenever the aligner pass order, repair bounds, or the
 * recorded payload shape changes.
 */
export const S5_STAGE_VERSION = 'voice-align-4-repair-identity';
export const S5_MODEL_ID = 'voice-engine:auto+stable-ts+wav2vec2-ctc+repair:base';
