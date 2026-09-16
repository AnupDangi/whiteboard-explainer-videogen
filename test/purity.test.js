import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join, relative} from 'node:path';

/** X1 — the compiler/renderer purity rule is documented as convention only.
 *  This test turns it into an enforced invariant by scanning SOURCE TEXT (no
 *  build, no dist) so a violation fails with the offending file:line. */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIRS = ['src/semantic/compiler', 'src/semantic/renderer'].map(d => join(ROOT, d));

const tsFiles = (dir) => readdirSync(dir, {withFileTypes: true}).flatMap(entry =>
  entry.isDirectory() ? tsFiles(join(dir, entry.name))
    : entry.name.endsWith('.ts') ? [join(dir, entry.name)] : []);

const allFiles = () => DIRS.flatMap(tsFiles);
const label = (file) => relative(ROOT, file);
const linesOf = (file) => readFileSync(file, 'utf8').split('\n');
// Comment-only lines are documentation, not executed code; skip them so a
// purity rule stated in a comment does not read as its own violation.
const isCommentOnly = (line) => /^\s*(\/\/|\/\*|\*|\*\/)/.test(line);

const IMPURE_IMPORTS = ['model-adapter', 'assets/external/', 'node:fs', 'node:child_process', 'node:http', 'node:https', '../jobs', '../../explainer/'];
const IMPURE_TOKENS = ['Date.now(', 'new Date(', 'Math.random(', 'performance.now(', 'process.env'];

test('compiler/renderer sources do not import impure modules', () => {
  const violations = [];
  for (const file of allFiles()) {
    linesOf(file).forEach((line, i) => {
      if (isCommentOnly(line)) return;
      if (!/\bimport\b|\bfrom\b/.test(line)) return;
      for (const spec of IMPURE_IMPORTS) {
        if (line.includes(spec)) violations.push(`${label(file)}:${i + 1}: imports "${spec}" — ${line.trim()}`);
      }
    });
  }
  assert.deepEqual(violations, [], `compiler/renderer imported an impure module:\n${violations.join('\n')}`);
});

test('compiler/renderer sources contain no clock, random or env access', () => {
  const violations = [];
  for (const file of allFiles()) {
    linesOf(file).forEach((line, i) => {
      if (isCommentOnly(line)) return;
      for (const token of IMPURE_TOKENS) {
        if (line.includes(token)) violations.push(`${label(file)}:${i + 1}: uses "${token}" — ${line.trim()}`);
      }
    });
  }
  assert.deepEqual(violations, [], `compiler/renderer reached outside its pure inputs:\n${violations.join('\n')}`);
});

test('the SVG renderer stays synchronous (no await/async)', () => {
  const file = join(ROOT, 'src/semantic/renderer/render-svg.ts');
  const violations = [];
  linesOf(file).forEach((line, i) => {
    if (isCommentOnly(line)) return;
    if (/\b(await|async)\b/.test(line)) violations.push(`${label(file)}:${i + 1}: ${line.trim()}`);
  });
  assert.deepEqual(violations, [], `render-svg.ts must stay synchronous and pure:\n${violations.join('\n')}`);
});
