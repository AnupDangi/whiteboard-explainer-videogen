# Claude hypothesis track — project instructions

This repository is an independent research prototype, not Lamina Labs source code. Follow the current compiler-refactor roadmap and phase status in `docs/HANDOFF.md`, and the implementation as it exists in `docs/ARCHITECTURE.md`. `claude_pipeline.md` records the earlier V1 hypothesis for historical comparison; the former `hypothesis/v1_claude/` reference tree is not present in this checkout. Read `docs/HANDOFF.md`, then `docs/ARCHITECTURE.md`, before implementation work.

## Content must come from data, never topic-specific runtime branches

Runtime code may define style tokens, drawing algorithms, generic template geometry, schemas, validation, and deterministic fallbacks. It must never inject lesson claims, labels, numbers, relations, narration, or topic-specific icon choices by branching on a lesson title, case ID, source filename, golden ID, or keyword list. A template may define *how* to draw a matrix or process; the validated scene data must supply its factual contents.

Hand-authored plans, answers, and expected values belong only in `fixtures/`, `__tests__/`, or explicitly versioned few-shot data. Fixture results must be labeled as fixtures and never counted as generated planner results. Every factual visual value must trace to a source evidence reference or be explicitly marked as an illustrative example. Missing evidence, provider output, alignment, or required assets must remain a visible failure or draft state; never convert it into a passing result.

For architecture and visual-quality work, do not render, inspect, compare, or score retained legacy fixture media or hand-authored scene outputs. They may be referenced as historical code-path records, but cannot establish renderer quality, planner quality, Simi parity, or architecture ranking. Only complete source-generated lessons may enter C6/E1/E5 visual review. Synthetic fixtures are permitted for isolated code-contract tests, not for visual or cost measurements. Do not run fixture-render commands as a substitute when generated lessons are unavailable.

Never edit frozen source inputs, Simi references, expected outputs, or golden hashes just to make a check pass. If a baseline is wrong, preserve it and add a separately versioned correction with the reason and review record. Review every new template and visual fallback for topic-specific content injection; add a regression test that changes topic and values while keeping the template fixed.

## Architecture and reproducibility

- Models emit validated scene data only. Do not execute model-generated JavaScript/Python, SVG paths, or a Manim pipeline.
- Keep `renderSVG(scene, timeMs)` deterministic and shared by browser playback and export. Do not use wall-clock animation state.
- Keep estimates and injected delays labeled. Never report fixture throughput as live model/TTS performance.
- Record actual model IDs, prompt/schema/catalog versions, input hashes, costs, stage times, cache state, fallbacks, and gates for each run.
- Hard schema, factual provenance, alignment, layout, readability, license, audio/video sync, or budget failures block `passed`; diagnostic previews may still be retained as drafts.
- Keys stay in `.env`; media and job outputs stay in `.data/`; exports stay in `output/`. Never add secrets or uploaded competitor videos to Git.
- A local result establishes feasibility of this implementation, not how Lamina works. Use primary disclosures for claims about Lamina.
- Do not push, publish, or change the production runtime unless the user explicitly requests it. Local commits on branch `teaching-compiler-v2` are authorized (user, 2026-10-02: "keep on committing"): commit after each completed, verified task (typecheck + tests green), small atomic commits, never commit secrets or `.data/`, never rewrite frozen plan files.

## Verification and evidence log

Use the commands present in `package.json`: `pnpm run typecheck:hypothesis` and `pnpm run test:hypothesis`. The `test:hypothesis` command builds `dist/` before running the offline suite. Paid provider and judge runs must be reported separately from offline tests, with quota/provider failures preserved.

After a material change, update the existing hypothesis plan/validation docs and append exact commands, results, limitations, and the next bounded task to `docs/HANDOFF.md`. Track each acceptance item as `implemented`, `tested`, `passed`, `failed`, or `unmeasured`; implementation alone is not a pass.

## Frozen implementation plans

Files listed in `docs/superpowers/plans/plan-lock.json` are frozen. Never edit, reformat, `chmod`, or regenerate them or the lock file. `__tests__/plan-lock.test.ts` fails the offline suite if their bytes or read-only mode change. Record progress in `docs/HANDOFF.md`. Record scope changes in the plan's `.amendments.md` file, and quote the user's dated chat approval verbatim in each amendment.
