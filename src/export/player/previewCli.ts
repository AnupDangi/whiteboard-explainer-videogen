#!/usr/bin/env node
import { createBrowserPreviewServer } from './previewServer.js';

const args = process.argv.slice(2);
const runDir = args[0];
const portValue = args[1] ?? '4178';
const port = Number(portValue);
if (!runDir || !Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('Usage: node dist/src/export/player/previewCli.js <run-directory> [port]');
  process.exitCode = 2;
} else {
  createBrowserPreviewServer(runDir).then((server) => {
    server.listen(port, '127.0.0.1', () => console.log(`Hypothesis preview: http://127.0.0.1:${port}`));
    const stop = () => server.close(() => process.exit(0));
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  }).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
