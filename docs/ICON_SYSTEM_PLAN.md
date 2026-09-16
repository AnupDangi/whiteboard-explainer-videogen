# Dynamic Representation & Icon Subsystem — Integration Plan

Status: P0–P2 implemented; P3+ not started.
Scope: add a controlled dynamic representation subsystem to the V2 semantic
pipeline. External icon retrieval is a fallback source for representation
candidates, never a renderer path.

| phase | state | where |
|---|---|---|
| P0 palette + fill modes | **done** | `renderer/palette.ts`, `AssetPart.strokeRole/fillRole/fillMode/fillOpacity`, golden SVG hashes in `test/golden-svg-hashes.json` |
| P1 normalizer | **done** | `assets/normalize/{sanitize,path,geometry,transform,colors}.ts`, `assets/external/convert.ts` |
| P2 embedded catalog | **done** | `CompiledSceneV2.assetCatalog`, `resolveAsset(ref, catalog?)`, threaded through compile/fallback/renderer |
| P3–P7 | not started | external retrieval, cache/replay, policy/ranking, benchmark, promotion |

**Path corrections** (this document was written before a repo restructure):
`src/semantic/representation.ts` is now `src/semantic/identity/representation.ts`;
the `getAsset` touch points are `compile-scene.ts` (asset lookup, anchor
resolution, facing ports), `fallback.ts:ensureAssetCompatibility`,
`visual-director.ts` (candidate metadata, archetype fit, anchors),
`illustrations.ts`, `relations.ts` and `render-svg.ts` — all now resolve through
`resolveAsset(ref, catalog?)`. `docs/v4/critical_changes.md` was deleted with the
stale docs, so its two non-goals are no longer recorded anywhere; P3 needs an
explicit decision in this file instead.

---

## 0. Objective

For an unseen concept, the system must automatically find or construct an
appropriate visual representation, safely normalize it into our semantic asset
model, use it deterministically and offline, keep scene style consistent, and
fall back gracefully when nothing suitable exists.

Success is **not** "we support Iconify". Success is:

> an unseen concept is represented by whichever tier is appropriate, the chosen
> geometry is validated and persisted into the job, the renderer stays pure and
> network-free, and the whole scene remains visually coherent.

---

## 1. Preserved invariants

```
LLM        → semantics
Resolver   → representation
Compiler   → geometry / layout
Renderer   → pixels
```

- `renderSVG(scene, timeMs)` stays deterministic and pure. No DOM, clock,
  randomness, filesystem, or network inside rendering.
- Browser and MP4 export use the exact same renderer and the same embedded data.
- Models never emit SVG, paths, coordinates, or asset ids outside the resolved
  candidate set.
- External SVG never reaches the browser or the renderer as raw markup. It is
  converted to `AssetDefinition` first; the converter is the only ingest path.
- Provider and external-source failures remain visible (journal + telemetry +
  `REPRESENTATION_DEGRADATION`), never converted into silent fixture success.

---

## 2. Fit check against the current repo

The proposal lands on existing seams. Known corrections and constraints:

- **Scene-level catalog** is the right shape. `SemanticJobStore.persistScene`
  (`src/semantic/jobs.ts:120`) serializes the whole `CompiledSceneV2` to
  `<sceneId>.json`, served at `/media/semantic/<job>/<sceneId>.json`
  (`src/server.ts:196`) and re-read by `scripts/export-semantic-job.ts:42`.
  Embedding `assetCatalog` in `CompiledSceneV2` therefore reaches browser,
  export, and replay with no extra plumbing. Per-object duplication is
  unnecessary.
- **`getAsset` is called in six places** that must become catalog-aware:
  `src/semantic/compiler/compile-scene.ts:26,42,91`,
  `src/semantic/compiler/fallback.ts:224`,
  `src/semantic/planning/visual-director.ts:36`,
  `src/semantic/renderer/illustrations.ts:6`. A scene-level catalog fixes only
  the renderer; compile, fallback, and director need it threaded.
- **`RepresentationSource` already exists**:
  `asset | composition | template | generated | abstraction`
  (`src/semantic/representation.ts:12`). `external` is additive.
- **Fill is a translucent wash only** (`src/semantic/renderer/illustrations.ts:17`,
  `fill-opacity` 0.13–0.25) and colors are a fixed six-token enum
  (`src/semantic/renderer/style.ts:1`). Palette and fill modes must land before
  any illustration import.
- **Anchors are a flat map** (`src/semantic/assets/types.ts:3`), validated
  non-empty (`src/semantic/assets/validator.ts:12`) and iterated by the compiler
  (`compile-scene.ts:42`). Keep flat; classify additively.
