/** Demo: narrated whiteboard-explainer videos from ANY source — paper URL, local PDF,
 *  pasted text, or a bare prompt. The internal prompt-builder enriches the source into
 *  an optimized rich visual brief, so the caller only supplies the source itself.
 *  Usage:
 *    node dist/scripts/generate-video.js --url https://arxiv.org/pdf/1706.03762 --minutes 1
 *    node dist/scripts/generate-video.js --pdf ./paper.pdf --minutes 1 --model qwen/qwen3.8-flash
 *    node dist/scripts/generate-video.js --prompt "Explain ..." --minutes 1,5
 *  Kokoro local neural narration is the demo default — no speech key needed, and the
 *  persistent server auto-starts itself if it isn't already running (run
 *  scripts/setup-kokoro.sh once first). Each (source, minutes) pair is generated
 *  sequentially, then exported to MP4 under --out-dir. Requires OPENROUTER_API_KEY.
 *  Pass --tts elevenlabs for natural voice (needs ELEVENLABS_API_KEY +
 *  ELEVENLABS_VOICE_ID). */
import {JobStore} from '../src/jobs.js';
import {ingestSource} from '../src/sources.js';
import {detectFigures,describeFigures} from '../src/figures.js';
import {buildRichBrief,briefStats} from '../src/prompt-builder.js';
import {resolve,join} from 'node:path';
import {mkdir,readFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import type {GenerationOptions,SourceInput,SourceFigure} from '../src/types.js';

const args = process.argv.slice(2);
const arg = (name: string, fallback: string | null) => { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1]; };
const flag = (name: string) => args.includes(name);

const DEFAULT_URL = 'https://arxiv.org/pdf/1706.03762'; // "Attention Is All You Need"
const promptText = arg('--prompt', null);
const inlineText = arg('--text', null);
const pdfPath = arg('--pdf', null);
const urlArg = arg('--url', pdfPath || promptText || inlineText ? null : DEFAULT_URL);
type NamedSource = {input: SourceInput; label: string};
const rawSources: NamedSource[] = [];
if (pdfPath) {
  const bytes = await readFile(resolve(pdfPath));
  rawSources.push({input:{kind:'pdf', base64: bytes.toString('base64'), name: pdfPath}, label: pdfPath});
}
if (promptText) rawSources.push({input:{kind:'prompt', text: promptText}, label: promptText});
if (inlineText) rawSources.push({input:{kind:'text', text: inlineText}, label: inlineText});
if (urlArg) for (const url of urlArg.split(',').map(s => s.trim()).filter(Boolean))
  rawSources.push({input:{kind:'url', url}, label: url});
if (!rawSources.length) throw new Error('Give a source: --url, --pdf, --prompt, or --text');
const minutesList = (arg('--minutes', '1')!).split(',').map(Number);
for (const m of minutesList) if (![1, 5, 10, 30].includes(m)) throw new Error(`--minutes must be 1, 5, 10 or 30 (got ${m})`);
const budgetPerMinute = Number(arg('--budget-per-minute', '0.5'));
const jobRetries = Number(arg('--retries', '3'));
const narrate = !flag('--no-narration');
// Robot (local) voice is the demo default: no speech key, unlimited use.
// Default local provider is the bundled voice-engine (Supertonic/Piper).
const ttsArg = arg('--tts', 'voice-engine')!;
const voiceEngineProviders = ['voice-engine', 'piper', 'supertonic'];
if (ttsArg === 'piper' || ttsArg === 'supertonic') process.env.VOICE_ENGINE_PROVIDER = ttsArg;
else if (!voiceEngineProviders.includes(ttsArg) && ttsArg !== 'elevenlabs' && ttsArg !== 'kokoro')
  throw new Error(`--tts must be voice-engine, piper, supertonic, elevenlabs or kokoro (got ${ttsArg})`);
const ttsProvider = voiceEngineProviders.includes(ttsArg) ? 'voice-engine' : ttsArg;
const modelFlag = arg('--model', null);
if (modelFlag) process.env.OPENROUTER_MODEL = modelFlag;
const enrich = !flag('--no-enrich');
const cachePrompts = !flag('--no-cache');
const visualCritic = flag('--visual-critic');
const voiceId = arg('--voice', null);
const language = arg('--language', null);
const outDir = resolve(arg('--out-dir', 'output/videos')!);
const fps = arg('--fps', '12')!;
const width = arg('--width', '1280')!;

const slug = (url: string) => url.replace(/^https?:\/\//, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

function runExport(input: string, out: string): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const p = spawn(process.execPath, ['dist/scripts/export.js', '--input', input, '--out', out, '--fps', fps, '--width', width], {stdio: 'inherit'});
    p.on('exit', code => code === 0 ? resolvePromise() : reject(new Error(`export exited with code ${code}`)));
    p.on('error', reject);
  });
}

await mkdir(outDir, {recursive: true});
const store = new JobStore(resolve('.data'));
const results: Array<Record<string, unknown>> = [];

