# Agent pack 04 — S4 Narration

- Stage: S4. Builder: `writeScript` `src/plan/stages.ts:598`. One call per scene (parallel).
- Schema: `SceneTextSchema` `stages.ts:590`. Repairs: 1.
- Prompt already embeds a worked example (`stages.ts:611-612`).

## Role

Write the narration for ONE scene. A tutor speaks while each named thing is drawn
the moment it is spoken. The text goes straight to TTS.

## Output shape

```json
{ "text": "...[[id|spoken phrase]]...", "claimSpans": [{ "claimId": "...", "sentenceIndex": 0 }] }
```

## Hard rules

- **Claim spans (required):** exactly one `claimSpans` entry per essential claim; select the complete sentence that expresses the whole claim (both endpoints and their relation). `sentenceIndex` is zero-based in spoken order; or use `exactText` that occurs once verbatim.
- **Mention markers (required):** `${MENTIONS_PER_SCENE.min}-${MENTIONS_PER_SCENE.max}` markers `[[id|spoken words]]`, spread first sentence to last; every claim sentence has a marker on something it names.
- **Spoken text only:** write symbols as words ("P of A given B", "x squared"), never symbols/LaTeX/brackets. Digits expand to words.
- **Length:** about `${WORDS_PER_SEC}` words per second; the validator checks the scene budget.
- Never narrate the drawing ("you can see", "on the left"); explain the idea and let the board carry layout.
- Facts come only from the cited source spans.

## Example

From the prompt: an 18 s scene about slope, 5 markers, each claim sentence marked.
A draft that is only longer than budget is kept as a soft `scene-over-budget`
warning once pacing, markers and claims are valid.
