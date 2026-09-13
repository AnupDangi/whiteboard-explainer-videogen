import test from 'node:test';
import assert from 'node:assert/strict';
import {log,logContext,loggedFetch,sanitizeLog} from '../dist/src/shared/logger.js';

test('Terminal logging redacts nested credentials and secrets embedded in errors',t=>{
  const prior=process.env.CANVAS_TEST_API_KEY;process.env.CANVAS_TEST_API_KEY='private-test-value';
  t.after(()=>{if(prior===undefined)delete process.env.CANVAS_TEST_API_KEY;else process.env.CANVAS_TEST_API_KEY=prior;});
  const result=JSON.stringify(sanitizeLog({error:new Error('Rejected private-test-value'),headers:{Authorization:'Bearer another-value','xi-api-key':'other-key'},narration:'private source',audio_base64:'binary-payload'}));
  for(const secret of ['private-test-value','another-value','other-key','private source','binary-payload'])assert(!result.includes(secret));
  assert(result.includes('REDACTED'));
});

test('Provider logs retain job correlation, HTTP status and latency without request bodies',async t=>{
  const lines=[];t.mock.method(console,'log',line=>lines.push(JSON.parse(line)));t.mock.method(console,'error',line=>lines.push(JSON.parse(line)));
  await logContext.run({jobId:'job-one'},async()=>{
    log('job.started');
    const response=await loggedFetch('test',async()=>new Response('',{status:402}))('https://example.test/speech?key=hidden-query',{method:'POST',headers:{Authorization:'Bearer hidden-header'},body:'hidden-body'});
    assert.equal(response.status,402);
  });
  assert(lines.every(line=>line.jobId==='job-one'));
  const response=lines.find(line=>line.event==='provider.response');assert.equal(response.status,402);assert.equal(response.level,'error');assert(response.elapsedMs>=0);
  const all=JSON.stringify(lines);for(const secret of ['hidden-query','hidden-header','hidden-body'])assert(!all.includes(secret));
});
