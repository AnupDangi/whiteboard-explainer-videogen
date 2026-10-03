import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Credit holds shared by every process that synthesizes speech (lesson runs, benchmark trials and language demos all start as
 * separate processes against the same ElevenLabs keys). A hold names a key by hash, never by value, and belongs to a process:
 * a hold whose process has died, or whose lifetime ran out, is dropped, so a crash cannot strand credits.
 */
interface Hold { id: string; keyId: string; credits: number; pid: number; expiresAt: number }
interface HoldFile { schemaVersion: 'elevenlabs-reservations/v1'; holds: Hold[] }

const processAlive = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; } };

export class FileReservationStore {
  private readonly lockFile: string;
  constructor(private readonly file: string, private readonly options: { ttlMs?: number; lockStaleMs?: number } = {}) { this.lockFile = `${file}.lock`; }

  static keyId(key: string): string { return createHash('sha256').update(key).digest('hex').slice(0, 16); }

  private async locked<T>(work: () => Promise<T>): Promise<T> {
    await mkdir(path.dirname(this.file), { recursive: true });
    const staleMs = this.options.lockStaleMs ?? 15_000;
    const deadline = Date.now() + 30_000;
    for (let attempt = 0; ; attempt++) {
      try { const handle = await open(this.lockFile, 'wx'); await handle.close(); break; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        const age = await stat(this.lockFile).then((info) => Date.now() - info.mtimeMs, () => 0);
        if (age > staleMs) { await rm(this.lockFile, { force: true }); continue; }
        if (Date.now() > deadline) throw new Error('timed out waiting for the ElevenLabs reservation lock');
        await new Promise((resolve) => setTimeout(resolve, 5 + Math.min(attempt, 20) * 3));
      }
    }
    try { return await work(); } finally { await rm(this.lockFile, { force: true }); }
  }

  private async read(): Promise<Hold[]> {
    try {
      const parsed = JSON.parse(await readFile(this.file, 'utf8')) as Partial<HoldFile>;
      if (parsed.schemaVersion !== 'elevenlabs-reservations/v1' || !Array.isArray(parsed.holds)) return [];
      return parsed.holds.filter((hold) => hold.expiresAt > Date.now() && processAlive(hold.pid));
    } catch { return []; }
  }

  private async write(holds: Hold[]): Promise<void> {
    const partial = `${this.file}.${randomUUID()}.partial`;
    await writeFile(partial, `${JSON.stringify({ schemaVersion: 'elevenlabs-reservations/v1', holds } satisfies HoldFile)}\n`, { flag: 'wx' });
    await rename(partial, this.file);
  }

  /** Credits currently held on a key by live processes. */
  async reserved(keyId: string): Promise<number> {
    return this.locked(async () => (await this.read()).filter((hold) => hold.keyId === keyId).reduce((sum, hold) => sum + hold.credits, 0));
  }

  /** Atomically add a hold if `remaining` still covers it together with every other live hold. Returns the hold id, or undefined. */
  async tryHold(keyId: string, credits: number, remaining: number): Promise<string | undefined> {
    return this.locked(async () => {
      const holds = await this.read();
      const held = holds.filter((hold) => hold.keyId === keyId).reduce((sum, hold) => sum + hold.credits, 0);
      if (remaining - held < credits) { await this.write(holds); return undefined; }
      const id = randomUUID();
      await this.write([...holds, { id, keyId, credits, pid: process.pid, expiresAt: Date.now() + (this.options.ttlMs ?? 15 * 60_000) }]);
      return id;
    });
  }

  async release(id: string): Promise<void> {
    await this.locked(async () => this.write((await this.read()).filter((hold) => hold.id !== id)));
  }
}
