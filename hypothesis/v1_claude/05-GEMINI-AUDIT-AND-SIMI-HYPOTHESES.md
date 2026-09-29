# 05 — Gemini Audit and Simi Hypotheses

Two parts: (A) what Gemini got right/wrong, each mapped to an experiment that settles it; (B) what is publicly known about Lamina Labs / Simi, and what we can reasonably infer about their stack — clearly separated.

---

## Part A — Claim-by-claim audit

| # | Gemini claim | Verdict | Settled by |
|---|---|---|---|
| 1 | Simi uses metaphors, not literal icons (key, chest, `?` box) | ✅ Correct — visible in frames | E6, E4 |
| 2 | Formulas/arrays/matrices/meters are procedural, not icons | ✅ Correct — the most important insight | E5 (primitives per scene) |
| 3 | Remove 168×132 cards; freeform canvas | ✅ Correct | E2 |
| 4 | Simi renders raw LaTeX | ⚠️ Not visible in any frame; "X+Y=Z" is text in a box. You still need math for user PDFs | E9 (formula-heavy doc) |
| 5 | "katex + commander-svg" server-side SVG | ❌ KaTeX outputs HTML; commander-svg unknown. Use `mathjax-full` | S-4 |
| 6 | Everything through Rough.js / svg2roughjs, hachure fills | ⚠️ Overstated. Simi = clean marker strokes + flat pastel fills. Rough on small icons hurts legibility; random unless seeded | E7, S-5 |
| 7 | Static metaphor dictionary table | ⚠️ Right idea, wrong mechanism — a static table is hardcoding. Use retrieval-grounded selection from a general catalog | E4 |
| 8 | "Guarantees 100% visual coverage" | ❌ Overclaim. Coverage of *something*, not of *correct* visuals | E6, semantic-match metric |
| 9 | Static SVG + stroke-dashoffset makes things "draw" | ⚠️ Only for stroke paths. Filled icons and MathJax glyphs need outline-then-fill or clip wipe | S-2, S-4 |
| 10 | `@remotion/svg`, "interpolatedPath hook" | ❌ Wrong names → `@remotion/paths` (`evolvePath`, `interpolatePath`). License caveat omitted | S-7 |
| 11 | dagre / d3-hierarchy for layout | ✅ Usable; elkjs better for labeled layered flows; templates matter more than auto-layout | S-9 |
| 12 | flubber, opentype.js, fontkit | ✅ Real | — |
| 13 | "Simi's LLM does not pass drawing commands to a sub-agent at runtime" | ❓ Unverifiable from outside. Plausible, but don't build on it | — |
| 14 | "Path you are on is logically sound and architecturally complete" | ⚠️ Missing: word-level sync, 1 fps problem, style normalization, catalog grounding, harness, planner model quality, license handling | Files 01–03 |

What Gemini missed entirely:
- **Composition with badges** (lock + ⚠ = security flaw; brain + ✗) — the combinatorial trick that covers abstract concepts.
- **Your 1 fps render** — no animation is possible at 1 fps; this alone explains a lot of the "not Simi" feeling.
- **Scale and occupancy** — your elements use ~2–5% of the frame; Simi's scenes fill ~50–70%.
- **Planner quality** as the ceiling on scene design.
- **Measurement**: "resolved %" rewards wrong icons; semantic match must replace it.

---

## Part B — Lamina Labs / Simi: known facts

Public reporting (as of the searches for this plan; verify for newer info):

