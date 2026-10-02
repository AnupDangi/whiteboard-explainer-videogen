import test from 'node:test';
import assert from 'node:assert/strict';
import { ChemistryValidationError, compileMolecule, compileReaction, parseExplicitMolecule, parseExplicitReaction, validateChemistryEvidence, validateMolecule } from '../render/chemistry.js';
import { safeParseSceneSpec } from '../shared/schema.js';
import { measureElement } from '../layout/measure.js';
import { renderPrimitive } from '../render/primitives.js';

const water = {
  atoms: [{ id: 'o', element: 'O' }, { id: 'ha', element: 'H' }, { id: 'hb', element: 'H' }],
  bonds: [{ from: 'o', to: 'ha', order: 1 }, { from: 'o', to: 'hb', order: 1 }],
};
const hydrogen = {
  atoms: [{ id: 'ha', element: 'H' }, { id: 'hb', element: 'H' }],
  bonds: [{ from: 'ha', to: 'hb', order: 1 }],
};
const oxygen = {
  atoms: [{ id: 'oa', element: 'O' }, { id: 'ob', element: 'O' }],
  bonds: [{ from: 'oa', to: 'ob', order: 2 }],
};
const methane = {
  atoms: [{ id: 'c', element: 'C' }, ...['a', 'b', 'd', 'e'].map((id) => ({ id, element: 'H' }))],
  bonds: ['a', 'b', 'd', 'e'].map((id) => ({ from: 'c', to: id, order: 1 })),
};

function rejects(value: unknown, code: string): void {
  assert.throws(() => validateMolecule(value), (error: unknown) => error instanceof ChemistryValidationError && error.code === code);
}

test('neutral atom graph compiles explicit atoms and exact bond orders deterministically', () => {
  const a = compileMolecule(water);
  assert.equal(a.formula, 'H2O');
  assert.equal(a.visual.texts.length, 3, 'each explicit atom receives a symbol');
  assert.equal(a.visual.paths.length, 5, 'two bonds and three atom boundaries');
  assert.deepEqual(a, compileMolecule(water));
  assert.ok(a.width > 0 && a.height > 0);

  const b = compileMolecule(oxygen);
  assert.equal(b.formula, 'O2');
  assert.equal(b.visual.paths.length, 4, 'double bond produces two distinct paths');
  assert.deepEqual(b, compileMolecule(oxygen));

  const c = compileMolecule(methane);
  assert.equal(c.formula, 'CH4');
  assert.equal(c.visual.texts.length, 5);
});

test('balanced reaction preserves stoichiometry and produces stable structural drawing', () => {
  const reaction = { reactants: [{ coefficient: 2, molecule: hydrogen }, { coefficient: 1, molecule: oxygen }], products: [{ coefficient: 2, molecule: water }] };
  const drawing = compileReaction(reaction);
  assert.equal(drawing.formula, '2H2 + O2 → 2H2O');
  assert.equal(drawing.visual.texts.filter((t) => t.text === 'H').length, 4, 'one structure per species is shown with its coefficient');
  assert.equal(drawing.visual.texts.filter((t) => t.text === 'O').length, 3);
  assert.equal(drawing.visual.texts.filter((t) => t.text === '2').length, 2, 'stoichiometric coefficients are drawn, not only recorded in formula metadata');
  assert.deepEqual(drawing, compileReaction(reaction));
});

test('unsupported chemistry and malformed structures fail closed', () => {
  rejects({ ...water, charge: 0 }, 'UNSUPPORTED_FIELD');
  rejects({ ...water, atoms: [{ id: 'o', element: 'Na' }, ...water.atoms.slice(1)] }, 'UNSUPPORTED_ELEMENT');
  rejects({ ...water, atoms: [{ id: 'o', element: 'O', isotope: 18 }, ...water.atoms.slice(1)] }, 'UNSUPPORTED_FIELD');
  rejects({ ...water, atoms: [water.atoms[0], water.atoms[0], water.atoms[2]] }, 'DUPLICATE_ATOM');
  rejects({ ...water, bonds: [{ from: 'o', to: 'ha', order: 4 }, water.bonds[1]] }, 'BOND_ORDER');
  rejects({ ...water, bonds: [{ from: 'o', to: 'ha', order: 1 }, { from: 'ha', to: 'o', order: 1 }] }, 'DUPLICATE_BOND');
  rejects({ ...water, bonds: [{ from: 'o', to: 'ha', order: 1 }, { from: 'ha', to: 'missing', order: 1 }] }, 'BOND_ENDPOINT');
  rejects({ ...water, bonds: [{ from: 'o', to: 'ha', order: 1 }, { from: 'hb', to: 'hb', order: 1 }] }, 'BOND_ENDPOINT');
  rejects({ ...water, bonds: [{ from: 'o', to: 'ha', order: 1 }, { from: 'ha', to: 'hb', order: 1 }] }, 'VALENCE');
  rejects({ atoms: [{ id: 'a', element: 'H' }, { id: 'b', element: 'H' }, { id: 'c', element: 'H' }, { id: 'd', element: 'H' }], bonds: [{ from: 'a', to: 'b', order: 1 }, { from: 'a', to: 'b', order: 1 }, { from: 'c', to: 'd', order: 1 }] }, 'DUPLICATE_BOND');
  for (const notation of ['[H]-[O](', '[H]-[O])', '[H]-[O]()', '[H]-[O](-)', '[H]-[O](-[H]', '[H]-[O](-[H])[H]']) {
    assert.throws(() => parseExplicitMolecule(notation), (error: unknown) => error instanceof ChemistryValidationError, notation);
  }
});

