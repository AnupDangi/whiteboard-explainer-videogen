# Plan amendments

## 2026-09-25 — Task 5 example bank version assertion

- **Scope:** Update the existing `scene-context.test.ts` assertion for `EXAMPLE_BANK_VERSION` from `/v3/` to `/v4/`, matching Task 5's planned `mechanism-bank/v4` bump.
- **Reason:** The frozen plan explicitly required bank v4, while the existing assertion still expected v3. The Task 5 brief required reporting the mismatch before editing the assertion.
- **User approval (2026-09-25):** “Yes, update it (recommended)”
- **Applied:** `src/experimental/hypothesis/v1_claude/__tests__/scene-context.test.ts` now asserts `/v4/`.
