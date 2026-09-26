import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { alignAudio, closeAlignmentWorkers } from '../../shared/alignment/align.js';

test('alignment workers stay alive across requests and bound simultaneous sidecars', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hyp-align-worker-'));
  const scriptPath = join(root, 'fake-worker.py');
  const startsPath = join(root, 'starts.txt');
  await writeFile(scriptPath, `import json, sys\nwith open(${JSON.stringify(startsPath)}, 'a') as f: f.write('start\\n')\nfor line in sys.stdin:\n p=json.loads(line)\n words=p['text'].split()\n print(json.dumps({'durationMs': 5000, 'words':[{'word':w, 'startMs':i*100, 'endMs':(i+1)*100} for i,w in enumerate(words)]}), flush=True)\n`);
  try {
    const first = await alignAudio('/tmp/unused.wav', 'one two', { pythonBin: 'python3', alignScript: scriptPath, workerPoolSize: 1 });
    const second = await alignAudio('/tmp/unused.wav', 'three four', { pythonBin: 'python3', alignScript: scriptPath, workerPoolSize: 1 });
    assert.equal(first.words.length, 2);
    assert.equal(second.words[0]?.word, 'three');
    assert.equal((await readFile(startsPath, 'utf8')).trim().split('\n').length, 1, 'sequential calls reuse the same model-owning worker');

    await Promise.all(Array.from({ length: 8 }, (_, i) => alignAudio('/tmp/unused.wav', `parallel${i}`, { pythonBin: 'python3', alignScript: scriptPath, workerPoolSize: 2 })));
    assert.equal((await readFile(startsPath, 'utf8')).trim().split('\n').length, 3, 'eight concurrent requests use no more than the configured two extra workers');
  } finally {
    closeAlignmentWorkers();
    await rm(root, { recursive: true, force: true });
  }
});

test('alignment abort cancels a queued task and terminates its active worker', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hyp-align-abort-'));
  const scriptPath = join(root, 'slow-worker.py');
  await writeFile(scriptPath, `import json,sys,time\nfor line in sys.stdin:\n p=json.loads(line)\n if p['text']=='slow': time.sleep(1)\n words=p['text'].split()\n print(json.dumps({'durationMs':5000,'words':[{'word':w,'startMs':i*100,'endMs':(i+1)*100} for i,w in enumerate(words)]}),flush=True)\n`);
  try {
    const activeAbort = new AbortController();
    const active = alignAudio('/tmp/unused.wav', 'slow', { pythonBin: 'python3', alignScript: scriptPath, workerPoolSize: 1, signal: activeAbort.signal });
    const queuedAbort = new AbortController();
    const queued = alignAudio('/tmp/unused.wav', 'queued', { pythonBin: 'python3', alignScript: scriptPath, workerPoolSize: 1, signal: queuedAbort.signal });
    queuedAbort.abort();
    await assert.rejects(queued, { name: 'AbortError' });
    activeAbort.abort();
    await assert.rejects(active, { name: 'AbortError' });
  } finally {
    closeAlignmentWorkers();
    await rm(root, { recursive: true, force: true });
  }
});
