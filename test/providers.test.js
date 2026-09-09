import test from 'node:test';
import assert from 'node:assert/strict';
import {alignmentToTiming,generatePlan,generateSpeech} from '../dist/src/providers.js';
import {fixtures} from '../dist/src/fixtures.js';
const alignment=text=>({characters:[...text],character_start_times_seconds:[...text].map((_,i)=>i*.1),character_end_times_seconds:[...text].map((_,i)=>(i+1)*.1)});
test('H16 repeated words resolve by ordinal position',()=>{
  const t=alignmentToTiming('query key query',alignment('query key query'));assert.equal(t.words.length,3);assert.equal(t.words[0].startMs,0);assert.equal(t.words[2].startMs,1000);assert.equal(t.kind,'provider-aligned');
});
test('H16 mismatched and invalid alignments fail visibly',()=>{
  assert.throws(()=>alignmentToTiming('two',alignment('one')));
  const a=alignment('one');a.character_start_times_seconds[2]=-1;assert.throws(()=>alignmentToTiming('one',a));
  assert.throws(()=>alignmentToTiming('x',{characters:['x']}));
});
test('H04 planner uses provider output rather than silently returning fixture',async()=>{
  let request;
  const result=await generatePlan('Explain attention',{env:{ANTHROPIC_API_KEY:'test-key',ANTHROPIC_MODEL:'test-model'},fetcher:async(url,options)=>{request={url,...options};return {ok:true,json:async()=>({stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify(fixtures.attention)}]})};}});
  assert.equal(result.scenes.length,4);assert.equal(JSON.parse(request.body).model,'test-model');assert(request.url.includes('anthropic.com'));
  await assert.rejects(generatePlan('test',{env:{}}),/Configure/);
});
test('H22 provider HTTP and truncation failures propagate',async()=>{
  const env={ANTHROPIC_API_KEY:'test',ANTHROPIC_MODEL:'test'};
  await assert.rejects(generatePlan('test',{env,fetcher:async()=>({ok:false,status:429})}),/429/);
  await assert.rejects(generatePlan('test',{env,fetcher:async()=>({ok:true,json:async()=>({stop_reason:'max_tokens'})})}),/truncated/);
});
test('H15 speech adapter preserves audio and timestamp contract',async()=>{
  const result=await generateSpeech('hello',{env:{ELEVENLABS_API_KEY:'test',ELEVENLABS_VOICE_ID:'voice'},fetcher:async()=>({ok:true,json:async()=>({audio_base64:Buffer.from('mock audio').toString('base64'),alignment:alignment('hello')})})});
  assert.equal(result.audio.toString(),'mock audio');assert.equal(result.timing.words[0].word,'hello');
});
test('Selected ElevenLabs voice overrides the configured default',async()=>{
  let called;
  await generateSpeech('hello',{voiceId:'selected-voice',env:{ELEVENLABS_API_KEY:'test',ELEVENLABS_VOICE_ID:'default'},fetcher:async url=>{called=url;return Response.json({audio_base64:Buffer.from('audio').toString('base64'),alignment:alignment('hello')});}});
  assert.match(called,/selected-voice\/with-timestamps$/);
});
test('ElevenLabs paid-plan rejection preserves exact reason without claiming exhausted quota',async()=>{
  const message='Free users cannot use library voices via the API. Please upgrade your subscription to use this voice.';
  await assert.rejects(generateSpeech('hello',{env:{ELEVENLABS_API_KEY:'test',ELEVENLABS_VOICE_ID:'library'},fetcher:async()=>Response.json({detail:{code:'paid_plan_required',status:'payment_required',message}},{status:402})}),error=>{
    assert.equal(error.message,`ElevenLabs HTTP 402 [paid_plan_required]: ${message}`);
    assert(!error.message.includes('exhausted'));return true;
  });
});
