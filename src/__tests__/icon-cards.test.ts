import test from 'node:test';
import assert from 'node:assert/strict';
import type { CatalogEntry } from '../assets/catalog.js';
import { EMPTY_BADGE_REVIEW, badgeReviewFrom } from '../assets/badgeReview.js';
import { BoardOpSchema } from '../visual-v2/board-ops/types.js';
import { emptyBoardState } from '../visual-v2/board-state/reducer.js';
import { compileSceneTimeline, type BeatTiming } from '../visual-v2/timeline/compile.js';
import { compileScene, renderSceneSvg, type CompiledScene } from '../visual-v2/renderer/frame.js';
import { BADGE_MIN_SIDE_PX, iconCard, iconCardSide } from '../visual-v2/renderer/visuals.js';
import { badgeRightsEvidence } from '../pipeline-v2/badgeProvenance.js';

// Synthetic contract fixture only; never a quality or visual measurement.
const D = 'simi-house-v1/domain-outline';
const entry = (id: string, name: string): CatalogEntry => ({
  id, names: [name], tags: [], meaning: '', source: 'assetlab-sketchy-downshift:x', license: 'MIT', lane: 'simple-symbol', strokePaths: 1, houseFamily: D,
  render: (size) => ({ paths: [{ d: `M0 0 L${size.w} ${size.h}`, length: Math.hypot(size.w, size.h) }], fills: [], texts: [] }),
});
const catalog = [entry('dom-flask', 'flask'), entry('dom-beaker', 'beaker'), entry('dom-funnel', 'funnel')];
const approved = badgeReviewFrom(['dom-flask|flask', 'dom-beaker|beaker', 'dom-funnel|funnel'].map((key) => ({ assetId: key.split('|')[0]!, referent: key.split('|')[1]!, verdict: 'accept' as const, reviewer: 'test', date: '2026-10-09' })));
const badge = { draw: (side: number) => ({ paths: [{ d: `M0 0 L${side} ${side}`, length: side }], fills: [], texts: [] }) };

test('a card with room draws the icon left of the label', () => {
  const rect = { x: 100, y: 100, w: 360, h: 110 };
  const visual = iconCard(rect, 'flask', '#fff', badge);
  assert.equal(visual.paths.length, 2, 'box + icon');
  assert.ok(visual.texts[0]!.x > rect.x + rect.w / 2, 'label shifts right of centre');
});

test('a card too short for a 56 px icon stays a plain labelled box', () => {
  assert.equal(BADGE_MIN_SIDE_PX, 56);
  const rect = { x: 100, y: 100, w: 360, h: 60 };
  const visual = iconCard(rect, 'flask', '#fff', badge);
  assert.equal(visual.paths.length, 1);
  assert.equal(visual.texts[0]!.x, rect.x + rect.w / 2);
});

test('a label that would stop fitting next to the icon keeps the plain box', () => {
  const visual = iconCard({ x: 0, y: 0, w: 200, h: 110 }, 'extraordinarily unbreakable labelword', '#fff', badge);
  assert.equal(visual.paths.length, 1);
});

const add = (id: string, element: unknown, at: unknown, beat: string) => BoardOpSchema.parse({ op: 'add', opId: `${beat}.${id}`, beatId: beat, id, element, at });
const tok = (text: string) => ({ type: 'token', text, provenance: 'illustrative' });
// Free-standing tokens (>= 212 x 130 px) so a 56 px icon and the label fit; ring-slot tokens are 192 x 192 and too narrow for both.
const ops = [
  add('t1', tok('flask'), { region: 'left' }, 'b1'),
  add('t2', tok('beaker'), { region: 'center' }, 'b2'),
  add('t3', tok('funnel'), { region: 'right' }, 'b3'),
];
const beats: BeatTiming[] = ops.map((op, i) => ({ beatId: op.beatId, startMs: i * 3000, endMs: i * 3000 + 2800, sentences: [{ startMs: i * 3000, endMs: i * 3000 + 2800 }] }));
const timeline = compileSceneTimeline({ ops, initial: emptyBoardState(), beats });

