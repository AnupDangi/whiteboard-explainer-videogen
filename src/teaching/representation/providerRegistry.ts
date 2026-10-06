import { z } from 'zod';
import { REPRESENTATION_FAMILIES, SEMANTIC_CHANGE_KINDS, semanticEventId, type RepresentationFamily, type SemanticChangeKind, type TeachingBeat } from '../beat-plan/types.js';

export const MechanismRequirementSchema = z.object({
  eventId: z.string().min(1).max(80).regex(/^[a-z0-9_.]+$/),
  kind: z.enum(SEMANTIC_CHANGE_KINDS),
  entityIds: z.array(z.string().min(1).max(80)).min(1).max(12),
  description: z.string().trim().min(1).max(240),
}).strict();

export interface RepresentationProblem {
  path: string;
  message: string;
}

/** A visible mechanism that must account for one pinned semantic change in the beat. */
export interface MechanismRequirement {
  eventId: string;
  kind: SemanticChangeKind;
  entityIds: string[];
  description: string;
}

/**
 * Family-specific contract for the semantic representation compiler.
 * Providers validate model data before compiling; they never receive or return geometry.
 */
export interface RepresentationProvider<TModel, TState, TOperation> {
  family: RepresentationFamily;
  version: string;
  modelSchema: z.ZodType<TModel>;
  suitability(beat: TeachingBeat): number;
  validateModel(model: TModel, beat: TeachingBeat): RepresentationProblem[];
  mechanismRequirements(model: TModel, beat: TeachingBeat): MechanismRequirement[];
  compile(model: TModel, state: TState, beat: TeachingBeat): TOperation[];
  /** A deterministic family-specific model. The caller must choose this explicitly after targeted repair. */
  fallback(beat: TeachingBeat): TModel;
}

export type ProviderFailureCode =
  | 'provider_unavailable'
  | 'invalid_model'
  | 'unsuitable'
  | 'missing_mechanism'
  | 'invalid_provider_contract'
  | 'compile_failed';

export type ProviderExecutionResult<TOperation> =
  | {
      ok: true;
      family: RepresentationFamily;
      providerVersion: string;
      source: 'model' | 'fallback';
      suitability: number;
      mechanisms: MechanismRequirement[];
      operations: TOperation[];
    }
  | {
      ok: false;
      family: RepresentationFamily;
      code: ProviderFailureCode;
      problems: RepresentationProblem[];
    };

export interface ExecutableRepresentationProvider<TState, TOperation> {
  readonly family: RepresentationFamily;
  readonly version: string;
  compile(model: unknown, state: TState, beat: TeachingBeat): ProviderExecutionResult<TOperation>;
  compileFallback(state: TState, beat: TeachingBeat): ProviderExecutionResult<TOperation>;
}

function schemaProblems(error: z.ZodError): RepresentationProblem[] {
  return error.issues.map((issue) => ({
    path: `/${issue.path.map(String).join('/')}`,
    message: issue.message,
  }));
}

function requiredMechanismProblems(beat: TeachingBeat, mechanisms: MechanismRequirement[]): RepresentationProblem[] {
  const expected = beat.requiredSemanticChanges.map((change, index) => ({
    eventId: semanticEventId(beat.beatId, index),
    kind: change.kind,
    entityId: change.entityId,
  }));
  const problems: RepresentationProblem[] = [];
  const declaredEventIds = new Set<string>();
  for (const requirement of mechanisms) {
    if (declaredEventIds.has(requirement.eventId)) problems.push({ path: '/mechanisms', message: `mechanism event ${requirement.eventId} is declared more than once` });
    declaredEventIds.add(requirement.eventId);
    if (!requirement.description.trim()) problems.push({ path: '/mechanisms', message: `mechanism ${requirement.eventId} needs a visible explanation` });
    if (new Set(requirement.entityIds).size !== requirement.entityIds.length) problems.push({ path: '/mechanisms', message: `mechanism ${requirement.eventId} repeats an entity id` });
  }
  for (const change of expected) {
    const matching = mechanisms.find((requirement) => requirement.eventId === change.eventId);
    if (!matching) {
      problems.push({ path: '/mechanisms', message: `required ${change.kind} change ${change.eventId} has no declared visible mechanism` });
      continue;
    }
    if (matching.kind !== change.kind || !matching.entityIds.includes(change.entityId)) {
      problems.push({ path: '/mechanisms', message: `mechanism ${change.eventId} must preserve kind ${change.kind} and entity ${change.entityId}` });
    }
  }
  for (const requirement of mechanisms) {
    if (!expected.some((change) => change.eventId === requirement.eventId)) {
      problems.push({ path: '/mechanisms', message: `mechanism ${requirement.eventId} does not match a required semantic change in ${beat.beatId}` });
    }
  }
  return problems;
}

