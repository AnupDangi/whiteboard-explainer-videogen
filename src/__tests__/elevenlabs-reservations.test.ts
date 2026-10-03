import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ElevenKeyPool, type FetchLike } from '../audio/elevenlabs.js';
import { FileReservationStore } from '../audio/reservations.js';

const reply = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
const balance = (limit: number): FetchLike => async () => reply(200, { character_count: 0, character_limit: limit });

test('two processes sharing a reservation file cannot jointly reserve more credits than a key has', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'el-res-'));
  try {
    const file = path.join(dir, 'reservations.json');
    const processA = new ElevenKeyPool(['key-a'], balance(100), new FileReservationStore(file));
    const processB = new ElevenKeyPool(['key-a'], balance(100), new FileReservationStore(file));
    const held = await processA.reserve(60);
    await assert.rejects(processB.reserve(60), /no ElevenLabs key/, 'the other process sees the hold');
    const smaller = await processB.reserve(30);
    smaller.cancel(); await processB.idle();
    held.settle(55); await processA.idle();
    const afterSettle = await processB.reserve(40);
    afterSettle.cancel(); await processB.idle();
    assert.ok(!(await readFile(file, 'utf8')).includes('key-a'), 'the file never contains an API key');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a reservation from a dead process or past its expiry is released, so a crash cannot strand credits', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'el-res-stale-'));
  try {
    const file = path.join(dir, 'reservations.json');
    const store = new FileReservationStore(file, { ttlMs: 60_000 });
    const keyId = FileReservationStore.keyId('key-a');
    await writeFile(file, JSON.stringify({ schemaVersion: 'elevenlabs-reservations/v1', holds: [
      { id: 'dead', keyId, credits: 90, pid: 2 ** 22 + 12345, expiresAt: Date.now() + 60_000 },
      { id: 'expired', keyId, credits: 90, pid: process.pid, expiresAt: Date.now() - 1 },
    ] }));
    const pool = new ElevenKeyPool(['key-a'], balance(100), store);
    const hold = await pool.reserve(100);
    hold.cancel(); await pool.idle();
    assert.equal(await store.reserved(keyId), 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('concurrent reservations in one process stay atomic through the shared file, and cancel releases the hold', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'el-res-race-'));
  try {
    const file = path.join(dir, 'reservations.json');
    const pools = [0, 1, 2, 3].map(() => new ElevenKeyPool(['key-a'], balance(100), new FileReservationStore(file)));
    const outcomes = await Promise.allSettled(pools.map((pool) => pool.reserve(40)));
    assert.equal(outcomes.filter((o) => o.status === 'fulfilled').length, 2, '100 credits fit two holds of 40, never three');
    for (const outcome of outcomes) if (outcome.status === 'fulfilled') outcome.value.cancel();
    await Promise.all(pools.map((pool) => pool.idle()));
    assert.equal(await new FileReservationStore(file).reserved(FileReservationStore.keyId('key-a')), 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
