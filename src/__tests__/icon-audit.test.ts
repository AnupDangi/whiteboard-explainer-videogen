import test from 'node:test';
import assert from 'node:assert/strict';
import { auditResolvedScenes } from '../harness/iconAudit.js';
import { scoreSimiRubric } from '../harness/simiRubric.js';
import type { CatalogEntry } from '../assets/catalog.js';

const G = 'simi-house-v1/general-drawon';
const D = 'simi-house-v1/domain-outline';
const entry = (id: string, name: string): CatalogEntry => ({ id, names: [name], tags: [], meaning: '', source: 's', license: 'manual', lane: 'simple-symbol', strokePaths: 1, render: () => ({ paths: [], fills: [], texts: [] }) });
const el = (id: string, concept: string, strategy: string, extra: Record<string, unknown> = {}) => ({ element: { id, prim: 'object', concept, label: concept }, resolution: { strategy, assetId: extra.assetId ?? null, selectionBasis: extra.selectionBasis, houseFamily: extra.houseFamily }, });
const scene = (sceneId: string, elements: unknown[]) => ({ sceneId, elements, edges: [], carryOver: [] }) as never;

test('audit classifies representations and flags role-for-literal, unrelated validated icons and mixed families', () => {
  const catalog = [entry('lamp-1', 'lamp'), entry('cell-1', 'cell')];
  const audit = auditResolvedScenes([
    scene('s1', [el('a', 'lamp', 'R3-house-literal', { assetId: 'lamp-1', houseFamily: G }), el('b', 'lamp', 'R2-semantic-core'), el('c', 'quarterly synergy', 'R10-labelled-primitive'), el('d', 'red thing', 'R4-curated-flaticon', { assetId: 'cell-1', selectionBasis: 'curated', houseFamily: D })]),
  ], catalog);
  assert.equal(audit.summary.objectElements, 4);
  assert.equal(audit.summary.pictorialShare, 0.5);
  assert.equal(audit.summary.roleShare, 0.25);
  assert.equal(audit.summary.labelledShare, 0.25);
  const reasons = audit.summary.wrongBindingSuspects.map((suspect) => suspect.reason).join(' | ');
  assert.match(reasons, /role glyph used although "lamp" has an exact literal/);
  assert.match(reasons, /shares no word with "red thing"/);
  assert.match(reasons, /mixes families/);
});

test('rubric scores a rich board higher than a label-only board and labels the mute test a proxy', () => {
  const rich = auditResolvedScenes([scene('s', [el('a', 'lamp', 'R3-house-literal', { assetId: 'lamp-1', houseFamily: G }), el('b', 'gate', 'R5-approved-metaphor')])], [entry('lamp-1', 'lamp')]);
  const poor = auditResolvedScenes([scene('s', [el('a', 'x', 'R10-labelled-primitive'), el('b', 'y', 'R10-labelled-primitive')])], []);
  const timeline = { sceneId: 's', sceneStartMs: 0, sceneEndMs: 10_000, events: [{ elementId: 'a', track: 'object', t0: 1000, t1: 2000 }, { elementId: 'b', track: 'object', t0: 6000, t1: 7000 }] } as never;
  const laidOut = { sceneId: 's', elements: [], edges: [{ from: 'a', to: 'b', points: [] }], carryOver: [] } as never;
  const good = scoreSimiRubric({ scenes: [{ laidOut, timeline }], audit: rich, metrics: { majorClaimVisualCoverage: 1, relationCoverage: 1 } });
  const bad = scoreSimiRubric({ scenes: [{ laidOut, timeline }], audit: poor, metrics: { majorClaimVisualCoverage: 1, relationCoverage: 1 } });
  assert.ok(good.total > bad.total);
  assert.match(good.items.find((item) => item.key === 'mute-test-proxy')!.basis, /proxy/);
  assert.equal(good.items.find((item) => item.key === 'progressive-reveal')!.score, 2);
});

test('audit counts labelled boxes as concept nodes, so a board of boxes plus one picture is not scored as mostly pictorial', () => {
  const box = (id: string) => ({ element: { id, prim: 'box', text: id, conceptIds: [`c_${id}`] }, resolution: undefined });
  const audit = auditResolvedScenes([scene('s', [el('a', 'lamp', 'R3-house-literal', { assetId: 'lamp-1', houseFamily: G }), box('x'), box('y'), box('z')])], [entry('lamp-1', 'lamp')]);
  assert.equal(audit.summary.pictorialShare, 1, 'object-only share is unchanged');
  assert.equal(audit.summary.conceptNodes, 4);
  assert.equal(audit.summary.pictureShareOfConceptNodes, 0.25);
  assert.equal(audit.summary.distinctPictures, 1);
});

test('spatial stability is not scored perfect when concepts recur in the next scene but were redrawn elsewhere', () => {
  const laid = (sceneId: string, x: number) => ({ sceneId, elements: [{ id: 'a', element: { id: 'a', prim: 'box', conceptIds: ['c1'] }, bbox: { x, y: 100, w: 100, h: 100 }, intrinsicSize: { w: 100, h: 100 } }], edges: [], carryOver: [] }) as never;
  const timeline = (sceneId: string) => ({ sceneId, sceneStartMs: 0, sceneEndMs: 10_000, events: [] }) as never;
  const audit = auditResolvedScenes([], []);
  const stay = scoreSimiRubric({ scenes: [{ laidOut: laid('s1', 100), timeline: timeline('s1') }, { laidOut: laid('s2', 100), timeline: timeline('s2') }], audit, metrics: {} });
  const jump = scoreSimiRubric({ scenes: [{ laidOut: laid('s1', 100), timeline: timeline('s1') }, { laidOut: laid('s2', 900), timeline: timeline('s2') }], audit, metrics: {} });
  assert.equal(stay.items.find((item) => item.key === 'spatial-stability')!.score, 2);
  assert.equal(jump.items.find((item) => item.key === 'spatial-stability')!.score, 0);
});
