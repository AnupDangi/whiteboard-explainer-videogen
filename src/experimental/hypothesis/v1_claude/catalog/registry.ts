import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Enabled icon libraries in retrieval order; additions require review, ingest, and embeddings. */
export interface CatalogLibrary {
  libraryId: string;
  file: string;
  embeddings: string;
  house: boolean;
}

export const ENABLED_LIBRARIES: readonly CatalogLibrary[] = [
  { libraryId: 'streamline', file: 'streamline.json', embeddings: 'streamline.emb.bin', house: true },
];

let dataDirectory: string | undefined;

/** Streamline initializes the directory lazily to avoid a module import cycle. */
export function setCatalogDataDir(dir: string): void {
  dataDirectory = dir;
}

function catalogDataDir(): string {
  if (!dataDirectory) throw new Error('catalog data dir not initialized; import catalog/streamline.js first');
  return dataDirectory;
}

const fileHash = (file: string): string => createHash('sha256').update(readFileSync(file)).digest('hex');

export function catalogVersion(libraries: readonly CatalogLibrary[] = ENABLED_LIBRARIES, dataDir?: string): string {
  const dir = dataDir ?? catalogDataDir();
  const hash = createHash('sha256');
  for (const library of libraries) {
    hash.update(`${library.libraryId}\n${fileHash(resolve(dir, library.file))}\n${fileHash(resolve(dir, library.embeddings))}\n${library.house}\n`);
  }
  return `catalog-${hash.digest('hex').slice(0, 16)}`;
}

const housePrefixes = (): string[] => ENABLED_LIBRARIES.filter((library) => library.house).map((library) => `${library.libraryId}:`);

export function isHouseSource(source: string): boolean {
  return housePrefixes().some((prefix) => source.startsWith(prefix));
}
