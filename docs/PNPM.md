# pnpm — production and worktree guideline

Single package manager: **pnpm 10** (pinned via `packageManager: pnpm@10.28.2` in
root and `voice-engine` manifests). No npm commands anywhere in docs, skills,
or scripts. CI enforces this with `--frozen-lockfile` installs.

## Install

```bash
pnpm install --frozen-lockfile        # root; CI fails if lock is stale
pnpm --dir voice-engine install       # only needed for TTS work
```

Never `npm install` (creates `package-lock.json` / npm-layout `node_modules`
that break the frozen gate). Never commit lockfiles other than
`pnpm-lock.yaml`. Never commit `node_modules/`, `dist/`, `.data/`, `output/`,
`.env` (all gitignored).

## Daily commands

```bash
pnpm run typecheck:hypothesis       # tsc, no emit
pnpm run test:hypothesis            # build + manifest + node + python suites
pnpm run baseline:verify            # frozen baselines + v3 relocations
pnpm run video:one-shot -- --prompt="..." --source=<file> --duration=60 --id=<name>
pnpm run preview:hypothesis -- <run-dir> [port]
```

`test:hypothesis` rebuilds `dist/` first; always run it (not bare `node --test`)
so the manifest check runs.

## Adding / upgrading a dependency

```bash
pnpm add <pkg>            # runtime dep (updates pnpm-lock.yaml — commit it)
pnpm add -D <pkg>         # dev dep
pnpm --dir voice-engine add <pkg>   # voice-engine dep (commit its lock too)
```

Then `pnpm run test:hypothesis` before committing. In CI, an out-of-sync
lockfile fails the install step by design.

## Worktrees (v2b and later)

Each worktree is an independent checkout with its own `node_modules/` and
`dist/` (both ignored). After creating a worktree:

```bash
cd <worktree>
pnpm install --frozen-lockfile
pnpm --dir voice-engine install   # TTS work only
pnpm run build
```

Python sidecars need no install (stdlib-only tests). The alignment `.venv`
and model weights live per-checkout and are never committed. `git worktree
list` shows registrations; remove dead ones with `git worktree remove --force
<path>` (never plain `rm` on a registered worktree).

## Troubleshooting

| Symptom | Fix |
|---|---|
| `ERR_PNPM_OUTDATED_LOCKFILE` in CI | run `pnpm install` locally, commit the lock change |
| `Cannot find module` after branch switch | `pnpm install --frozen-lockfile && pnpm run build` |
| `shared/MANIFEST.sha256 is stale` | `pnpm run manifest:shared`, commit it |
| Lock `requires a known pipeline version` | needs a git checkout with at least one commit |
| Store bloat | `pnpm store prune` (never delete the store mid-install) |

## Production notes

Publish readiness requires a clean typecheck, a zero-exit current
`test:hypothesis`, a zero-exit `baseline:verify`, and clean `git diff --check`.
Use the live test summary; historical test counts are not current evidence.
Videos stay `draft` until S5 alignment calibration is measured and human
muted-board review passes. Paid provider runs are diagnostics, never CI.
