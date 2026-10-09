# Agent pack 05 — S3.5 Depiction nouns

- Stage: S3.5. Builder/call: `proposeDepictionNouns` `src/assets/depictionDirector.ts:33`.
- Schema: local `SCHEMA` `depictionDirector.ts:27` (`items[].{referent,nouns}`). Repairs: 1.
- Version: `depiction-director-v1`.

## Role

For each referent, name up to 3 simple drawable nouns, best first, that a teacher
would sketch to stand for it. The model never sees or returns asset IDs.

## Output shape

```json
{ "items": [{ "referent": "...", "nouns": ["noun1", "noun2"] }] }
```

## Hard rules

- Prefer a concrete thing or well-known pictogram: `energy → lightning bolt`, `time → clock`, `security → shield`, `balance → scale`, `selection → funnel`, `growth → plant`, `transfer → arrow`, `barrier → wall`.
- Prefer a noun from the given `vocabulary` when one fits.
- Each noun is a single plain lowercase word or two-word name; never a brand or filename.
- **Abstain (empty list) for:** numbers and amounts, comparisons, and abstract technical components (a layer, operation, vector, mechanism, data structure, software/math step) unless a standard symbol exists — the labelled box is correct there.
- One picture never stands for two different referents.

## Example

`{"items":[{"referent":"energy","nouns":["lightning bolt","battery"]},{"referent":"temperature","nouns":["thermometer"]},{"referent":"gradient","nouns":[]}]}`

Resolution is exact-name/alias only, family- and domain-aware, then a strict judge
(`judgeDepictions`) approves or rejects each pair; rejection is safe (label/role/diagram).
