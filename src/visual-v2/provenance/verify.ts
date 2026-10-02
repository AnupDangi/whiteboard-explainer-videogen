/**
 * Verification lane for illustrative examples (V2 plan Phase 8). An example the writer invents to make an idea concrete is not a
 * source fact, so it is checked by computation instead of by matching words in the source: a numeric equality is evaluated, and a
 * derivation step in one linear unknown must keep the solution. What cannot be checked is reported as unverifiable, never passed.
 */
export type Verification = { status: 'verified' | 'refuted' | 'unverifiable'; method: 'computation' | 'algebra' | 'none'; detail: string };

type Vars = Record<string, number>;

function normalizeTex(input: string): string {
  let s = input.replace(/\\left|\\right|\\,|\\;|\\!|\\ /g, '').replace(/\\cdot|\\times/g, '*').replace(/\\div/g, '/').replace(/\s+/g, '');
  // \frac{a}{b} -> ((a)/(b)); repeat for nesting.
  for (let guard = 0; guard < 8 && s.includes('\\frac'); guard++) s = s.replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, '(($1)/($2))');
  return s.replace(/\^\{([^{}]*)\}/g, '^($1)').replace(/[{}]/g, (m) => (m === '{' ? '(' : ')'));
}

type Arithmetic<T> = {
  number(value: number, literal: string): T;
  variable(name: string): T;
  add(a: T, b: T): T;
  negate(a: T): T;
  multiply(a: T, b: T): T;
  divide(a: T, b: T): T;
  power(a: T, b: T): T;
};

/** A bounded parser shared by numeric evaluation and structural algebra; it never executes expression text. */
function parseExpression<T>(tex: string, arithmetic: Arithmetic<T>): T | undefined {
  if (tex.length > 2048) return undefined;
  const s = normalizeTex(tex);
  if (/[^0-9a-zA-Z.+\-*/^()]/.test(s) || /[a-zA-Z]{2,}/.test(s)) return undefined;
  let i = 0;
  let depth = 0;
  const fail = (): never => { throw new Error('parse'); };
  const peek = (): string => s[i] ?? '';
  const nested = (parse: () => T): T => { if (++depth > 64) fail(); try { return parse(); } finally { depth--; } };
  const number = (): T => { const m = /^\d+(?:\.\d+)?/.exec(s.slice(i)); if (!m) return fail(); i += m[0].length; return arithmetic.number(Number(m[0]), m[0]); };
  const atom = (): T => {
    const c = peek();
    if (c === '(') { i++; const v = nested(sum); if (peek() !== ')') fail(); i++; return v; }
    if (/[0-9.]/.test(c)) return number();
    if (/[a-zA-Z]/.test(c)) { i++; return arithmetic.variable(c); }
    return fail();
  };
  const power = (): T => { const base = atom(); if (peek() === '^') { i++; return arithmetic.power(base, nested(unary)); } return base; };
  const unary = (): T => { if (peek() === '-') { i++; return arithmetic.negate(nested(unary)); } if (peek() === '+') { i++; return nested(unary); } return power(); };
  const product = (): T => {
    let v = unary();
    for (;;) {
      const c = peek();
      if (c === '*') { i++; v = arithmetic.multiply(v, unary()); } else if (c === '/') { i++; v = arithmetic.divide(v, unary()); }
      else if (c !== '' && c !== '+' && c !== '-' && c !== ')') v = arithmetic.multiply(v, power()); // implicit multiplication: 2x, 3(4+1), (a)(b)
      else return v;
    }
  };
  const sum = (): T => { let v = product(); for (;;) { const c = peek(); if (c === '+') { i++; v = arithmetic.add(v, product()); } else if (c === '-') { i++; v = arithmetic.add(v, arithmetic.negate(product())); } else return v; } };
  try { const value = sum(); return i === s.length ? value : undefined; } catch { return undefined; }
}

const finite = (value: number): number => { if (!Number.isFinite(value)) throw new Error('non-finite arithmetic'); return value; };

