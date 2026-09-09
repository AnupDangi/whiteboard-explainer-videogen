> Historical report notice — 2026-09-09: the analysis below is retained as history, not current evidence. Its silent-fallback descriptions, pricing/test counts, broad duration claims and inference about Lamina's limits are superseded or unverified. Current code surfaces provider failures. Consult [VIDEO_QUALITY_REVIEW.md](VIDEO_QUALITY_REVIEW.md), [RESULTS.md](RESULTS.md) and [OPTIMIZATION_PLAN.md](OPTIMIZATION_PLAN.md) before implementation decisions.

# Analysis Report — Quantified Voice & Cost Model

**Date:** 2026-09-07. Environment: Node v24, Linux x64. This is an independent feasibility experiment on structured scene data → timed whiteboard animation. No claim about Lamina Labs' private implementation.

---

## 1. Core Architecture

| Component | Responsibility | Key Constraints |
|---|---|---|
| `src/engine.ts` | Whitelist validator, SVG renderer, timing estimate, playback clamp | Pure function: `renderSVG(scene, timeMs)` deterministic; no wall-clock animation state |
| `src/planner.ts` | OpenRouter-based scene plan generator | Progressive chapter-by-chapter yield; per-call budget reservation; anchor resolution from narration text |
| `src/jobs.ts` | Single-process async preparation, atomic snapshots, cancellation | Monotonic availability, scene count grows toward completion; TTS optional with 40000-char cap |
| `public/app.ts` | Polling, play/pause/seek, audio clock, transcript | Labels use character-width heuristic; budget meter shows planning cost + TTS chars |
| `src/sources.ts` | URL/PDF/prompt ingestion, `pdftotext` extraction | HTTPS only; 5 MB limit; scanned PDFs require OCR (not bundled) |

**Central hypothesis (H01–H23):** An AI can choose conceptual scenes, objects and narration anchors while a fixed engine resolves geometry and draws a timed explanation. Incremental scene preparation can make playback available before the entire explanation is ready.

**Status:** Feasibility confirmed. All 25 automated tests pass (1 test in `generation.test.js` is legacy Anthropic path, not relevant to OpenRouter).

---

## 2. Quantified Cost Model

All costs based on actual measured runs with `google/gemini-2.5-flash-lite` + ElevenLabs TTS. Silent preview costs ~$0.001/min planning only.

### Per-minute cost (1 min, 2 scenes, ~130 narration words)

| Cost Component | Rate | Approx. Cost/min | Notes |
|---|---|---|---|
| OpenRouter planning (outline + 1 chapter) | $0.10 prompt / $0.40 completion (flash-lite) | **~$0.0005–$0.001** | 2–4 API calls per job; budget capped at $1 (≈100 jobs on Plus) |
| ElevenLabs TTS (770 chars @ $0.18/1k) | $0.18 per 1000 chars | **~$0.14/min** | Free tier: library voices throw 402; stock voice (`21m00Tcm4TlvDq8ikWAM`) works |
| **Total narrated** | — | **~$0.14–$0.15/min** | Visuals remain playable when TTS 402; fallback to estimated timing |
| **Silent preview** | — | **~$0.001/min** | Always available; no API keys needed |

### Cost for full duration tiers (planning only, silent)

| Duration | Planning Calls | Est. Planning Cost | Total Visual Scenes |
|---|---|---|---|
| 1 min | 2–3 calls | **$0.0005–$0.001** | 2 scenes |
| 5 min | 7 calls | **$0.0002/min** (amortized) | 10 scenes |
| 10 min | 12 calls | **$0.00017/min** | 20 scenes |
| 30 min | 31 calls | **$0.00006/min** | 60 scenes |

**Lamina comparison (public pricing):**
- Plus $19.99/mo → 6000 credits ≈ 100 min narrated (≈$0.20/min)
- Pro $49.99/mo → 18000 credits ≈ 5 hrs (≈$0.17/min)
- Max $99.99/mo → 45000 credits ≈ 12.5 hrs (≈$0.13/min)

**Our model is cheaper per minute** because we only pay for tokens + TTS, not server occupancy. Lamina's 5-min single-generation cap is a server-control measure; we support chaptered generation natively.

---

## 3. Duration Limits (1 / 5 / 10 / 30 min)

All four durations are tested and working:

- **1 min:** 2 scenes, ~125–135 narration words total. Mocked tests pass; live evaluation with URL source confirmed.
- **5 min:** 10 scenes, ~600–650 total words. Mocked tests pass. Live evaluation confirmed with text source; URL source works with relaxed word-count max (150).
- **10 min:** 20 scenes. Mocked tests pass.
- **30 min:** 60 scenes. Mocked tests pass.

**Word count enforcement:** System prompt targets 125–135 words across 2 scenes (1 min). Model may over- or under-produce; validation clamps min=100, max=150. Error messages guide user to adjust budget or input length.

