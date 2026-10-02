import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateExpression, verifyEquation, verifyStep } from '../visual-v2/provenance/verify.js';
import { BoardOpSchema } from '../visual-v2/board-ops/types.js';
import { emptyBoardState } from '../visual-v2/board-state/reducer.js';
import { validateBoardOps } from '../visual-v2/board-ops/validate.js';

test('the evaluator handles arithmetic, powers, fractions and implicit multiplication, and nothing else', () => {
  assert.equal(evaluateExpression('3^2+4^2'), 25);
  assert.equal(evaluateExpression('\\frac{1}{2}+\\frac{1}{3}'), 1 / 2 + 1 / 3);
  assert.equal(evaluateExpression('2x+6', { x: 4 }), 14);
  assert.equal(evaluateExpression('-(2+3)\\cdot 4'), -20);
  assert.equal(evaluateExpression('2^{3}'), 8);
  assert.equal(evaluateExpression('x'), undefined, 'an unbound variable is not a number');
  assert.equal(evaluateExpression('2+'), undefined);
  assert.equal(evaluateExpression('alert(1)'), undefined);
});

test('a numeric equality is verified by computation and a wrong one is refuted', () => {
  assert.equal(verifyEquation('3^2+4^2=5^2').status, 'verified');
  assert.equal(verifyEquation('3^2+4^2=6^2').status, 'refuted');
  assert.equal(verifyEquation('\\frac{1}{2}+\\frac{1}{3}=\\frac{5}{6}').status, 'verified');
  assert.match(verifyEquation('3^2+4^2=6^2').detail, /25.*36/);
});

test('numeric verification uses exact arithmetic rather than rounded numbers or a tolerance', async (t) => {
  for (const equation of ['9007199254740992+1=9007199254740992', '1000000000=1000000001', '1=1.0000000001']) {
    await t.test(equation, () => {
      assert.equal(verifyEquation(equation).status, 'refuted');
      assert.equal(verifyStep('1=1', equation).status, 'refuted');
    });
  }
  assert.equal(verifyEquation('0.1+0.2=0.3').status, 'verified');
  assert.equal(verifyEquation('9007199254740992+1=9007199254740993').status, 'verified');
});

test('unsupported numeric proof stays unverifiable while the public floating evaluator keeps its existing API', () => {
  assert.equal(evaluateExpression('9^{0.5}'), 3);
  assert.equal(verifyEquation('9^{0.5}=3').status, 'unverifiable');
  assert.equal(verifyStep('1=1', '9^{0.5}=3').status, 'unverifiable');
  assert.equal(verifyEquation('0^0=1').status, 'unverifiable');
});

test('an initial single-unknown affine equation is checked algebraically; unsupported symbolic laws remain unverifiable', () => {
  assert.equal(verifyEquation('a^2+b^2=c^2').status, 'unverifiable');
  assert.equal(verifyEquation('2x+6=14').status, 'verified');
  assert.equal(verifyEquation('2x+6=14').method, 'algebra');
  assert.match(verifyEquation('2x+6=14').detail, /x = 4/);
  assert.equal(verifyEquation('x-x=0').status, 'unverifiable', 'an identity has no unique solution');
  assert.equal(verifyEquation('not an equation').status, 'unverifiable');
});

test('structural algebra rejects nonlinear expressions that look linear at three sample points', () => {
  const nonlinear = '2x+x(x-1)(x-2)=8';
  assert.equal(verifyEquation(nonlinear).status, 'unverifiable');
  assert.equal(verifyStep(nonlinear, 'x=4').status, 'unverifiable');
  assert.equal(verifyStep('x=4', nonlinear).status, 'unverifiable');
  assert.equal(verifyStep('2x=8', 'x^2=16').status, 'unverifiable');
  assert.equal(verifyStep('x/(x-1)=2', 'x=2').status, 'unverifiable');
  assert.equal(verifyStep('x=4', '0=0').status, 'unverifiable', 'a true numeric equality loses the unknown constraint');
  assert.equal(verifyEquation('2x+x^0=1').status, 'unverifiable', 'zero power can hide an undefined value at the proposed zero solution');
});

