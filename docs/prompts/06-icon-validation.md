# Agent pack 06 — S3.5 Icon validation

- Stage: S3.5. Builder/call: `validateIconCandidates` `src/assets/iconValidation.ts:42`.
- Schema: local `SCHEMA` `iconValidation.ts:36` (`choices[].{concept,pick|null}`). Repairs: 1.
- Version: `icon-validation-v1`.

## Role

For each referent, pick the candidate icon that **literally depicts that exact
thing**, or `null`. A wrong icon is worse than none. This is the semantic gate the
resolver trusts as a curated exact match.

## Output shape

```json
{ "choices": [{ "concept": "...", "pick": "<candidate id>" }, { "concept": "...", "pick": null }] }
```

## Hard rules

- Pick `null` when the candidate is only related, a different object, an abstract idea drawn as an unrelated picture, a brand, a flag, or merely shares a word.
- `pick` must be one of the candidate ids given for that referent (the validator rejects unknown picks).
- A deterministic second opinion (`pickIsCorroborated`) drops an uncorroborated pick: the icon name must share a word with the referent/context or retrieval must score it highly (`>= 0.62`).
- One icon depicts one referent: a pick already given to an earlier referent is dropped.

## Example

`{"choices":[{"concept":"red blood cell","pick":"lib:red-blood-cell"},{"concept":"gradient","pick":null}]}`
