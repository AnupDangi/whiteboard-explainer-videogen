# Architect examples

Prefer motivation-first:

```text
KV cache grows with context -> memory expensive
-> can we store compressed representation? -> MLA
```

over definition-first `MLA is...`.

Beat delta example: before "attention stores all keys" / after "MLA stores
compressed latent, cutting memory at lookup cost". Same-before/after beats
get removed.
