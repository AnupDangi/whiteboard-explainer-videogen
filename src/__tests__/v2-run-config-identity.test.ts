import test from 'node:test';
import assert from 'node:assert/strict';
import { effectiveSpeechProfiles } from '../run/v2RunConfigIdentity.js';

test('effective config speech identity ignores scene assignments and provider snapshot IDs', () => {
  const firstCase = effectiveSpeechProfiles([
    { sceneId: 'case-a-scene-1', model: 'tts-model', voice: 'voice-a', capabilitySnapshotId: 'snapshot-1' },
    { sceneId: 'case-a-scene-2', model: 'tts-model', voice: 'voice-a', capabilitySnapshotId: 'snapshot-2' },
  ]);
  const secondCase = effectiveSpeechProfiles([
    { sceneId: 'case-b-scene-1', model: 'tts-model', voice: 'voice-a', capabilitySnapshotId: 'snapshot-9' },
  ]);
  assert.deepEqual(firstCase, [{ model: 'tts-model', voice: 'voice-a' }]);
  assert.deepEqual(secondCase, firstCase);
  assert.notDeepEqual(effectiveSpeechProfiles([{ model: 'tts-model', voice: 'voice-b' }]), firstCase, 'an effective voice change is a config change');
});
