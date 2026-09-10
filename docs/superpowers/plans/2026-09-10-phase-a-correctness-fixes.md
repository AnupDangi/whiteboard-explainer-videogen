# Phase A — Baseline Correctness Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close out `docs/OPTIMIZATION_PLAN.md`'s Phase A ("Baseline correctness") — items A1, A4, A5 and A6 — so the app has a trustworthy correctness baseline before any Phase B (expressive-visuals) architecture work begins.

**Architecture:** No new stages, no new files beyond a couple of small doc/data files. Every fix lands inside the existing deterministic layers (TTS bridge, `planner.ts`'s deterministic validators, `schema.ts`, `jobs.ts`) — consistent with `AGENTS.md`'s constraint against a framework rewrite.

**Tech Stack:** TypeScript (Node 22, `node:test`), Python 3.13 (Kokoro TTS bridge, `kokoro-mlx`/`mlx`/`misaki`), existing `.kokoro-venv/`.

**Spec:** `docs/OPTIMIZATION_PLAN.md` §5 "Phase A — Baseline correctness" (A1–A6 table) and its acceptance column. `docs/HANDOFF.md`'s top entry ("Next bounded implementation batch: roadmap A1–A5...") and `tasks.md`'s "Current program" checklist are the trackers this plan updates on completion. `AGENTS.md` sets the project-wide constraints below.

## Already shipped — do not re-implement

Commit `5cf8c32` ("Complete agent architecture implementation...", currently `HEAD`) already landed working, tested fixes for two Phase-A items. Verified by reading the current source and re-running `npm test` (65 pass / 0 fail / 1 skip) before this plan was written:

- **A2 (caption gap/tail state)** — `src/engine.ts`'s `renderSVG` now holds the last spoken phrase through a mid-narration gap and hides the caption only after the true final word, instead of resetting to the opening words on every gap. Covered by `test/engine.test.js`'s `'A2: caption holds the last spoken phrase through a mid-narration gap'`. **No task below touches this.**
- **A3 (numeric fill opacity)** — `src/engine.ts` now does `const fillOp=n.fillOpacity??0.25` instead of treating `fillOpacity` as a boolean that gated a progress-based fade. **No task below touches this.**

`tasks.md`'s "Current program" section still shows the whole of Phase A as a single unchecked `- [ ] A — ...` line; Task 5 below splits that into A1–A6 sub-lines and checks off what this plan actually verifies.

## Global Constraints

- Never evaluate/execute LLM-generated code (`AGENTS.md` #3).
- `renderSVG(scene, timeMs)` stays a pure, deterministic function — no wall-clock state (`AGENTS.md` #4).
- Keep provider failures visible; never turn a provider failure into a silent successful fixture response (`AGENTS.md` #7).
- Run `npm test` (builds via `tsc` first) before and after every task; do not proceed past a task with a red suite.
- Do not commit unless explicitly instructed by whoever is executing this plan (matches `docs/OPTIMIZATION_PLAN.md` §9: "Do not commit or push unless requested"). The TDD steps below still say "commit" per the skill template — treat that as "stage the change and stop for the executor's own commit policy" if commits were not explicitly authorized for this run.
- No paid provider calls. Every test below uses a mock `fetcher` or the free local Kokoro venv (`.kokoro-venv/`, already set up in this repo) gated behind `TEST_KOKORO_TTS=1`.
- Do not start Phase B (asset registry, expressive visuals) work as part of this plan — that is explicitly the next plan, not this one.

---

### Task 1: A1 — Kokoro word-timing BOS/EOS attribution fix

**Files:**
- Modify: `scripts/kokoro_tts.py:90-170` (the per-chunk word-timing loop and the trailing-gap diagnostic added by A1's prior instrumentation pass)
- Modify: `test/kokoro-speech.test.js:13-26` (the existing live-gated contract test)

**Interfaces:**
- Consumes: nothing from another task in this plan.
- Produces: no interface change — `Timing.gapMs`/`Timing.trailingNonSilent` (already in `src/types.ts`) keep their shape; their *values* change (gap should now be ~0 for a well-formed utterance). Nothing downstream (`src/kokoro-speech.ts`'s `classifyGap`, `src/engine.ts`'s caption logic) needs edits — they already consume `Timing` generically.

**Root cause (found by reading `scripts/kokoro_tts.py`):** For each chunk, `ids = [0, *token_ids, 0]` — index `0` is a BOS token, the last index is an EOS token, and `pred` (the duration predictor's frame-count output) has one entry per id, including those two. The audio (`model.forward(...)`) genuinely contains BOS lead-in and EOS trailing frames — but the per-word `start_ms`/`end_ms` math sums `pred[1:1+start]` / `pred[1:1+offset]`, which **excludes index 0 (BOS)** from every word's position and **never includes the last index (EOS)** in any word's `end_ms`. Net effect: every word is timestamped as if the chunk's audio started right where phoneme 1 begins (ignoring the real BOS lead-in), and the final word's `end_ms` never accounts for the EOS tail — exactly the "1.55–5.125 s of non-silent audio after the last word" the video review found, plus a smaller, previously unreported, leading-edge version of the same bug.

**Fix:** attribute the BOS duration to every word's start/end (it already happened before their audio, so their timestamps should reflect that), and attribute the final chunk's trailing predictor frames to the last word by clamping its `end_ms` to the real total audio duration — the last word's audio legitimately continues until synthesis ends. This uses the predictor's own signal throughout; it is not a truncation (no audio is cut) and not a global stretch (only the boundary words move, and only by the amount the model itself predicted).

- [ ] **Step 1: Extend the live-gated contract test to assert the fix (currently failing)**

Replace the existing test in `test/kokoro-speech.test.js`:

```js
test('Kokoro speech returns real WAV with native word timings', {skip: !RUNTIME}, async () => {
  const {audio, timing, format} = await generateKokoroSpeech('hello world hello', {voiceId: 'af_heart'});
  assert.equal(format, 'wav');
  assert.equal(audio.toString('ascii', 0, 4), 'RIFF');
  const sampleRate = audio.readUInt32LE(24), channels = audio.readUInt16LE(22), bits = audio.readUInt16LE(34);
  assert.equal(sampleRate, 24000); assert.equal(channels, 1);
  const duration = audio.readUInt32LE(40) / (sampleRate * channels * bits / 8) * 1000;
  assert(Math.abs(duration - timing.durationMs) < 1);
  assert.deepEqual(timing.words.map(w => w.word), ['hello', 'world', 'hello']);
  assert.equal(timing.kind, 'kokoro-aligned');
  timing.words.forEach((word, i) => {
    assert(word.endMs > word.startMs);
    assert(word.endMs <= timing.durationMs + 1);
    if (i) assert(word.startMs >= timing.words[i - 1].endMs - 1);
  });
  assert(audio.subarray(44).some(byte => byte !== 0));
  // A1: the BOS token's predicted duration is real audio before the first phoneme; the first
  // word must start after it, not at t=0 (which would claim speech that isn't there yet).
  assert(timing.words[0].startMs > 0, 'A1: first word should start after the BOS lead-in, not at t=0');
  // A1: the last word must cover the audio's real end — no unaccounted trailing gap (this was
  // the video review's headline finding: 1.55-5.125s of non-silent audio after the last word).
  const trailingGapMs = timing.durationMs - timing.words[timing.words.length - 1].endMs;
  assert(trailingGapMs < 1, `A1: last word should cover the audio tail; got ${trailingGapMs}ms unaccounted`);
});
```

- [ ] **Step 2: Run it to confirm it fails against the current (unfixed) Python**

Run: `TEST_KOKORO_TTS=1 npm test` (requires the persistent Kokoro server or a working `.kokoro-venv/`; `npm run kokoro:setup` first if the venv is missing).
Expected: the new `assert(timing.words[0].startMs > 0, ...)` line FAILS (current code always starts the first word at `startMs: 0`).

- [ ] **Step 3: Fix the Python word-timing math**

In `scripts/kokoro_tts.py`, after the existing duration-length check:

```python
        pred = np.array(mx.clip(mx.round(duration), 0, None).astype(mx.int32).squeeze(0))
        if len(pred) != length:
            fail('Duration length %d does not match input length %d' % (len(pred), length))
```

add:

```python
        pred = np.array(mx.clip(mx.round(duration), 0, None).astype(mx.int32).squeeze(0))
        if len(pred) != length:
            fail('Duration length %d does not match input length %d' % (len(pred), length))
        # A1: pred[0] is the BOS token's predicted duration frames — real synthesized audio the
        # model plays before the first phoneme. The word-timing math below previously started
        # counting from pred[1] with no offset, so every word was timestamped as if the chunk's
        # audio began right where phoneme 1 starts — ignoring this real lead-in.
        bos_ms = float(pred[0]) / FRAMES_PER_SECOND * 1000
```

Then change the two lines inside the `for word in chunk_text.split():` loop from:

```python
            start_ms = elapsed_ms + float(pred[1:1 + start].sum()) / FRAMES_PER_SECOND * 1000
            end_ms = elapsed_ms + float(pred[1:1 + offset].sum()) / FRAMES_PER_SECOND * 1000
```

to:

```python
            start_ms = elapsed_ms + bos_ms + float(pred[1:1 + start].sum()) / FRAMES_PER_SECOND * 1000
            end_ms = elapsed_ms + bos_ms + float(pred[1:1 + offset].sum()) / FRAMES_PER_SECOND * 1000
```

Then, after the existing gap-diagnostic block (which currently reads):

```python
    duration_ms = len(samples) / SAMPLE_RATE * 1000
    # A1: Diagnose trailing audio after last word timestamp.
    # The total WAV duration (duration_ms) may exceed the last word's endMs;
    # this gap contains the trailing non-silent signal identified in the video review.
    last_word_end = words[-1]['endMs'] if words else 0
    gap_ms = duration_ms - last_word_end
    trailing_non_silent = False
    if gap_ms > 0:
        # Check the final 200 ms of audio for non-silence (RMS > -40 dBFS).
        start_idx = max(0, len(samples) - int(SAMPLE_RATE * 0.2))
        segment = samples[start_idx:]
        rms = float(np.sqrt(np.mean(segment ** 2))) if segment.size else 0.0
        trailing_non_silent = rms > 0.001  # -40 dBFS threshold relative to peak=1
```

insert a fix line right after `duration_ms = len(samples) / SAMPLE_RATE * 1000` and before the diagnostic comment, so the diagnostic now measures the *post-fix* (near-zero) gap instead of the original bug:

```python
    duration_ms = len(samples) / SAMPLE_RATE * 1000
    # A1 fix: the final chunk's EOS token and any trailing coarticulation frames are real
    # synthesized audio that belongs to the last spoken word (nothing else happens after it),
    # so attribute them there instead of leaving them as an unaccounted tail. This is not a
    # truncation (no audio removed) and not a global stretch (only the last word's end moves,
    # by exactly the amount of audio that follows it).
    if words:
        words[-1]['endMs'] = duration_ms
    # A1: Diagnose trailing audio after last word timestamp (now expected to be ~0 after the
    # fix above; kept as a regression sentinel — a future change that reintroduces a gap here
    # will show up in gapMs/trailingNonSilent instead of silently regressing).
    last_word_end = words[-1]['endMs'] if words else 0
    gap_ms = duration_ms - last_word_end
    trailing_non_silent = False
    if gap_ms > 0:
        # Check the final 200 ms of audio for non-silence (RMS > -40 dBFS).
        start_idx = max(0, len(samples) - int(SAMPLE_RATE * 0.2))
        segment = samples[start_idx:]
        rms = float(np.sqrt(np.mean(segment ** 2))) if segment.size else 0.0
        trailing_non_silent = rms > 0.001  # -40 dBFS threshold relative to peak=1
```

- [ ] **Step 4: Run the test again to confirm it passes**

Run: `TEST_KOKORO_TTS=1 npm test`
Expected: PASS, including the new `startMs > 0` and `trailingGapMs < 1` assertions.

- [ ] **Step 5: Run the full suite (non-live) and commit**

Run: `npm test`
Expected: 65 pass, 0 fail, 1 skipped (unchanged — this fix has no non-live-gated test surface).

```bash
git add scripts/kokoro_tts.py test/kokoro-speech.test.js
git commit -m "fix(A1): attribute BOS/EOS predictor frames to word timing, closing the trailing-audio gap"
```

**Known limitation to record in Task 5's HANDOFF update:** this fixes the traceable root cause using the model's own predictor signal and is verified by the live contract test above, but `docs/OPTIMIZATION_PLAN.md`'s full A1 acceptance also calls for "listening/independent alignment checks... on all 32 audited WAV scenes" — that requires a human listening pass this plan cannot perform. Say so explicitly rather than claiming full A1 acceptance.

---

### Task 2: A4 — Replace the forced shape-diversity gate with identity-aware kind collision

**Files:**
- Modify: `src/planner.ts:139-159` (`checkKindCollision`), `src/planner.ts:365` (the `visualFailures` array inside `directScene`)
- Modify: `test/validators.test.js:36-43` (the existing `kind collision` unit test — extended, not replaced)
- Modify: `test/generation.test.js` (new end-to-end regression test appended after the existing tests)

**Interfaces:**
- Consumes: nothing from another task in this plan.
- Produces: `checkKindCollision(scenes)` keeps its existing exported signature (`(scenes:LooseScene[]) => string[]`) — same import site (`src/planner.ts`, re-exported for tests via `dist/src/planner.js`), only its internal logic changes. `checkShapeMix` itself is **not removed or changed** — only one of its two call sites (inside `directScene`'s per-attempt gate) stops using it. Its other call site, inside `directScene`'s exhausted-fallback path (`src/planner.ts:381`), **must stay untouched** — see the note below.

**Why the fallback call site must stay:** `directScene`'s exhausted-fallback path (reached only after 3 failed director attempts) ships the raw, undirected content with a hardcoded `layout:'flow'` and whatever `upgradeShapes` can salvage. `test/generation.test.js`'s existing test `'Exhausted director retries fail loudly instead of shipping all-generic boxes'` locks in that this degenerate case (director genuinely failed 3 times, nothing was actually decided) still fails loudly rather than silently shipping an undifferentiated scene — verified by tracing that test's mock: it produces all-`generic`-kind, no-`shape` nodes, which `checkKindCollision` alone would let through (generic kinds are skipped), so `checkShapeMix` is the only thing making that specific test's fallback path fail as expected. A4 is about not rejecting *legitimate* uniform-shape content from a director that actually ran (e.g. a real token row); it is not about weakening the "the director completely failed and we're shipping undirected content" guard.

- [ ] **Step 1: Write the failing unit tests for the loosened `checkKindCollision`**

Add to `test/validators.test.js`, right after the existing `'kind collision: one glyph per concept; identical labels pass'` test (do not delete the existing test — extend the file with a new one below it):

```js
test('kind collision (A4): repeated instances of one concept pass; different concepts still fail',()=>{
  // Token row: same kind, numbered labels — a legitimate repeated instance, must pass.
  const tokens=[{id:'s',narration:'x',nodes:[
    {id:'t1',label:'Token 1',kind:'token'},{id:'t2',label:'Token 2',kind:'token'},{id:'t3',label:'Token 3',kind:'token'},
  ]}];
  assert.deepEqual(checkKindCollision(tokens),[]);
  // Multiple keys: same kind, lettered labels — must pass.
  const keys=[{id:'s',narration:'x',nodes:[{id:'k1',label:'Key A',kind:'key'},{id:'k2',label:'Key B',kind:'key'}]}];
  assert.deepEqual(checkKindCollision(keys),[]);
  // Repeated bases: identical labels, same kind — must pass (already covered by the "twins"
  // case above, restated here with a base-pair-shaped label for A4 traceability).
  const bases=[{id:'s',narration:'x',nodes:[{id:'b1',label:'Base pair',kind:'molecule'},{id:'b2',label:'Base pair',kind:'molecule'}]}];
  assert.deepEqual(checkKindCollision(bases),[]);
  // Two genuinely different concepts sharing a kind must still fail — unchanged from before.
  const clash=[{id:'s',narration:'x',nodes:[{id:'a',label:'Attraction',kind:'energy'},{id:'b',label:'Repulsion',kind:'energy'}]}];
  assert.match(checkKindCollision(clash).join('|'),/share kind "energy"/);
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test`
Expected: `npm run build` succeeds (no type errors — the test only calls the existing exported function), but the new test FAILS: the `tokens` and `keys` cases currently produce a non-empty failure array (`share kind "token"...` / `share kind "key"...`) because the current `checkKindCollision` fails on any two same-kind nodes with different labels.

- [ ] **Step 3: Rewrite `checkKindCollision` in `src/planner.ts`**

Replace the current function (lines 139-159):

```typescript
/** Antonym-kind collision: one glyph must not stand for two different concepts. */
export function checkKindCollision(scenes:LooseScene[]):string[] {
  const failures:string[]=[];
  for(const scene of scenes){
    const byKind=new Map<string,string[]>();
    for(const node of scene.nodes){
      // Annotations explain rather than symbolize: their kind never collides.
      if(node.shape==='annotation')continue;
      const kind=typeof node.kind==='string'?node.kind:'generic';
      if(kind==='generic')continue;
      const label=(node.label||'').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
      if(!byKind.has(kind))byKind.set(kind,[]);
      byKind.get(kind)!.push(`${node.id||'node'}:"${node.label||''}"(${label})`);
    }
    for(const [kind,members] of byKind){
      const labels=new Set(members.map(m=>m.slice(m.indexOf('('))));
      if(labels.size>1)failures.push(`${scene.id||'scene'}: ${members.join(' vs ')} share kind "${kind}" for different concepts; pick distinct kinds`);
    }
  }
  return failures;
}
```

with:

```typescript
/** A4: an "instance suffix" — a trailing number, single letter, or ordinal word — marks a
 *  label as one of several repeated instances of the same concept ("Token 1"/"Token 2",
 *  "Key A"/"Key B"), not a different concept. Stripped before comparing labels below. */
const INSTANCE_SUFFIX=/\s*(?:[0-9]+|[a-z]|first|second|third|fourth|fifth|sixth)\s*$/i;
const labelStem=(label:string)=>label.toLowerCase().replace(/[^\p{L}\p{N} ]/gu,' ').replace(INSTANCE_SUFFIX,'').replace(/\s+/g,' ').trim();
/** Antonym-kind collision: one glyph must not stand for two DIFFERENT concepts (V2 §37 "concept
 *  identity != asset class" cuts the other way: same kind is fine when it's really one concept
 *  repeated). A4 replaces the old blanket "different labels sharing a kind always fails" rule —
 *  which rejected legitimate token rows, multiple keys and repeated bases (docs/VIDEO_QUALITY_
 *  REVIEW.md finding) — with an identity check: same-kind nodes pass when every label reduces to
 *  the same stem after stripping a trailing instance marker (a shared "type", different
 *  instances); they still fail when the stems genuinely differ (two unrelated concepts wrongly
 *  sharing one glyph). */
export function checkKindCollision(scenes:LooseScene[]):string[] {
  const failures:string[]=[];
  for(const scene of scenes){
    const byKind=new Map<string,{id:string;label:string;stem:string}[]>();
    for(const node of scene.nodes){
      // Annotations explain rather than symbolize: their kind never collides.
      if(node.shape==='annotation')continue;
      const kind=typeof node.kind==='string'?node.kind:'generic';
      if(kind==='generic')continue;
      const label=node.label||'';
      if(!byKind.has(kind))byKind.set(kind,[]);
      byKind.get(kind)!.push({id:node.id||'node',label,stem:labelStem(label)});
    }
    for(const [kind,members] of byKind){
      if(members.length<2)continue;
      const stems=new Set(members.map(m=>m.stem));
      if(stems.size<=1)continue; // every member reduces to one stem: repeated instances, not a collision
      failures.push(`${scene.id||'scene'}: ${members.map(m=>`${m.id}:"${m.label}"`).join(' vs ')} share kind "${kind}" for different concepts; pick distinct kinds`);
    }
  }
  return failures;
}
```

- [ ] **Step 4: Stop gating `directScene`'s normal (non-fallback) path on `checkShapeMix`**

In `src/planner.ts`, inside `directScene`, find:

```typescript
            const upgraded:Plan={...directed,scenes:upgradeShapes(directed.scenes,Object.fromEntries(content.scenes.map(s=>[s.id,arc||''])))};
            // Phase 1 deterministic visual gates: shape variety and one-glyph-per-concept.
            const visualFailures=[...checkShapeMix(upgraded.scenes),...checkKindCollision(upgraded.scenes)];
            if(visualFailures.length)throw new Error('Visual checks — '+visualFailures.join(' | '));
```

Replace with:

```typescript
            const upgraded:Plan={...directed,scenes:upgradeShapes(directed.scenes,Object.fromEntries(content.scenes.map(s=>[s.id,arc||''])))};
            // A4: shape-mix is now a soft diagnostic, not a hard gate, for a director call that
            // actually ran — a scene of identical semantic instances (a token row, several keys)
            // can be genuinely correct with one shape (V2 §36 "do not use hard shape diversity
            // as a quality gate"). checkKindCollision (identity-aware, A4) remains a hard gate:
            // two DIFFERENT concepts sharing one glyph is still a real defect.
            const shapeDiagnostic=checkShapeMix(upgraded.scenes);
            if(shapeDiagnostic.length)log('planner.shape-diagnostic',{chapter:chapter+1,findings:shapeDiagnostic});
            const visualFailures=[...checkKindCollision(upgraded.scenes)];
            if(visualFailures.length)throw new Error('Visual checks — '+visualFailures.join(' | '));
```

Leave the fallback path (`src/planner.ts:379-383`, the `fallbackFailures` block using `checkShapeMix` + `checkKindCollision`) **exactly as it is** — do not touch it.

- [ ] **Step 5: Run the unit test again to confirm it passes**

Run: `npm test`
Expected: the new `'kind collision (A4)...'` test passes; the existing `'shape mix...'` and `'kind collision: one glyph...'` tests still pass unchanged (their fixtures — `twins`, `generic`, `clash`, all-box `boxes` — are unaffected: `checkShapeMix` itself is untouched, and `clash`'s two labels have different stems so it still fails `checkKindCollision`).

- [ ] **Step 6: Add the end-to-end regression proving the gate is actually gone**

Append to `test/generation.test.js` (after the last existing `test(...)` block):

```js
test('A4: a real director result using one shape throughout (a legitimate token row) is accepted without repair',async()=>{
  const reply=(result)=>Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(result)}}],usage:{prompt_tokens:10,completion_tokens:10,cost:0.00001}});
  let directorCalls=0;
  const fetcher=async(url,options)=>{
    if(url.endsWith('/models'))return Response.json({data:[{id:'test/model',pricing:{prompt:'0.0000001',completion:'0.0000004'}}]});
    const body=JSON.parse(options.body);
    const content=JSON.parse(body.messages[1].content);
    if(content.chapterCount)return reply({title:'Outline',chapters:[{title:'Topic',objective:'Explain it',arc:'build',keyPoints:['Core idea point','Working example point']}]});
    if(content.scenes){
      directorCalls++;
      // Same shape ('box', via no shape field) and same kind ('token') on every node, with
      // numbered labels the director echoes back unchanged — a legitimate repeated-instance
      // token row. Before A4 this tripped the hard shape-mix gate and forced a repair/fallback.
      return reply({scenes:content.scenes.map(s=>({id:s.id,layout:'flow',nodes:s.nodes.map((n,j)=>({id:n.id,kind:'token',emphasis:false}))}))});
    }
    const words='Core idea point Working example point '+Array.from({length:60},(_,i)=>`term_${i}`).join(' ');
    const result={version:1,title:'D',scenes:[0,1].map(i=>({id:`s${i}`,title:`Aspect ${i}`,narration:words,
      nodes:[{id:'a',label:'Token 1',anchor:'term_0',keyPoint:'Core idea point'},{id:'b',label:'Token 2',anchor:'term_10',keyPoint:'Working example point'}],
      edges:[{from:'a',to:'b',label:'precedes'}],note:''}))};
    return reply(result);
  };
  const scenes=[];
  for await(const p of generateChapters(source,{env,fetcher,durationMinutes:1}))scenes.push(...p.scenes);
  assert.equal(scenes.length,2,'both scenes committed — no chapter regeneration was needed');
  assert.equal(directorCalls,1,'the director succeeded on its first attempt — no repair/fallback was triggered by shape uniformity');
  for(const scene of scenes)assert(scene.nodes.every(n=>(n.shape||'box')==='box'),'the single-shape token row survived unchanged, as intended by A4');
});
```

- [ ] **Step 7: Run it to confirm it passes**

Run: `npm test`
Expected: PASS. (Before Step 4's fix, this test would have failed: `directorCalls` would be 3 — `DIRECTOR_ATTEMPTS` exhausted by the shape-mix gate — and the run would either fall through to the fallback path and throw, or, since `checkKindCollision` alone also passes this fixture, would still fail via `checkShapeMix` inside `visualFailures` on every attempt.)

- [ ] **Step 8: Run the full suite and commit**

Run: `npm test`
Expected: 67 pass (65 + 2 new), 0 fail, 1 skipped. Also update `test/generation.test.js`'s `import` line and `test/validators.test.js`'s import line only if new names were introduced — they were not; both files already import everything this task needs.

```bash
git add src/planner.ts test/validators.test.js test/generation.test.js
git commit -m "fix(A4): replace forced shape-diversity gate with identity-aware kind collision"
```

---

### Task 3: A5 — Parameterize the Visual Director schema by scene count; fix the critic-repair schema mismatch

**Files:**
- Modify: `src/schema.ts:20` (`directorSchema`)
- Modify: `src/planner.ts:281` (`repairFromCritique`'s repair call), `src/planner.ts:361` (`directScene`'s first director call), `src/planner.ts:372` (`directScene`'s director-repair call)
- Modify: `test/validators.test.js` (new pure-function test for `directorSchema(count)`)
- Modify: `test/generation.test.js` (new end-to-end regression proving the critic repair now actually applies instead of silently no-op'ing)

**Interfaces:**
- Consumes: nothing from another task in this plan (independent of Tasks 1/2/4; safe to do in any order, but this plan runs it after Task 2 since both touch `src/planner.ts` and sequential edits avoid merge noise).
- Produces: `directorSchema` changes from a constant (`typeof directorSchema === object`) to a function `(count:number) => object`, matching the existing `outlineSchema(count)` convention in the same file. Every call site in the whole repo is updated in this task — `git grep -n directorSchema` after this task must show only the definition and the three call sites listed above.

**Why this is a real, currently-silent bug:** `directorSchema` hardcodes `array(...,2,2)` — exactly 2 scenes, matching the normal per-chapter director call. But `repairFromCritique` (line ~279) builds `scenesPrompt` with exactly **one** scene (`scenes:[{id:scene.id,...}]`, since the critic reviews and repairs one scene at a time) and then calls `call(directorSystem, JSON.stringify({...}), 2000, directorSchema)` — passing a 1-scene payload against a schema that requires exactly 2. OpenRouter's `strict:true` structured-output mode means the model is constrained to emit a schema-conformant response; asking it to conform to `array(...,2,2)` while the prompt only describes 1 scene either produces an invalid model response or, most likely in practice, an unusable one — and either way `repairFromCritique`'s own `try/catch` (lines 276-289) swallows any failure and just logs `planner.critic-repair-failed`, keeping the original unrepaired scene. **Net effect: the critic-repair feature has likely never actually repaired anything** — it silently no-ops every time it's asked to. This task's Step 6 regression test proves the before/after behavior directly.

- [ ] **Step 1: Write the failing pure-function test for the parameterized schema**

Add to `test/validators.test.js` (new imports needed — add `directorSchema` to the top-of-file import list, which currently reads `import {checkQuantities,checkKeyPoints,checkShapeMix,checkKindCollision,checkEdgeLabels,upgradeShapes,checkConceptBudget} from '../dist/src/planner.js';` — add a second import line rather than editing that one, since `directorSchema` lives in `schema.js`, not `planner.js`):

```js
import {directorSchema} from '../dist/src/schema.js';
```

then, appended as a new test:

```js
test('A5: directorSchema is parameterized by scene count, matching outlineSchema\'s existing convention',()=>{
  const one=directorSchema(1);
  assert.equal(one.properties.scenes.minItems,1);
  assert.equal(one.properties.scenes.maxItems,1);
  const two=directorSchema(2);
  assert.equal(two.properties.scenes.minItems,2);
  assert.equal(two.properties.scenes.maxItems,2);
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test`
Expected: `npm run build` fails first — `directorSchema` is currently a plain object, not a function, so `directorSchema(1)` is a TypeScript call-on-non-function error. (If using a JS-only quick check instead: `node -e "..."` against the built `dist/src/schema.js` would throw `directorSchema is not a function` at runtime.)

- [ ] **Step 3: Make `directorSchema` a function of scene count**

In `src/schema.ts`, replace:

```typescript
export const directorSchema=obj({scenes:array(obj({id:str(40),layout:{type:'string',enum:[...LAYOUTS]},nodes:array(obj({id:str(40),kind:{type:'string',enum:[...NODE_KINDS]},emphasis:{type:'boolean'},shape:{type:'string',enum:['box','illustration','icon','circle','square','bullet','number','annotation']},attachTo:{type:'string',maxLength:40},position:{type:'string',enum:['below','above','left','right','none']}}),2,6)}),2,2)});
```

with:

```typescript
// A5: parameterized by scene count, matching outlineSchema's existing convention — the old
// fixed array(...,2,2) silently mismatched the critic-repair call, which sends exactly ONE
// scene per repair (see planner.ts's repairFromCritique); a strict-mode schema mismatch there
// meant repair calls never actually validated, so critic repairs have likely never applied.
export const directorSchema=(count:number)=>obj({scenes:array(obj({id:str(40),layout:{type:'string',enum:[...LAYOUTS]},nodes:array(obj({id:str(40),kind:{type:'string',enum:[...NODE_KINDS]},emphasis:{type:'boolean'},shape:{type:'string',enum:['box','illustration','icon','circle','square','bullet','number','annotation']},attachTo:{type:'string',maxLength:40},position:{type:'string',enum:['below','above','left','right','none']}}),2,6)}),count,count)});
```

- [ ] **Step 4: Update every call site in `src/planner.ts`**

Change line ~281 (`repairFromCritique`), from:

```typescript
      const repaired=await call(directorSystem,JSON.stringify({repairError:'Visual critic flagged: '+issues.join('; '),invalidDirection:currentDirection,...scenesPrompt}),2000,directorSchema);
```

to:

```typescript
      const repaired=await call(directorSystem,JSON.stringify({repairError:'Visual critic flagged: '+issues.join('; '),invalidDirection:currentDirection,...scenesPrompt}),2000,directorSchema(1));
```

Change line ~361 (`directScene`'s first attempt), from:

```typescript
            if(attempt===0){const t=performance.now();try{directorRaw=await call(directorSystem,directorPrompt,3000,directorSchema,'director');}finally{chapSpan.directorMs+=Math.round(performance.now()-t);}}
```

to:

```typescript
            if(attempt===0){const t=performance.now();try{directorRaw=await call(directorSystem,directorPrompt,3000,directorSchema(content.scenes.length),'director');}finally{chapSpan.directorMs+=Math.round(performance.now()-t);}}
```

Change line ~372 (`directScene`'s director-repair), from:

```typescript
            {const t=performance.now();try{directorRaw=await call(directorSystem,JSON.stringify({repairError:error instanceof Error?error.message:String(error),invalidDirection:directorRaw,...JSON.parse(directorPrompt)}),3000,directorSchema,'director-repair');}finally{chapSpan.directorMs+=Math.round(performance.now()-t);}}
```

to:

```typescript
            {const t=performance.now();try{directorRaw=await call(directorSystem,JSON.stringify({repairError:error instanceof Error?error.message:String(error),invalidDirection:directorRaw,...JSON.parse(directorPrompt)}),3000,directorSchema(content.scenes.length),'director-repair');}finally{chapSpan.directorMs+=Math.round(performance.now()-t);}}
```

`content.scenes.length` is always `2` today (the two-scenes-per-chapter invariant is unchanged by this task), so behavior for the two `directScene` call sites is identical to before — only the `repairFromCritique` call site's behavior actually changes (1 instead of the wrong 2).

- [ ] **Step 5: Run the schema test again to confirm it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Add the end-to-end regression proving critic repair now actually applies**

Append to `test/generation.test.js`:

```js
test('A5: a single-scene critic repair validates and actually applies (was previously a silent no-op)',async()=>{
  const reply=(result)=>Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(result)}}],usage:{prompt_tokens:10,completion_tokens:10,cost:0.00001}});
  let repairCalls=0;
  const fetcher=async(url,options)=>{
    if(url.endsWith('/models'))return Response.json({data:[
      {id:'test/model',pricing:{prompt:'0.0000001',completion:'0.0000004'}},
      {id:'openai/gpt-5.6-luna',pricing:{prompt:'0.0000002',completion:'0.0000006'}},
    ]});
    const body=JSON.parse(options.body);
    const userContent=body.messages[1].content;
    if(Array.isArray(userContent)){
      // The critic's vision call: request one repair, every time.
      return reply({issues:['scene reads as cluttered'],needsRepair:true});
    }
    const content=JSON.parse(userContent);
    if(content.chapterCount)return reply({title:'Outline',chapters:[{title:'Topic',objective:'Explain it',arc:'build',keyPoints:['Core idea point','Working example point']}]});
    if(content.repairError&&Array.isArray(content.scenes)&&content.scenes.length===1){
      // The A5 repair call: exactly one scene in the prompt. Flip the kind so the test can
      // observe the repair actually landing (before the A5 fix, this call silently failed
      // schema validation and repairFromCritique's catch kept the original, unrepaired scene).
      repairCalls++;
      return reply({scenes:[{id:content.scenes[0].id,layout:'flow',nodes:content.scenes[0].nodes.map((n,j)=>({id:n.id,kind:'success',emphasis:false,...(j===0?{shape:'icon'}:{})}))}]});
    }
    if(content.scenes){
      // Normal 2-scene director call: distinct icon/box shapes, distinct kinds, so it succeeds
      // on the first attempt and the critic is what triggers the repair, not a director retry.
      return reply({scenes:content.scenes.map(s=>({id:s.id,layout:'flow',nodes:s.nodes.map((n,j)=>({id:n.id,kind:j%2?'generic':'database',emphasis:false,...(j%2?{}:{shape:'icon'})}))}))});
    }
    const words='Core idea point Working example point '+Array.from({length:60},(_,i)=>`term_${i}`).join(' ');
    return reply({version:1,title:'D',scenes:[0,1].map(i=>({id:`s${i}`,title:`Aspect ${i}`,narration:words,
      nodes:[{id:'a',label:'Cause',anchor:'term_0',keyPoint:'Core idea point'},{id:'b',label:'Effect',anchor:'term_10',keyPoint:'Working example point'}],
      edges:[{from:'a',to:'b',label:'causes'}],note:''}))});
  };
  const scenes=[];
  for await(const p of generateChapters(source,{env,fetcher,durationMinutes:1,visualCritic:true}))scenes.push(...p.scenes);
  assert.equal(repairCalls,2,'the critic requested a repair for both scenes and each repair call validated (1-scene schema)');
  assert(scenes.every(s=>s.nodes[0].kind==='success'),'the repaired kind actually reached the committed scene, not just the repair response');
});
```

- [ ] **Step 7: Run it to confirm it passes**

Run: `npm test`
Expected: PASS. (Before Step 4's fix, `repairCalls` would stay `0` — the repair `call()` would throw on the schema/prompt mismatch, `repairFromCritique`'s `catch` would log `planner.critic-repair-failed` and silently keep the original `database`/`generic` kinds, and this test's final assertion would fail.)

- [ ] **Step 8: Run the full suite and commit**

Run: `npm test`
Expected: 69 pass (67 + 2 new), 0 fail, 1 skipped.

```bash
git add src/schema.ts src/planner.ts test/validators.test.js test/generation.test.js
git commit -m "fix(A5): parameterize directorSchema by scene count, fixing the silently-broken critic repair"
```

---

### Task 4: A6 — Generation manifest version stamp + fixed review corpus

**Files:**
- Modify: `src/types.ts` (`JobSnapshot` interface)
- Modify: `src/jobs.ts` (add the version constant, stamp it in `create()`)
- Create: `docs/REVIEW_CORPUS.md`
- Modify: `test/jobs.test.js` (new test)

**Interfaces:**
- Consumes: nothing from another task in this plan.
- Produces: `JobSnapshot.manifestVersion?: string` — a new optional field (optional so old saved `job.json` files without it still satisfy the type when read back by `JobStore.get()`). `GENERATION_MANIFEST_VERSION` exported from `src/jobs.ts` as the single source of truth for the current value.

**Scope note:** `docs/OPTIMIZATION_PLAN.md`'s A6 acceptance ("Reports distinguish historical MP4, current-render replay and fresh planner generation; exact versions/hashes recorded") is satisfied here at the bounded level this plan covers: every new job snapshot is stamped with a version string that changes whenever the compiled-scene contract changes, plus a small fixed corpus doc naming the specific historical jobs this session's video review already covers (so future reports reference the same named set instead of ad hoc job IDs each time). A full content-hash-based `GenerationManifest` (per-request schema/model/font/compiler hashes, per `docs/OPTIMIZATION_PLAN.md` §4's `GenerationManifest` contract) is a larger, separate effort explicitly out of scope for this bounded Phase A pass — note this as a known limitation in Task 5's HANDOFF update.

- [ ] **Step 1: Write the failing test**

Append to `test/jobs.test.js` (after the existing tests, using the file's own `setup(t)`/`options` helpers already defined at its top):

```js
test('A6: job snapshot is stamped with the generation manifest version',async t=>{
  const {store}=await setup(t);
  const job=await store.create(options);
  assert.equal(typeof job.manifestVersion,'string');
  assert(job.manifestVersion.length>0);
  const fetched=await store.get(job.id);
  assert.equal(fetched.manifestVersion,job.manifestVersion,'the stamped version survives a save/reload round trip');
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test`
Expected: FAIL — `job.manifestVersion` is `undefined` (`typeof undefined !== 'string'`).

- [ ] **Step 3: Add the field to `JobSnapshot`**

In `src/types.ts`, the `JobSnapshot` interface currently reads:

```typescript
export interface JobSnapshot {
 id:string;status:string;revision:number;createdAt:number;mode:string;targetMinutes:number;plannerBudgetUsd:number;ttsCharacters:number;timingMode:string;simulatedDelayMs:number;scenes:CompiledScene[];availableMs:number;events:{sequence:number;type:string;atMs:number;availableMs:number}[];
 title?:string;totalScenes?:number;firstPlayableMs?:number;completedMs?:number;actualMinutes?:number;error?:string;usage?:Usage;source?:Omit<SourceDocument,'text'>&{characters:number};spans?:JobSpans;
}
```

Add `manifestVersion` to the second (all-optional) line:

```typescript
export interface JobSnapshot {
 id:string;status:string;revision:number;createdAt:number;mode:string;targetMinutes:number;plannerBudgetUsd:number;ttsCharacters:number;timingMode:string;simulatedDelayMs:number;scenes:CompiledScene[];availableMs:number;events:{sequence:number;type:string;atMs:number;availableMs:number}[];
 title?:string;totalScenes?:number;firstPlayableMs?:number;completedMs?:number;actualMinutes?:number;error?:string;usage?:Usage;source?:Omit<SourceDocument,'text'>&{characters:number};spans?:JobSpans;manifestVersion?:string;
}
```

- [ ] **Step 4: Stamp it in `src/jobs.ts`**

Add the constant near the top of `src/jobs.ts`, right after the existing imports (before `export class JobStore`):

```typescript
/** A6: bump this whenever a change to schema.ts's shapes/kinds or engine.ts's compiler/
 *  renderer could make an old saved job.json render differently under the current code —
 *  lets a report distinguish "replayed under its original code" from "replayed under updated
 *  code" without re-deriving history from git log (docs/OPTIMIZATION_PLAN.md §4 GenerationManifest,
 *  bounded to a version string for this pass — see docs/REVIEW_CORPUS.md). */
export const GENERATION_MANIFEST_VERSION='v1-2026-09-10';
```

In `create()`, the `job` object construction currently reads:

```typescript
    const job:InternalJob={id:randomUUID(),status:'queued',revision:0,createdAt:Date.now(),mode:options.mode,
      targetMinutes:options.durationMinutes??1,plannerBudgetUsd:options.maxCostUsd??1,ttsCharacters:0,
      timingMode:options.narration?(options.ttsProvider==='elevenlabs'?'provider-aligned':'kokoro-aligned'):'estimated',simulatedDelayMs:delayMs,scenes:[],availableMs:0,events:[]};
```

Add `manifestVersion:GENERATION_MANIFEST_VERSION` to it:

```typescript
    const job:InternalJob={id:randomUUID(),status:'queued',revision:0,createdAt:Date.now(),mode:options.mode,
      targetMinutes:options.durationMinutes??1,plannerBudgetUsd:options.maxCostUsd??1,ttsCharacters:0,
      timingMode:options.narration?(options.ttsProvider==='elevenlabs'?'provider-aligned':'kokoro-aligned'):'estimated',simulatedDelayMs:delayMs,scenes:[],availableMs:0,events:[],manifestVersion:GENERATION_MANIFEST_VERSION};
```

- [ ] **Step 5: Run the test again to confirm it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Create the fixed review corpus doc**

Create `docs/REVIEW_CORPUS.md`:

```markdown
# Fixed review corpus

A named, stable set of generated jobs/topics that quality reports (`docs/RESULTS.md`,
`docs/VIDEO_QUALITY_REVIEW.md`, future ones) should reference by name instead of citing ad hoc
job IDs each time — so "the DNA video" means the same evidence across sessions until this file
is deliberately updated. Per `docs/OPTIMIZATION_PLAN.md` §9 "First batch to execute" item 1.

Origin legend: **fresh** = a live model-planned generation; **fixture** = `src/fixtures.ts`
hand-authored data, no model call; **replay** = re-rendering a previously saved `job.json`
under the current code (tests compile-idempotence, not planning quality).

| Name | Topic | Origin | Duration | Evidence |
|---|---|---|---|---|
| dna | DNA replication | fresh | 5 min | `docs/VIDEO_QUALITY_REVIEW.md` (2026-09-09 review) |
| tectonics | Plate tectonics | fresh | 5 min | `docs/VIDEO_QUALITY_REVIEW.md` (2026-09-09 review) |
| printing | Printing press | fresh | 5 min | `docs/VIDEO_QUALITY_REVIEW.md` (2026-09-09 review) |
| bicycle-pump | Bicycle pump | fresh | 1 min | `docs/VIDEO_QUALITY_REVIEW.md` (2026-09-09 review) |
| gps | GPS trilateration | fresh | 1 min | `docs/VIDEO_QUALITY_REVIEW.md` (2026-09-09 review) |
| attention | Attention mechanism | fixture | n/a | `src/fixtures.ts`'s `attention` fixture; used throughout the test suite as the deterministic baseline |

Adding a job to this table: record its actual job ID, exact prompt/source, model, and
`manifestVersion` (see `src/jobs.ts`'s `GENERATION_MANIFEST_VERSION`) in the evidence doc being
cited, then add one row here pointing at that doc. Do not delete a row once evidence has been
published referencing it by name — supersede it with a new row/name instead.
```

- [ ] **Step 7: Run the full suite and commit**

Run: `npm test`
Expected: 70 pass (69 + 1 new), 0 fail, 1 skipped.

```bash
git add src/types.ts src/jobs.ts test/jobs.test.js docs/REVIEW_CORPUS.md
git commit -m "feat(A6): stamp job snapshots with a generation manifest version; add fixed review corpus doc"
```

---

### Task 5: Docs/tracker sync — close out Phase A's tracking entries

**Files:**
- Modify: `tasks.md`
- Modify: `docs/HANDOFF.md`
- Modify: `docs/RESULTS.md`

**Interfaces:**
- Consumes: the actual `npm test` pass count from Task 4's Step 7 (70 pass / 0 fail / 1 skipped) and the specific limitations noted in Tasks 1 and 4.
- Produces: nothing consumed by later tasks — this is the terminal documentation task.

This task has no code/tests — it is a documentation update, folded into its own task per the plan's task-sizing rule (a reviewer could accept Tasks 1-4's code while still wanting the tracking docs to reflect it, so it gets its own gate) rather than being split across the four code tasks.

- [ ] **Step 1: Update `tasks.md`'s "Current program" section**

Replace:

```markdown
- [x] Review five additional full video timelines through samples, scripts and WAV analysis; create evidence-backed roadmap. No continuous listening claim.
- [ ] A — Alignment diagnosis and baseline correctness (A1–A6); begin with A1–A5.
- [ ] B — Versioned rich mechanism fixtures and asset contracts.
```

with:

```markdown
- [x] Review five additional full video timelines through samples, scripts and WAV analysis; create evidence-backed roadmap. No continuous listening claim.
- [x] A1 — Kokoro word-timing BOS/EOS root-cause fix (predictor-frame attribution, not a truncation/stretch). Listening verification across all 32 originally-audited WAV scenes is still outstanding — code-level fix and live contract test only.
- [x] A2 — Caption gap/tail state fixed (landed in commit 5cf8c32, prior to this plan).
- [x] A3 — Numeric fill opacity now honored as a value, not a boolean (landed in commit 5cf8c32, prior to this plan).
- [x] A4 — Forced shape-diversity gate replaced with identity-aware kind collision; the director's exhausted-fallback guard is intentionally left strict.
- [x] A5 — directorSchema parameterized by scene count; the single-scene critic-repair schema mismatch (repair calls were silently no-op'ing) is fixed.
- [x] A6 — Job snapshots stamped with a generation manifest version; `docs/REVIEW_CORPUS.md` added. Full content-hash `GenerationManifest` remains a future, larger task.
- [ ] B — Versioned rich mechanism fixtures and asset contracts.
```

- [ ] **Step 2: Add a new dated entry at the top of `docs/HANDOFF.md`**

Insert, above the current `# Current handoff — 2026-09-09, multi-video architecture review` section:

```markdown
# Current handoff — 2026-09-10, Phase A baseline correctness closed

Implemented `docs/OPTIMIZATION_PLAN.md`'s Phase A (A1, A4, A5, A6 — A2/A3 had already landed in
commit 5cf8c32) per `docs/superpowers/plans/2026-09-10-phase-a-correctness-fixes.md`. Full suite:
`npm test` → 70 passed, 0 failed, 1 skipped.

What changed: A1's Kokoro BOS/EOS word-timing root cause fixed (predictor frames were being
dropped from every word's timing math — verified via a live `TEST_KOKORO_TTS=1` contract test,
not just a mock). A4's forced "every scene needs 2+ shapes" gate replaced with an identity-aware
kind-collision check (token rows, multiple keys, repeated bases no longer wrongly rejected; two
genuinely different concepts sharing a kind still fail); the exhausted-director-fallback path
intentionally stays strict. A5 found and fixed a real silent bug: the single-scene critic-repair
call was validated against the always-2-scene `directorSchema`, so every critic-requested repair
has likely been silently failing and keeping the unrepaired scene — `directorSchema` is now
`directorSchema(count)`, and a new end-to-end test proves a repair actually applies. A6 adds a
`manifestVersion` stamp to every job snapshot and a fixed named review corpus
(`docs/REVIEW_CORPUS.md`).

Known limitations, stated explicitly rather than left implicit: A1's fix is code/predictor-level
and live-contract-tested, but the full A1 acceptance criterion (human listening checks across all
32 originally-reviewed WAV scenes) was not performed — no human ears were available in this pass.
A6's manifest is a version string, not the full per-request schema/model/font/compiler hash
`GenerationManifest` contract `docs/OPTIMIZATION_PLAN.md` §4 describes — that remains future work.

Next bounded task: Phase B ("Prove expressive visuals without a model" — `src/types.ts`/`src/
schema.ts` V2 unions, `src/assets/registry.ts`, three authored mechanism fixtures: DNA fork, pump
cylinder, attention tokens) per `docs/OPTIMIZATION_PLAN.md` §5 Phase B. Do not start Phase B
inside this same session without deliberately re-reading that section first — it is a large,
separate effort per the plan's own dependency note ("Dependencies: A3/A4").

Verification: `npm test` (build + full suite) at each task boundary; no paid provider calls; no
commits beyond what was explicitly authorized for this run.

---
```

- [ ] **Step 3: Add a new dated entry at the top of `docs/RESULTS.md`**

Insert, above the current `# Latest observed results — 2026-09-09, multi-video review` heading:

```markdown
# 2026-09-10 — Phase A baseline correctness (A1, A4, A5, A6)

- Full suite: `npm test` → 70 passed, 0 failed, 1 skipped (up from 65/0/1 before this pass — 5
  new tests: 1 live-gated Kokoro timing assertion extension, 1 kind-collision unit test, 1 A4
  end-to-end generation test, 1 A5 end-to-end generation test, 1 A6 job-snapshot test).
- A1 (`scripts/kokoro_tts.py`): traced the trailing-audio defect to the duration predictor's
  BOS/EOS frame entries (`pred[0]`/`pred[-1]` per chunk) being excluded from every word's
  start/end sum despite being real synthesized audio. Fixed by attributing BOS lead-in to every
  word's start and clamping the last word's `endMs` to the true total audio duration. Verified
  live: `TEST_KOKORO_TTS=1 npm test` — first word now starts after a nonzero BOS offset; trailing
  gap after the last word is under 1ms (was previously 1.55-5.125s per the 2026-09-09 review's 32
  audited scenes). Human listening verification across those 32 scenes remains outstanding.
- A4 (`src/planner.ts`): `checkKindCollision` now allows same-kind nodes whose labels reduce to
  one stem after stripping a trailing instance marker (number/letter/ordinal) — token rows and
  multiple lettered keys pass; two different concepts sharing a kind still fail. The hard
  `checkShapeMix` gate was removed from `directScene`'s normal per-attempt path (now a
  `planner.shape-diagnostic` log line only) but deliberately left in place on the
  exhausted-director-fallback path, per the existing `'Exhausted director retries fail loudly...'`
  regression test it protects.
- A5 (`src/schema.ts`, `src/planner.ts`): found that the single-scene critic-repair call was
  validated against the fixed 2-scene `directorSchema` — a real, previously-silent bug meaning
  critic-requested repairs have likely never actually applied (the failure was swallowed by
  `repairFromCritique`'s own `catch`). `directorSchema` is now `directorSchema(count)`; a new
  end-to-end test with `visualCritic:true` proves a repair's changed `kind` now reaches the
  committed scene.
- A6 (`src/types.ts`, `src/jobs.ts`, `docs/REVIEW_CORPUS.md`): every new `JobSnapshot` carries
  `manifestVersion` (`GENERATION_MANIFEST_VERSION` in `src/jobs.ts`); added a named, stable
  review corpus table so future reports cite the same evidence set by name.
- No paid provider calls in this pass; no commits beyond what was explicitly authorized.

---
```

- [ ] **Step 4: Final full-suite check and commit**

Run: `npm test`
Expected: 70 pass, 0 fail, 1 skipped (unchanged from Task 4's Step 7 — this task is docs-only).

```bash
git add tasks.md docs/HANDOFF.md docs/RESULTS.md
git commit -m "docs: close out Phase A tracking (A1/A4/A5/A6), point next bounded task at Phase B"
```

---

## Self-review notes (recorded per the writing-plans skill, not part of the executable plan)

**Spec coverage:** A1 → Task 1. A2/A3 → already shipped, explicitly called out so no task re-does them. A4 → Task 2. A5 → Task 3. A6 → Task 4. Tracker sync (`tasks.md`/`HANDOFF.md`/`RESULTS.md`) → Task 5. Every item in `docs/OPTIMIZATION_PLAN.md` Phase A's table (A1-A6) has a task or an explicit already-done note.

**Placeholder scan:** every step in this plan contains complete, real code with no `TBD`/`similar to Task N`/unshown logic.

**Type consistency:** `directorSchema` is `(count:number)=>object` everywhere after Task 3 (definition in `schema.ts`, three call sites in `planner.ts`, test call in `validators.test.js`). `checkKindCollision`'s signature (`(scenes:LooseScene[])=>string[]`) is unchanged across Task 2. `GENERATION_MANIFEST_VERSION` is defined once in `jobs.ts` and referenced only there and in this plan's doc text (Task 4).