- **Non-goal conflict**: `docs/v4/critical_changes.md:126,129` lists
  "allow unrestricted generated SVG" and "add hundreds of assets before
  resolver works" as non-goals. This plan requires an explicit revision of
  those two lines before external retrieval is enabled.

---

## 3. Target flow

```
                        SEMANTIC CONCEPT
                              │
                              ▼
                   RepresentationRequest
                              │
                              ▼
                   Representation Resolver
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
  trusted registry      compositions           templates
        └─────────────────────┼─────────────────────┘
                              │
                        good result?
                       /            \
                     yes             no
                      │               │
                      │               ▼
                      │        External search (metadata only)
                      │               │
                      │        Candidate ranker
                      │               │
                      │           top ≤ 3
                      │               │
                      │        Fetch → Sanitize → Normalize → Validate
                      │               │
                      │        AssetDefinition (source: external)
                      │               │
                      │        suitable enough?
                      │          /          \
                      └──────── yes           no
                               │              │
                               │              ▼
                               │     constrained synthesis
                               │              │
                               │              ▼
                               │        semantic abstraction
                               ▼
                    per-job asset catalog
                               ▼
                    Visual Director → Compiler → deterministic SVG
```

Pipeline placement (unchanged stage order):

```
ingest → knowledge → teaching-architect → whiteboard-planner
       → representation-guide   ← external resolution happens HERE
       → source-visual-grounding → visual-director → compile → render
```

External retrieval runs inside the `representation-guide` stage
(`src/semantic/planning/generate.ts:129`), after local resolution fails, and its
result is journaled like every other stage output.

---

## 4. Contracts (all additive)

Nothing below changes existing behavior. `chalk-ink-v2` is the compatibility
theme and must reproduce today's SVG byte-for-byte.

```ts
// src/semantic/assets/types.ts
export type AssetColorRole =
  | 'outline' | 'primary' | 'primaryShadow'
  | 'secondary' | 'secondaryShadow'
  | 'accent' | 'neutral' | 'muted' | 'white';

export type FillMode = 'none' | 'wash' | 'solid';

export interface AssetPart {
  // existing fields unchanged: id, points, closed, stroke, fill, order,
  // durationWeight, fillAfter, semanticRole
  strokeRole?: AssetColorRole;   // alternative to `stroke`
  fillRole?: AssetColorRole;     // alternative to `fill`
  fillMode?: FillMode;           // default 'wash' == today
  fillOpacity?: number;          // default preserves today's wash math
}

export interface ConversionMetadata {
  conversionType: 'stroke_native' | 'filled_native' | 'filled_to_outline' | 'mixed';
  confidence: number;            // 0..1
  warnings: string[];
}

export interface AssetProvenance {
  provider: string;              // e.g. 'iconify'
  collection: string;            // e.g. 'tabler'
  sourceAssetId: string;         // e.g. 'database'
  licenseId: string;             // e.g. 'MIT'
  licenseUrl?: string;
  sourceUrl?: string;
  fetchedAt: string;             // ISO timestamp, plan-time only
  sourceHash: string;
  normalizerVersion: string;
}

export interface AssetDefinition {
  // existing fields unchanged
  suitability?: ('hero' | 'support' | 'symbolic' | 'annotation')[];
  semanticAnchors?: string[];    // names in `anchors` that are semantic, not bbox-derived
  conversion?: ConversionMetadata;
  provenance?: AssetProvenance;
}
```

```ts
// src/semantic/types.ts
export interface CompiledSceneV2 {
  // existing fields unchanged
  assetCatalog?: Record<string, AssetDefinition>;
}
```

```ts
// src/semantic/representation.ts
export type RepresentationSource =
  | 'asset' | 'composition' | 'template' | 'generated' | 'abstraction'
  | 'external';                  // new

export interface RepresentationRequest {
  // existing fields unchanged
  canonicalName?: string;
  aliases?: string[];
  role: 'hero' | 'support' | 'material' | 'annotation' | 'symbolic';
}
```

Notes:

- Existing assets keep using `stroke`/`fill`. New/external assets use
  `strokeRole`/`fillRole`. Renderer resolves a part color as
  `strokeRole ? palette[strokeRole] : COLORS[stroke]` per theme.
- `anchors` stays a flat `Record<string, Point>` so `validator.ts` and
  `compile-scene.ts:42` are untouched. `semanticAnchors` marks the semantic
  subset; external assets are geometric-only by default.

### Palette resolver

