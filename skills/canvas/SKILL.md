---
name: canvas
description: Deterministic whiteboard canvas access for explain-canvas-lab agents — logical canvas, shapes, icons, illustrations, layouts, drawing grammar.
---

# Canvas skill — the only drawing surface agents may use

Agents never emit SVG, pixels, or executable drawing code. Agents emit
validated scene **data**; `src/engine.ts` owns all geometry and rendering.
This skill documents the canvas contract so planner/director prompts stay
grounded in what the renderer can actually draw.

## Logical canvas

- Size: **1280 × 720**. Title band occupies y < 150, subtitle bar y 640–698.
- Safe drawing region: x in [0, 1280], y in **[150, 600]**.
  `compileScene` + `preflightScene` reject anything outside it.
- Render entry: `renderSVG(compiledScene, timeMs)` — pure, deterministic,
  shared by browser playback and MP4 export. Same timestamp ⇒ same pixels.

## Node shapes (mix them — never one shape for a whole scene)

1. `box` (default) — rounded-rect outline drawn stroke-by-stroke
   (dash reveal, 900 ms), small kind glyph top-left, centered label,
   pastel fill after 35%. Best for steps, processes, containers.
2. `icon` — **paste the kind's icon large with the label written BESIDE it,
   no box border or fill.** Icon pops in with a quick scale+fade (first 35%
   of the 900 ms draw), label reads on beside it. Best for simple actors,
   objects, symbols the viewer should recognize before reading.
   Requires `kind` to have an icon (everything except `generic`).
   See `src/icons.ts` + `hasIcon()`.
3. `illustration` — full multi-part figure drawn stroke-by-stroke in stages
   (major outline 45% → secondary detail 30% → fill wash 25%, 1700 ms total)
   with a caption strip below. Valid for kinds with a reusable figure:
   `user, teacher, student, agent, server, model, plant, sun, browser,
   phone, robot, pipeline`. See `src/illustrations.ts` + `hasIllustration()`.
   At most one (rarely two) per scene; never for abstract concepts.
4. `circle` / `square` — box behavior with round/sharp containers (circle has
   no corner glyph). Best for cycles, cells, round entities / rigid artifacts.
5. `bullet` — no container; label renders as a bulleted key-point list
   (points separated by `. `, ≤120 chars). Best for recap/takeaway nodes.
6. `number` — round badge with the count BIG. Best for narrated quantities.
   Short labels only; type shrinks to fit.
7. `annotation` — short floating caption attached via `attachTo` (target node
   id) + `position` (below|above|left|right); compiler places it, plus scene
   notes auto-promote to marginalia. Best for definitions, units, warnings.

A rich scene mixes shapes, e.g. one illustration + two icons + one box.

## Kind vocabulary (`src/vocabulary.ts` — single source of truth)

`generic, question, key, container, database, model, user, document, api,
cloud, memory, search, vector, token, brain, lock, warning, success, graph,
matrix, agent, server, file, image, request, response, idea, teacher,
student, book, example, result, equation, probability, atom, cell, energy,
input, process, output, loop, choice, attract, repel, note, tool, cycle,
light, temperature, molecule, plant, sun, browser, phone, robot, pipeline`

- `generic` renders no glyph — use only when nothing fits.
- Kind selects the icon glyph AND the accent stroke color (`src/style.ts`).
- Same concept repeated across scenes keeps the same kind + color.
- Opposites get opposite kinds (`attract` vs `repel`) — never one kind for both.
- Edges accept short verb labels (≤24 chars); emphasis nodes get a highlight wash.

## Layouts (topology before coordinates — never emit x/y)

`flow` loosely-related grid · `branch` one source → outputs (node 0 =
source) · `convergence` sources → one result (LAST node = result) ·
`compare` side-by-side · `hierarchy` root + children (node 0 = root) ·
`timeline` strict left-to-right sequence · `radial` center + satellites
(node 0 = center). 2–6 nodes per scene; compiler resolves geometry,
connector routing, whitespace, safe regions. One learning objective per
scene — split crowded scenes instead of shrinking.

## Drawing grammar (`renderSVG`)

Title fade-in → node outline/icon/illustration reveal → label/caption →
edge path draw + arrowhead → fill/highlight → result emphasis. A pencil
cursor follows the single active stroke (perimeter point for boxes,
path point for edges) and hides at rest. Visual order tracks narration
anchors: object may start ~80 ms before its spoken term.

## Constraints agents must respect

- Labels ≤ 40 chars (engine wraps + rejects overflow); titles ≤ 70.
- `wordIndex` is resolved server-side from a verbatim 1–3 word `anchor`
  copied exactly from the scene narration — never invent indices.
- 2–6 nodes, ≤ 10 edges, edges reference same-scene node ids only.
- Never place annotations by coordinates; `note` (≤ 170 chars) is the
  only caption channel and the compiler positions everything else.
