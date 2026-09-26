import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { StageArtifact } from '../shared/contracts.js';
import { sha256, stableJson, stageArtifact, verifyArtifact } from '../shared/artifacts.js';

export interface StageDefinition {
  schemaVersion: string;
  stageVersion: string;
  promptVersion?: string;
  modelId?: string;
  catalogVersion?: string;
}

export interface VersionedStageArtifact<T> extends StageArtifact<T> { catalogVersion?: string }
export interface CachedStage<T> { artifact: VersionedStageArtifact<T>; key: string; cacheHit: boolean }

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

async function exists(filePath: string): Promise<boolean> {
  try { await stat(filePath); return true; } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

/** Claude hypothesis local stage store. Keys include every declared input and implementation contract. */
export class ContentAddressedArtifactStore {
  private readonly runLocalArtifacts = new Map<string, VersionedStageArtifact<unknown>>();

  constructor(readonly root: string, readonly mode: 'cold' | 'warm' | 'replay' = 'warm') {}

  key(input: unknown, meta: StageDefinition): string {
    return sha256(stableJson({ inputHash: sha256(stableJson(input)), ...meta }));
  }

  async run<T>(stage: string, input: unknown, meta: StageDefinition, produce: () => Promise<T> | T): Promise<CachedStage<T>> {
    const stageVersion = `${stage}:${meta.stageVersion}`;
    const key = this.key(input, { ...meta, stageVersion });
    if (this.mode === 'cold') {
      const runLocal = this.runLocalArtifacts.get(key) as VersionedStageArtifact<T> | undefined;
      if (runLocal) return { artifact: runLocal, key, cacheHit: true };
    }
    const artifactPath = join(this.root, key.slice(0, 2), `${key}.json`);
    if (this.mode !== 'cold') {
      try {
        const artifact = JSON.parse(await readFile(artifactPath, 'utf8')) as VersionedStageArtifact<T>;
        await verifyArtifact(artifact);
        if (artifact.inputHash !== sha256(stableJson(input)) || artifact.schemaVersion !== meta.schemaVersion || artifact.stageVersion !== stageVersion || artifact.promptVersion !== meta.promptVersion || artifact.modelId !== meta.modelId || artifact.catalogVersion !== meta.catalogVersion) {
          throw new Error(`Cached artifact metadata mismatch for ${stage}`);
        }
        return { artifact, key, cacheHit: true };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      if (this.mode === 'replay') throw new Error(`Replay cache miss for ${stage} (${key})`);
    }

    const payload = await produce();
    const base = stageArtifact(input, payload, {
      schemaVersion: meta.schemaVersion,
      stageVersion,
      ...(meta.promptVersion ? { promptVersion: meta.promptVersion } : {}),
      ...(meta.modelId ? { modelId: meta.modelId } : {}),
    });
    const artifact: VersionedStageArtifact<T> = { ...base, ...(meta.catalogVersion ? { catalogVersion: meta.catalogVersion } : {}) };
    await mkdir(dirname(artifactPath), { recursive: true });
    const temporary = `${artifactPath}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
    await rename(temporary, artifactPath);
    return { artifact, key, cacheHit: false };
  }

  /**
   * Let a later stage in this same process reuse an artifact produced earlier
   * in a cold run. This does not read or trust artifacts from a prior run.
   */
  reuseWithinRun<T>(stage: string, input: unknown, meta: StageDefinition, artifact: VersionedStageArtifact<T>): void {
    if (this.mode !== 'cold') return;
    const stageVersion = `${stage}:${meta.stageVersion}`;
    this.runLocalArtifacts.set(this.key(input, { ...meta, stageVersion }), artifact);
  }

  /** Cache a large file as a content-addressed blob and materialize it in each run directory. */
  async runFile<T extends { outputSha256: string; outputBytes: number }>(
    stage: string,
    input: unknown,
    meta: StageDefinition,
    outputPath: string,
    produce: () => Promise<void>,
  ): Promise<CachedStage<T>> {
    const stageVersion = `${stage}:${meta.stageVersion}`;
    const key = this.key(input, { ...meta, stageVersion });
    const directory = join(this.root, key.slice(0, 2));
    const artifactPath = join(directory, `${key}.json`);
    const blobPath = join(directory, `${key}.blob`);
    const inputHash = sha256(stableJson(input));

    const validArtifact = async (): Promise<VersionedStageArtifact<T> | undefined> => {
      try {
        const artifact = JSON.parse(await readFile(artifactPath, 'utf8')) as VersionedStageArtifact<T>;
        await verifyArtifact(artifact);
        if (artifact.inputHash !== inputHash || artifact.schemaVersion !== meta.schemaVersion || artifact.stageVersion !== stageVersion || artifact.promptVersion !== meta.promptVersion || artifact.modelId !== meta.modelId || artifact.catalogVersion !== meta.catalogVersion) {
          throw new Error(`Cached artifact metadata mismatch for ${stage}`);
        }
        return artifact;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw error;
      }
    };

    if (this.mode !== 'cold') {
      const cached = await validArtifact();
      if (cached) {
        const payload = cached.payload;
        let blobValid = false;
        if (await exists(blobPath)) {
          const blobStat = await stat(blobPath);
          blobValid = blobStat.size === payload.outputBytes && await sha256File(blobPath) === payload.outputSha256;
          if (!blobValid) throw new Error(`Cached binary artifact checksum mismatch for ${stage}`);
        }
        // A legacy metadata-only cache can be recovered if this run already has the exact output.
        if (!blobValid && await exists(outputPath)) {
          const outputStat = await stat(outputPath);
          if (outputStat.size === payload.outputBytes && await sha256File(outputPath) === payload.outputSha256) {
            await mkdir(directory, { recursive: true });
            const blobTemp = `${blobPath}.${process.pid}.${randomUUID()}.tmp`;
            await copyFile(outputPath, blobTemp);
            await rename(blobTemp, blobPath);
            blobValid = true;
          }
        }
        if (blobValid) {
          const outputStat = await exists(outputPath) ? await stat(outputPath) : undefined;
          const outputValid = outputStat?.size === payload.outputBytes && await sha256File(outputPath) === payload.outputSha256;
          if (!outputValid) {
            const outputTemp = `${outputPath}.${process.pid}.${randomUUID()}.tmp`;
            await mkdir(dirname(outputPath), { recursive: true });
            await copyFile(blobPath, outputTemp);
            await rename(outputTemp, outputPath);
          }
          return { artifact: cached, key, cacheHit: true };
        }
        if (this.mode === 'replay') throw new Error(`Replay binary cache miss for ${stage} (${key})`);
      } else if (this.mode === 'replay') throw new Error(`Replay cache miss for ${stage} (${key})`);
    }

    await mkdir(dirname(outputPath), { recursive: true });
    await produce();
    const outputStat = await stat(outputPath);
    const payload = { outputSha256: await sha256File(outputPath), outputBytes: outputStat.size } as T;
    await mkdir(directory, { recursive: true });
    const blobTemp = `${blobPath}.${process.pid}.${randomUUID()}.tmp`;
    const artifactTemp = `${artifactPath}.${process.pid}.${randomUUID()}.tmp`;
    await copyFile(outputPath, blobTemp);
    const base = stageArtifact(input, payload, {
      schemaVersion: meta.schemaVersion,
      stageVersion,
      ...(meta.promptVersion ? { promptVersion: meta.promptVersion } : {}),
      ...(meta.modelId ? { modelId: meta.modelId } : {}),
    });
    const artifact: VersionedStageArtifact<T> = { ...base, ...(meta.catalogVersion ? { catalogVersion: meta.catalogVersion } : {}) };
    await writeFile(artifactTemp, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
    await rename(blobTemp, blobPath);
    await rename(artifactTemp, artifactPath);
    return { artifact, key, cacheHit: false };
  }
}