```ts
// src/semantic/renderer/palette.ts (new)
export type ThemeName = 'chalk-ink-v2' | 'pastel' | 'vibrant';

export interface ThemePalette {
  outline: string; primary: string; primaryShadow: string;
  secondary: string; secondaryShadow: string;
  accent: string; neutral: string; muted: string; white: string;
}
```

- `chalk-ink-v2`: maps `outline→#233832`, `primary→#367354`, `secondary→#3481a3`,
  `accent→#ce972b`, `neutral→#947154`, `primaryShadow→#bd6559`, plus paper.
  Existing `COLORS` tokens resolve to the same hex as today.
- Theme is resolved **once at compile time**; resolved hex is baked into the
  job asset catalog. The renderer never reads a theme by name.
- A golden test pins byte-identical SVG for every existing fixture under the
  default theme.

---

## 5. Resolver tiers

| Tier | Meaning | Repo source |
| --- | --- | --- |
| 0 | renderer primitives | not a source; renderer |
| 1 | trusted semantic illustrations | `asset` |
| 2 | trusted generic icons | `asset` |
| 3 | compositions | `composition` (`COMPOSITION_FAMILIES`) |
| 4 | domain templates | `template` (`assets/templates/catalog.ts`) |
| 5 | dynamic external candidate | **new `external`** |
| 6 | constrained semantic synthesis | `generated` (`representation-synthesis.ts`) |
| 7 | semantic abstraction | `abstraction` |

Rule: external search runs only when tiers 1–4 return nothing. The insertion
point is in `resolveRepresentation` (`src/semantic/identity/representation.ts:98`)
and `resolveRepresentationRequest` (`:127`), after `substringFallback` fails and
before the `generated` / `abstraction` branches.

Suitability gate: an external asset defaults to `support`/`symbolic`. It may act
as a structural **hero** only if it declares `suitability: ['hero']`, exposes the
required anchors/states, and passes the complexity budget. This prevents a
generic leaf icon from becoming the hero of a biology lesson.

---

## 6. Catalog threading (the real engineering cost)

Introduce a resolver that defaults to the static registry:

```ts
// src/semantic/assets/registry.ts
export function resolveAsset(ref: string, catalog?: Record<string, AssetDefinition>): AssetDefinition {
  return catalog?.[ref] ?? getAsset(ref);
}
```

Touch points to convert from `getAsset` to `resolveAsset`:

| File | Lines | Change |
| --- | --- | --- |
| `src/semantic/compiler/compile-scene.ts` | 26, 42, 91 | accept `catalog?` param |
| `src/semantic/compiler/fallback.ts` | 224 | receive catalog from compile-scene |
| `src/semantic/planning/visual-director.ts` | 36 | accept catalog in validate/direct |
| `src/semantic/planning/critic-repair.ts` | 58 | carry catalog when rebuilding allowed assets |
| `src/semantic/renderer/illustrations.ts` | 6 | resolve from `scene.assetCatalog` |
| `src/semantic/renderer/render-svg.ts` | 19 | pass `scene.assetCatalog` to illustration/render |

Signatures (all synchronous; no concurrency hazard):

```ts
compileScene(scene, timing, previous, catalog?)
validateDirectedScene(..., catalog?)
renderIllustration(o, draw, emphasis, state, catalog?)
```

`resolveAsset(ref)` with no catalog is exactly today's behavior, so the change
is inert until a catalog is supplied.

---

## 7. New modules

```
src/semantic/assets/external/
  types.ts     ExternalCandidateMetadata, CandidateScore, LicensePolicy, RetrievalMode
  iconify.ts   search + batch fetch, injectable fetch, timeouts, abort
  search.ts    two-phase lookup: metadata query -> top-N
  rank.ts      deterministic scoring
  policy.ts    CollectionProfile registry + strict|balanced|broad
  license.ts   hard license gate
  cache.ts     normalized asset + search metadata cache
  convert.ts   icon body -> AssetDefinition (normalize + validate)

src/semantic/assets/normalize/
  sanitize.ts  strict allow-list, fail closed
  path.ts      SVG path grammar
  geometry.ts  primitive + curve flattening
  transform.ts apply transforms before flatten
  colors.ts    third-party color -> AssetColorRole
  roles.ts     color roles, draw order, anchors, states

src/semantic/renderer/
  palette.ts   ThemeName -> ThemePalette
```

### Collection profiles (no `if (prefix === ...)`)

