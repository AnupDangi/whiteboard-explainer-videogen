import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chatStructured,
  maxPriceForCallBudget,
  maxPriceMultiplier,
  modelMaxPriceFloor,
  openrouterServiceTier,
} from '../llm/openrouter.js';
import { lessonCostCapUsd, lessonCostCapMultiplier } from '../plan/hierarchical.js';

const PRICE_VARS = ['HYPOTHESIS_MAX_PRICE_MULTIPLIER', 'HYPOTHESIS_MAX_PRICE_OVERRIDE_JSON', 'OPENROUTER_ALLOW_TIER_ROWS', 'HYPOTHESIS_LESSON_COST_CAP_MULTIPLIER'];

function savedEnv(): Record<string, string | undefined> {
  return Object.fromEntries(PRICE_VARS.map((k) => [k, process.env[k]]));
}

function restoreEnv(saved: Record<string, string | undefined>): void {
  for (const k of PRICE_VARS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
}

function withEnv(vars: Record<string, string>, fn: () => void): void {
  const saved = savedEnv();
  try {
    for (const k of PRICE_VARS) delete process.env[k];
    Object.assign(process.env, vars);
    fn();
  } finally {
    restoreEnv(saved);
  }
}

test('price caps: unset env reproduces today\'s ceiling math exactly', () => {
  withEnv({}, () => {
    assert.equal(maxPriceMultiplier(), 1);
    assert.deepEqual(maxPriceForCallBudget(0.02, 1200, 1000), { prompt: 2.770935, completion: 9 });
    assert.equal(maxPriceForCallBudget(0, 1200, 1000), undefined);
    assert.equal(modelMaxPriceFloor('google/gemini-3.8-flash'), undefined);
    assert.equal(openrouterServiceTier(), undefined);
  });
});

test('price caps: explicit multiplier 1 and invalid values behave like unset', () => {
  for (const value of ['1', 'abc', '', '0', '-3', 'NaN']) {
    withEnv({ HYPOTHESIS_MAX_PRICE_MULTIPLIER: value }, () => {
      assert.equal(maxPriceMultiplier(), 1, `multiplier ${JSON.stringify(value)} must fall back to 1`);
      assert.deepEqual(maxPriceForCallBudget(0.02, 1200, 1000), { prompt: 2.770935, completion: 9 });
    });
  }
});

test('price caps: multiplier > 1 raises the computed ceiling', () => {
  withEnv({ HYPOTHESIS_MAX_PRICE_MULTIPLIER: '2' }, () => {
    assert.equal(maxPriceMultiplier(), 2);
    const raised = maxPriceForCallBudget(0.02, 1200, 1000)!;
    assert.deepEqual(raised, { prompt: 5.54187, completion: 18 });
    assert.ok(raised.prompt > 2.770935 && raised.completion > 9);
  });
});

test('price caps: per-model override is raise-only, prefix-matched, and ignored when malformed', () => {
  const tiny = { remaining: 0.003, bytes: 500, maxTokens: 4000 };
  const computed = maxPriceForCallBudget(tiny.remaining, tiny.bytes, tiny.maxTokens)!;
  withEnv({ HYPOTHESIS_MAX_PRICE_OVERRIDE_JSON: '{"google/gemini-3.8-flash":{"prompt":2,"completion":8}}' }, () => {
    assert.deepEqual(modelMaxPriceFloor('google/gemini-3.8-flash'), { prompt: 2, completion: 8 });
    assert.equal(modelMaxPriceFloor('qwen/qwen3.8-flash'), undefined);
    const raised = maxPriceForCallBudget(tiny.remaining, tiny.bytes, tiny.maxTokens, 'google/gemini-3.8-flash')!;
    assert.deepEqual(raised, { prompt: 2, completion: 8 });
    // A floor below the computed ceiling never lowers it.
    assert.deepEqual(maxPriceForCallBudget(tiny.remaining, tiny.bytes, tiny.maxTokens, 'qwen/qwen3.8-flash'), computed);
    assert.deepEqual(maxPriceForCallBudget(tiny.remaining, tiny.bytes, tiny.maxTokens), computed);
  });
  withEnv({ HYPOTHESIS_MAX_PRICE_OVERRIDE_JSON: '{"google/":{"prompt":0.1,"completion":0.1}}' }, () => {
    // Longest-prefix match; still raise-only so the tiny floor changes nothing.
    assert.deepEqual(maxPriceForCallBudget(tiny.remaining, tiny.bytes, tiny.maxTokens, 'google/gemini-3.8-flash'), computed);
  });
  for (const bad of ['not-json', '[1,2]', '{"a":1}', '']) {
    withEnv(bad ? { HYPOTHESIS_MAX_PRICE_OVERRIDE_JSON: bad } : {}, () => {
      assert.equal(modelMaxPriceFloor('google/gemini-3.8-flash'), undefined, `override ${JSON.stringify(bad)} must be ignored`);
    });
  }
});

test('tier opt-in: unset sends no service_tier; 1 opts into priority; explicit tiers pass through', async () => {
  const captureBody = async (): Promise<Record<string, unknown>> => {
    let body: Record<string, unknown> = {};
    await chatStructured('test-key', {
      model: 'google/gemini-3.8-flash', system: 'system', user: 'user', schema: { type: 'object' },
      schemaName: 'test', maxTokens: 10, temperature: 0,
    }, async (_url, init) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, cost: 0.0001 } }), { status: 200 });
    });
    return body;
  };
  const saved = savedEnv();
  try {
    for (const k of PRICE_VARS) delete process.env[k];
    assert.equal(openrouterServiceTier(), undefined);
    assert.equal('service_tier' in (await captureBody()), false);
    for (const [value, expected] of [['1', 'priority'], ['true', 'priority'], ['flex', 'flex'], ['priority', 'priority'], ['fast', 'fast']] as const) {
      process.env.OPENROUTER_ALLOW_TIER_ROWS = value;
      assert.equal(openrouterServiceTier(), expected);
      assert.equal((await captureBody()).service_tier, expected);
    }
    for (const value of ['0', 'false', 'bogus-tier']) {
      process.env.OPENROUTER_ALLOW_TIER_ROWS = value;
      assert.equal(openrouterServiceTier(), undefined, `tier value ${JSON.stringify(value)} must fail closed`);
      assert.equal('service_tier' in (await captureBody()), false);
    }
  } finally {
    restoreEnv(saved);
  }
});

test('lesson caps: defaults unchanged; multiplier scales them', () => {
  withEnv({}, () => {
    assert.equal(lessonCostCapMultiplier(), 1);
    assert.equal(lessonCostCapUsd(60), 0.1);
    assert.equal(lessonCostCapUsd(300), 0.5);
    assert.equal(lessonCostCapUsd(600), 0.7);
    assert.equal(lessonCostCapUsd(1800), 1);
  });
  withEnv({ HYPOTHESIS_LESSON_COST_CAP_MULTIPLIER: '3' }, () => {
    assert.equal(lessonCostCapMultiplier(), 3);
    assert.equal(lessonCostCapUsd(60), 0.30000000000000004);
    assert.equal(lessonCostCapUsd(1800), 3);
  });
  withEnv({ HYPOTHESIS_LESSON_COST_CAP_MULTIPLIER: 'nope' }, () => {
    assert.equal(lessonCostCapMultiplier(), 1);
    assert.equal(lessonCostCapUsd(60), 0.1);
  });
});