test('labels composition is unchanged; icon-cards plans one badge per process step', () => {
  const plain = compileScene('s1', 'Lab glassware', timeline, 'lesson');
  assert.equal(plain.badges, undefined);
  const rich = compileScene('s1', 'Lab glassware', timeline, 'lesson', undefined, undefined, { composition: 'icon-cards', catalog, review: approved });
  assert.deepEqual([...rich.badges!.keys()], ['t1', 't2', 't3']);
  assert.equal(rich.badgeFamily, D);
  assert.notEqual(renderSceneSvg(rich, timeline.durationMs), renderSceneSvg(plain, timeline.durationMs));
});

test('the context icon appears beside the title only after the title wipe', () => {
  const rich = compileScene('s1', 'Lab glassware', timeline, 'lesson', undefined, undefined, { composition: 'icon-cards', catalog, review: approved });
  assert.equal(renderSceneSvg(rich, 0).includes('data-role="context-icon"'), false);
  assert.equal(renderSceneSvg(rich, 800).includes('data-role="context-icon"'), true);
});

test('every drawn badge asset gets one rights evidence record with its licence', () => {
  const rich = compileScene('s1', 'Lab glassware', timeline, 'lesson', undefined, undefined, { composition: 'icon-cards', catalog, review: approved });
  const evidence = badgeRightsEvidence([rich, rich] as CompiledScene[], new Map(catalog.map((e) => [e.id, e])), []);
  assert.deepEqual(evidence.map((item) => item.assetId).sort(), ['dom-beaker', 'dom-flask', 'dom-funnel']);
  assert.ok(evidence.every((item) => item.license.identifier === 'MIT'));
});

test('an unreviewed badge is never drawn: no card icon and no context icon', () => {
  const plain = compileScene('s1', 'Lab glassware', timeline, 'lesson');
  const rich = compileScene('s1', 'Lab glassware', timeline, 'lesson', undefined, undefined, { composition: 'icon-cards', catalog, review: EMPTY_BADGE_REVIEW });
  assert.equal(rich.badges, undefined);
  assert.equal(rich.badgeFamily, undefined);
  assert.deepEqual((rich.pendingBadges ?? []).map((badge) => badge.referent).sort(), ['beaker', 'flask', 'funnel'], 'unreviewed matches are listed for review, not drawn');
  assert.equal(renderSceneSvg(rich, timeline.durationMs), renderSceneSvg(plain, timeline.durationMs));
  assert.equal(renderSceneSvg(rich, 2000).includes('data-role="context-icon"'), false);
});

test('a badge whose card cannot hold a 56 px icon is not planned, so no context icon either', () => {
  const rich = compileScene('s1', 'Lab glassware', timeline, 'lesson', undefined, undefined, { composition: 'icon-cards', catalog, review: approved });
  for (const [id] of rich.badges ?? []) assert.ok(['t1', 't2', 't3'].includes(id));
  const none = compileScene('s1', 'Lab glassware', timeline, 'lesson', undefined, undefined, { composition: 'icon-cards', catalog: [], review: approved });
  assert.equal(none.badges, undefined);
});

test('a token that names a process concept of the lesson gets no badge', () => {
  const concepts = new Map([['c1', { id: 'c1', label: 'Flask', kind: 'process' as const }]]);
  const rich = compileScene('s1', 'Lab glassware', timeline, 'lesson', concepts, undefined, { composition: 'icon-cards', catalog, review: approved });
  assert.equal(rich.badges?.has('t1') ?? false, false);
});

test('the icon steps down toward 56 px so a short label next to it still fits', () => {
  const side = iconCardSide({ x: 0, y: 0, w: 250, h: 130 }, 'beaker');
  assert.ok(side !== null && side >= BADGE_MIN_SIDE_PX && side <= 100, String(side));
  assert.equal(iconCardSide({ x: 0, y: 0, w: 120, h: 130 }, 'beaker'), null);
});
