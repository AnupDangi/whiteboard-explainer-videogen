import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Enabled icon libraries in retrieval order; additions require review, ingest, and embeddings. */
export interface CatalogLibrary {
  libraryId: string;
  file: string;
  embeddings: string;
  house: boolean;
  /** Review-licence library: enabled only under ASSET_USAGE_CONTEXT=local-dev. */
  devOnly?: boolean;
}

const REGISTRY_FILE = 'enabled-libraries.json';
// tsc does not copy data files into dist/; read the registry from the source tree.
const HERE = dirname(fileURLToPath(import.meta.url));
const DIST_SRC = `${sep}dist${sep}src${sep}`;
const REGISTRY_DIR = resolve(HERE.includes(DIST_SRC) ? HERE.replace(DIST_SRC, `${sep}src${sep}`) : HERE, 'data');

const REGISTRY = JSON.parse(readFileSync(resolve(REGISTRY_DIR, REGISTRY_FILE), 'utf8')) as { libraries: CatalogLibrary[]; disabled?: CatalogLibrary[] };

/** Enabled libraries, read from `data/enabled-libraries.json` (shared with scripts/embed-catalog.mjs). */
export const ENABLED_LIBRARIES: readonly CatalogLibrary[] = REGISTRY.libraries.filter((library) => !library.devOnly || process.env.ASSET_USAGE_CONTEXT === 'local-dev');

/** Every ingested library, enabled or not (disabled ones stay loadable for rollback and tests). */
export const ALL_LIBRARIES: readonly CatalogLibrary[] = [...ENABLED_LIBRARIES, ...(REGISTRY.disabled ?? [])];

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
