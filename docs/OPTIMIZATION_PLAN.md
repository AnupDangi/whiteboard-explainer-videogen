# agents_optimization_v2 — Optimization Plan

Date: 2026-09-09
Goal: Close the gap between current prototype and Lamina Labs-class whiteboard explainer quality.

## Current State (Phases 0-5 complete)

- 60 tests passing, 0 failing
- 28 MP4 outputs generated (1/5/10-min matrix)
- Teaching planner with arc roles (hook/build/example/payoff/recap)
- Visual Director with 32 kinds, 8 shapes, 7 layouts
- Pencil cursor, critic, Kokoro TTS, parallel export
- Cost: ~$0.20/10min plan, $0 voice; latency: 173s wall for 10min

## User-Reported Gaps

1. Doesn't feel like a real teacher is teaching
2. Content overlap / crowded scenes
3. Missing "how to start teaching" context
4. Icons/visuals not polished enough

## V2 Target Gaps (from replication target)

| Gap | Current | Target |
|---|---|---|
| Teacher persona | AI-generated narration | Real instructor voice with hooks, analogies, misconception addressing |
| Semantic storyboard | Lite version | Shared semantic events drive narration + visuals |
| Scene density | 2-6 nodes, sometimes crowded | 2-6 primary objects, split when crowded |
| Overlap | Preflight catches it | Smarter compiler avoids it proactively |
| Pencil cursor | Perimeter follower | Follows active path, jumps between regions |
| Text measurement | Character ratios | Actual rendered text bounds |
| Connector routing | Straight lines | Curved, intelligent attachment |
| Scene transitions | Hard reset | Clear completion → transition → new title |
| Annotation system | Basic captions | Semantic annotations with relative placement |
| Color semantics | Limited | Per-concept semantic colors |
| Rich illustrations | Basic multi-part | More detailed, stage-driven |

## Optimization Phases

### Phase 6 — Teacher Persona & Pedagogy (HIGH IMPACT)

**Problem**: Narration reads like AI content, not a teacher explaining to a student.

**Changes**:
1. Enhance planner content prompt with explicit teaching methodology:
   - Hook opening: "Have you ever wondered..."
   - Transition phrases: "Now let's see...", "Notice what happens..."
   - Analogy invitations: "Think of it like..."
   - Misconception addressing: "You might think... but actually..."
   - Check-for-understanding: "So when we look at..."
   - Recap closings: "To summarize what we just saw..."
2. Add `teacherTone` to outline schema with style guidance per arc:
   - hook: curious, question-driven
   - build: methodical, step-by-step
   - example: concrete, "here's one"
   - payoff: "aha" moment, significance
   - recap: summary, "so remember"
3. Narration rhythm: vary sentence length, add pauses (",", "...") for natural speech
4. First-person plural: "we're going to see", "let's look at"

### Phase 7 — Semantic Storyboard v2 (HIGH IMPACT)

**Problem**: Narration and visuals generated somewhat independently.

**Changes**:
1. Expand `keyPoint` into `semanticEvent` with:
   - `meaning`: the core teaching intent
   - `narrationIntent`: what the narrator should communicate
   - `visualIntent`: what should appear/draw
   - `emphasis`: similarity/comparison/cause/result
   - `annotation`: optional semantic label
2. Content stage emits semantic events, not just nodes/edges
3. Director and TTS both derive from same semantic events
4. Anchors align to semantic event boundaries, not just word positions

### Phase 8 — Scene Density & Overlap Prevention (HIGH IMPACT)

**Problem**: Scenes sometimes feel crowded or overlapping concepts.

**Changes**:
1. Add `conceptBudget` per scene: max 4-5 distinct concepts
2. Explicit split triggers in planner:
   - More than 5 primary visual objects → split
   - Learning objective changes → split
   - Diagram topology changes → split
   - "from definition to example" → split
3. Smarter layout compiler:
   - Priority-based placement (important nodes first)
   - Force-directed fine-tuning after initial placement
   - Connector-aware spacing (reserve space for arrows)
   - Text-measurement-aware (use actual bounds)
4. Scene note auto-promotion only when density < 4 nodes

### Phase 9 — Visual Polish (MEDIUM IMPACT)

**Problem**: Icons/illustrations feel basic.

**Changes**:
1. Icon redesign: more detail, consistent stroke weight, hand-drawn feel
2. Add more intermediate detail to illustrations (stage 1.5 between outline and fill)
3. Semantic color system:
   - Per-concept colors (not just per-kind)
   - Same concept = same color across scenes
   - Warm colors for actions, cool for data, green for positive, red for negative
4. Better highlight effects (marker sweep with texture)
5. Scene background: subtle grid or dot pattern for whiteboard feel

### Phase 10 — Pencil & Transitions (MEDIUM IMPACT)

**Changes**:
1. Pencil cursor improvements:
   - Follow actual stroke path, not just perimeter
   - Jump quickly between unrelated drawing regions
   - Fade in/out smoothly
   - Tilt based on stroke direction
2. Scene transitions:
   - "Scene complete" signal (brief pause, slight fade)
   - Clear canvas sweep (wipe or fade)
   - New title reveal with underline
   - Brief anticipation pause before next concept

### Phase 11 — Text Measurement & Connectors (LOWER IMPACT)

**Changes**:
1. Actual text measurement:
   - Use canvas measureText when available
   - Fallback to opentype.js for Node
   - Cache measured widths per font/size
2. Connector improvements:
   - Curved routing (quadratic bezier)
   - Smart attachment points (midpoint of shared edge)
   - Avoid text and objects
   - Arrowhead with proper sizing

### Phase 12 — Latency & Cost Optimization (HIGH IMPACT)

**Changes**:
1. Streamed outline: yield chapter titles as they're planned, don't wait for all
2. Parallel TTS + planning overlap: start TTS for scene N while planning scene N+1
3. Faster fallback models for simple scenes
4. Cache scene geometries across similar topics
5. Reduce model calls: combine outline+content where possible

## Implementation Order

1. **Phase 6** (Teacher Persona) — biggest quality jump, no architecture change
2. **Phase 8** (Density/Overlap) — fixes user's #2 complaint
3. **Phase 7** (Semantic Storyboard v2) — improves coherence
4. **Phase 12** (Latency) — improves user experience
5. **Phase 9** (Visual Polish) — incremental improvement
6. **Phase 10** (Pencil/Transitions) — polish
7. **Phase 11** (Text/Connectors) — technical debt

## Success Metrics

- Human rater: "feels like a teacher explaining" (target: 4+/5)
- Overlap incidents: 0 (preflight + compiler)
- Scene density: 2-5 concepts per scene (enforced)
- Cost per minute: <$0.02 plan, $0 voice
- First playable: <15s
- Total generation: <60s for 1min, <120s for 5min
