import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { ReplayFixture } from '../structured/replayClient.js';

/**
 * Run-level replay inventory (V2 plan Phase 1.2, STCC §19/§24). Every model call writes a
 * `replay-fixture.json` under `<run>/structured/<stage>/<n>-<subject>/`; this module collects
 * them into one deterministic chain so a completed run can be re-executed offline, free, and
 * bit-identically (the `replayClient` serves a recorded response only when the request hash
 * matches). It never edits artifacts and makes no provider calls.
 */
export interface ReplayFixtureEntry {
  /** Run-relative path of the fixture file. */
  path: string;
  stage: string;
  subject: string;
  model: string;
  schemaName: string;
  /** Number of recorded responses (attempts) for this call. */
  responses: number;
}

/** Collect every replay fixture under a run directory, sorted by path (deterministic order). */
export function collectReplayFixtures(runDir: string): ReplayFixtureEntry[] {
  const structured = join(runDir, 'structured');
  const entries: ReplayFixtureEntry[] = [];
  const walk = (dir: string): void => {
    let names: string[];
    try { names = readdirSync(dir).sort(); } catch { return; }
    for (const name of names) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name === 'replay-fixture.json') {
        const fixture = JSON.parse(readFileSync(full, 'utf8')) as ReplayFixture;
        entries.push({ path: full.slice(runDir.length + 1), stage: fixture.stage, subject: fixture.subject, model: fixture.model, schemaName: fixture.schemaName, responses: fixture.responses.length });
      }
    }
  };
  walk(structured);
  return entries;
}

/** True when every fixture is well-formed and carries at least one response (a replayable chain). */
export function replayChainProblems(entries: readonly ReplayFixtureEntry[]): string[] {
  const problems: string[] = [];
  if (!entries.length) problems.push('run has no replay fixtures; nothing to replay');
  const seen = new Set<string>();
  for (const entry of entries) {
    const key = `${entry.stage}|${entry.subject}`;
    if (seen.has(key)) problems.push(`duplicate replay call ${key}`);
    seen.add(key);
    if (!entry.stage.trim()) problems.push(`${entry.path}: missing stage`);
    if (!entry.schemaName.trim()) problems.push(`${entry.path}: missing schemaName`);
    if (entry.responses < 1) problems.push(`${entry.path}: recorded no responses`);
  }
  return problems;
}

/** Load one fixture by stage and subject (the key the recorder writes). */
export function loadReplayFixture(runDir: string, entry: ReplayFixtureEntry): ReplayFixture {
  return JSON.parse(readFileSync(join(runDir, entry.path), 'utf8')) as ReplayFixture;
}
