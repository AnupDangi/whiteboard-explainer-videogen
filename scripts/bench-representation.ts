/** P6 representation-resolution benchmark (measurement, not capability).
 *
 *  Runs the local tiered resolver (`resolveRepresentation`) over the
 *  hand-authored multi-domain corpus against the FULL supported archetype set,
 *  classifies each outcome with `classifyCandidate`, and reports WHERE
 *  resolution succeeds and fails — overall, by semanticType and by domain.
 *
 *  Offline and deterministic: no model calls, no network, no wall-clock fields
 *  in the report. The corpus is authored in eval/representation/corpus.ts and is
 *  not derived from any dataset or the asset registry.
 *
 *  Run: `npm run bench:representation` (builds, then node dist/...).
 */
import {mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {resolveRepresentation} from '../src/semantic/identity/representation.js';
import {
  classifyCandidate,
  REPRESENTATION_TIERS,
  type RepresentationCandidateEntry,
  type RepresentationTier,
} from '../src/semantic/representation-metrics.js';
import {SUPPORTED_ARCHETYPES} from '../src/semantic/compiler/zones.js';
import {CORPUS, type CorpusConcept} from '../eval/representation/corpus.js';

interface ConceptResult {
  id: string;
  name: string;
  semanticType: string;
  domains: string[];
  kind: 'concrete' | 'abstract';
  tier: RepresentationTier;
  candidateIds: string[];
}

const OUT_DIR = 'eval/representation';

/** One resolver run per concept against every supported archetype. */
const results: ConceptResult[] = CORPUS.map((concept: CorpusConcept) => {
  const decision = resolveRepresentation(
    {
      id: concept.id,
      canonicalName: concept.name,
      aliases: [],
      semanticType: concept.semanticType,
    },
    SUPPORTED_ARCHETYPES,
  );
  const entry: RepresentationCandidateEntry = {
    candidates: decision.candidates,
    representation: decision.representation,
    fallback: decision.fallback,
  };
  return {
    id: concept.id,
    name: concept.name,
    semanticType: concept.semanticType,
    domains: [...concept.domains],
    kind: concept.kind,
    tier: classifyCandidate(entry),
    candidateIds: decision.candidates.map(candidate => candidate.id),
  };
});

type TierCounts = Record<string, number>;

function blankCounts(): TierCounts {
  const counts: TierCounts = {};
  for (const tier of REPRESENTATION_TIERS) counts[tier] = 0;
  counts.total = 0;
  return counts;
}

function tally(rows: readonly ConceptResult[]): TierCounts {
  const counts = blankCounts();
  for (const row of rows) {
    counts[row.tier]++;
    counts.total++;
  }
  return counts;
}

function percent(count: number, total: number): string {
  return total === 0 ? '0.0%' : `${((count / total) * 100).toFixed(1)}%`;
}

function groupBy(
  rows: readonly ConceptResult[],
  keysOf: (row: ConceptResult) => string[],
): Map<string, ConceptResult[]> {
  const groups = new Map<string, ConceptResult[]>();
  for (const row of rows) {
    for (const key of keysOf(row)) {
      const bucket = groups.get(key);
      if (bucket) bucket.push(row);
      else groups.set(key, [row]);
    }
  }
  return groups;
}

function countsBy(rows: readonly ConceptResult[], keysOf: (row: ConceptResult) => string[]): Record<string, TierCounts> {
  const out: Record<string, TierCounts> = {};
  for (const key of [...groupBy(rows, keysOf).keys()].sort()) {
    out[key] = tally(groupBy(rows, keysOf).get(key) ?? []);
  }
  return out;
}

const overall = tally(results);
const bySemanticType = countsBy(results, row => [row.semanticType]);
const byDomain = countsBy(results, row => row.domains);

/** The real gaps: a physical noun the resolver could not place on any curated
 *  asset and had to drop to a bare label. */
const concretePrimitiveLabels = results
  .filter(row => row.kind === 'concrete' && row.tier === 'primitive-label')
  .map(row => ({id: row.id, name: row.name, semanticType: row.semanticType, domains: row.domains}));

/** Arguably WRONG: an abstraction (not a depictable object) matched a curated
 *  asset and was treated as a trusted icon. */
const abstractionTrustedAssets = results
  .filter(row => row.kind === 'abstract' && row.tier === 'trusted-asset')
  .map(row => ({id: row.id, name: row.name, semanticType: row.semanticType, domains: row.domains, candidateIds: row.candidateIds}));

const report = {
  source: 'eval/representation/corpus.ts',
  method: 'resolveRepresentation over all SUPPORTED_ARCHETYPES, classified by classifyCandidate; offline, deterministic',
  corpusSize: results.length,
  domains: [...new Set(results.flatMap(row => row.domains))].sort(),
  tiers: [...REPRESENTATION_TIERS],
  overall,
  overallPct: Object.fromEntries(REPRESENTATION_TIERS.map(tier => [tier, percent(overall[tier], overall.total)])),
  bySemanticType,
  byDomain,
  concretePrimitiveLabels,
  abstractionTrustedAssets,
  perConcept: results,
};

function table(title: string, counts: TierCounts): string {
  const lines = [`### ${title}`, '', '| tier | count | share |', '| --- | ---: | ---: |'];
  for (const tier of REPRESENTATION_TIERS) {
    lines.push(`| ${tier} | ${counts[tier]} | ${percent(counts[tier], counts.total)} |`);
  }
  lines.push(`| **total** | **${counts.total}** | 100.0% |`);
  return lines.join('\n');
}

function section(title: string, groups: Record<string, TierCounts>, extraHeader: string): string {
  const parts = [`## ${title}`, '', `Tallies are per ${extraHeader}; a concept with several values counts in each.`, ''];
  for (const key of Object.keys(groups).sort()) {
    const counts = groups[key];
    const cells = REPRESENTATION_TIERS.map(tier => `${tier}: ${counts[tier]} (${percent(counts[tier], counts.total)})`).join(' · ');
    parts.push(`- **${key}** (n=${counts.total}) — ${cells}`);
  }
  return parts.join('\n');
}

const markdown = [
  '# Representation-resolution benchmark (P6)',
  '',
  'Measurement only. The local tiered resolver is run over a hand-authored,',
  'multi-domain corpus; no model calls, no network. The corpus is authored in',
  '`eval/representation/corpus.ts` and is not derived from any dataset or the',
  'asset registry.',
  '',
  `**Corpus size:** ${results.length} concepts across ${report.domains.length} domains (${report.domains.join(', ')}).`,
  `**Archetypes searched:** all ${SUPPORTED_ARCHETYPES.length} supported archetypes per concept.`,
  '',
  table('Overall tier distribution', overall),
  '',
  section('By semantic type', bySemanticType, 'semanticType'),
  '',
  section('By domain', byDomain, 'domain'),
  '',
  '## Concrete nouns that fell to `primitive-label` (real gaps)',
  '',
  concretePrimitiveLabels.length
    ? concretePrimitiveLabels.map(row => `- ${row.name} (${row.id}) — ${row.semanticType}, ${row.domains.join('/')}`).join('\n')
    : '_none_',
  '',
  '## Abstractions that reached `trusted-asset` (arguably wrong — an abstraction should not be an icon)',
  '',
  abstractionTrustedAssets.length
    ? abstractionTrustedAssets.map(row => `- ${row.name} (${row.id}) — ${row.semanticType}, ${row.domains.join('/')} → ${row.candidateIds.join(', ')}`).join('\n')
    : '_none_',
  '',
].join('\n');

await mkdir(OUT_DIR, {recursive: true});
await writeFile(join(OUT_DIR, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
await writeFile(join(OUT_DIR, 'report.md'), markdown);

console.log(`representation benchmark: ${results.length} concepts, ${SUPPORTED_ARCHETYPES.length} archetypes each`);
for (const tier of REPRESENTATION_TIERS) {
  console.log(`  ${tier.padEnd(16)} ${String(overall[tier]).padStart(3)}  ${percent(overall[tier], overall.total)}`);
}
console.log(`concrete -> primitive-label gaps: ${concretePrimitiveLabels.length}`);
console.log(`abstract -> trusted-asset suspicious: ${abstractionTrustedAssets.length}`);
console.log(`wrote ${join(OUT_DIR, 'report.json')} and ${join(OUT_DIR, 'report.md')}`);