```ts
interface CollectionProfile {
  prefix: string;
  license: { id: string; policy: 'auto' | 'attribution' | 'blocked' };
  style: {
    outline: boolean; fill: boolean; duotone: boolean;
    roundness?: number; strokeWeight?: number; complexity?: number;
  };
}
```

The style resolver derives compatibility from profiles instead of hardcoded
prefix lists.

### Retrieval modes

```ts
type RetrievalMode = 'off' | 'strict' | 'balanced' | 'broad';
```

- `strict`: only highly compatible collections.
- `balanced` (default when enabled): preferred styles first; if no acceptable
  candidate, broaden once to other approved collections.
- `broad`: all legally approved collections.

### License gate (hard)

```
MIT / ISC / BSD / Apache-2.0 / CC0   → ALLOW_AUTO
attribution-only                     → ALLOW_ATTRIBUTION (requires provenance)
CC BY-SA (share-alike)               → BLOCK (initial policy)
NC / unknown                         → BLOCK
```

Every accepted external asset persists `AssetProvenance`, including license id
and URL. Blocked licenses are recorded as telemetry, not used.

### Sanitizer (fail closed)

Reject: `<script>`, `<foreignObject>`, `<iframe>`, external image URLs,
external `href`/`xlink:href`, event handlers, CSS `url(...)`, SMIL/animation,
embedded scripts, remote fonts.
Allow: `svg, g, path, rect, circle, ellipse, line, polyline, polygon`.
Apply transforms, then flatten.

### Complexity guards

Match existing validator limits (`src/semantic/assets/validator.ts:9-11`):
≤100 parts, ≤1000 points/part, ≤10000 total, finite coordinates, inside viewBox,
valid anchors, valid states. Add: max nesting depth, max transformed-path
complexity, max serialized asset size. Reject, never truncate silently.

### Conversion confidence

```ts
type ConversionType = 'stroke_native' | 'filled_native' | 'filled_to_outline' | 'mixed';
```

`stroke_native` and clean filled silhouettes are preferred. Multi-color complex
icons flattened to outline score low and are rejected rather than forced.

---

## 8. Persistence, replay, determinism

- Journal: the `representation-guide` stage output carries the resolved
  catalog. Existing `executeStage` + `FileStageJournal`
  (`src/semantic/harness/stage.ts:41`) replay it at zero fetch cost.
- Job tree: `.data/semantic/<job>/asset-catalog.json` and
  `.data/semantic/<job>/assets/<id>.json`.
- Compiled scene: `scene.assetCatalog` embedded, so browser and
  `scripts/export-semantic-job.ts` render offline and identically.
- Cache: `.data/icon-cache/<prefix>/<name>.json`, keyed on
  `provider + collection + name + sourceHash + normalizerVersion`. Never keyed on
  prompt text. Search metadata cached briefly per query.
- Guarantee (tested): first run performs N fetches; resume/replay performs 0.

---

## 9. Runtime budget and failure policy

```
VISUAL_ICONS        = off | strict | balanced | broad   (default off)
search timeout      1–2 s
fetch timeout       1–2 s
searches / concept  1
metadata results    ≤ 20
bodies fetched      ≤ 3
dynamic concepts/scene  bounded
```

On timeout, 404, invalid JSON, unsupported SVG, complexity violation, or blocked
license: drop the candidate, keep the primitive/synthesis fallback, and record
`REPRESENTATION_DEGRADATION` plus telemetry. The job continues. A job only fails
when no valid fallback exists at all.

LLM interaction: the director receives candidate metadata only
(`assetId`, concept, style, suitability, anchor names) — never SVG paths.

Failure-injection tests must cover: search down, timeout, malformed JSON, 404
asset, unsupported SVG, complexity violation, blocked license, archetype
incompatibility.

---

## 10. Implementation phases

```
P0  Palette + fill modes.
    palette.ts, AssetColorRole/FillMode, renderer resolution.
    Gate: chalk-ink-v2 reproduces existing SVG byte-for-byte on all fixtures.

P1  Normalizer.
    normalize/* + external/convert.ts on local SVG fixtures.
    Gate: sanitizer, path parser, transforms, complexity guards, validator pass.

P2  Dynamic embedded catalog.
    Manual external-shaped fixture -> normalize -> assetCatalog -> serialize.
    Gate: Node SVG == browser SVG == export SVG; no registry entry needed.

P3  External retrieval.
    iconify.ts, search.ts, rank.ts, policy.ts behind VISUAL_ICONS=off -> balanced.
    Wire `external` into the resolver. No raw SVG downstream.
    Gate: resolver local-first; external only on miss; director sees metadata only.

P4  Cache + replay.
    cache.ts, job artifacts, journal persistence.
    Gate: first run N fetches; replay 0; offline render identical.

P5  Policy + ranking + telemetry.
    license.ts, suitability, hero gating, candidate scoring, metrics.
    Gate: blocked licenses rejected; style modes recorded.

P6  Representation benchmark.
    Re-run the ~117-concept multi-domain sweep and report the resolution
    distribution by tier, style mode used, conversion success/reject, license
    rejects — and whether the final representation actually teaches the concept.

P7  Promotion.
    Frequent high-quality winners are reviewed and promoted into the trusted
    static registry (telemetry -> review -> static asset).
```