- Lamina Labs is a Y Combinator Spring 2026 company, founded 2025, San Francisco, two-person founding team: Sudip Rokaya and Kartikesh Mishra (both MIT). Source: https://www.ycombinator.com/companies/lamina-labs
- YC profile describes the company as building infrastructure for near-real-time structured video generation, focused on videos that teach and explain rather than cinematic clips. Source: same.
- Reported $4.8M raised; the founders previously tried automating Manim and abandoned it as hard to make reliable for broad use. Source: https://runtimewire.com/article/lamina-labs-raises-4-8-million-simi-ai-explainer-video
- The company says Simi writes the script, produces and animates illustrations, and adds narration; a 1-min video in as little as ~20 s (fastest runs), ~40 s per the product page benchmark; 80+ languages. These are the company's own claims. Source: runtimewire (Japanese/Chinese editions carry the same text).
- Inputs include prompts and documents (PDF, Word, PowerPoint, text/markdown); a Python SDK / API exists. Source: https://mer.vin/2026/05/simi-by-lamina-labs-whiteboard-explainer-videos-from-prompts-and-documents/
- Reported early traction: thousands of users and ~187 paying customers within 12 days of launch (founder-attributed via Nepali Times). Source: runtimewire.

## Part C — Inferences (hypotheses, not facts)

| Hypothesis | Confidence | Reasoning | What it means for you |
|---|---|---|---|
| H1: They use frontier LLM APIs, not a proprietary foundation model | High | 2-person team; pretraining is not feasible at that size/funding; 80+ languages out of the box matches frontier LLM + multilingual TTS | You have access to the same class of intelligence. Planner prompt/DSL design is the differentiator |
| H2: LLM emits a constrained structured scene format; deterministic renderer draws | High | They abandoned free-form Manim code generation for reliability; frames show consistent templates and primitives | Same bet as this plan. Validated direction |
| H3: A curated/generated single-style illustration library | Medium-high | Every illustration shares stroke weight, palette and doodle style across unrelated topics | Build the catalog + normalizer + offline factory. "Produces illustrations" in their claims may mean an asset-generation step, possibly offline or cached |
| H4: A live player (structured scene data played in the browser), MP4 export separate | Medium | "Near-real-time structured video" + ~20–40 s per minute is hard with naive frame-by-frame rendering + encode | Build Mode B player (file 01 §8); measure time-to-first-frame |
| H5: Heavy parallelism (scenes planned concurrently) | Medium | Same latency argument | Parallelize S6 per scene; stream scenes to the player as they finish |
| H6: Fine-tuned smaller models for some stages | Low–unknown | Possible with funding and user data; no public evidence | Don't chase this. Revisit after you have thousands of judged scenes (that's your fine-tune dataset) |
| H7: Better tested than you | High | Real users + paying customers → a daily stream of failure cases | Your harness + goldens + real-doc set is how you compress that advantage. Ship early to real learners |

---

## Part D — Final verdict

**Can this architecture reach Simi-level video?**

- **Visual style: yes.** Nothing in their frames requires technology you don't have. Clean strokes, flat pastel fills, one illustration family, marker lettering, stroke-reveal animation, freeform templates — all engineering. Expect parity within 1–2 weeks if you follow file 02 and E1 passes.
- **Scene design: yes for familiar topics, uncertain for arbitrary uploads until measured.** "Query Meets Keys" quality comes from the planner understanding the mechanism and a DSL expressive enough to draw it (operators, meters, token strips, convergence templates). With a strong planner model + few-shots + judge-driven iteration, you should match them on common STEM/CS/business topics in 2–6 weeks. Arbitrary documents (dense papers, legal text) are where both products will be weakest; your E9 numbers decide.
- **Speed: plausible** with parallel planning + live player; not with your current per-frame pipeline.
- **Robustness at scale: not immediately.** Their lead is usage volume. Yours can be a better harness and a tighter focus (learning-platform integration, tutor-style teaching plans, Nepali/South-Asian languages and curricula) where their generalist product is less tuned.

**Where you can actually beat them** (worth designing for from day one):
1. **Teaching structure** — tutor intro, section roadmap, time-aware plans for 1/5/10/30/60 min, recap; personalized per learner via the learning platform.
2. **Math/formula depth** — a real formula primitive with annotated derivations (`formula_focus`), which their current frames don't show.
3. **Transparent quality** — gates and judge scores per video; useful for institutions.
4. **Local languages and curricula** — Nepali narration + Devanagari lettering done well.

The honest limit: architecture gets you to their level; beating them depends on the eval loop and real users, not on the diagram.
