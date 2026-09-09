# Video quality review — 2026-09-09

This review supports [the implementation roadmap](OPTIMIZATION_PLAN.md). It evaluates our independent implementation, not Lamina's private technology. No application source was changed or paid generation performed during this review.

## Assessment

We can plausibly get substantially closer to the supplied reference with the existing deterministic rendering approach. The current output is not close in explanatory visual quality across the reviewed topics. The bottleneck is a restrictive representation of meaning, compounded by timing and graphics defects. More model calls, a larger icon count, or higher resolution alone will not solve it.

The core change is from **a graph of named concepts** to **a sequence of visible explanatory actions on structured illustrations and diagrams**. Preserve source ingestion, validated data, provider boundaries, budgets, deterministic playback, and export. Evolve the representation and compiler in place behind a versioned path.

Narrow-domain reference-level scenes are a realistic engineering objective. Consistent quality across arbitrary prompts and five-minute lessons remains an empirical question. We have no same-prompt, blinded competitor benchmark and cannot assign a defensible percentage of parity or promise a date for it.

## Review coverage and method

Reviewed five additional outputs across their full timelines: 14 minutes 37.6 seconds of media in total. Inspected ordered frames at approximately five-second intervals, two short four-frames-per-second windows, selected full-resolution frames, saved scene narration, event schedules, and WAV sample energy. This is a sampled visual/transcript review, **not continuous audiovisual listening**. Voice naturalness, pronunciation, perceptual lip/word synchronization, and exact spoken boundaries were not rated. Contact-sheet empty cells are extraction padding, not black frames in the videos.

The prior review inspected our 55.5-second DNA sample and only the first 60 seconds of the supplied 75.5-second Lamina attention reference. No additional competitor footage was reviewed here. Different topics and generation dates limit direct quality comparisons.

| Output | Actual duration | Scenes | Matching saved job |
|---|---:|---:|---|
| DNA, filename ending `5min.mp4` | 257.583 s | 10 | `510070ba-235d-410b-8dbf-e49842befa66` |
| Plate tectonics, `5min.mp4` | 232.750 s | 10 | `5a1a37aa-7784-4927-8611-f4dee95d3b0c` |
| Printing press, `5min.mp4` | 288.250 s | 10 | `20798a2a-b6ad-407f-9510-b82bc9356dec` |
| Test file `f91546db-ab9d-424d-805f-8d21dc48e765.mp4` — bicycle pump | 51.667 s | 2 | `9381afa8-19f2-4f48-9f56-a49fb9e02855` |
| GPS, `Explain-how-GPS-determines-your-location-1min.mp4` | 47.333 s | 2 | `f5d1fdd7-3ccc-4417-8cca-93aa845e6edb` |

Job matches use scene titles, narration visible in captions, and duration agreement within one 12-fps frame; an export provenance manifest was not available. The test MP4's filename is not its matching saved job ID. Do not confuse the other bicycle-pump jobs with this file.

All five exports are 1280×720 at 12 fps, with audio. The reference is 1920×1080 at 30 fps. Full video paths and SHA-256 hashes are in [the evidence manifest](../output/review-2026-09-09/manifest.json). Source file hashes are in [code-baseline.json](../output/review-2026-09-09/code-baseline.json).

The three long jobs and GPS lack `visualIntent`; the reviewed pump has it on all four primary nodes. Thus the long videos establish historical output defects, while the pump and direct source probes show several limitations persist with the current metadata. Absence of metadata alone does not prove an artifact's exact generation revision.

## Recurring findings in the videos

Times below are rounded from saved scene boundaries, except selected exact-frame references.

| Video and interval | Observed representation | Missing teaching operation |
|---|---|---|
| DNA 00:26–00:48 | Twisted ladder is a small molecule glyph; separated strands are a box | Show two paired strands and expose complementary templates |
| DNA 00:48–01:14 | Helicase is a tool glyph; replication fork is a purple rectangle | Draw the Y-shaped fork named in the narration |
| DNA 01:14–01:41 | Polymerase is a robot icon beside a constraint box | Show matching bases and a consistent synthesis direction |
| DNA 02:09–02:36 | Fragments are another molecule glyph | Draw separate pieces and show the gaps being joined |
| DNA 03:51–04:18 | “Half old and half new” is text in a green box | Show two daughter duplexes, each with old/new strand identity |
| Tectonics 00:43–01:07 | Core, rock, plume, and sinking rock form a horizontal chain | Show circulation in a cross-section |
| Tectonics 01:29–01:48 | New crust is an arrow-linked result box | Show a spreading boundary with emerging material |
| Tectonics 02:08–02:36 | Subduction becomes a horizontal chain; fault box is almost unreadable | Show descending slab, locked interface, and release of strain |
| Printing 00:49–01:21 | Letter stamps are a tool glyph and a “290” label | Show reusable letter blocks, arrangement, and reuse |
| Printing 01:21–01:50 | Ink and leverage are two static concepts | Show type, ink, paper, platen, and impression |
| Printing 02:28–03:05 | A real person illustration appears | Positive evidence: richer figures work, but are isolated rather than central to the mechanism |
| Pump 00:00–00:52 | Air/pressure labels and a lock glyph for a valve | Show the cylinder, piston positions, open/closed valves, and airflow |
| GPS 00:25–00:47 | “Three Overlapping Spheres” is a rectangle | Show intersecting ranges and explain the dimensional simplification |

