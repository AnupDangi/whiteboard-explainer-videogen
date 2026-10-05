#!/usr/bin/env node
// simi_benchmark fixtures -> lesson sources. Uses ONLY the candidate-visible
// part (source spans + objective + domain + duration). Truth, comprehension,
// expected answers, and judge material are NEVER read: this builds teaching
// inputs, not answer keys.
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const FIX = '/Users/anupdangi/Desktop/AnupAI/Research/lamina-labs-clone/simi_benchmark_v1_1/benchmark/fixtures';
const OUT = path.join(ROOT, 'bench', 'simi-smoke');
mkdirSync(OUT, { recursive: true });

const cases = readdirSync(FIX).filter((d) => /^[A-Z]+-\d+$/.test(d)).sort();
const unquote = (s) => s.replace(/^'(.*)'$/s, '$1').replace(/''/g, "'");
for (const id of cases) {
  const text = readFileSync(path.join(FIX, id, 'fixture.yaml'), 'utf8');
  const spans = [...text.matchAll(/- id: '(\w+)'\n\s+text: '(.*)'/g)].map((m) => ({ id: m[1], text: unquote(m[2]) }));
  const full = /full_text: '(.*)'/.exec(text)?.[1] ?? spans.map((s) => `[${s.id}] ${s.text}`).join(' ');
  const domain = /domain: '([^']+)'/.exec(text)?.[1] ?? 'general';
  const objective = /objective: '([^']+)'/.exec(text)?.[1] ?? `Teach ${id}.`;
  const duration = Number(/target_duration_s: (\d+)/.exec(text)?.[1] ?? 90);
  const topic = /topic: '([^']+)'/.exec(text)?.[1] ?? id;
  const md = `# ${topic}\n\n${unquote(full)}\n`;
  writeFileSync(path.join(OUT, `${id}.md`), md);
  console.log(`${id}: ${spans.length} spans, ${duration}s, ${domain} — ${topic.slice(0, 60)}`);
}
