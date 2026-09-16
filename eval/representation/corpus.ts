/** P6 representation benchmark corpus.
 *
 *  Hand-authored here — NOT copied from any dataset, registry or upstream file.
 *  The intent is a broad, deliberately unbalanced spread: 75 concepts across 9
 *  domains, mixing concrete nouns an icon library could plausibly hold with
 *  abstractions it could not. `kind` is an author judgement about depictability,
 *  not a resolver input.
 *
 *  `domains` is a list because a concept can sit in several (e.g. a matrix lives
 *  in mathematics and computing); domain tallies therefore sum above the corpus
 *  size. `semanticType` uses the ConceptIdentity vocabulary from src.
 */
import type {ConceptIdentity} from '../../src/semantic/types.js';

export type CorpusSemanticType = ConceptIdentity['semanticType'];
export type CorpusKind = 'concrete' | 'abstract';

export interface CorpusConcept {
  id: string;
  name: string;
  semanticType: CorpusSemanticType;
  domains: string[];
  kind: CorpusKind;
}

export const CORPUS: readonly CorpusConcept[] = [
  // --- biology -------------------------------------------------------------
  {id: 'neuron', name: 'Neuron', semanticType: 'entity', domains: ['biology'], kind: 'concrete'},
  {id: 'mitochondria', name: 'Mitochondria', semanticType: 'entity', domains: ['biology'], kind: 'concrete'},
  {id: 'gene', name: 'Gene', semanticType: 'entity', domains: ['biology'], kind: 'abstract'},
  {id: 'photosynthesis', name: 'Photosynthesis', semanticType: 'process', domains: ['biology', 'chemistry'], kind: 'abstract'},
  {id: 'homeostasis', name: 'Homeostasis', semanticType: 'state', domains: ['biology'], kind: 'abstract'},
  {id: 'ecosystem', name: 'Ecosystem', semanticType: 'entity', domains: ['biology'], kind: 'abstract'},
  {id: 'enzyme', name: 'Enzyme', semanticType: 'entity', domains: ['biology', 'chemistry'], kind: 'concrete'},
  {id: 'cell', name: 'Cell', semanticType: 'entity', domains: ['biology'], kind: 'concrete'},

  // --- physics -------------------------------------------------------------
  {id: 'turbine', name: 'Turbine', semanticType: 'entity', domains: ['physics'], kind: 'concrete'},
  {id: 'pendulum', name: 'Pendulum', semanticType: 'entity', domains: ['physics'], kind: 'concrete'},
  {id: 'entropy', name: 'Entropy', semanticType: 'quantity', domains: ['physics'], kind: 'abstract'},
  {id: 'velocity', name: 'Velocity', semanticType: 'quantity', domains: ['physics'], kind: 'abstract'},
  {id: 'electromagnet', name: 'Electromagnet', semanticType: 'entity', domains: ['physics'], kind: 'concrete'},
  {id: 'nuclear-fusion', name: 'Nuclear Fusion', semanticType: 'process', domains: ['physics'], kind: 'abstract'},
  {id: 'refraction', name: 'Refraction', semanticType: 'process', domains: ['physics'], kind: 'abstract'},
  {id: 'schrodinger-equation', name: 'Schrodinger Equation', semanticType: 'equation', domains: ['physics', 'mathematics'], kind: 'abstract'},

  // --- computing -----------------------------------------------------------
  {id: 'database', name: 'Database', semanticType: 'entity', domains: ['computing'], kind: 'concrete'},
  {id: 'algorithm', name: 'Algorithm', semanticType: 'process', domains: ['computing', 'mathematics'], kind: 'abstract'},
  {id: 'recursion', name: 'Recursion', semanticType: 'process', domains: ['computing', 'mathematics'], kind: 'abstract'},
  {id: 'compiler', name: 'Compiler', semanticType: 'entity', domains: ['computing'], kind: 'concrete'},
  {id: 'cache', name: 'Cache', semanticType: 'entity', domains: ['computing'], kind: 'concrete'},
  {id: 'neural-network', name: 'Neural Network', semanticType: 'entity', domains: ['computing'], kind: 'abstract'},
  {id: 'byte', name: 'Byte', semanticType: 'quantity', domains: ['computing'], kind: 'abstract'},
  {id: 'hash-table', name: 'Hash Table', semanticType: 'entity', domains: ['computing'], kind: 'concrete'},
  {id: 'latency', name: 'Latency', semanticType: 'quantity', domains: ['computing'], kind: 'abstract'},

  // --- history -------------------------------------------------------------
  {id: 'treaty', name: 'Treaty', semanticType: 'entity', domains: ['history', 'law-governance'], kind: 'concrete'},
  {id: 'dynasty', name: 'Dynasty', semanticType: 'entity', domains: ['history'], kind: 'abstract'},
  {id: 'revolution', name: 'Revolution', semanticType: 'process', domains: ['history'], kind: 'abstract'},
  {id: 'empire', name: 'Empire', semanticType: 'entity', domains: ['history'], kind: 'abstract'},
  {id: 'manuscript', name: 'Manuscript', semanticType: 'entity', domains: ['history'], kind: 'concrete'},
  {id: 'chronology', name: 'Chronology', semanticType: 'process', domains: ['history'], kind: 'abstract'},
  {id: 'clock', name: 'Clock', semanticType: 'entity', domains: ['history'], kind: 'concrete'},

  // --- finance -------------------------------------------------------------
  {id: 'inflation', name: 'Inflation', semanticType: 'quantity', domains: ['finance'], kind: 'abstract'},
  {id: 'stock', name: 'Stock', semanticType: 'entity', domains: ['finance'], kind: 'concrete'},
  {id: 'interest-rate', name: 'Interest Rate', semanticType: 'quantity', domains: ['finance'], kind: 'abstract'},
  {id: 'bank', name: 'Bank', semanticType: 'entity', domains: ['finance'], kind: 'concrete'},
  {id: 'debt', name: 'Debt', semanticType: 'quantity', domains: ['finance'], kind: 'abstract'},
  {id: 'portfolio', name: 'Portfolio', semanticType: 'entity', domains: ['finance'], kind: 'abstract'},
  {id: 'collateral', name: 'Collateral', semanticType: 'entity', domains: ['finance'], kind: 'concrete'},
  {id: 'liquidity', name: 'Liquidity', semanticType: 'quantity', domains: ['finance'], kind: 'abstract'},

  // --- medicine ------------------------------------------------------------
  {id: 'vaccine', name: 'Vaccine', semanticType: 'material', domains: ['medicine'], kind: 'concrete'},
  {id: 'antibiotic', name: 'Antibiotic', semanticType: 'material', domains: ['medicine'], kind: 'concrete'},
  {id: 'diagnosis', name: 'Diagnosis', semanticType: 'process', domains: ['medicine'], kind: 'abstract'},
  {id: 'immunity', name: 'Immunity', semanticType: 'state', domains: ['medicine'], kind: 'abstract'},
  {id: 'tumor', name: 'Tumor', semanticType: 'entity', domains: ['medicine'], kind: 'concrete'},
  {id: 'blood-pressure', name: 'Blood Pressure', semanticType: 'quantity', domains: ['medicine'], kind: 'abstract'},
  {id: 'receptor', name: 'Receptor', semanticType: 'entity', domains: ['medicine'], kind: 'concrete'},
  {id: 'inflammation', name: 'Inflammation', semanticType: 'process', domains: ['medicine'], kind: 'abstract'},

  // --- mathematics ---------------------------------------------------------
  {id: 'matrix', name: 'Matrix', semanticType: 'quantity', domains: ['mathematics', 'computing'], kind: 'concrete'},
  {id: 'vector', name: 'Vector', semanticType: 'quantity', domains: ['mathematics', 'physics'], kind: 'concrete'},
  {id: 'integral', name: 'Integral', semanticType: 'quantity', domains: ['mathematics'], kind: 'abstract'},
  {id: 'theorem', name: 'Theorem', semanticType: 'entity', domains: ['mathematics'], kind: 'abstract'},
  {id: 'prime-number', name: 'Prime Number', semanticType: 'quantity', domains: ['mathematics'], kind: 'abstract'},
  {id: 'gradient', name: 'Gradient', semanticType: 'quantity', domains: ['mathematics'], kind: 'abstract'},
  {id: 'mathematical-induction', name: 'Mathematical Induction', semanticType: 'process', domains: ['mathematics'], kind: 'abstract'},
  {id: 'topology', name: 'Topology', semanticType: 'entity', domains: ['mathematics'], kind: 'abstract'},
  {id: 'probability', name: 'Probability', semanticType: 'quantity', domains: ['mathematics'], kind: 'abstract'},
  {id: 'quadratic-formula', name: 'Quadratic Formula', semanticType: 'equation', domains: ['mathematics'], kind: 'abstract'},

  // --- law / governance ----------------------------------------------------
  {id: 'constitution', name: 'Constitution', semanticType: 'entity', domains: ['law-governance'], kind: 'concrete'},
  {id: 'statute', name: 'Statute', semanticType: 'entity', domains: ['law-governance'], kind: 'concrete'},
  {id: 'jurisdiction', name: 'Jurisdiction', semanticType: 'location', domains: ['law-governance'], kind: 'abstract'},
  {id: 'democracy', name: 'Democracy', semanticType: 'state', domains: ['law-governance'], kind: 'abstract'},
  {id: 'veto', name: 'Veto', semanticType: 'process', domains: ['law-governance'], kind: 'abstract'},
  {id: 'legislature', name: 'Legislature', semanticType: 'entity', domains: ['law-governance'], kind: 'concrete'},
  {id: 'ballot', name: 'Ballot', semanticType: 'entity', domains: ['law-governance'], kind: 'concrete'},
  {id: 'referendum', name: 'Referendum', semanticType: 'process', domains: ['law-governance'], kind: 'abstract'},
  {id: 'head-of-state', name: 'Head of State', semanticType: 'role', domains: ['law-governance'], kind: 'abstract'},

  // --- chemistry -----------------------------------------------------------
  {id: 'molecule', name: 'Molecule', semanticType: 'entity', domains: ['chemistry'], kind: 'concrete'},
  {id: 'catalyst', name: 'Catalyst', semanticType: 'entity', domains: ['chemistry'], kind: 'concrete'},
  {id: 'covalent-bond', name: 'Covalent Bond', semanticType: 'entity', domains: ['chemistry'], kind: 'concrete'},
  {id: 'oxidation', name: 'Oxidation', semanticType: 'process', domains: ['chemistry'], kind: 'abstract'},
  {id: 'acid', name: 'Acid', semanticType: 'material', domains: ['chemistry'], kind: 'concrete'},
  {id: 'ph', name: 'pH', semanticType: 'quantity', domains: ['chemistry'], kind: 'abstract'},
  {id: 'isotope', name: 'Isotope', semanticType: 'entity', domains: ['chemistry'], kind: 'concrete'},
  {id: 'combustion', name: 'Combustion', semanticType: 'process', domains: ['chemistry'], kind: 'abstract'},
];
