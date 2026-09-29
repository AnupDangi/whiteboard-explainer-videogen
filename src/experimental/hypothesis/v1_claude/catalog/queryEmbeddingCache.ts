import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** Content-addressed query vectors: key = sha256(model + newline + normalized text); values are base64 Float32 bytes. */
export class QueryEmbeddingCache {
  private readonly entries: Record<string, string>;
  private dirty = false;

  constructor(private readonly filePath: string, private readonly model: string) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(filePath, 'utf8'));
      this.entries = parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, string> : {};
    } catch {
      this.entries = {};
    }
  }

  private key(text: string): string {
    return createHash('sha256').update(`${this.model}\n${text.trim().toLowerCase()}`).digest('hex');
  }

  get(text: string): Float32Array | undefined {
    const value = this.entries[this.key(text)];
    if (!value) return undefined;
    try {
      const bytes = Buffer.from(value, 'base64');
      if (bytes.byteLength === 0 || bytes.byteLength % Float32Array.BYTES_PER_ELEMENT !== 0) return undefined;
      return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    } catch {
      return undefined;
    }
  }

  set(text: string, vector: Float32Array): void {
    this.entries[this.key(text)] = Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength).toString('base64');
    this.dirty = true;
  }

  async flush(): Promise<void> {
    if (!this.dirty) return;
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const sorted = Object.fromEntries(Object.entries(this.entries).sort(([left], [right]) => left.localeCompare(right)));
    const temporary = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(sorted)}\n`, 'utf8');
    await rename(temporary, this.filePath);
    this.dirty = false;
  }
}
