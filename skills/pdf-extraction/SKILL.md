---
name: pdf-extraction
description: >
  Conditional PDF fallback. Use only when native pdftotext ingestion fails or
  tables/positions are required. Never auto-load for every PDF job.
---

# Purpose

Recover text/tables/positions from PDFs the native path
(`src/explainer/sources.ts`: `pdftotext -raw` + `buildPageText`) cannot
handle: scanned pages, table-heavy reports, figure regions. Keeps heavy
pdfplumber context out of the default pipeline.

# When to use

Native extraction failed, returned empty/garbled tables, or the planner
needs cell structure/char positions for a table-heavy source.

# When NOT to use

Default PDF path. Native `extractPdf` covers text PDFs faster with page
offsets and tail-cut. Do not load this skill speculatively.

# Inputs

- PDF bytes/path + page range + need (text | tables | region bbox).
- Native failure evidence (empty output, missing tables).

# Outputs

- `{text, pages[{page, start}], tables[]}` consumed by document-map builder
  and evidence-quote validator. Quotes must remain verbatim for grounding
  checks. Nothing else emitted.

# Hard invariants

- Native first; fallback only on observed failure.
- Page-aware offsets preserved; no silent tail drop beyond TEXT_LIMIT.
- Scanned/image PDFs need OCR first; pdfplumber alone is not OCR.
- Costs/tokens bounded: targeted pages/regions, never whole-book dump when
  a region suffices.

# Decision procedure

1. Try native; on table/position gap, scope minimal pages + region.
2. Extract with layout/tolerance tuned per PDF; visually debug tables.
3. Merge back into page-text with offsets; re-run grounding validator.

# Failure conditions

- Whole-document bulk extraction without scoping; invented cell values;
  dropped page offsets; OCR need misreported as success.

# Repair behavior

Tune tolerances, crop region, or escalate to OCR; record fallback use in
job log so fixture-vs-source provenance stays clear.

# Success criteria

- Previously missing tables/quotes recovered verbatim with page offsets;
  grounding validator passes; fallback logged as conditional, not default.

# Representative evals

- `eval:table-recovery`: report PDF where native misses table ->
  fallback recovers cells verbatim. See `references/fallback.md`.
