import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { indexSourceBundleWithRag } from '../plan/ragSidecar.js';
import { buildSourceBundle } from '../plan/sourceBundle.js';
import { sourceDocFromText } from '../plan/sourceDoc.js';
import { PersistentBudgetLedger } from '../pipeline/budgetLedger.js';

// Charge-on-match: the sidecar only reports cost *estimates* (the provider
// never exposes billed dollars), so booking $0.025 on a retrieval miss charges
// the run for value it never received while retrieval stayed local-text.
// Estimates settle only on `matched` retrieval; miss/partial keep $0 with an
// honest local-text status. The ledger stays fail-closed: budget gates and
// uncertain-spend blocking are unchanged.
//
// The Python sidecar is stubbed with an executable script (selected via
// RAG_PYTHON) that answers index/query from stdin/argv exactly like
// rag-engine/service.py's `{ok, ...}` envelope. No lesson content: the source
// is filler words plus one distinctive sentence.

const STUB = `#!/usr/bin/env python3
import json, os, sys
# Test-only control files: the sidecar allowlist strips ambient environment,
# so the harness drives this stub through files next to workingDir, which the
# index/query payloads both carry. Production providerEnv keys are untouched.
cmd = sys.argv[2] if len(sys.argv) > 2 else ''
payload = json.loads(sys.stdin.read() or '{}')
usage = {'callAttempts': 1, 'successfulCallAttempts': 1, 'failedCalls': 0,
         'providerReportedUsageResponses': 0, 'promptTokens': 10,
         'completionTokens': 5, 'totalTokens': 15}
sibling = os.path.join(os.path.dirname(payload.get('workingDir', '')), 'stub-control.json')
control = json.load(open(sibling)) if os.path.exists(sibling) else {}
if cmd == 'index':
    items = payload.get('contentList', [])
    mm = [i for i in items if i.get('type') in ('image', 'table', 'equation')]
    if control.get('indexMode', 'complete') == 'partial-index':
        print(json.dumps({'ok': True, 'indexStatus': 'partial', 'items': len(items),
              'multimodal': {'expected': len(mm), 'completed': 0, 'failed': 0},
              'actualUsage': usage,
              'stores': {'indexedChunks': 0, 'textChunks': 0, 'chunkVectors': 0}}))
    else:
        n = max(1, len(items))
        print(json.dumps({'ok': True, 'indexStatus': 'complete', 'items': len(items),
              'multimodal': {'expected': len(mm), 'completed': len(mm), 'failed': 0},
              'actualUsage': usage,
              'stores': {'indexedChunks': n, 'textChunks': n, 'chunkVectors': n}}))
else:
    print(json.dumps({'ok': True, 'queryStatus': 'complete',
          'data': {'chunks': control.get('chunks', [])}, 'actualUsage': usage}))
`;

interface Rig {
  root: string;
  ledgerPath: string;
  controlFile: string;
  restore: () => void;
}

function rig(): Rig {
  const root = mkdtempSync(join(tmpdir(), 'hyp-rag-charge-'));
  const repoRoot = join(root, 'repo');
  const binDir = join(repoRoot, 'rag-engine', '.venv', 'bin');
  mkdirSync(binDir, { recursive: true });
  writeFileSync(join(repoRoot, 'rag-engine', 'service.py'), '');
  const stubPath = join(root, 'fake-python');
  writeFileSync(stubPath, STUB);
  chmodSync(stubPath, 0o755);
  const controlFile = join(root, 'stub-control.json');
  writeFileSync(controlFile, JSON.stringify({ chunks: [] }));
  const saved: NodeJS.ProcessEnv = {};
  for (const key of ['RAG_ENGINE', 'HYPOTHESIS_REPO_ROOT', 'RAG_PYTHON', 'RAG_INDEX_ESTIMATE_USD', 'RAG_QUERY_ESTIMATE_USD'] as const) {
    saved[key] = process.env[key];
  }
  process.env.RAG_ENGINE = 'on';
  process.env.HYPOTHESIS_REPO_ROOT = repoRoot;
  process.env.RAG_PYTHON = stubPath;
  process.env.RAG_INDEX_ESTIMATE_USD = '0.02';
  process.env.RAG_QUERY_ESTIMATE_USD = '0.005';
  return {
    root,
    ledgerPath: join(root, 'ledger.json'),
    controlFile,
    restore: () => {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      rmSync(root, { recursive: true, force: true });
    },
  };
}

function bigDoc(): ReturnType<typeof sourceDocFromText> {
  // Must clear the donor 40k-char RAG skip threshold or the source skips
  // indexing before the stub ever runs (9000 words ≈ 45k chars).
  return sourceDocFromText(`# Qzxw Notes\n\nQzxw braided river channels shift course. ${'word '.repeat(9000)}`, 'markdown');
}

