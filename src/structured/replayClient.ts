import { createHash } from 'node:crypto';
import type { ModelClient } from '../llm/modelClient.js';
import type { ChatRequest, ChatResult } from '../llm/openrouter.js';

/**
 * Replay of one recorded model call (V2 plan Phase 1.2): the recorded responses are served in order, so a stage can be
 * re-run offline, deterministically and for free. Each request's hash must equal the recorded one, so a replay can never
 * silently answer a different prompt than the one the model saw.
 */
export interface ReplayResponse {
  content: string;
  finishReason: string;
  usage: ChatResult['usage'];
  schemaConstrained: boolean;
  requestHash: string;
}

export interface ReplayFixture {
  schemaVersion: 'structured-replay/v1';
  stage: string;
  subject: string;
  model: string;
  provider: string;
  schemaName: string;
  responses: ReplayResponse[];
}

export const requestHashOf = (system: string, user: string, schemaName: string): string => createHash('sha256').update(`${system}\n${user}\n${schemaName}`).digest('hex');

export interface ReplayClient extends ModelClient { assertDrained(): void }

export function replayClient(fixture: ReplayFixture): ReplayClient {
  let next = 0;
  return {
    provider: `replay:${fixture.provider}`,
    async chat(request: ChatRequest): Promise<ChatResult> {
      const response = fixture.responses[next];
      if (!response) throw new Error(`replay fixture exhausted: ${fixture.stage}/${fixture.subject} recorded ${fixture.responses.length} response(s)`);
      const actual = requestHashOf(request.system, request.user, request.schemaName);
      if (actual !== response.requestHash) throw new Error(`replay fixture request mismatch for ${fixture.stage}/${fixture.subject} call ${next + 1}: the prompt differs from the recorded one`);
      next += 1;
      return { content: response.content, finishReason: response.finishReason, temperatureApplied: true, schemaConstrained: response.schemaConstrained, usage: { ...response.usage } };
    },
    assertDrained(): void {
      if (next !== fixture.responses.length) throw new Error(`replay fixture has ${fixture.responses.length - next} unused response(s) for ${fixture.stage}/${fixture.subject}`);
    },
  };
}