/** Wrap a typed provider in a runtime-checked boundary for untrusted model output. */
export function defineRepresentationProvider<TModel, TState, TOperation>(
  provider: RepresentationProvider<TModel, TState, TOperation>,
): ExecutableRepresentationProvider<TState, TOperation> {
  const run = (input: unknown, state: TState, beat: TeachingBeat, source: 'model' | 'fallback'): ProviderExecutionResult<TOperation> => {
    const parsed = provider.modelSchema.safeParse(input);
    if (!parsed.success) return { ok: false, family: provider.family, code: 'invalid_model', problems: schemaProblems(parsed.error) };

    let modelProblems: RepresentationProblem[];
    try {
      modelProblems = provider.validateModel(parsed.data, beat);
      if (!Array.isArray(modelProblems)) throw new Error('validateModel must return an array');
    } catch (error) {
      return { ok: false, family: provider.family, code: 'invalid_provider_contract', problems: [{ path: '/validateModel', message: `provider validation failed: ${String(error)}` }] };
    }
    if (modelProblems.length) return { ok: false, family: provider.family, code: 'invalid_model', problems: modelProblems };

    let suitability: number;
    let mechanisms: MechanismRequirement[];
    try {
      suitability = provider.suitability(beat);
      const declaredMechanisms: unknown = provider.mechanismRequirements(parsed.data, beat);
      if (!Array.isArray(declaredMechanisms)) throw new Error('mechanismRequirements must return an array');
      const parsedMechanisms = z.array(MechanismRequirementSchema).safeParse(declaredMechanisms);
      if (!parsedMechanisms.success) {
        return { ok: false, family: provider.family, code: 'invalid_provider_contract', problems: schemaProblems(parsedMechanisms.error) };
      }
      mechanisms = parsedMechanisms.data;
    } catch (error) {
      return { ok: false, family: provider.family, code: 'invalid_provider_contract', problems: [{ path: '/', message: `provider contract failed: ${String(error)}` }] };
    }
    if (!Number.isFinite(suitability) || suitability < 0 || suitability > 1) {
      return { ok: false, family: provider.family, code: 'invalid_provider_contract', problems: [{ path: '/suitability', message: 'provider suitability must be a finite score from 0 through 1' }] };
    }
    if (suitability === 0) return { ok: false, family: provider.family, code: 'unsuitable', problems: [{ path: '/suitability', message: `provider ${provider.family} is not suitable for ${beat.beatId}` }] };
    const mechanismProblems = requiredMechanismProblems(beat, mechanisms);
    if (mechanismProblems.length) return { ok: false, family: provider.family, code: 'missing_mechanism', problems: mechanismProblems };

    try {
      const operations = provider.compile(parsed.data, state, beat);
      if (!Array.isArray(operations) || operations.length === 0) {
        return { ok: false, family: provider.family, code: 'compile_failed', problems: [{ path: '/operations', message: 'provider must compile a non-empty semantic operation sequence' }] };
      }
      return { ok: true, family: provider.family, providerVersion: provider.version, source, suitability, mechanisms, operations };
    } catch (error) {
      return { ok: false, family: provider.family, code: 'compile_failed', problems: [{ path: '/operations', message: `provider compilation failed: ${String(error)}` }] };
    }
  };

  return Object.freeze({
    family: provider.family,
    version: provider.version,
    compile: (model: unknown, state: TState, beat: TeachingBeat) => run(model, state, beat, 'model'),
    compileFallback: (state: TState, beat: TeachingBeat) => {
      let fallback: TModel;
      try {
        fallback = provider.fallback(beat);
      } catch (error) {
        return { ok: false as const, family: provider.family, code: 'compile_failed' as const, problems: [{ path: '/fallback', message: `provider fallback failed: ${String(error)}` }] };
      }
      const result = run(fallback, state, beat, 'fallback');
      return result.ok ? result : {
        ok: false as const,
        family: result.family,
        code: 'invalid_provider_contract' as const,
        problems: result.problems,
      };
    },
  });
}

export interface RepresentationProviderStatus {
  family: RepresentationFamily;
  status: 'implemented' | 'not_implemented';
  version?: string;
}

export interface RepresentationProviderRegistry<TState, TOperation> {
  readonly statuses: readonly RepresentationProviderStatus[];
  compile(family: RepresentationFamily, model: unknown, state: TState, beat: TeachingBeat): ProviderExecutionResult<TOperation>;
  compileFallback(family: RepresentationFamily, state: TState, beat: TeachingBeat): ProviderExecutionResult<TOperation>;
}

/** Missing providers are reported as unavailable; no family is silently routed through a generic board. */
export function createRepresentationProviderRegistry<TState, TOperation>(
  providers: readonly ExecutableRepresentationProvider<TState, TOperation>[],
): RepresentationProviderRegistry<TState, TOperation> {
  const byFamily = new Map<RepresentationFamily, ExecutableRepresentationProvider<TState, TOperation>>();
  for (const provider of providers) {
    if (byFamily.has(provider.family)) throw new Error(`duplicate representation provider for ${provider.family}`);
    byFamily.set(provider.family, provider);
  }

  const unavailable = (family: RepresentationFamily): ProviderExecutionResult<TOperation> => ({
    ok: false,
    family,
    code: 'provider_unavailable',
    problems: [{ path: '/representationFamily', message: `no typed semantic provider is implemented for ${family}; generic BoardOps fallback is not permitted` }],
  });

  return Object.freeze({
    statuses: Object.freeze(REPRESENTATION_FAMILIES.map((family) => {
      const provider = byFamily.get(family);
      return provider ? { family, status: 'implemented' as const, version: provider.version } : { family, status: 'not_implemented' as const };
    })),
    compile: (family: RepresentationFamily, model: unknown, state: TState, beat: TeachingBeat) => byFamily.get(family)?.compile(model, state, beat) ?? unavailable(family),
    compileFallback: (family: RepresentationFamily, state: TState, beat: TeachingBeat) => byFamily.get(family)?.compileFallback(state, beat) ?? unavailable(family),
  });
}

/** Empty until a family provider is implemented and verified; its status is explicit for all planned families. */
export const REPRESENTATION_PROVIDER_REGISTRY = createRepresentationProviderRegistry<never, never>([]);
