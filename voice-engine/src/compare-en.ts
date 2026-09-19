import {mkdir} from 'node:fs/promises';
import {DEFAULT_OUT_DIR} from './paths.js';
import {route, synthesize} from './index.js';

/** ~10 seconds of English at a normal narration pace. */
const TEXT = 'A good explanation does not start with the answer. It starts with a question you can almost answer, then closes the gap one step at a time.';

const ROUTES: Array<[string, string]> = [
  ['English', 'en'],
  ['Hindi', 'hi'],
  ['French', 'fr'],
  ['German', 'de'],
  ['Nepali', 'ne'],
  ['Chinese', 'zh'],
  ['Farsi', 'fa'],
  ['Malayalam', 'ml'],
  ['Telugu', 'te'],
  ['Swahili', 'sw'],
];

interface Row {
  provider: string;
  voice: string;
  audioDurationMs: number;
  generationMs: number;
  rtf: number;
  audioPath: string;
}

function printTable(rows: Row[]): void {
  const header = ['provider', 'voice', 'audioMs', 'genMs', 'rtf', 'audioPath'];
  const body = rows.map(row => [
    row.provider,
    row.voice,
    String(row.audioDurationMs),
    String(row.generationMs),
    row.rtf.toFixed(3),
    row.audioPath,
  ]);
  const widths = header.map((_, i) => Math.max(header[i].length, ...body.map(r => r[i].length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i])).join('  ');
  console.log(line(header));
  console.log(line(widths.map(w => '-'.repeat(w))));
  for (const row of body) console.log(line(row));
}

async function main(): Promise<void> {
  await mkdir(DEFAULT_OUT_DIR, {recursive: true});

  console.log('Router (text + language -> provider):');
  for (const [label, language] of ROUTES) {
    const decision = route({language});
    console.log(`  ${label.padEnd(10)} ${language.padEnd(3)} -> ${decision.provider}`);
  }

  console.log(`\nEnglish sample (${TEXT.split(/\s+/).length} words):`);
  console.log(`  "${TEXT}"\n`);

  const rows: Row[] = [];
  for (const provider of ['auto', 'piper'] as const) {
    const result = await synthesize({text: TEXT, language: 'en', provider});
    rows.push({
      provider: result.provider,
      voice: result.voice,
      audioDurationMs: result.audioDurationMs,
      generationMs: result.generationMs,
      rtf: result.rtf,
      audioPath: result.audioPath,
    });
  }

  printTable(rows);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
