import {closeVoiceEngineWorkers, synthesize} from './index.js';
import type {SynthesizeInput} from './types.js';

/** Async JSON stdin -> JSON stdout boundary for host apps. */
async function main(): Promise<void> {
  let raw = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) raw += chunk;
  const input = JSON.parse(raw ?? '{}') as SynthesizeInput;
  const result = await synthesize(input);
  process.stdout.write(JSON.stringify(result));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}).finally(closeVoiceEngineWorkers);