async function spentUsd(ledgerPath: string, budget: number): Promise<number> {
  return (await new PersistentBudgetLedger(ledgerPath, budget).snapshot()).spentUsd;
}

test('a retrieval miss settles $0 and stays honestly local-text', async () => {
  const { root, ledgerPath, controlFile, restore } = rig();
  try {
    writeFileSync(controlFile, JSON.stringify({ chunks: [{ content: 'hxqv filler that matches no source span whatsoever' }] }));
    const sourceDoc = bigDoc();
    const { sourceBundle } = buildSourceBundle([sourceDoc], 'qzxw channels');
    const ledger = new PersistentBudgetLedger(ledgerPath, 1.0);
    const outcome = await indexSourceBundleWithRag({ sourceDoc, sourceBundle, query: 'qzxw channels', workingDir: join(root, 'work'), ledger, remainingBudgetUsd: 1.0, providerEnv: {} });
    assert.equal(outcome.retrievalStatus, 'miss');
    assert.equal(outcome.estimatedCostUsd, 0);
    assert.equal(sourceBundle.retrievalCost.apiCostUsd, 0);
    assert.equal(sourceBundle.retrievalMode, 'local-text');
    assert.equal(sourceBundle.ragStatus?.retrieval, 'miss');
    assert.ok(outcome.error?.length, 'miss keeps an honest diagnostic');
    assert.equal(await spentUsd(ledgerPath, 1.0), 0);
  } finally {
    restore();
  }
});

test('a matched retrieval still settles the estimate through the ledger', async () => {
  const { root, ledgerPath, controlFile, restore } = rig();
  try {
    const sourceDoc = bigDoc();
    const quote = sourceDoc.spans.find((span) => span.text.includes('braided river'))!.text;
    writeFileSync(controlFile, JSON.stringify({ chunks: [{ content: quote }] }));
    const { sourceBundle } = buildSourceBundle([sourceDoc], 'qzxw channels');
    const ledger = new PersistentBudgetLedger(ledgerPath, 1.0);
    const outcome = await indexSourceBundleWithRag({ sourceDoc, sourceBundle, query: 'qzxw channels', workingDir: join(root, 'work'), ledger, remainingBudgetUsd: 1.0, providerEnv: {} });
    assert.equal(outcome.retrievalStatus, 'matched');
    assert.equal(outcome.status, 'completed');
    assert.equal(outcome.estimatedCostUsd, 0.025);
    assert.equal(sourceBundle.retrievalMode, 'deep-indexed+local-text');
    assert.equal(await spentUsd(ledgerPath, 1.0), 0.025);
  } finally {
    restore();
  }
});

test('a partial index settles $0 instead of the sunk index estimate', async () => {
  const { root, ledgerPath, controlFile, restore } = rig();
  try {
    writeFileSync(controlFile, JSON.stringify({ indexMode: 'partial-index', chunks: [{ content: 'hxqv filler' }] }));
    const sourceDoc = bigDoc();
    const { sourceBundle } = buildSourceBundle([sourceDoc], 'qzxw channels');
    const ledger = new PersistentBudgetLedger(ledgerPath, 1.0);
    const outcome = await indexSourceBundleWithRag({ sourceDoc, sourceBundle, query: 'qzxw channels', workingDir: join(root, 'work'), ledger, remainingBudgetUsd: 1.0, providerEnv: {} });
    assert.equal(outcome.status, 'partial');
    assert.equal(outcome.estimatedCostUsd, 0);
    assert.equal(sourceBundle.retrievalCost.apiCostUsd, 0);
    assert.equal(sourceBundle.retrievalMode, 'local-text');
    assert.equal(await spentUsd(ledgerPath, 1.0), 0);
  } finally {
    restore();
  }
});

test('an unaffordable RAG estimate stays fail-closed without spending', async () => {
  const { root, ledgerPath, controlFile, restore } = rig();
  try {
    writeFileSync(controlFile, JSON.stringify({ chunks: [{ content: 'hxqv filler' }] }));
    const sourceDoc = bigDoc();
    const { sourceBundle } = buildSourceBundle([sourceDoc], 'qzxw channels');
    const ledger = new PersistentBudgetLedger(ledgerPath, 1.0);
    const outcome = await indexSourceBundleWithRag({ sourceDoc, sourceBundle, query: 'qzxw channels', workingDir: join(root, 'work'), ledger, remainingBudgetUsd: 0.001, providerEnv: {} });
    assert.equal(outcome.status, 'failed');
    assert.equal(outcome.estimatedCostUsd, 0);
    assert.equal(await spentUsd(ledgerPath, 1.0), 0);
  } finally {
    restore();
  }
});
