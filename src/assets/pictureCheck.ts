import type { SceneSpec, StageFailure } from '../shared/types.js';
import { resolveScene } from './resolveScene.js';
import { layoutScene } from '../layout/solver.js';
import { compileTimelineFull } from '../timeline/compile.js';
import { renderSVG } from '../render/renderScene.js';
import { rasterizePng } from '../export/videoEncode.js';
import { chatVision } from '../llm/openrouter.js';
import { emptyUsage, type CallUsage } from '../llm/structuredCall.js';

/**
 * Visual verification of picture choices (Simi benchmark §6: a wrong icon is worse than no icon). The text judge sees only
 * names; this check draws the chosen pictures exactly as the board will (same resolver, layout and renderer) with their
 * labels, and asks a vision model whether each picture is a recognisable depiction of its label. Rejecting is always safe:
 * the referent falls back to a labelled box. A failed or unparseable call approves nothing it could not check — it keeps
 * the text judge's verdict and records a soft failure.
 */
export interface PictureToCheck { referent: string; label: string; entryId: string }

const plainWord = (value: string): string => value.toLowerCase().replace(/[^a-z0-9 -]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 48) || 'item';

/** One image: each picture with a numbered label, laid out by the normal layout engine. */
export function renderPictureSheet(pictures: ReadonlyArray<PictureToCheck>, width = 1280): Buffer {
  const items = pictures.slice(0, 9);
  const spec = {
    schemaVersion: 'claude-scene-spec/v1', sceneId: 'picture-check', title: 'Picture check', template: 'list_icon',
    elements: items.map((item, index) => ({ id: `p${index + 1}`, slot: 'item', anchor: 'sceneStart', prim: 'object', concept: plainWord(item.referent), label: `${index + 1} ${item.label}`.slice(0, 40) })),
    edges: [],
  } as unknown as SceneSpec;
  const validated = new Map(items.map((item) => [plainWord(item.referent), item.entryId] as const));
  const laid = layoutScene(resolveScene(spec, { validated }));
  const timeline = compileTimelineFull(laid, [], 0, 10_000);
  return rasterizePng(renderSVG(laid, timeline, 9_999), width);
}

export function parseVerdicts(content: string, count: number): Map<number, boolean> | undefined {
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) return undefined;
  try {
    const value = JSON.parse(match[0]) as { verdicts?: Array<{ n?: number; keep?: boolean }> };
    if (!Array.isArray(value.verdicts)) return undefined;
    const out = new Map<number, boolean>();
    for (const verdict of value.verdicts) if (Number.isInteger(verdict.n) && verdict.n! >= 1 && verdict.n! <= count && typeof verdict.keep === 'boolean') out.set(verdict.n!, verdict.keep);
    return out;
  } catch { return undefined; }
}

export async function checkPicturesVisually(args: {
  pictures: ReadonlyArray<PictureToCheck>;
  model: string;
  apiKey: string;
  fetcher?: typeof fetch;
  /** Injected in tests. */
  render?: typeof renderPictureSheet;
  chat?: typeof chatVision;
}): Promise<{ rejected: Set<string>; usage: CallUsage; failures: StageFailure[] }> {
  const usage = emptyUsage();
  const rejected = new Set<string>();
  const failures: StageFailure[] = [];
  const pictures = args.pictures.slice(0, 9);
  if (!pictures.length) return { rejected, usage, failures };
  try {
    const png = (args.render ?? renderPictureSheet)(pictures);
    const prompt = `You check picture choices for a whiteboard explainer. The image shows ${pictures.length} small pictures, each with a number and a label under it. For every number decide: keep=true only if the picture is a recognisable, standard way to illustrate the label's meaning (the thing itself, or a well-known symbol for it); keep=false if it shows something else, is decorative, ambiguous, or would mislead a learner. A labelled box is the fallback, so reject when unsure. Return JSON only: {"verdicts":[{"n":1,"keep":true}]} with one entry per number.`;
    const result = await (args.chat ?? chatVision)(args.apiKey, { model: args.model, prompt, imagesPng: [png], maxTokens: 600 }, args.fetcher);
    usage.calls += 1; usage.promptTokens += result.usage.promptTokens; usage.completionTokens += result.usage.completionTokens; usage.cachedTokens += result.usage.cachedTokens; usage.costUsd += result.usage.costUsd;
    const verdicts = parseVerdicts(result.content, pictures.length);
    if (!verdicts) { failures.push({ code: 'picture-check-unparseable', stage: 'discovery', message: 'vision picture check returned no usable verdicts; the text judge verdict stands', hard: false }); return { rejected, usage, failures }; }
    pictures.forEach((picture, index) => { if (verdicts.get(index + 1) === false) rejected.add(picture.referent); });
  } catch (error) {
    failures.push({ code: 'picture-check-failed', stage: 'discovery', message: `vision picture check skipped: ${error instanceof Error ? error.message : String(error)}`, hard: false });
  }
  return { rejected, usage, failures };
}
