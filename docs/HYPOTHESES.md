# Hypothesis register

> **Historical.** Superseded by [VIDEO_QUALITY_REVIEW.md](VIDEO_QUALITY_REVIEW.md) (2026-09-09) and the roadmap in [OPTIMIZATION_PLAN.md](OPTIMIZATION_PLAN.md). Entries below reflect a pre-illustrations, pre-critic, pre-Kokoro state of the code; do not use them as current acceptance evidence.

Updated: 2026-09-07. Owner: Anup Dangi. Version: 0.1.

## Research question

Can a constrained scene document, reusable renderer and speech-aligned event timeline produce a useful progressive whiteboard explanation without generating a new executable animation program per request?

This is a feasibility study. None of the implementation choices below establishes Lamina Labs' private architecture. An interview reports abandoning an initial Manim automation attempt; Lamina describes deterministic animation infrastructure; its API documents playback while rendering. Exact model ownership, renderer, scene representation and transport remain undisclosed.

Confidence refers to inference about Lamina, not confidence that our code works. Experiment outcomes are tracked separately in RESULTS.md. “Implemented” is not “validated at production scale.”

| ID | Hypothesis about a possible implementation | Inference strength | Falsifiable experiment for OUR prototype | v0.1 scope |
|---|---|---|---|---|
| H01 | A planner separates content into conceptual scenes. | Stronger | E04: independent reviewers can identify one learning objective per generated scene. | Fixtures and optional planner; human review pending. |
| H02 | Scene duration follows speech instead of a fixed 15-second chunk. | Plausible | E02: change word timings; duration changes without truncating final events. | Implemented. |
| H03 | A global outline precedes detailed preparation. | Plausible | E04: compare outline-first against isolated scene prompting for contradictions. | Outline-first only; ablation pending. |
| H04 | A model produces typed scene data. | Stronger | E01/E04: fixtures and model plans use identical validation/rendering; invalid plans fail closed. | Implemented; live model pending. |
| H05 | Visual objects have stable identity and geometry. | Plausible | E01: revealing later nodes never changes earlier node bounds. | Implemented. |
| H06 | Coordinates live in a logical canvas space. | Plausible | E05: identical relative geometry at 640 and 1280 output widths. | 1280×720 logical space; responsive scaling. |
| H07 | Layout uses constraints as well as model intent. | Plausible | E01/E06: 2–6 nodes across three layouts stay in bounds and do not overlap. | Three fixed arrangements; no freeform solver. |
| H08 | Text is measured before scene commitment. | Plausible | E06: compare heuristic wrapping against actual font metrics and long-label stress inputs. | Heuristic wrapping only; actual measurement unresolved. |
| H09 | Connectors attach to node anchors. | Plausible | E01: all connector endpoints lie on their source/target node boundaries. | Implemented; crossing optimization pending. |
| H10 | A limited primitive vocabulary covers many explainers. | Stronger for supplied sample | E04: reviewers assess coverage across 20 diverse prompts. | Boxes, text, lines, arrowheads; coverage untested. |
| H11 | Illustrations may be reusable or generated assets. | Plausible | E07: measure concept coverage with and without a small icon library. | Deferred; no image assets used. |
| H12 | Shared style tokens provide visual consistency. | Stronger for supplied sample | E05: all scenes use the same type, palette and stroke rules. | Implemented. |
| H13 | Draw animation reveals prepared geometry. | Stronger | E01/E05: intermediate stroke progression and stable finished geometry. | SVG stroke reveal; no raster diffusion. |
| H14 | Visual order follows narrative meaning. | Stronger for supplied sample | E04: human review of node-to-word anchors. | Indices supported; fixture anchors are illustrative. |
| H15 | Speech and graphics are separate stages. | Plausible | E02/E03: fake speech response changes timing without altering layout. | Provider adapter, stage boundary implemented. |
| H16 | Alignment maps speech to drawing events. | Plausible | E02: known character timestamps resolve repeated words by ordinal index. | Alignment adapter implemented; real speech validation pending. |
| H17 | A shared timeline drives preview and export. | Plausible | E01/E05: seeking to a timestamp reproduces the same SVG and exported frame. | Shared pure renderer; browser audio QA pending. |
| H18 | Work continues while earlier scenes are available. | Stronger | E03: observe a nonterminal job with one playable scene and subsequent duration growth. | Sequential preparation in background with concurrent playback. |
| H19 | Cached assets or geometry improve throughput. | Plausible | E07: benchmark cache on/off while holding content and resolution constant. | Deferred. |
| H20 | Media segments or drawing events are delivered incrementally. | Stronger; transport unknown | E03: available duration grows monotonically; reconnect recovers a full snapshot. | JSON scene snapshots through polling; no HLS. |
| H21 | Playback buffers rather than outrunning prepared content. | Plausible | E03: inject a delay longer than the buffer; clock stops at available boundary and resumes. | Pure clock clamp implemented; browser QA pending. |
| H22 | Invalid scenes are detected and failures are recoverable. | Plausible | E01/E03: reject malformed input, cancel preparation, preserve prior committed scenes. | Validation and cancellation; no automatic model repair yet. |
| H23 | A small specialized model could plan scenes cheaply. | Weak | E08: compare two accessible models for schema validity, latency, quality and measured cost. | No trained model; adapter only. |

## Competing explanations still viable

1. A model could generate restricted drawing code rather than JSON.
2. Scenes could be prepared raster illustrations revealed through masks.
3. Planning could be complete before playback while only encoding remains active.
4. Client playback could be a video stream rather than live object rendering.

The finished MP4 does not distinguish these. Testing our design cannot settle those claims.

## Sources

- [Founder interview, Nepali Times, June 21 2026](https://nepalitimes.com/nepali-duo-goes-from-kathmandu-valley-to-silicon-valley): initial Manim attempt, its abandonment, discussion of a small model without technical training details.
- [Lamina company profile](https://www.linkedin.com/company/lamina-labs): deterministic animation positioning.
- [Lamina HTTP API](https://www.laminalabs.ai/docs/getting-started): background jobs, stream availability and final media.
- [Lamina Node SDK](https://www.laminalabs.ai/docs/node-sdk): resumable progress-event interface.
- [tldraw agent architecture](https://tldraw.dev/docs/ai): a public example of typed actions on a canvas; no evidence Lamina uses tldraw.
- ElevenLabs timing API (historical implementation reference): removed from this repository on 2026-09-12; narration is now local-only via Supertonic 3 / Piper.

No competitor source code, brand assets, or supplied competitor video is included in this repository.