Representative extracted frames:

![DNA at 63 seconds: a named fork without fork geometry](../output/review-2026-09-09/dna-fork-63s.png)

![Tectonics at 143 seconds: dark fault fill and cramped relationship labels](../output/review-2026-09-09/tectonics-fault-143s.png)

![GPS at 36 seconds: named spheres without intersecting geometry](../output/review-2026-09-09/gps-spheres-36s.png)

### Long-form continuity and pacing

DNA uses `timeline` in 8/10 scenes; printing also uses it in 8/10; tectonics uses it in 6/10. Repetition is not inherently wrong, but these arrangements do not express the different spatial mechanisms being taught. The three videos contain only 24, 25, and 31 primary nodes respectively. The problem is often insufficient explanatory structure, not too many objects.

In DNA, leading strand becomes an `attract` box while lagging strand becomes a `repel` icon. Later, the pair becomes a `pipeline` box. In GPS, the satellite broadcast is rendered as a server rack. These are intelligible substitutions only after reading labels. The vocabulary/prompt encourages approximate category mapping instead of detecting an unsupported visual concept.

Saved schedules contain long intervals without node/edge drawing: up to 14.88 seconds in DNA; 20.53 seconds in the printing type scene; 19.055 seconds in the press mechanics scene. This metric excludes subtitle updates, fills, transitions, and deliberate reading holds. It is a diagnostic, not a rule to insert decorative motion every few seconds. Here the intervals coincide with narration describing actions absent from the board.

The three nominal five-minute files are respectively 14.1%, 22.4%, and 3.9% shorter than 300 seconds. Decide whether duration is approximate or a contract. Do not meet a duration target by adding silent padding or making an instructor speak unnaturally fast/slow.

## Confirmed code defects and architectural constraints

### 1. Word alignment needs investigation before further pacing tuning — highest priority

All 32 audited WAV scenes from DNA, tectonics, printing, and the matching pump job have audio extending **1.55–5.125 seconds beyond the last word timestamp**. For DNA alone the range is 3.075–5 seconds. The WAV lengths agree with `timing.durationMs`; this does not establish correct word alignment.

The uncovered intervals contain substantial signal: in DNA scene 1, 34/50 100-ms windows after the final recorded word exceed −40 dBFS RMS. Similar non-silent intervals appear throughout the other audited scenes. This is evidence against treating them as mere silent tails. Energy does not identify spoken words or establish their exact boundaries; a listening/forced-alignment audit is still required.

`scripts/kokoro_tts.py` runs audio synthesis and recomputes duration-predictor output separately. It aggregates a separate G2P tokenization using phoneme-string lengths, without a demonstrated exact mapping to the filtered model token sequence including punctuation/separators/BOS/EOS. These are candidate causes, not a completed diagnosis. Do not fix this by globally stretching timestamps or truncating audio. Trace token identity and timing on actual audio first.

Evidence: [audio-tail-evidence.json](../output/review-2026-09-09/audio-tail-evidence.json). Sampling used 16-bit PCM WAV, 100-ms windows, RMS threshold −40 dBFS; no ASR or auditory evaluation was performed.

### 2. Caption reset is confirmed independently

`sceneState()` returns `activeWord = -1` outside recorded word intervals. `renderSVG()` computes `captionStart = max(0, activeWord - 6)`, displaying the opening words again. This is visible repeatedly across the corpus. Correct short-gap hold/long-gap hide behavior and genuine phrase wrapping are required. The current 14-word single line is not a two-line subtitle layout.

### 3. Fill opacity is treated as a boolean

Compilation sets `fillOpacity = 0.25`; box/circle/square rendering uses its truthiness to animate opacity to 1. A source probe of the current tectonics scene produced three full-opacity fills despite 0.25 declarations. The dark fault box at 02:23 is concrete evidence of the resulting readability problem. Fix numeric opacity composition and validate the final composited colors, including highlights.

### 4. The quality rules reject useful reference structures

Direct probes of current validators show:

- `checkKindCollision()` rejects `Key: SAT` and `Key: MAT` sharing `kind: key`.
- `checkShapeMix()` rejects a row of token boxes.
- `checkConceptBudget()` counts distinct kinds rather than semantic concepts or perceptual groups.

The first two are natural structures in the supplied reference. Separate instance identity, semantic type, and visual role. Repeated objects should usually share appearance. Preserve warnings for misleading visual ambiguity, but remove arbitrary shape diversity as a hard gate.

### 5. Visual intent has no executable semantics

