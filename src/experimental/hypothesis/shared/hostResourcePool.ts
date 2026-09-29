import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

interface LeaseRecord {
  schemaVersion: 'host-resource-lease/v1';
  owner: string;
  pid: number;
  hostname: string;
  resource: string;
  acquiredAt: string;
}

export interface HostResourcePoolOptions {
  signal?: AbortSignal;
  rootDir?: string;
  pollMs?: number;
}

const SAFE_ID = /^[a-zA-Z0-9_-]{1,80}$/;

function poolRoot(rootDir?: string): string {
  return path.resolve(rootDir ?? process.env.HYPOTHESIS_RESOURCE_POOL_DIR ?? path.join(os.tmpdir(), 'hypothesis-host-resource-pool'));
}

function ownerAlive(record: LeaseRecord): boolean {
  if (record.hostname !== os.hostname() || !Number.isInteger(record.pid) || record.pid < 1) return true;
  try {
    process.kill(record.pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

async function reapDeadLease(filePath: string): Promise<boolean> {
  let before: LeaseRecord;
  try {
    before = JSON.parse(await readFile(filePath, 'utf8')) as LeaseRecord;
  } catch {
    const info = await stat(filePath).catch(() => undefined);
    if (!info || Date.now() - info.mtimeMs < 60_000) return false;
    await rm(filePath, { force: true }).catch(() => undefined);
    return true;
  }
  if (before.schemaVersion !== 'host-resource-lease/v1' || ownerAlive(before)) return false;
  const current = await readFile(filePath, 'utf8').catch(() => undefined);
  if (!current || current !== JSON.stringify(before)) return false;
  await rm(filePath, { force: true }).catch(() => undefined);
  return true;
}

async function acquire(resource: string, limit: number, options: HostResourcePoolOptions): Promise<() => Promise<void>> {
  if (!SAFE_ID.test(resource)) throw new Error(`Invalid host resource pool name: ${resource}`);
  if (!Number.isInteger(limit) || limit < 1 || limit > 128) throw new Error('Host resource pool limit must be an integer from 1 to 128');
  const signal = options.signal;
  const root = poolRoot(options.rootDir);
  const directory = path.join(root, resource);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const owner = randomUUID();
  const record: LeaseRecord = { schemaVersion: 'host-resource-lease/v1', owner, pid: process.pid, hostname: os.hostname(), resource, acquiredAt: new Date().toISOString() };
  const contents = JSON.stringify(record);
  const pollMs = Math.max(10, Math.min(500, options.pollMs ?? 60));
  let start = 0;

  while (true) {
    if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error('Host resource wait was aborted');
    for (let offset = 0; offset < limit; offset++) {
      const slot = (start + offset) % limit;
      const filePath = path.join(directory, `${slot}.lease`);
      try {
        const handle = await open(filePath, 'wx', 0o600);
        try {
          await handle.writeFile(contents, 'utf8');
          await handle.sync();
        } finally {
          await handle.close();
        }
        return async () => {
          const current = await readFile(filePath, 'utf8').catch(() => undefined);
          if (current === contents) await rm(filePath, { force: true });
        };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        await reapDeadLease(filePath);
      }
    }
    start = (start + 1) % limit;
    await delay(pollMs, undefined, signal ? { signal } : undefined).catch((error: unknown) => {
      if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : error;
      throw error;
    });
  }
}

/** Acquire a host-shared filesystem lease and release it even when work throws. */
export async function withHostResourcePermit<T>(resource: string, limit: number, work: () => Promise<T>, options: HostResourcePoolOptions = {}): Promise<T> {
  const release = await acquire(resource, limit, options);
  try {
    return await work();
  } finally {
    await release();
  }
}
