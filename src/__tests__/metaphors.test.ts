import test from 'node:test';
import assert from 'node:assert/strict';
import { validateMetaphors } from '../assets/metaphors.js';

test('a metaphor without a stated structure or reconnect term is rejected', () => {
  const { ok, problems } = validateMetaphors([
    { concept: 'a', role: 'loop', structure: 'the output returns to the input', reconnectTerm: 'feedback' },
    { concept: 'b', role: 'loop', structure: 'short', reconnectTerm: 'x' },
    { concept: 'c', role: 'loop', structure: 'the output returns to the input' },
    { concept: 'd', role: 'not-a-role', structure: 'the output returns to the input', reconnectTerm: 'x' },
    { concept: 'e', role: 'loop', topology: 'cycle', structure: 'the output returns to the input', reconnectTerm: 'x' },
    { concept: 'A', role: 'loop', structure: 'the output returns to the input', reconnectTerm: 'x' },
  ]);
  assert.deepEqual(ok.map((entry) => entry.concept), ['a']);
  assert.equal(problems.length, 5);
});