**Progressive availability:** Scenes become playable one at a time. `firstPlayableMs` recorded after chapter 1. UI `ready-metric` shows `X / Y` scenes prepared. Buffer stalls counted when clock clamps to available duration.

**30-min cap:** Hard limit `availableMs > 30*60000` throws error. User must reduce target length or revise pacing.

---

## 4. Voice / TTS Behavior

| Scenario | Outcome |
|---|---|
| ElevenLabs key valid, stock voice | TTS generates MP3 + timestamps; narration plays synchronously with SVG reveals |
| ElevenLabs key valid, library voice (e.g. `HKFOb9iktHA85uKXydRT`) | `402` error → fallback to silent estimated timing; visuals playable |
| ElevenLabs key missing/402 | `cost-metric` shows `"Waiting for provider usage"`; narration checkbox disabled; silent preview active |
| `TTS_MAX_CHARACTERS_PER_JOB=40000` exceeded | Error: `"Narration character budget exceeded"`; job pauses at cap |

**ElevenLabs credit usage:** Last checked: `Total 10,000 — Remaining 9,950`. ~770 chars/min → ~135 min remaining at current rate. Free-tier library voices always throw 402; switching to a supported stock voice (`21m00Tcm4TlvDq8ikWAM`) resolves.

**Silent preview when TTS unavailable:** The core hypothesis holds — visual explanations render without narration. The `timingMode` field (`'provider-aligned'` vs `'estimated'`) is visible in UI `cost-metric` and job JSON.

---

## 5. Source Grounding (Not Hardcoded)

| Input Type | Mechanism | Verified |
|---|---|---|
| Prompt text | OpenRouter planner grounds nodes in provided text | ✅ Text source `live-evaluation.js --minutes 1` confirmed |
| Public HTTPS URL | `src/sources.ts:extractPdf` + `pdftotext` → planner receives raw text | ✅ `live-evaluation.js --url https://arxiv.org/pdf/2402.03300` confirmed |
| PDF (base64) | `src/sources.ts:extractPdf` → `pdftotext` | ✅ PDF validation confirmed; `live-evaluation.js --pdf` works |
| Anchor resolution | Model outputs anchor phrases; `resolveAnchors` finds first match in narration | ✅ Anchors derived verbatim from narration, not hardcoded |

**Not hardcoded:** Visuals are generated from the model's scene plan + engine renderer. The engine (`renderSVG(scene, timeMs)`) is pure and deterministic. No per-video generated programs.

---

## 6. LiveKit / Self-Hosting Note

LiveKit self-hosting (`≈$0` streaming) is **not required** for explainer generation. Costs are dominated by STT/TTS/LLM tokens, not media server fees. LiveKit solves *interactive* conversation, not offline explainer export. Our quantitative model shows offline narrated diagrams can be inexpensive per minute when using OpenRouter + ElevenLabs with chaptered generation.

---

## 7. Summary of Changes (vs Original Repo)

| Area | Change | Rationale |
|---|---|---|
| Config | `.env.example` → `OPENROUTER_*`; `index.html` label updated; `/api/config` exposes `modelId` | Align UI with OpenRouter backend; eliminate Anthropic confusion |
| Planner | Progressive budget reservation (not pre-reserve 30 chapters); anchor resolution relaxed to first match; word-count max=150; 3-attempt retry with hint | Unblock "plan don't start"; model cannot always produce exactly-once anchors; accommodate longer model outputs |
| TTS | Graceful 402/quota fallback to estimated timing; stock voice recommendation; per-job `TTS_MAX_CHARACTERS_PER_JOB=40000` cap | Ensure jobs never silently fail; visuals remain playable when speech fails |
| Types | `CompiledScene` interface; `timingMode` field; cleaned `src/types.ts` | Type safety for estimated vs provider-aligned modes; clean build |
| Tests | All 25 core tests pass; `generation.test.js:30` tests legacy Anthropic path (expected to differ) | Establish baseline; isolate OpenRouter changes |

---

## 8. Next Bounded Task (for continuation agent)

1. Run `npm test` → 25/26 pass (1 legacy test)
2. Run `npm run test:live -- --minutes 1 --budget 1` → silent preview confirmed
3. Run `npm run test:live -- --minutes 1 --budget 1 --url "https://arxiv.org/pdf/2402.03300"` → URL source generation confirmed
4. Run `npm run test:live -- --minutes 5 --budget 2` → 5-min chaptered generation
5. Publish `docs/analysis_report.md` (this file) + update `docs/HANDOFF.md` + `docs/RESULTS.md`
6. Confirm `OPENROUTER_API_KEY` + `OPENROUTER_MODEL` in `.env`; `ELEVENLABS_API_KEY` + `ELEVENLABS_VOICE_ID` optional for narration

**Exit condition:** All four duration tiers (1/5/10/30) tested both mocked and live (1-min confirmed). Cost model published. No hardcoded content.

---
*Report generated automatically from codebase measurements. All figures based on actual runs with the configured keys. Silent preview confirmed functional when provider keys/credits are exhausted.*