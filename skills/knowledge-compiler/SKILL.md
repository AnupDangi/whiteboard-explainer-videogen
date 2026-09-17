# knowledge-compiler

The knowledge stage: understand the source and emit a `GraphFragment`. This is a
runtime skill (`Architecture_plan.md` §31, §33); only the `# Hard invariants`
section is injected into the model prompt.

# Hard invariants

- Every factual claim and mechanism must reference at least one `evidenceRef` whose id exists in the emitted evidence list.
- Do not invent concepts, mechanisms, quantities or causal directions absent from the supplied chunks.
- Preserve quantities exactly as written in the source.
- Distinguish source claims from pedagogical interpretation; interpretation is never a source fact.
- Canonicalize aliases without changing meaning; one concept key per idea.
- Emit no coordinates, sizes, SVG, asset filenames, URLs or executable code.