/** Recursive-descent evaluator: numbers, bound single-letter variables, + - * / ^, parentheses, implicit multiplication. */
export function evaluateExpression(tex: string, vars: Vars = {}): number | undefined {
  return parseExpression(tex, {
    number: finite,
    variable: (name) => finite(vars[name] ?? NaN),
    add: (a, b) => finite(a + b),
    negate: (a) => -a,
    multiply: (a, b) => finite(a * b),
    divide: (a, b) => finite(a / b),
    power: (a, b) => finite(a ** b),
  });
}

const sides = (tex: string): [string, string] | undefined => { const parts = tex.split('='); return parts.length === 2 && parts[0]!.trim() && parts[1]!.trim() ? [parts[0]!, parts[1]!] : undefined; };
const letters = (tex: string): string[] => [...new Set(normalizeTex(tex).match(/[a-zA-Z]/g) ?? [])];

export function verifyEquation(tex: string): Verification {
  const parts = sides(tex);
  if (!parts) return { status: 'unverifiable', method: 'none', detail: 'not a single equation' };
  if (letters(tex).length > 0) {
    const solution = linearSolution(tex);
    return solution ? { status: 'verified', method: 'algebra', detail: `single-unknown affine equation; ${solution.variable} = ${rationalText(solution.value)}` } : { status: 'unverifiable', method: 'none', detail: 'not a supported single-unknown affine equation' };
  }
  const left = affineExpression(parts[0], '')?.constant;
  const right = affineExpression(parts[1], '')?.constant;
  if (!left || !right) return { status: 'unverifiable', method: 'none', detail: 'could not evaluate both sides with bounded exact arithmetic' };
  return rationalEqual(left, right) ? { status: 'verified', method: 'computation', detail: `${rationalText(left)} = ${rationalText(right)}` } : { status: 'refuted', method: 'computation', detail: `left side is ${rationalText(left)} but right side is ${rationalText(right)}` };
}

type Rational = { numerator: bigint; denominator: bigint };
const unsupportedAffine = (): never => { throw new Error('unsupported affine arithmetic'); };

/** Exact decimal/fraction arithmetic, bounded to 512 bits per numerator/denominator and integer powers up to 32. */
function rational(numerator: bigint, denominator = 1n): Rational {
  if (denominator === 0n || numerator.toString(2).length > 512 || denominator.toString(2).length > 512) return unsupportedAffine();
  if (denominator < 0n) { numerator = -numerator; denominator = -denominator; }
  let a = numerator < 0n ? -numerator : numerator;
  let b = denominator;
  while (b !== 0n) { const remainder = a % b; a = b; b = remainder; }
  return { numerator: numerator / a, denominator: denominator / a };
}
const ZERO = rational(0n);
const ONE = rational(1n);
const rationalText = (value: Rational): string => value.denominator === 1n ? String(value.numerator) : `${value.numerator}/${value.denominator}`;
const rationalAdd = (a: Rational, b: Rational): Rational => rational(a.numerator * b.denominator + b.numerator * a.denominator, a.denominator * b.denominator);
const rationalNegate = (a: Rational): Rational => rational(-a.numerator, a.denominator);
const rationalMultiply = (a: Rational, b: Rational): Rational => rational(a.numerator * b.numerator, a.denominator * b.denominator);
const rationalDivide = (a: Rational, b: Rational): Rational => rational(a.numerator * b.denominator, a.denominator * b.numerator);
const rationalEqual = (a: Rational, b: Rational): boolean => a.numerator === b.numerator && a.denominator === b.denominator;

function rationalLiteral(literal: string): Rational {
  if (literal.length > 155) return unsupportedAffine();
  const [integer, decimal = ''] = literal.split('.');
  return rational(BigInt(`${integer}${decimal}`), 10n ** BigInt(decimal.length));
}

type Affine = { constant: Rational; coefficient: Rational };
const affine = (constant: Rational, coefficient = ZERO): Affine => ({ constant, coefficient });

