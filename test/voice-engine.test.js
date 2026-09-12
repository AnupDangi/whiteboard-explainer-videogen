import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createVoiceEngineRunner,wordsFromDuration} from '../dist/src/voice-engine-client.js';
import {createVoiceEngineSpeech} from '../dist/src/v2/speech.js';

test('voice-engine timing marks estimated word boundaries',()=>{
 const t=wordsFromDuration('one two three four',4000);
 assert.equal(t.kind,'engine');assert.equal(t.durationMs,4000);assert.equal(t.words.length,4);
 assert.equal(t.words[0].startMs,0);assert.equal(t.words[3].endMs,4000);
 assert.ok(t.words.every((w,i)=>w.startMs<w.endMs&&(i===0||w.startMs>=t.words[i-1].endMs)));
 assert.throws(()=>wordsFromDuration('   ',100),/empty/);
});
test('V2 voice-engine speech returns audio with engine timing asynchronously',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ve-')),audioPath=join(dir,'a.wav');await writeFile(audioPath,Buffer.from('RIFF'));
 const speech=createVoiceEngineSpeech({run:async()=>({audioPath,provider:'supertonic',language:'en',voice:'F3',generationMs:10,audioDurationMs:2000,rtf:0.005})});
 const out=await speech('alpha beta');
 assert.equal(out.format,'wav');assert.equal(out.audio.toString(),'RIFF');
 assert.equal(out.timing.kind,'engine');assert.equal(out.timing.durationMs,2000);assert.equal(out.timing.words.length,2);
});
test('voice-engine client surfaces a missing engine as a visible failure',async()=>{
 await assert.rejects(createVoiceEngineRunner({engineDir:'/nonexistent/voice-engine'})({text:'hi',language:'en'}),/voice-engine exited|Cannot find/);
});