for (const {input, label: sourceLabel} of rawSources) {
  // Enrich once per source: ingest (URL/PDF download included), then build the
  // optimized rich brief. The job itself receives finished text, so provenance
  // travels in `name` and no re-download happens inside the worker.
  let jobSource: SourceInput = input;
  let figures: SourceFigure[] | undefined;
  if (enrich) {
    console.log(`\n=== enriching source: ${sourceLabel.slice(0, 80)} ===`);
    const ingested = await ingestSource(input);
    // Enriched jobs hand the planner a text brief, so the original bytes never reach
    // the worker's PDF figure branch — detect+describe here and pass figures along.
    if (input.kind === 'pdf' && process.env.OPENROUTER_API_KEY) {
      const bytes = Buffer.from(input.base64!, 'base64');
      const candidates = await detectFigures(bytes);
      console.log(`figures detected: ${candidates.length}`);
      if (candidates.length) {
        figures = await describeFigures(bytes, candidates, {env: process.env});
        console.log(`figures described: ${figures.length}`);
      }
    }
    const brief = buildRichBrief({...ingested, figures}, {minutes: Math.max(...minutesList)});
    console.log('brief:', JSON.stringify(briefStats(ingested, brief, {minutes: Math.max(...minutesList)})));
    // LD8 live-run fix: for pageable sources the job must receive the ORIGINAL source —
    // replacing text with the brief destroyed page boundaries and made the LD2 map
    // build from brief text (pages lost, routing quality down). Bare prompts keep the
    // brief (they have no structure to preserve).
    jobSource = input.kind === 'pdf'
      ? {kind: 'pdf', base64: input.base64, name: `${ingested.kind}:${ingested.label}`.slice(0, 200)}
      : input.kind === 'url' ? {kind: 'url', url: input.url, name: `${ingested.kind}:${ingested.label}`.slice(0, 200)}
      // Preserve the prompt kind so the planner knows there is NO document to ground
      // against (prompt-only lessons may use general knowledge — grounding is skipped).
      : {kind: input.kind === 'prompt' ? 'prompt' : 'text', text: brief, name: `${ingested.kind}:${ingested.label}`.slice(0, 200)};
  }
  for (const minutes of minutesList) {
    const label = `${slug(sourceLabel)}-${minutes}min`;
    const startedAt = Date.now();
    // LLM planning is stochastic: occasionally the model writes a narration anchor that
    // never actually appears in its own narration (a hallucinated quote), which exhausts
    // the in-job repair budget. A fresh job (new outline + chapters) usually avoids whatever
    // specific slip caused the last one to fail, so retry at the job level rather than give up.
    let lastError: string | undefined;
    let succeeded = false;
    for (let attempt = 1; attempt <= jobRetries && !succeeded; attempt++) {
      console.log(`\n=== ${label}: planning (attempt ${attempt}/${jobRetries}) ===`);
      try {
        const options: GenerationOptions = {
          mode: 'model', source: {...jobSource}, ...(figures?.length ? {figures} : {}), durationMinutes: minutes,
          maxCostUsd: Math.min(10, Math.max(0.2, budgetPerMinute * minutes)),
          delayMs: 0, narration: narrate, ttsProvider: ttsProvider as 'elevenlabs'|'kokoro'|'voice-engine', visualCritic, cachePrompts,
          ...(voiceId ? {voiceId} : {}),
          ...(language ? {language} : {}),
        };
        const created = await store.create(options);
        console.log(`Job ${created.id} started (target ${minutes} min, narration ${narrate ? 'on' : 'off'})`);
        await store.jobs.get(created.id)!.task;
        const job = await store.get(created.id);
        if (!job || (job.status !== 'complete' && job.status !== 'partial')) {
          lastError = job?.error || job?.status || 'unknown error';
          console.error(`✗ ${label} attempt ${attempt}: ${lastError}`);
          continue;
        }
        console.log(`Job ${job.id} ${job.status}: ${job.scenes.length} scenes, ${(job.availableMs / 1000).toFixed(1)}s, $${job.usage?.costUsd.toFixed(4) ?? '0'} planning cost${job.fallbackCount ? `, ${job.fallbackCount} silent-fallback scene(s)` : ''}`);
        const jobPath = resolve('.data', job.id, 'job.json');
        const outPath = join(outDir, `${label}.mp4`);
        console.log(`=== ${label}: exporting to ${outPath} ===`);
        await runExport(jobPath, outPath);
        results.push({
          source: sourceLabel, minutes, status: job.status, jobId: job.id, output: outPath, attempts: attempt,
          actualMinutes: job.actualMinutes, sceneCount: job.scenes.length, model: job.usage?.model,
          enriched: enrich, tts: ttsProvider, fallbackCount: job.fallbackCount ?? 0,
          usage: job.usage, elapsedMs: Date.now() - startedAt,
        });
        console.log(`✓ ${label}: saved ${outPath}`);
        succeeded = true;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        console.error(`✗ ${label} attempt ${attempt}: ${lastError}`);
      }
    }
    if (!succeeded) results.push({source: sourceLabel, minutes, status: 'error', error: lastError, attempts: jobRetries, elapsedMs: Date.now() - startedAt});
  }
}
await store.close();
console.log('\n=== Summary ===');
console.log(JSON.stringify(results, null, 2));
if (results.some(r => !['complete','partial'].includes(r.status as string))) process.exitCode = 1;
