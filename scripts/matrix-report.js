/** Aggregate matrix run logs + job snapshots into a cost/latency table. */
import {readFileSync, readdirSync} from 'node:fs';
const files = readdirSync('output/evaluations/matrix').filter(f => f.startsWith('run-') && f.endsWith('.log'));
const rows = [];
for (const f of files) {
  const t = readFileSync('output/evaluations/matrix/' + f, 'utf8');
  const m = t.match(/=== Summary ===\s*(\[.*\])\s*$/s);
  if (!m) { rows.push({log: f, status: 'STILL-RUNNING'}); continue; }
  const r = JSON.parse(m[1])[0];
  let extra = {};
  try {
    const j = JSON.parse(readFileSync('.data/' + r.jobId + '/job.json', 'utf8'));
    const shapes = {};
    for (const s of j.scenes) for (const n of s.nodes) shapes[n.shape || 'box'] = (shapes[n.shape || 'box'] || 0) + 1;
    extra = {ttsChars: j.ttsCharacters, timing: j.timingMode, firstPlayableMs: j.firstPlayableMs, shapes: JSON.stringify(shapes), layouts: [...new Set(j.scenes.map(s => s.layout))].join('/')};
  } catch {}
  rows.push({
    log: f, status: r.status, model: r.model || r.usage?.model, minutes: r.minutes,
    scenes: r.sceneCount ?? null, actualMin: r.actualMinutes?.toFixed(2) ?? null,
    promptTok: r.usage?.promptTokens ?? null, compTok: r.usage?.completionTokens ?? null,
    calls: r.usage?.calls ?? null, costUsd: r.usage?.costUsd?.toFixed(4) ?? null,
    elapsedS: r.elapsedMs ? Math.round(r.elapsedMs / 1000) : null,
    voiceCostUsd: r.tts === 'kokoro' || r.tts === 'local' ? '0.0000' : 'n/a',
    error: (r.error || '').slice(0, 90), ...extra,
  });
}
rows.sort((a, b) => a.log.localeCompare(b.log));
console.log(JSON.stringify(rows, null, 1));
const done = rows.filter(r => r.status === 'complete');
const tot = done.reduce((s, r) => s + parseFloat(r.costUsd || 0), 0);
console.log(`\nCOMPLETE=${done.length}/${rows.length} TOTAL_PLAN_COST=$${tot.toFixed(4)} TOTAL_VOICE_COST=$0.0000 (kokoro local)`);
