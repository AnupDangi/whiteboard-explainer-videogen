import test from 'node:test';
import assert from 'node:assert/strict';
import { rasterizeContactSheetPng, rasterizePng, type ContactSheetSpawner } from '../export/videoEncode.js';

const TINY_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="48" viewBox="0 0 64 48"><rect width="64" height="48" fill="#fff"/><circle cx="32" cy="24" r="12" fill="#e65343"/></svg>';
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

test('contact-sheet isolation: real child process rasterizes a valid PNG', () => {
  const png = rasterizeContactSheetPng(TINY_SVG, 64);
  assert.ok(png.subarray(0, 8).equals(PNG_SIGNATURE), 'child stdout must be PNG data');
});

test('contact-sheet isolation: child pixels match the in-process rasterizer', () => {
  assert.deepEqual(rasterizeContactSheetPng(TINY_SVG, 64), rasterizePng(TINY_SVG, 64));
});

test('contact-sheet isolation: non-zero child exit becomes a catchable soft failure (parent survives)', () => {
  const failingChild: ContactSheetSpawner = () => ({
    status: 1,
    signal: null,
    stdout: undefined,
    stderr: Buffer.from('synthetic child failure'),
    error: undefined,
  }) as unknown as ReturnType<ContactSheetSpawner>;
  // A native abort in-process would kill the run before any manifest write;
  // the isolated child turns it into an ordinary Error the runLive try/catch
  // records as soft `contact-sheet-png-failed` while summary writes proceed.
  assert.throws(() => rasterizeContactSheetPng(TINY_SVG, 64, failingChild), /contact-sheet child raster failed.*exit 1/);
});

test('contact-sheet isolation: native-abort signal (e.g. SIGABRT) becomes a catchable soft failure', () => {
  const abortedChild: ContactSheetSpawner = () => ({
    status: null,
    signal: 'SIGABRT',
    stdout: undefined,
    stderr: Buffer.from(''),
    error: undefined,
  }) as unknown as ReturnType<ContactSheetSpawner>;
  assert.throws(() => rasterizeContactSheetPng(TINY_SVG, 64, abortedChild), /contact-sheet child raster failed.*SIGABRT/);
});

test('contact-sheet isolation: invalid width rejects before spawning', () => {
  let spawned = false;
  const spy: ContactSheetSpawner = (() => {
    spawned = true;
    throw new Error('must not spawn');
  }) as unknown as ContactSheetSpawner;
  assert.throws(() => rasterizeContactSheetPng(TINY_SVG, 0, spy), /positive integer/);
  assert.equal(spawned, false);
});
