import type { PrimitiveVisual, StrokePath, TextRun } from '../shared/types.js';
import type { EvidenceReference } from '../shared/contracts.js';
import { STYLE } from './style.js';
import { ellipsePath, polylinePath } from './pathmath.js';

/** A deliberately small exact subset. Hydrogens and every bond must be explicit. */
export type ElementSymbol = 'H' | 'C' | 'N' | 'O' | 'F' | 'Cl';
export interface ChemicalAtom { id: string; element: ElementSymbol }
export interface ChemicalBond { from: string; to: string; order: 1 | 2 | 3 }
export interface MoleculeGraph { atoms: ChemicalAtom[]; bonds: ChemicalBond[] }
export interface ReactionSpecies { coefficient: number; molecule: MoleculeGraph }
export interface ReactionGraph { reactants: ReactionSpecies[]; products: ReactionSpecies[] }
export interface ChemicalDrawing { width: number; height: number; formula: string; visual: PrimitiveVisual }

/** Source notation subset: explicit bracket atoms, bond orders, and tree branches. */
export function parseExplicitMolecule(notation: string): MoleculeGraph {
  const tokens = notation.match(/\[(?:H|C|N|O|F|Cl)\]|[-=#()]|./g) ?? [];
  if (tokens.join('') !== notation || tokens.some((token) => !/^\[(?:H|C|N|O|F|Cl)\]$/.test(token) && !['-', '=', '#', '(', ')'].includes(token))) {
    fail('UNSUPPORTED_NOTATION', 'requires explicit bracket atoms, -/=/# bonds, and balanced tree branches; charges, rings, stereo and implicit H are unsupported');
  }
  const atoms: ChemicalAtom[] = [];
  const bonds: ChemicalBond[] = [];
  const branches: Array<{ atomId: string; atomCount: number }> = [];
  let current: string | undefined;
  let pendingOrder: ChemicalBond['order'] | undefined;
  let previousToken: string | undefined;
  for (const token of tokens) {
    if (/^\[/.test(token)) {
      const element = token.slice(1, -1) as ElementSymbol;
      const id = `a${atoms.length}`;
      atoms.push({ id, element });
      if (current !== undefined) {
        if (pendingOrder === undefined) fail('UNSUPPORTED_NOTATION', 'every atom-to-atom connection must include an explicit bond symbol');
        bonds.push({ from: current, to: id, order: pendingOrder });
      } else if (atoms.length > 1) {
        fail('UNSUPPORTED_NOTATION', 'unexpected root atom');
      }
      current = id;
      pendingOrder = undefined;
    } else if (token === '-' || token === '=' || token === '#') {
      if (current === undefined || pendingOrder !== undefined) fail('UNSUPPORTED_NOTATION', 'bond symbol must occur once between two atoms');
      pendingOrder = token === '-' ? 1 : token === '=' ? 2 : 3;
    } else if (token === '(') {
      if (current === undefined || pendingOrder !== undefined) fail('UNSUPPORTED_NOTATION', 'branch must start at an atom');
      branches.push({ atomId: current, atomCount: atoms.length });
    } else {
      const branch = branches.pop();
      if (!branch || pendingOrder !== undefined || atoms.length === branch.atomCount || previousToken === '(') {
        fail('UNSUPPORTED_NOTATION', 'branch must contain at least one complete bonded atom');
      }
      current = branch.atomId;
    }
    previousToken = token;
  }
  if (pendingOrder !== undefined || branches.length > 0 || atoms.length < 2) fail('UNSUPPORTED_NOTATION', 'notation ends with an incomplete atom, bond, or branch');
  return validateMolecule({ atoms, bonds });
}

/** Small graph-isomorphism check: atom IDs and ordering do not carry chemical meaning. */
function sameMolecule(a: MoleculeGraph, b: MoleculeGraph): boolean {
  if (a.atoms.length !== b.atoms.length || a.bonds.length !== b.bonds.length) return false;
  const edge = (m: MoleculeGraph, i: number, j: number) => m.bonds.find((bond) =>
    (bond.from === m.atoms[i]!.id && bond.to === m.atoms[j]!.id) || (bond.to === m.atoms[i]!.id && bond.from === m.atoms[j]!.id))?.order ?? 0;
  const map = new Array<number>(a.atoms.length).fill(-1), used = new Set<number>();
  const search = (i: number): boolean => {
    if (i === map.length) return true;
    for (let j = 0; j < b.atoms.length; j++) {
      if (used.has(j) || a.atoms[i]!.element !== b.atoms[j]!.element) continue;
      if (Array.from({ length: i }, (_, k) => k).some((k) => edge(a, i, k) !== edge(b, j, map[k]!))) continue;
      map[i] = j; used.add(j);
      if (search(i + 1)) return true;
      used.delete(j); map[i] = -1;
    }
    return false;
  };
  return search(0);
}

export function parseExplicitReaction(notation: string): ReactionGraph {
  const sides = notation.split(' -> ');
  if (sides.length !== 2) fail('UNSUPPORTED_NOTATION', 'reaction requires one literal " -> " separator');
  const parseSide = (side: string): ReactionSpecies[] => {
    const terms = side.split(' + ');
    if (terms.length < 1 || terms.length > 3) fail('UNSUPPORTED_NOTATION', 'reaction requires 1–3 species per side');
    return terms.map((term) => {
      const match = /^([1-8])?(\[.*\])$/.exec(term);
      if (!match) fail('UNSUPPORTED_NOTATION', 'reaction species must have an optional 1–8 coefficient and explicit bracket atoms');
      return { coefficient: match[1] ? Number(match[1]) : 1, molecule: parseExplicitMolecule(match[2]!) };
    });
  };
  const reaction = { reactants: parseSide(sides[0]!), products: parseSide(sides[1]!) };
  compileReaction(reaction);
  return reaction;
}

/** A model may only request an exact drawing whose full notation occurs in one cited quote. */
export function validateChemistryEvidence(kind: 'molecule' | 'reaction', graph: MoleculeGraph | ReactionGraph, notation: string, refs: EvidenceReference[] | undefined): void {
  if (!refs?.some((ref) => ref.quote.includes(notation))) fail('MISSING_STRUCTURAL_EVIDENCE', 'one cited source quote must contain the exact explicit structural notation');
  if (kind === 'molecule') {
    const expected = validateMolecule(graph);
    if (!sameMolecule(expected, parseExplicitMolecule(notation))) fail('STRUCTURE_MISMATCH', 'drawn atom/bond graph differs from cited notation');
  } else {
    const expected = graph as ReactionGraph;
    compileReaction(expected);
    const cited = parseExplicitReaction(notation);
    for (const side of ['reactants', 'products'] as const) {
      const actual = expected[side], written = cited[side];
      if (actual.length !== written.length || actual.some((species, i) => species.coefficient !== written[i]!.coefficient || !sameMolecule(validateMolecule(species.molecule), written[i]!.molecule))) {
        fail('STRUCTURE_MISMATCH', `${side} differs from cited notation`);
      }
    }
  }
}

const VALENCE: Record<ElementSymbol, number> = { H: 1, C: 4, N: 3, O: 2, F: 1, Cl: 1 };
const ELEMENTS = new Set<string>(Object.keys(VALENCE));
const ATOM_RADIUS = 26;
const X_STEP = 112;
const Y_STEP = 92;
const PAD = 40;

export class ChemistryValidationError extends Error {
  constructor(readonly code: string, detail: string) { super(`${code}: ${detail}`); this.name = 'ChemistryValidationError'; }
}

function fail(code: string, detail: string): never { throw new ChemistryValidationError(code, detail); }
function record(value: unknown, keys: readonly string[], name: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail('INVALID_SHAPE', `${name} must be an object`);
  const obj = value as Record<string, unknown>;
  for (const key of Object.keys(obj)) if (!keys.includes(key)) fail('UNSUPPORTED_FIELD', `${name}.${key}`);
  for (const key of keys) if (!(key in obj)) fail('MISSING_FIELD', `${name}.${key}`);
  return obj;
}
function array(value: unknown, min: number, max: number, name: string): unknown[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) fail('INVALID_COUNT', `${name} requires ${min}–${max} entries`);
  return value;
}

export function validateMolecule(input: unknown): MoleculeGraph {
  const obj = record(input, ['atoms', 'bonds'], 'molecule');
  const atoms = array(obj.atoms, 2, 12, 'atoms').map((value, i) => {
    const a = record(value, ['id', 'element'], `atoms[${i}]`);
    if (typeof a.id !== 'string' || !/^[a-z][a-z0-9_]{0,23}$/.test(a.id)) fail('ATOM_ID', `atoms[${i}].id`);
    if (typeof a.element !== 'string' || !ELEMENTS.has(a.element)) fail('UNSUPPORTED_ELEMENT', String(a.element));
    return { id: a.id, element: a.element as ElementSymbol };
  });
  const ids = new Set(atoms.map((a) => a.id));
  if (ids.size !== atoms.length) fail('DUPLICATE_ATOM', 'atom IDs must be unique');
  const bondInputs = array(obj.bonds, atoms.length - 1, atoms.length - 1, 'bonds');
  const bondKeys = new Set<string>();
  const degrees = new Map(atoms.map((a) => [a.id, 0]));
  const adjacency = new Map(atoms.map((a) => [a.id, [] as string[]]));
  const bonds = bondInputs.map((value, i) => {
    const b = record(value, ['from', 'to', 'order'], `bonds[${i}]`);
    if (typeof b.from !== 'string' || typeof b.to !== 'string' || !ids.has(b.from) || !ids.has(b.to) || b.from === b.to) fail('BOND_ENDPOINT', `bonds[${i}]`);
    if (b.order !== 1 && b.order !== 2 && b.order !== 3) fail('BOND_ORDER', `bonds[${i}]`);
    const key = [b.from, b.to].sort().join('\0');
    if (bondKeys.has(key)) fail('DUPLICATE_BOND', `bonds[${i}]`);
    bondKeys.add(key);
    degrees.set(b.from, degrees.get(b.from)! + b.order);
    degrees.set(b.to, degrees.get(b.to)! + b.order);
    adjacency.get(b.from)!.push(b.to);
    adjacency.get(b.to)!.push(b.from);
    return { from: b.from, to: b.to, order: b.order } as ChemicalBond;
  });
  const visited = new Set<string>();
  const walk = (id: string) => { visited.add(id); for (const next of adjacency.get(id)!) if (!visited.has(next)) walk(next); };
  walk(atoms[0]!.id);
  if (visited.size !== atoms.length) fail('DISCONNECTED_GRAPH', 'all atoms must be bonded into one molecule');
  // N-1 distinct edges plus connectivity proves this graph is a tree. Rings and aromaticity are not represented.
  for (const a of atoms) if (degrees.get(a.id) !== VALENCE[a.element]) fail('VALENCE', `${a.id} (${a.element}) has bond order ${degrees.get(a.id)}, expected ${VALENCE[a.element]}`);
  return { atoms, bonds };
}

export function molecularFormula(molecule: MoleculeGraph): string {
  const counts = new Map<ElementSymbol, number>();
  for (const atom of molecule.atoms) counts.set(atom.element, (counts.get(atom.element) ?? 0) + 1);
  const order = counts.has('C') ? ['C', 'H', ...[...counts.keys()].filter((x) => x !== 'C' && x !== 'H').sort()] : [...counts.keys()].sort();
  return order.filter((x) => counts.has(x as ElementSymbol)).map((x) => `${x}${counts.get(x as ElementSymbol) === 1 ? '' : counts.get(x as ElementSymbol)}`).join('');
}

function layoutMolecule(molecule: MoleculeGraph): Map<string, { x: number; y: number }> {
  const adj = new Map(molecule.atoms.map((a) => [a.id, [] as string[]]));
  for (const b of molecule.bonds) { adj.get(b.from)!.push(b.to); adj.get(b.to)!.push(b.from); }
  const index = new Map(molecule.atoms.map((a, i) => [a.id, i]));
  for (const children of adj.values()) children.sort((a, b) => index.get(a)! - index.get(b)!);
  const positions = new Map<string, { x: number; y: number }>();
  let leaf = 0;
  const place = (id: string, parent: string | null, depth: number): number => {
    const children = adj.get(id)!.filter((next) => next !== parent);
    const ys = children.map((next) => place(next, id, depth + 1));
    const y = ys.length ? (ys[0]! + ys[ys.length - 1]!) / 2 : leaf++ * Y_STEP;
    positions.set(id, { x: depth * X_STEP, y });
    return y;
  };
  place(molecule.atoms[0]!.id, null, 0);
  return positions;
}

function drawBond(a: { x: number; y: number }, b: { x: number; y: number }, order: number): StrokePath[] {
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
  if (len <= 2 * ATOM_RADIUS) fail('GEOMETRY', 'bond too short to draw');
  const ux = dx / len, uy = dy / len, nx = -uy, ny = ux;
  const offsets = order === 1 ? [0] : order === 2 ? [-6, 6] : [-10, 0, 10];
  return offsets.map((offset) => polylinePath([
    { x: a.x + ux * ATOM_RADIUS + nx * offset, y: a.y + uy * ATOM_RADIUS + ny * offset },
    { x: b.x - ux * ATOM_RADIUS + nx * offset, y: b.y - uy * ATOM_RADIUS + ny * offset },
  ]));
}

export function compileMolecule(input: unknown): ChemicalDrawing {
  const molecule = validateMolecule(input);
  const raw = layoutMolecule(molecule);
  const xs = [...raw.values()].map((p) => p.x), ys = [...raw.values()].map((p) => p.y);
  const minX = Math.min(...xs), minY = Math.min(...ys);
  const positions = new Map([...raw].map(([id, p]) => [id, { x: p.x - minX + PAD, y: p.y - minY + PAD }]));
  const paths: StrokePath[] = [];
  for (const bond of molecule.bonds) paths.push(...drawBond(positions.get(bond.from)!, positions.get(bond.to)!, bond.order));
  const texts: TextRun[] = [];
  for (const atom of molecule.atoms) {
    const p = positions.get(atom.id)!;
    paths.push(ellipsePath(p.x, p.y, ATOM_RADIUS, ATOM_RADIUS));
    texts.push({ x: p.x, y: p.y + 11, text: atom.element, size: STYLE.font.sizes.note, anchor: 'middle' });
  }
  return { width: Math.max(...xs) - minX + PAD * 2, height: Math.max(...ys) - minY + PAD * 2, formula: molecularFormula(molecule), visual: { paths, fills: [], texts } };
}

function shiftVisual(visual: PrimitiveVisual, dx: number, dy: number): PrimitiveVisual {
  const transform = `translate(${dx} ${dy})`;
  return {
    paths: visual.paths.map((p) => ({ ...p, transform })),
    fills: visual.fills.map((f) => ({ ...f, transform })),
    texts: visual.texts.map((t) => ({ ...t, x: t.x + dx, y: t.y + dy })),
  };
}

export function compileReaction(input: unknown): ChemicalDrawing {
  const obj = record(input, ['reactants', 'products'], 'reaction');
  const parseSide = (value: unknown, name: string) => array(value, 1, 3, name).map((item, i) => {
    const s = record(item, ['coefficient', 'molecule'], `${name}[${i}]`);
    if (!Number.isInteger(s.coefficient) || (s.coefficient as number) < 1 || (s.coefficient as number) > 8) fail('COEFFICIENT', `${name}[${i}].coefficient must be 1–8`);
    const molecule = validateMolecule(s.molecule);
    return { coefficient: s.coefficient as number, molecule };
  });
  const reactants = parseSide(obj.reactants, 'reactants'), products = parseSide(obj.products, 'products');
  const count = (side: ReactionSpecies[]) => {
    const totals = new Map<ElementSymbol, number>();
    for (const species of side) for (const atom of species.molecule.atoms) totals.set(atom.element, (totals.get(atom.element) ?? 0) + species.coefficient);
    return totals;
  };
  const left = count(reactants), right = count(products);
  for (const element of new Set([...left.keys(), ...right.keys()])) if ((left.get(element) ?? 0) !== (right.get(element) ?? 0)) fail('UNBALANCED_REACTION', `${element}: ${left.get(element) ?? 0} reactant atoms, ${right.get(element) ?? 0} product atoms`);
  const drawings = [...reactants, ...products].map((s) => compileMolecule(s.molecule));
  const maxHeight = Math.max(...drawings.map((d) => d.height));
  const visual: PrimitiveVisual = { paths: [], fills: [], texts: [] };
  let x = PAD;
  const terms: string[] = [];
  const addText = (label: string, cx: number) => visual.texts.push({ x: cx, y: maxHeight / 2 + PAD + 10, text: label, size: STYLE.font.sizes.note, anchor: 'middle' });
  drawings.forEach((drawing, i) => {
    if (i > 0) {
      if (i === reactants.length) {
        const y = maxHeight / 2 + PAD;
        visual.paths.push(polylinePath([{ x: x + 6, y }, { x: x + 64, y }]));
        visual.paths.push(polylinePath([{ x: x + 48, y: y - 12 }, { x: x + 64, y }, { x: x + 48, y: y + 12 }]));
        x += 94;
        terms.push('→');
      } else { addText('+', x + 16); x += 64; terms.push('+'); }
    }
    const species = i < reactants.length ? reactants[i]! : products[i - reactants.length]!;
    if (species.coefficient > 1) {
      visual.texts.push({ x: x + 8, y: maxHeight / 2 + PAD + 10, text: String(species.coefficient), size: STYLE.font.sizes.note, anchor: 'middle' });
      x += 32;
    }
    const shifted = shiftVisual(drawing.visual, x, PAD + (maxHeight - drawing.height) / 2);
    visual.paths.push(...shifted.paths); visual.fills.push(...shifted.fills); visual.texts.push(...shifted.texts);
    terms.push(`${species.coefficient === 1 ? '' : species.coefficient}${drawing.formula}`);
    x += drawing.width + 22;
  });
  return { width: x + PAD, height: maxHeight + PAD * 2, formula: terms.join(' '), visual };
}