test('affine algebra supports grouped terms, constant division and a linear power without sampled proof', () => {
  assert.equal(verifyStep('3(x-2)+x=10', '4x=16').status, 'verified');
  assert.equal(verifyStep('\\frac{x+2}{2}=3', 'x=4').status, 'verified');
  assert.equal(verifyStep('2x^1=8', 'x=4').status, 'verified');
  assert.equal(verifyStep('x/0=2', 'x=2').status, 'unverifiable');
  assert.equal(verifyStep('x^(1+x)=2', 'x=1').status, 'unverifiable');
  assert.equal(verifyEquation('9'.repeat(400) + 'x=2').status, 'unverifiable', 'overflow is not valid algebra');
});

test('affine solution comparisons preserve exact decimals and integers beyond floating-point precision', () => {
  assert.equal(verifyStep('0.1x=0.3', 'x=3').status, 'verified');
  assert.equal(verifyStep('3x=1', 'x=\\frac{1}{3}').status, 'verified');
  assert.equal(verifyStep('9007199254740993x=9007199254740992', 'x=1').status, 'refuted');
  assert.equal(verifyStep('x=1', 'x=1.0000000001').status, 'refuted');
});

test('a derivation step must keep the solution of a linear equation', () => {
  assert.equal(verifyStep('2x+6=14', '2x=8').status, 'verified');
  assert.equal(verifyStep('2x=8', 'x=4').status, 'verified');
  assert.equal(verifyStep('2x=8', 'x=5').status, 'refuted');
  assert.match(verifyStep('2x=8', 'x=5').detail, /x = 4.*x = 5/);
  assert.equal(verifyStep('x^2=9', 'x=3').status, 'unverifiable', 'not linear');
  assert.equal(verifyStep('3+4=7', '7=7').status, 'verified');
});

test('board ops with a refuted illustrative equation or a derivation step that breaks the solution are pointer problems', () => {
  const add = (latex: string, provenance: string) => BoardOpSchema.parse({ op: 'add', opId: 'o1', beatId: 'b1', id: 'eq', element: { type: 'equation', latex, provenance }, at: { region: 'center' } });
  const step = (latex: string) => BoardOpSchema.parse({ op: 'equationStep', opId: 'o2', beatId: 'b2', target: 'eq', latex, rule: 'rule' });
  assert.deepEqual(validateBoardOps([add('3^2+4^2=5^2', 'illustrative'), step('9+16=25')], emptyBoardState()), []);
  const wrong = validateBoardOps([add('3^2+4^2=6^2', 'illustrative')], emptyBoardState()) as Array<{ path: string; message: string }>;
  assert.equal(wrong[0]!.path, '/ops/0/element/latex');
  assert.match(wrong[0]!.message, /illustrative example is wrong/);
  const broken = validateBoardOps([add('2x+6=14', 'illustrative'), step('2x=8'), step('x=5')], emptyBoardState()) as Array<{ path: string; message: string }>;
  assert.equal(broken.length, 1);
  assert.equal(broken[0]!.path, '/ops/2/latex');
  assert.match(broken[0]!.message, /does not follow/);
  const uncited = validateBoardOps([add('a^2+b^2=c^2', 'source')], emptyBoardState()) as Array<{ path: string; message: string }>;
  assert.equal(uncited[0]!.path, '/ops/0/element/evidence', 'a source equation is not accepted on the model\'s word');
  assert.match(uncited[0]!.message, /needs evidence/);
});

