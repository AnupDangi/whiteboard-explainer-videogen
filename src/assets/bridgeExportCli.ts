import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { freezeBridgeSnapshot, type AssetBridgeV2 } from './bridge.js';

function option(args: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

export async function runBridgeExportCli(args = process.argv.slice(2)): Promise<number> {
  const manifest = option(args, 'manifest');
  const assets = option(args, 'assets');
  const out = option(args, 'out');
  const generatedAt = option(args, 'generated-at');
  if (!manifest || !assets || !out || !generatedAt) {
    process.stderr.write('usage: asset-bridge:freeze --manifest <reviewed-v2.json> --assets <source-asset-root> --out <empty-output-dir> --generated-at <canonical-ISO-timestamp>\n');
    return 2;
  }
  let parsed: unknown;
  try { parsed = JSON.parse(await readFile(path.resolve(manifest), 'utf8')); }
  catch (error) {
    process.stderr.write(`AssetBridge manifest could not be read: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
  try {
    const snapshot = await freezeBridgeSnapshot(parsed as AssetBridgeV2, path.resolve(assets), path.resolve(out), generatedAt);
    process.stdout.write(`${JSON.stringify({ status: 'frozen', output: path.resolve(out), catalogVersion: snapshot.bridge.catalogVersion, digest: snapshot.digest, counts: snapshot.bridge.counts }, null, 2)}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`AssetBridge export rejected: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runBridgeExportCli().then((status) => { process.exitCode = status; }).catch((error: unknown) => {
    process.stderr.write(`AssetBridge export failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
