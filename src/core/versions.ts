/**
 * Versions for persisted and replayable artifacts. These values are deliberately
 * independent: changing a prompt must not invalidate an extraction cache, and a
 * renderer change must not pretend that the source parser changed.
 */
export const SYSTEM_VERSIONS={
  schema:'lesson-schema-v2',
  prompt:'teaching-prompt-v1',
  generator:'lesson-generator-v1',
  compiler:'scene-compiler-v1',
  renderer:'svg-renderer-v1',
  parser:'source-parser-v2',
  chunker:'semantic-chunker-v2',
  retrieval:'hybrid-retrieval-v2',
  cache:'artifact-cache-v2',
  pricing:'pricing-2026-09',
  artifact:'artifact-v1',
} as const;
