# Canvas references

## Renderer contract (runtime-owned)

- Entry: `renderSVG(compiledScene, timeMs)` pure deterministic. Browser,
  contact sheets, export share it.
- V1 shapes (`directorSchema`): box, illustration, icon, circle, square,
  bullet, number, annotation. `attachTo`+`position` meaningful only for
  annotation; sentinels `''`/`'none'` otherwise.
- V2 objects: `assetRef` XOR `representation`+`primitiveRef`
  (rectangle/circle/label/equation). Roles include hero/support/structure/
  material/data/equation/annotation/label. Zones in `ZONES`.
- Relations: `causes|flows_to|contains|part_of|transforms_to|depends_on|
  labels|compares_with|activates|inhibits|moves_toward`, visualForm
  arrow/flow/leader/brace/containment/none.
- Grammar: title fade -> node reveal -> label -> edge draw+head -> fill/
  highlight -> result emphasis. Cursor follows active stroke, hides at rest.

## Semantic minimality examples

Keep: hero showing state change required by beat; support encoding a
required relation endpoint; equation node for derived quantity.
Remove: second icon restating same concept; decorative attractor with no
beat or relation coverage.

## Failure modes

- Unknown asset id -> throw (fail closed).
- Wrong-archetype asset -> stripped to label, anchor degraded to center,
  counted `representation fallback`.
- Unroutable relation -> direct line + diagnostic, job continues.
- Label overflow -> `fitLabel` shrink/truncate (>=18px floor), warned.
- Identity break (same concept, changed kind/family) -> reject.