test('each operation introducing an illustrative equation requires a verified equation at its own pointer', async (t) => {
  const seed = (id: string) => BoardOpSchema.parse({ op: 'add', opId: `seed-${id}`, beatId: 'b0', id, element: { type: 'token', text: id, provenance: 'illustrative' }, at: { region: 'center' } });
  const bad = { type: 'equation', latex: 'a^2+b^2=c^2', provenance: 'illustrative' };
  const good = { type: 'equation', latex: '2x+6=14', provenance: 'illustrative' };
  const cases = [
    { op: { op: 'add', opId: 'a', beatId: 'b1', id: 'eq', element: bad, at: { region: 'center' } }, path: '/ops/2/element/latex' },
    { op: { op: 'replace', opId: 'r', beatId: 'b1', target: 'one', id: 'eq', element: bad }, path: '/ops/2/element/latex' },
    { op: { op: 'split', opId: 's', beatId: 'b1', target: 'one', into: [{ id: 'eq', element: bad, at: { region: 'left' } }, { id: 'eq2', element: good, at: { region: 'right' } }] }, path: '/ops/2/into/0/element/latex' },
    { op: { op: 'merge', opId: 'm', beatId: 'b1', targets: ['one', 'two'], into: { id: 'eq', element: bad, at: { region: 'center' } } }, path: '/ops/2/into/element/latex' },
  ];
  for (const { op, path } of cases) {
    await t.test(op.op, () => {
      const problems = validateBoardOps([seed('one'), seed('two'), BoardOpSchema.parse(op)], emptyBoardState()) as Array<{ path: string; message: string }>;
      assert.equal(problems.length, 1, op.op);
      assert.equal(problems[0]!.path, path, op.op);
      assert.match(problems[0]!.message, /could not verify/, op.op);
      const verifiedOp = JSON.parse(JSON.stringify(op).replaceAll('a^2+b^2=c^2', '2x+6=14'));
      assert.deepEqual(validateBoardOps([seed('one'), seed('two'), BoardOpSchema.parse(verifiedOp)], emptyBoardState()), [], op.op);
      const sourceOp = JSON.parse(JSON.stringify(op).replaceAll('"provenance":"illustrative"', '"provenance":"source"'));
      const sourceProblems = validateBoardOps([seed('one'), seed('two'), BoardOpSchema.parse(sourceOp)], emptyBoardState()) as Array<{ path: string; message: string }>;
      assert.ok(sourceProblems.length > 0 && sourceProblems.every((problem) => problem.path.endsWith('/evidence') && /needs evidence/.test(problem.message)), `${op.op}: source provenance needs a citation, not a computation`);
    });
  }
});

test('an illustrative equation kit uses the same verification gate as an equation element', () => {
  const addKit = (latex: string) => BoardOpSchema.parse({ op: 'add', opId: 'k', beatId: 'b1', id: 'eq', element: { type: 'kit', kit: 'equation', paramsJson: JSON.stringify({ latex }), provenance: 'illustrative' }, at: { region: 'center' } });
  const problems = validateBoardOps([addKit('x^2=9')], emptyBoardState()) as Array<{ path: string; message: string }>;
  assert.equal(problems[0]!.path, '/ops/0/element/paramsJson');
  assert.match(problems[0]!.message, /could not verify/);
  assert.deepEqual(validateBoardOps([addKit('2x=8')], emptyBoardState()), []);
});

test('unsupported non-source derivations fail and a failed equation step leaves the simulated board unchanged', () => {
  const add = (latex: string, provenance = 'illustrative') => BoardOpSchema.parse({ op: 'add', opId: 'a', beatId: 'b1', id: 'eq', element: { type: 'equation', latex, provenance }, at: { region: 'center' } });
  const step = (latex: string, opId: string) => BoardOpSchema.parse({ op: 'equationStep', opId, beatId: 'b2', target: 'eq', latex, rule: 'derive' });
  const broken = validateBoardOps([add('2x=8'), step('x=5', 's1'), step('x=4', 's2')], emptyBoardState()) as Array<{ path: string; message: string }>;
  assert.deepEqual(broken.map((problem) => problem.path), ['/ops/1/latex']);
  for (const provenance of ['illustrative', 'derived', 'metaphorical']) {
    const unsupported = validateBoardOps([add('2x=8', provenance), step('x^2=16', 's')], emptyBoardState()) as Array<{ path: string; message: string }>;
    assert.deepEqual(unsupported.map((problem) => problem.path), ['/ops/1/latex'], provenance);
    assert.match(unsupported[0]!.message, /could not verify/, provenance);
  }
  const failedAdd = validateBoardOps([add('x^2=9'), step('x=3', 's')], emptyBoardState()) as Array<{ path: string; message: string }>;
  assert.deepEqual(failedAdd.map((problem) => problem.path), ['/ops/0/element/latex'], 'ops that only fail because the failed op never drew their target are not separate problems');
});

test('transform cannot silently rewrite equation content through generic properties', () => {
  const add = BoardOpSchema.parse({ op: 'add', opId: 'a', beatId: 'b1', id: 'eq', element: { type: 'equation', latex: '2x=8', provenance: 'illustrative' }, at: { region: 'center' } });
  const transform = (key: string, value: string) => BoardOpSchema.parse({ op: 'transform', opId: 't', beatId: 'b2', target: 'eq', changes: [{ key, value }] });
  const problems = validateBoardOps([add, transform('latex', 'x=5')], emptyBoardState()) as Array<{ path: string; message: string }>;
  assert.equal(problems[0]!.path, '/ops/1/changes/0/key');
  assert.match(problems[0]!.message, /equationStep/);
  assert.deepEqual(validateBoardOps([add, transform('color', 'blue')], emptyBoardState()), []);
});