Recommended first slice: **P0 → P2 only, no network**. This proves palette,
normalization, and catalog determinism before any external dependency exists.

---

## 11. Tests

- Unit: relative commands, arcs, quadratics, cubics, subpaths, implicit
  repetition, transforms; `normalize(input)` twice is byte-identical.
- Security: script, external href, foreignObject, event handlers, remote image
  all rejected.
- Conversion: outline icon, simple fill, multi-fill, complex fill, unsupported.
- Resolver: local-first wins; external only on miss; failure degrades.
- Renderer: asset present only in `scene.assetCatalog` renders; scene JSON
  round-trip (stringify -> parse -> render) is identical.
- Replay: external fetch count is 0 on resume.
- Failure injection: the full list in section 9.
- Regression: existing asset/registry assertions
  (`test/semantic.test.js:27-28`, `test/semantic-richness.test.js:78`) stay
  green; the static registry is not modified by the dynamic path.

---

## 12. Telemetry and coverage metrics

```
externalSearchCount, externalSearchHitRate, externalSearchLatencyMs
externalFetchCount, externalConversionSuccessRate, externalConversionRejectRate
externalRepresentationUsed, externalHeroUsed, externalSupportUsed
licenseRejectedCount
strictMatch / balancedMatch / broadMatch
representationFallbackCount, hardRepresentationFailureCount
per-domain breakdown (biology, physics, medicine, computing, history, ...)
```

Primary product metric: `representationResolutionRate`, broken down by tier:

```
trustedAsset · composition · template · dynamicExternal · synthesis · abstraction · hardFailure
```

The distribution — not a single number — tells us where to invest.

---

## 13. Non-goals

- No raw SVG to the LLM or the renderer; the converter is the only ingest path.
- No network inside rendering or export.
- No per-icon hardcoded concept→asset map as the general mechanism. Curated
  mappings are allowed only when intentionally promoted into the trusted
  registry (P7).
- External icons are not structural heroes unless suitability and complexity
  requirements are met.
- Equations, matrices, graphs, timelines, charts, process diagrams,
  cross-sections, mechanical transforms, anatomy, attention matrices, and state
  machines remain specialized representations, not icon-search results.
- Icon search is for objects, roles, symbols, and support entities.

---

## 14. Open decisions (blockers before the relevant phase)

1. `docs/v4/critical_changes.md:126,129` — approve revising the two non-goals?
   Required before P3.
2. OpenMoji as an illustration source (license is CC BY-SA 4.0, share-alike):
   (a) do not use, (b) use with attribution + share-alike compliance,
   (c) reference-only, hand-redraw. Affects Phase 2 art direction only; the
   normalizer is source-agnostic.
3. Theme scope: ship `chalk-ink-v2` only in P0, or also `pastel`/`vibrant`?
   Recommendation: compatibility theme only first.
4. Catalog threading: accept optional-parameter threading through the six
   `getAsset` touch points, or use a scoped `AssetResolver` object?
   Recommendation: optional-parameter threading (explicit, no hidden state).
5. P7 promotion review: who signs off before a dynamic winner becomes a trusted
   static asset? Affects reproducibility hashes and the `ASSETS.length` pins.

---

## 15. Evidence caveat

The claim that a specific external system (e.g. Lamina/Simi) uses a custom or
OpenMoji-like registry is inference from video inspection, not a primary
disclosure. This plan is deliberately source-agnostic: it targets feasibility of
**our** implementation and does not assert how any other system works.

Verified primary facts used here:

- OpenMoji npm `openmoji@17.0.0`, license CC BY-SA 4.0 (graphics), LGPL-3.0
  (helpers); mandatory SVG layers `line`, `hair`, `skin-shadow`, `color`, `grid`.
- Iconify search API works without a key and indexes 200k+ icons across 200+
  collections; stroke-family prefix filtering reduces measured coverage from
  81% to 52% across a 14-domain, 117-concept sweep.
