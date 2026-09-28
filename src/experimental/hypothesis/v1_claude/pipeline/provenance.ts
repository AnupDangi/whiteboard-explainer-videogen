import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

let cached: string | undefined;

/**
 * The source commit a run was produced from, recorded in every evaluation
 * bundle (CLAUDE.md: record exactly what produced a result). "+dirty" marks
 * uncommitted tracked changes; "unknown" means the checkout has no git
 * metadata (for example an exported tarball).
 */
export function sourceCommit(): string {
  if (cached) return cached;
  const cwd = fileURLToPath(new URL('.', import.meta.url));
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' });
  if (head.status !== 0 || !head.stdout.trim()) return (cached = 'unknown');
  const dirty = spawnSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd, encoding: 'utf8' });
  cached = `${head.stdout.trim()}${dirty.status === 0 && dirty.stdout.trim() ? '+dirty' : ''}`;
  return cached;
}
