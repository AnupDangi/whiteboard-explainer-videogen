import test from 'node:test';
import assert from 'node:assert/strict';
import {generateLocalSpeech} from '../dist/src/local-speech.js';

test('Local Python speech has real PCM and measured repeated-word boundaries', {skip:process.env.TEST_LOCAL_TTS!=='1'}, async()=>{
  const {audio,timing,format}=await generateLocalSpeech('hello world hello');
  assert.equal(format,'wav');assert.equal(audio.toString('ascii',0,4),'RIFF');
  assert.equal(audio.toString('ascii',8,12),'WAVE');
  const sampleRate=audio.readUInt32LE(24),channels=audio.readUInt16LE(22),bits=audio.readUInt16LE(34);
  const duration=audio.readUInt32LE(40)/(sampleRate*channels*bits/8)*1000;
  assert(Math.abs(duration-timing.durationMs)<0.01);
  assert.deepEqual(timing.words.map(w=>w.word),['hello','world','hello']);
  assert.equal(timing.kind,'local-segment-aligned');
  timing.words.forEach((word,i)=>{assert(word.endMs>word.startMs);assert(word.endMs<=duration);if(i)assert(word.startMs>=timing.words[i-1].endMs);});
  assert(audio.subarray(44).some(byte=>byte!==0));
});
