import test from 'node:test';
import assert from 'node:assert/strict';
import { validateIconCandidates, pickIsCorroborated } from '../assets/iconValidation.js';

const item = (concept: string, candidates: Array<{ id: string; name: string; score?: number }>) => ({ concept, context: concept, candidates });

test('a pick is corroborated by a shared word or a strong retrieval score, otherwise dropped', () => {
  assert.equal(pickIsCorroborated(item('first interval', [{ id: 'a', name: 'interval timer', score: 0.4 }]), 'a'), true);
  assert.equal(pickIsCorroborated(item('first interval', [{ id: 'a', name: 'smartphone', score: 0.4 }]), 'a'), false);
  assert.equal(pickIsCorroborated(item('first interval', [{ id: 'a', name: 'smartphone', score: 0.7 }]), 'a'), true);
});

test('model picks are filtered: unrelated icons dropped and one icon never serves two referents', async () => {
  const items = [item('first interval', [{ id: 'phone', name: 'smartphone', score: 0.4 }]), item('half remains', [{ id: 'phone', name: 'smartphone', score: 0.4 }]), item('time clock', [{ id: 'clock', name: 'clock', score: 0.4 }]), item('clock time', [{ id: 'clock', name: 'clock', score: 0.4 }])];
  const body = JSON.stringify({ choices: [{ concept: 'first interval', pick: 'phone' }, { concept: 'half remains', pick: 'phone' }, { concept: 'time clock', pick: 'clock' }, { concept: 'clock time', pick: 'clock' }] });
  const fetcher: typeof fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: body }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, cost: 0 } }), { status: 200, headers: { 'content-type': 'application/json' } });
  const result = await validateIconCandidates({ items, model: 'test/model', apiKey: 'k', remainingBudgetUsd: 1, fetcher });
  assert.deepEqual([...result.picks.entries()], [['time clock', 'clock']]);
});
