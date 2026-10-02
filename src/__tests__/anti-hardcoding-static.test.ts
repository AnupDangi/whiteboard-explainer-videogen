import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

// final_plan/04 §8: benchmark topics may live only in fixtures, benchmark data, docs and explicit examples.
const BANNED = /osmosis|thermostat|vaccination|half[-_ ]?life|spaced[-_ ]repetition/i;
const ALLOWED_DIRS = ['__tests__', 'fixtures', 'fewshots'];
const ROOT = resolve('src');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return ALLOWED_DIRS.includes(name) || name === 'data' || name === 'reference' || name === 'reports' ? [] : sourceFiles(path);
    return /\.(ts|mjs)$/.test(name) ? [path] : [];
  });
}

test('no benchmark topic name appears in production TypeScript outside fixtures, tests and few-shot data', () => {
  const offenders = sourceFiles(ROOT).filter((file) => BANNED.test(readFileSync(file, 'utf8'))).map((file) => relative(ROOT, file));
  assert.deepEqual(offenders, []);
});

// liveCli.ts is the developer CLI that selects NAMED FIXTURE cases (labelled fixtures, never counted as generated
// lessons, see CLAUDE.md); it dispatches on the case the user typed and contains no lesson logic.
const CASE_SELECTOR_CLIS = new Set(['run/liveCli.ts']);

test('production code has no conditional on a run, scene or case id literal', () => {
  const pattern = /(?:sceneId|caseId|runId|lessonId)\s*===?\s*['"`][^'"`]+['"`]/;
  const offenders = sourceFiles(ROOT).filter((file) => pattern.test(readFileSync(file, 'utf8'))).map((file) => relative(ROOT, file)).filter((file) => !CASE_SELECTOR_CLIS.has(file));
  assert.deepEqual(offenders, []);
});
