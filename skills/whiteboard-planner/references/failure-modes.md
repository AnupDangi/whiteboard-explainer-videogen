# Planner failure modes

- Anchor paraphrase -> resolver throws; fix by copying exact span.
- Missing evidenceIds on source-grounded node -> grounding reject.
- Decorative edge (no beat/requirement coverage) -> critic duplication FAIL.
- Emitted layout/kind/shape -> schema additionalProperties reject.
- New semanticKey for known concept -> identity fork; reuse registry slug.
