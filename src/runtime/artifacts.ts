import {createHash, randomUUID} from 'node:crypto';
import {mkdir, readFile, rename, stat, unlink, writeFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import type {ArtifactReference} from '../types/runtime.js';

interface ArtifactPutOptions {
  kind: string;
  mediaType: string;
  version: string;
}

export interface ArtifactStore {
  put(bytes: Uint8Array, options: ArtifactPutOptions): Promise<ArtifactReference>;
  get(hash: string): Promise<Uint8Array | undefined>;
  has(hash: string): Promise<boolean>;
}

export const artifactHash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

function assertHash(hash: string): void {
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('Invalid sha256 artifact hash');
}

/** Filesystem content-addressed store. A temporary file is checksum-verified and
 * atomically renamed before a reference is returned, so partially-written output
 * can never be observed as a promoted artifact. */
export class FileArtifactStore implements ArtifactStore {
  readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  private pathFor(hash: string): string {
    assertHash(hash);
    return join(this.root, 'sha256', hash.slice(0, 2), hash.slice(2, 4), hash);
  }

  async put(bytes: Uint8Array, options: ArtifactPutOptions): Promise<ArtifactReference> {
    const data = Buffer.from(bytes);
    const hash = artifactHash(data);
    const path = this.pathFor(hash);
    await mkdir(dirname(path), {recursive: true});
    if (!await this.has(hash)) {
      const temporary = `${path}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, data, {flag: 'wx'});
        const staged = await readFile(temporary);
        if (artifactHash(staged) !== hash) throw new Error('Artifact checksum changed while staging');
        await rename(temporary, path);
      } finally {
        await unlink(temporary).catch(() => undefined);
      }
    }
    const info = await stat(path);
    if (info.size !== data.byteLength) throw new Error('Existing artifact has conflicting size');
    return {
      hash,
      kind: options.kind,
      storeKey: path,
      sizeBytes: data.byteLength,
      mediaType: options.mediaType,
      version: options.version,
    };
  }

  async get(hash: string): Promise<Uint8Array | undefined> {
    try {
      const data = await readFile(this.pathFor(hash));
      if (artifactHash(data) !== hash) throw new Error(`Artifact checksum mismatch for ${hash}`);
      return data;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }

  async has(hash: string): Promise<boolean> {
    try {
      await stat(this.pathFor(hash));
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  }
}

interface S3ObjectMetadata {
  contentLength: number;
  metadata?: Record<string, string>;
}

/** Minimal production seam implemented by an AWS SDK, MinIO, R2, or other
 * S3-compatible client. Tests inject an in-memory client; this module performs
 * no network calls by itself. */
interface S3ObjectClient {
  headObject(input: {bucket: string; key: string}): Promise<S3ObjectMetadata | undefined>;
  getObject(input: {bucket: string; key: string}): Promise<Uint8Array | undefined>;
  putObject(input: {
    bucket: string;
    key: string;
    body: Uint8Array;
    contentType: string;
    metadata: Record<string, string>;
    ifNoneMatch: '*';
  }): Promise<void>;
}

export class S3ArtifactStore implements ArtifactStore {
  constructor(
    private readonly client: S3ObjectClient,
    private readonly bucket: string,
    private readonly prefix = 'artifacts',
  ) {
    if (!bucket) throw new Error('S3 bucket is required');
  }

  private keyFor(hash: string): string {
    assertHash(hash);
    const prefix = this.prefix.replace(/^\/+|\/+$/g, '');
    return `${prefix ? `${prefix}/` : ''}sha256/${hash.slice(0, 2)}/${hash}`;
  }

  async put(bytes: Uint8Array, options: ArtifactPutOptions): Promise<ArtifactReference> {
    const data = Buffer.from(bytes);
    const hash = artifactHash(data);
    const key = this.keyFor(hash);
    const existing = await this.client.headObject({bucket: this.bucket, key});
    if (existing && existing.contentLength !== data.byteLength) throw new Error('Existing artifact has conflicting size');
    if (!existing) {
      try {
        await this.client.putObject({
          bucket: this.bucket,
          key,
          body: data,
          contentType: options.mediaType,
          metadata: {sha256: hash, artifactVersion: options.version, artifactKind: options.kind},
          ifNoneMatch: '*',
        });
      } catch (error) {
        // A concurrent writer may win between HEAD and conditional PUT. Treat it
        // as a cache hit only when the immutable object now exists with the same
        // size; real transport/provider failures remain visible.
        const winner = await this.client.headObject({bucket: this.bucket, key});
        if (!winner || winner.contentLength !== data.byteLength) throw error;
      }
    }
    return {
      hash,
      kind: options.kind,
      storeKey: `s3://${this.bucket}/${key}`,
      sizeBytes: data.byteLength,
      mediaType: options.mediaType,
      version: options.version,
    };
  }

  async get(hash: string): Promise<Uint8Array | undefined> {
    const data = await this.client.getObject({bucket: this.bucket, key: this.keyFor(hash)});
    if (!data) return undefined;
    if (artifactHash(data) !== hash) throw new Error(`Artifact checksum mismatch for ${hash}`);
    return data;
  }

  async has(hash: string): Promise<boolean> {
    return (await this.client.headObject({bucket: this.bucket, key: this.keyFor(hash)})) !== undefined;
  }
}