test('reaction rejects missing/unsupported fields, invalid coefficients and atom imbalance', () => {
  const valid = { reactants: [{ coefficient: 2, molecule: hydrogen }, { coefficient: 1, molecule: oxygen }], products: [{ coefficient: 2, molecule: water }] };
  for (const [input, code] of [
    [{ ...valid, catalyst: 'heat' }, 'UNSUPPORTED_FIELD'],
    [{ ...valid, reactants: [{ coefficient: 0, molecule: hydrogen }] }, 'COEFFICIENT'],
    [{ ...valid, products: [{ coefficient: 1, molecule: water }] }, 'UNBALANCED_REACTION'],
  ] as const) assert.throws(() => compileReaction(input), (error: unknown) => error instanceof ChemistryValidationError && error.code === code);
});

test('exact cited notation is required and its bond graph must match the drawing', () => {
  const ref = { sourceId: 's', spanId: 'p1', startChar: 0, endChar: 24, startLine: 1, endLine: 1, quote: 'Water is [H]-[O]-[H].' };
  assert.doesNotThrow(() => validateChemistryEvidence('molecule', water as never, '[H]-[O]-[H]', [ref]));
  assert.throws(() => validateChemistryEvidence('molecule', water as never, '[H]-[O]-[H]', []), /MISSING_STRUCTURAL_EVIDENCE/);
  assert.throws(() => validateChemistryEvidence('molecule', hydrogen as never, '[H]-[O]-[H]', [ref]), /STRUCTURE_MISMATCH/);
  assert.doesNotThrow(() => validateChemistryEvidence('molecule', water as never, '[H]-[O](-[H])', [{ ...ref, quote: '[H]-[O](-[H])' }]));
  const methaneNotation = '[C](-[H])(-[H])(-[H])-[H]';
  const methaneRef = { ...ref, quote: methaneNotation };
  assert.doesNotThrow(() => validateChemistryEvidence('molecule', methane as never, methaneNotation, [methaneRef]));
  const scene = (structureNotation: string, evidenceRefs = [ref]) => ({
    schemaVersion: 'claude-scene-spec/v1', sceneId: 'chemistry', title: 'Water structure', template: 'formula_focus',
    elements: [{ id: 'visual', slot: 'formula', anchor: 'sceneStart', prim: 'molecule', molecule: water, structureNotation, evidenceRefs }], edges: [],
  });
  assert.equal(safeParseSceneSpec(scene('[H]-[O]-[H]')).success, true);
  assert.equal(safeParseSceneSpec(scene('[H]-[H]', [ref])).success, false);
  assert.equal(safeParseSceneSpec(scene('[H]-[O]-[H]', [])).success, false);
  const parsed = safeParseSceneSpec(scene('[H]-[O]-[H]'));
  if (!parsed.success) return;
  const element = parsed.data.elements[0]!;
  const size = measureElement(element);
  const visual = renderPrimitive(element, { w: size.w * 2, h: size.h });
  assert.deepEqual(visual, renderPrimitive(element, { w: size.w * 2, h: size.h }));
  assert.equal(visual.texts.length, 3);
  assert.ok(visual.texts.every((run) => run.x >= size.w / 2 && run.x <= size.w * 1.5), 'aspect fit centres without stretching atom spacing');
});

test('reaction notation requires explicit balanced structures and matching coefficients', () => {
  const notation = '2[H]-[H] + [O]=[O] -> 2[H]-[O]-[H]';
  const reaction = { reactants: [{ coefficient: 2, molecule: hydrogen }, { coefficient: 1, molecule: oxygen }], products: [{ coefficient: 2, molecule: water }] };
  assert.equal(parseExplicitReaction(notation).reactants.length, 2);
  const ref = { sourceId: 's', spanId: 'p1', startChar: 0, endChar: notation.length, startLine: 1, endLine: 1, quote: notation };
  assert.doesNotThrow(() => validateChemistryEvidence('reaction', reaction as never, notation, [ref]));
  assert.throws(() => validateChemistryEvidence('reaction', { ...reaction, products: [{ coefficient: 1, molecule: water }] } as never, notation, [ref]), /UNBALANCED_REACTION/);
  assert.throws(() => parseExplicitReaction('2[H]-[H] + [O]=[O] -> [H]-[O]-[H]'), /UNBALANCED_REACTION/);
});
