/**
 * Teaching Compiler V2 feature flags (V2 plan §17). V1 stays the default; each V2
 * capability is switched on independently so one benchmark changes one causal layer
 * (final_plan/04 §12). The version label never enables a flag by itself.
 */
export const COMPILER_VERSIONS = ['v1', 'v2'] as const;
export type CompilerVersion = (typeof COMPILER_VERSIONS)[number];

export const V2_FLAGS = [
  'TEACHING_BEATS_V2',
  'BOARD_OPS_V2',
  'PERSISTENT_BOARD_V2',
  'TYPE_RESOLVER_V2',
  'LAYOUT_V2',
  'RENDER_PLAN_V2',
  'SKIA_EXPERIMENTAL',
] as const;
export type V2Flag = (typeof V2_FLAGS)[number];

export interface FeatureFlags {
  version: CompilerVersion;
  enabled: Record<V2Flag, boolean>;
}

const TRUE_VALUES = new Set(['1', 'true']);
const FALSE_VALUES = new Set(['', '0', 'false']);

export function resolveFeatureFlags(env: Record<string, string | undefined>): FeatureFlags {
  const rawVersion = (env.TEACHING_COMPILER_VERSION ?? 'v1').trim();
  if (!(COMPILER_VERSIONS as readonly string[]).includes(rawVersion)) throw new Error(`TEACHING_COMPILER_VERSION must be one of ${COMPILER_VERSIONS.join(', ')}, got "${rawVersion}"`);
  const enabled = {} as Record<V2Flag, boolean>;
  for (const name of V2_FLAGS) {
    const raw = (env[name] ?? '').trim().toLowerCase();
    if (TRUE_VALUES.has(raw)) enabled[name] = true;
    else if (FALSE_VALUES.has(raw)) enabled[name] = false;
    else throw new Error(`${name} must be 1, true, 0 or false, got "${env[name]}"`);
  }
  return { version: rawVersion as CompilerVersion, enabled };
}

export const FEATURE_FLAGS: FeatureFlags = resolveFeatureFlags(process.env);
export const TEACHING_COMPILER_VERSION: CompilerVersion = FEATURE_FLAGS.version;
