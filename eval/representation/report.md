# Representation-resolution benchmark (P6)

Measurement only. The local tiered resolver is run over a hand-authored,
multi-domain corpus; no model calls, no network. The corpus is authored in
`eval/representation/corpus.ts` and is not derived from any dataset or the
asset registry.

**Corpus size:** 75 concepts across 9 domains (biology, chemistry, computing, finance, history, law-governance, mathematics, medicine, physics).
**Archetypes searched:** all 17 supported archetypes per concept.

### Overall tier distribution

| tier | count | share |
| --- | ---: | ---: |
| trusted-asset | 11 | 14.7% |
| substring-asset | 0 | 0.0% |
| composition | 0 | 0.0% |
| external | 0 | 0.0% |
| primitive-label | 62 | 82.7% |
| not-applicable | 2 | 2.7% |
| **total** | **75** | 100.0% |

## By semantic type

Tallies are per semanticType; a concept with several values counts in each.

- **entity** (n=35) — trusted-asset: 5 (14.3%) · substring-asset: 0 (0.0%) · composition: 0 (0.0%) · external: 0 (0.0%) · primitive-label: 30 (85.7%) · not-applicable: 0 (0.0%)
- **equation** (n=2) — trusted-asset: 0 (0.0%) · substring-asset: 0 (0.0%) · composition: 0 (0.0%) · external: 0 (0.0%) · primitive-label: 0 (0.0%) · not-applicable: 2 (100.0%)
- **location** (n=1) — trusted-asset: 0 (0.0%) · substring-asset: 0 (0.0%) · composition: 0 (0.0%) · external: 0 (0.0%) · primitive-label: 1 (100.0%) · not-applicable: 0 (0.0%)
- **material** (n=3) — trusted-asset: 0 (0.0%) · substring-asset: 0 (0.0%) · composition: 0 (0.0%) · external: 0 (0.0%) · primitive-label: 3 (100.0%) · not-applicable: 0 (0.0%)
- **process** (n=14) — trusted-asset: 1 (7.1%) · substring-asset: 0 (0.0%) · composition: 0 (0.0%) · external: 0 (0.0%) · primitive-label: 13 (92.9%) · not-applicable: 0 (0.0%)
- **quantity** (n=16) — trusted-asset: 5 (31.3%) · substring-asset: 0 (0.0%) · composition: 0 (0.0%) · external: 0 (0.0%) · primitive-label: 11 (68.8%) · not-applicable: 0 (0.0%)
- **role** (n=1) — trusted-asset: 0 (0.0%) · substring-asset: 0 (0.0%) · composition: 0 (0.0%) · external: 0 (0.0%) · primitive-label: 1 (100.0%) · not-applicable: 0 (0.0%)
- **state** (n=3) — trusted-asset: 0 (0.0%) · substring-asset: 0 (0.0%) · composition: 0 (0.0%) · external: 0 (0.0%) · primitive-label: 3 (100.0%) · not-applicable: 0 (0.0%)

## By domain

Tallies are per domain; a concept with several values counts in each.

- **biology** (n=8) — trusted-asset: 2 (25.0%) · substring-asset: 0 (0.0%) · composition: 0 (0.0%) · external: 0 (0.0%) · primitive-label: 6 (75.0%) · not-applicable: 0 (0.0%)
- **chemistry** (n=10) — trusted-asset: 1 (10.0%) · substring-asset: 0 (0.0%) · composition: 0 (0.0%) · external: 0 (0.0%) · primitive-label: 9 (90.0%) · not-applicable: 0 (0.0%)
- **computing** (n=10) — trusted-asset: 3 (30.0%) · substring-asset: 0 (0.0%) · composition: 0 (0.0%) · external: 0 (0.0%) · primitive-label: 7 (70.0%) · not-applicable: 0 (0.0%)
- **finance** (n=8) — trusted-asset: 2 (25.0%) · substring-asset: 0 (0.0%) · composition: 0 (0.0%) · external: 0 (0.0%) · primitive-label: 6 (75.0%) · not-applicable: 0 (0.0%)
- **history** (n=7) — trusted-asset: 1 (14.3%) · substring-asset: 0 (0.0%) · composition: 0 (0.0%) · external: 0 (0.0%) · primitive-label: 6 (85.7%) · not-applicable: 0 (0.0%)
- **law-governance** (n=10) — trusted-asset: 0 (0.0%) · substring-asset: 0 (0.0%) · composition: 0 (0.0%) · external: 0 (0.0%) · primitive-label: 10 (100.0%) · not-applicable: 0 (0.0%)
- **mathematics** (n=13) — trusted-asset: 3 (23.1%) · substring-asset: 0 (0.0%) · composition: 0 (0.0%) · external: 0 (0.0%) · primitive-label: 8 (61.5%) · not-applicable: 2 (15.4%)
- **medicine** (n=8) — trusted-asset: 1 (12.5%) · substring-asset: 0 (0.0%) · composition: 0 (0.0%) · external: 0 (0.0%) · primitive-label: 7 (87.5%) · not-applicable: 0 (0.0%)
- **physics** (n=9) — trusted-asset: 1 (11.1%) · substring-asset: 0 (0.0%) · composition: 0 (0.0%) · external: 0 (0.0%) · primitive-label: 7 (77.8%) · not-applicable: 1 (11.1%)

## Concrete nouns that fell to `primitive-label` (real gaps)

- Neuron (neuron) — entity, biology
- Mitochondria (mitochondria) — entity, biology
- Enzyme (enzyme) — entity, biology/chemistry
- Turbine (turbine) — entity, physics
- Pendulum (pendulum) — entity, physics
- Electromagnet (electromagnet) — entity, physics
- Compiler (compiler) — entity, computing
- Hash Table (hash-table) — entity, computing
- Treaty (treaty) — entity, history/law-governance
- Manuscript (manuscript) — entity, history
- Stock (stock) — entity, finance
- Collateral (collateral) — entity, finance
- Vaccine (vaccine) — material, medicine
- Antibiotic (antibiotic) — material, medicine
- Tumor (tumor) — entity, medicine
- Receptor (receptor) — entity, medicine
- Constitution (constitution) — entity, law-governance
- Statute (statute) — entity, law-governance
- Legislature (legislature) — entity, law-governance
- Ballot (ballot) — entity, law-governance
- Molecule (molecule) — entity, chemistry
- Catalyst (catalyst) — entity, chemistry
- Covalent Bond (covalent-bond) — entity, chemistry
- Acid (acid) — material, chemistry
- Isotope (isotope) — entity, chemistry

## Abstractions that reached `trusted-asset` (arguably wrong — an abstraction should not be an icon)

- Photosynthesis (photosynthesis) — process, biology/chemistry → nature.sun.v2, biology.chloroplast.v2, biology.leaf.v2, biology.plant.sapling.v2
- Inflation (inflation) — quantity, finance → economy.price.level.v2
- Blood Pressure (blood-pressure) — quantity, medicine → physics.compressor.v2
- Gradient (gradient) — quantity, mathematics → math.gradient.v2
