#!/usr/bin/env node
import { createBrowserPreviewServer, createBrowserPreviewServerWhenReady } from './previewServer.js';

// Usage: previewCli.js <run-directory> [port] [--wait-ms=N]   (--wait-ms waits for the first verified scene of a run still in progress)
const args = process.argv.slice(2);
const waitMs = Number(args.find((arg) => arg.startsWith('--wait-ms='))?.slice('--wait-ms='.length) ?? 0);
const positional = args.filter((arg) => !arg.startsWith('--'));
const runDir = positional[0];
const port = Number(positional[1] ?? '4178');
if (!runDir || !Number.isInteger(port) || port < 1 || port > 65535 || !Number.isFinite(waitMs) || waitMs < 0) {
  console.error('Usage: node dist/src/export/player/previewCli.js <run-directory> [port] [--wait-ms=N]');
  process.exitCode = 2;
} else {
  (waitMs > 0 ? createBrowserPreviewServerWhenReady(runDir, { timeoutMs: waitMs }) : createBrowserPreviewServer(runDir)).then((server) => {
    server.listen(port, '127.0.0.1', () => console.log(`Hypothesis preview: http://127.0.0.1:${port}`));
    const stop = () => server.close(() => process.exit(0));
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  }).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