`PlanNode` carries a string intent and one word anchor; `PlanEdge` has no event/phrase anchor. The director schema only changes existing node metadata and a layout enum. It cannot construct a repeated strand, expose a subpart, draw a graph from values, or specify a multi-event mechanism. A model can describe a rich visual that the schema cannot represent.

### 6. Geometry is safe only in a limited sense

Seven slot layouts are followed by text growth, illustration growth, and annotation placement. Text measurement uses Helvetica advance approximations while rendering requests DejaVu Sans/fallbacks. Annotation `position` is accepted but its placement candidates always try below/right/left/above; the declared preference is ignored. Short notes may be attached to the first primary node regardless of semantic ownership.

`preflightScene()` does not measure actual glyph bounds, arrow-label footprints, shape-specific text containment, connector intersections, or contrast. Connectors attach to node rectangles, not necessarily visible icon/ellipse boundaries. Curved connectors are bowed lines, not obstacle-routed paths. Crowded edge labels remain visible in the extracts even with substantial unused canvas elsewhere.

### 7. Drawing and timing are not one compiled event system

Edges start at `max(endpoint start) + 700 ms`, unrelated to the spoken relationship. Illustrations take 1700 ms to draw. Multiple events can compete for one pencil. Icon/illustration pencils follow an invisible bounding rectangle; the stroke being revealed can be elsewhere. Bézier pencil progress uses the curve parameter while dash reveal uses arc length, another possible source of mismatch.

### 8. Critic capability is narrower than its name

The critic sees a completed 640×360 scene with estimated timing, title, node names, and layout. It cannot evaluate actual pacing from this input. Its single-scene repair request reuses a schema requiring exactly two scenes. This is a contract mismatch, not proof every repair fails: a provider could return an extra scene that the merge ignores. Repair can change only current visual metadata, so it cannot repair missing mechanism structure. Errors can silently keep the original scene; review disposition is not a strong persisted quality gate.

### 9. Scheduling is partly optimized, but measurement and control need work

Current code already parallelizes chapter preparation (up to five), overlaps speculative Kokoro TTS with direction, and renders export frames in batches. Do not reimplement these as if missing.

Speculative speech starts before the later scene semaphore and character reservation. It can submit more work than the apparent scene limit implies. `ttsMsByScene` measures time waiting on the promise, not full synthesis wall time when work started earlier. The Python server comment describes serialization, but the bridge directly accesses model internals; thread-safety/throughput must be verified rather than inferred from the comment. Queue wait, actual service time, speculative waste, and first-scene priority need separate measurement.

### 10. Factual grounding is part of visual quality

Quantity/key-point checks demonstrate matching text, not truth or a correctly drawn mechanism. The tectonics narration correctly mentions melting in the overlying mantle, then calls it a “melting slab,” while its visual reduces everything to hot rock. The standard subduction explanation needs to distinguish fluid release from the slab and melting above it. [USGS diagram and explanation](https://www.usgs.gov/media/images/subduction-zone-3).

Historical first/invention claims and precise quantities in the printing script also need sources and contextual qualification before approval; this review has not verified every such claim. More persuasive visuals must not make unsupported claims appear more authoritative.

## Performance evidence — historical jobs, not a new benchmark

| Job | First playable | Prepared completion | Recorded model cost |
|---|---:|---:|---:|
| DNA 5-minute request | 17.947 s | 41.477 s | $0.030429 |
| Tectonics 5-minute request | 15.988 s | 39.487 s | $0.030383 |
| Printing 5-minute request | 15.755 s | 45.201 s | $0.026664 |

These are saved job measurements, not export completion, not paid TTS pricing, and not total operating cost. Their output durations differ. File-derived frame rate and duration were checked afresh. Do not compare these prepared-completion times directly against Lamina's advertised approximately 40 seconds for a one-minute explainer. [Lamina public description](https://www.laminalabs.ai/).

## What to retain and what to change

Retain the deterministic data-driven architecture. Strengthen the semantic representation, teaching contracts, asset grammar, actual alignment, and compiler. Treat rich illustrations as composable mechanisms with named parts, not just bigger icons.

Change the priority order in the old optimization plan: timing and visible correctness first; typed events and expressive mechanisms next; global identity and teaching continuity alongside them; model ablations and throughput optimization after controlled quality evidence. Teacher catchphrases, more detailed icons, and a grid background are not adequate substitutes for this work.

## Verification and evidence limits

`npm test` on 2026-09-09: build passed, 64 tests passed, 0 failed, 1 skipped, with loopback permission for HTTP tests. [Test log](../output/review-2026-09-09/tests.log). This suite does not establish perceptual or factual quality. No source fixes, commits, pushes, new videos, model purchases, or uploads of private media were made.

The source-probe findings are reproducible from `engine.ts`, `planner.ts`, `schema.ts`, `jobs.ts`, and the saved jobs. The contact sheets and [job evidence](../output/review-2026-09-09/job-evidence.json) are local ignored artifacts; they are not guaranteed to exist in another checkout. Audio evidence and source hashes preserve what this review actually checked. Future quality claims require current-code regeneration, human listening, source review, and matched-prompt comparisons.
