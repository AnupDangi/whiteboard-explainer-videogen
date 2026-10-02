#!/usr/bin/env node
// One source, several narration languages, ElevenLabs speech (word clocks from the provider), V2 pipeline, 60 s.
//   node scripts/v2-lang-demo.mjs <source.md> [en hi ne ...] [--duration=60] [--tag=run1]
// Output: .data/lang-demo/<tag>/<lang>/ ; prints status, scenes, hard failures, video path per language. Paid (OpenRouter + ElevenLabs).
import { spawn } from 'node:child_process';
import path from 'node:path';
const args = process.argv.slice(2);
const flag = (k, d) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const positional = args.filter((a) => !a.startsWith('--'));
const [source, ...langs] = positional;
if (!source) { console.error('usage: v2-lang-demo.mjs <source.md> [langs...] [--duration=60] [--tag=name]'); process.exit(2); }
const languages = langs.length ? langs : ['en', 'hi', 'ne'];
const tag = flag('tag', new Date().toISOString().replace(/[:.]/g, '-'));
const env = { ...process.env, TEACHING_COMPILER_VERSION: 'v2', TEACHING_BEATS_V2: '1', BOARD_OPS_V2: '1', PERSISTENT_BOARD_V2: '1', TYPE_RESOLVER_V2: '1', LAYOUT_V2: '1', RENDER_PLAN_V2: '1' };
const run = (language) => new Promise((resolve) => {
  const out = path.join('.data/lang-demo', tag, language);
  const child = spawn('node', ['dist/src/run/lessonCli.js', `--source=${source}`, '--instruction=Teach the main idea of this source to a beginner.', `--duration=${flag('duration', '60')}`, `--id=${path.basename(source, path.extname(source))}-${language}`, '--cache=cold', '--tts=elevenlabs', `--language=${language}`, `--out=${out}`], { env });
  let log = '';
  child.stdout.on('data', (d) => { log += d; }); child.stderr.on('data', (d) => { log += d; });
  child.on('close', () => resolve({ language, out, log }));
});
const results = await Promise.all(languages.map(run));
for (const { language, out, log } of results) {
  console.log(`== ${language} (${out})`);
  for (const line of log.split('\n').filter((l) => /status=|\[HARD\]/.test(l))) console.log(line.slice(0, 700));
}
