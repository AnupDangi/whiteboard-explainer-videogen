# Fallback protocol

1. Scope: pages + bbox; record why native failed.
2. pdfplumber: `extract_text(layout=True)` or `extract_tables` with tuned
   `vertical_strategy`/`horizontal_strategy`/tolerances; `to_image()` +
   `debug_tablefinder()` for visual check.
3. Merge: preserve page numbers + char offsets into document map; keep
   quotes verbatim for `evidenceRefs` validator.
4. Log `pdfFallback: {pages, reason}` in job record.

Upstream technique catalog (conditional read): `.agents/skills/pdf-extraction/SKILL.md`.