/** Reduce syntax to a*x+b. Variable products, variable divisors and nonlinear powers are unsupported, even if samples agree. */
function affineExpression(tex: string, variable: string): Affine | undefined {
  return parseExpression(tex, {
    number: (_, literal) => affine(rationalLiteral(literal)),
    variable: (name) => name === variable ? affine(ZERO, ONE) : unsupportedAffine(),
    add: (a, b) => affine(rationalAdd(a.constant, b.constant), rationalAdd(a.coefficient, b.coefficient)),
    negate: (a) => affine(rationalNegate(a.constant), rationalNegate(a.coefficient)),
    multiply: (a, b) => a.coefficient.numerator !== 0n && b.coefficient.numerator !== 0n ? unsupportedAffine() : affine(rationalMultiply(a.constant, b.constant), rationalAdd(rationalMultiply(a.coefficient, b.constant), rationalMultiply(a.constant, b.coefficient))),
    divide: (a, b) => b.coefficient.numerator !== 0n || b.constant.numerator === 0n ? unsupportedAffine() : affine(rationalDivide(a.constant, b.constant), rationalDivide(a.coefficient, b.constant)),
    power: (a, b) => {
      if (b.coefficient.numerator !== 0n || b.constant.denominator !== 1n || b.constant.numerator < -32n || b.constant.numerator > 32n) return unsupportedAffine();
      const exponent = b.constant.numerator;
      // Only the first power preserves a variable's domain, including at a zero solution.
      if (a.coefficient.numerator !== 0n) return exponent === 1n ? a : unsupportedAffine();
      if (a.constant.numerator === 0n && exponent <= 0n) return unsupportedAffine();
      const base = exponent < 0n ? rationalDivide(ONE, a.constant) : a.constant;
      const absoluteExponent = exponent < 0n ? -exponent : exponent;
      return affine(rational(base.numerator ** absoluteExponent, base.denominator ** absoluteExponent));
    },
  });
}

/** The unknown and its unique solution only when both sides structurally reduce to affine expressions. */
function linearSolution(tex: string): { variable: string; value: Rational } | undefined {
  const parts = sides(tex);
  if (!parts) return undefined;
  const vars = letters(tex);
  if (vars.length !== 1) return undefined;
  const v = vars[0]!;
  const left = affineExpression(parts[0], v);
  const right = affineExpression(parts[1], v);
  if (!left || !right) return undefined;
  try {
    const coefficient = rationalAdd(left.coefficient, rationalNegate(right.coefficient));
    if (coefficient.numerator === 0n) return undefined;
    const value = rationalDivide(rationalAdd(right.constant, rationalNegate(left.constant)), coefficient);
    return { variable: v, value };
  } catch { return undefined; }
}

/** Does `next` follow from `previous`? Linear single-unknown equations must keep their solution; numeric equalities must stay true. */
export function verifyStep(previous: string, next: string): Verification {
  const a = linearSolution(previous);
  const b = linearSolution(next);
  if (a && b) return a.variable === b.variable && rationalEqual(a.value, b.value) ? { status: 'verified', method: 'algebra', detail: `${a.variable} = ${rationalText(a.value)} is kept` } : { status: 'refuted', method: 'algebra', detail: `${previous} gives ${a.variable} = ${rationalText(a.value)} but ${next} gives ${b.variable} = ${rationalText(b.value)}` };
  const x = verifyEquation(previous);
  const y = verifyEquation(next);
  if (x.method === 'computation' && y.method === 'computation') {
    if (x.status === 'verified' && y.status === 'verified') return { status: 'verified', method: 'computation', detail: 'both sides of both lines compute equal' };
    if (x.status === 'verified' && y.status === 'refuted') return { status: 'refuted', method: 'computation', detail: `${next} is false: ${y.detail}` };
  }
  return { status: 'unverifiable', method: 'none', detail: 'neither line is a single-unknown linear equation or a numeric equality' };
}
