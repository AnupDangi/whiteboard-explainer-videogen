import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createTtsPool,poolUrlsFromEnv} from '../dist/src/tts-pool.js';

const timing=(n=3)=>({kind:'kokoro-aligned',durationMs:n*300,words:Array.from({length:n},(_,i)=>({word:'w'+i,startMs:i*300,endMs:(i+1)*300}))});
const ok=()=>({audio:Buffer.from('x'),timing:timing()});
const delay=(ms,signal)=>new Promise((resolve,reject)=>{const t=setTimeout(resolve,ms);signal?.addEventListener('abort',()=>{clearTimeout(t);reject(signal.reason??new Error('aborted'));},{once:true});});

test('tts-pool: dispatches by priority so scene 1 is synthesized first',async()=>{
  const order=[];
  const pool=createTtsPool({urls:['http://a'],synthesize:async(_u,text)=>{order.push(text);return ok();}});
  await Promise.all([
    pool.enqueue({key:'s3',priority:3,text:'third'}),
    pool.enqueue({key:'s1',priority:1,text:'first'}),
    pool.enqueue({key:'s2',priority:2,text:'second'}),
  ]);
  assert.deepEqual(order,['first','second','third']);
  pool.close();
});

test('tts-pool: two workers run concurrently (one in-flight request per worker)',async()=>{
  const active=new Set();let max=0;
  const pool=createTtsPool({urls:['http://a','http://b'],synthesize:async(url,_t,_v,signal)=>{active.add(url);max=Math.max(max,active.size);await delay(30,signal);active.delete(url);return ok();}});
  await Promise.all([0,1,2,3].map(i=>pool.enqueue({key:'k'+i,priority:i,text:'t'+i})));
  assert.equal(max,2,'both workers were busy at once');
  pool.close();
});

test('tts-pool: a transient failure is retried once and then succeeds',async()=>{
  let calls=0;
  const pool=createTtsPool({urls:['http://a'],maxRetries:1,synthesize:async()=>{calls++;if(calls===1)throw new Error('worker dropped');return ok();}});
  const result=await pool.enqueue({key:'k',priority:1,text:'t'});
  assert.equal(calls,2,'one original + one retry');
  assert.equal(result.serviceMs>=0,true);
  assert.equal(pool.stats().retries,1);
  pool.close();
});

test('tts-pool: service timeout aborts the request, retries once, then fails',async()=>{
  let calls=0;
  const pool=createTtsPool({urls:['http://a'],serviceTimeoutMs:40,maxRetries:1,synthesize:async(_u,_t,_v,signal)=>{calls++;await delay(1000,signal);return ok();}});
  await assert.rejects(pool.enqueue({key:'k',priority:1,text:'t'}),/abort|timeout|operation/i);
  assert.equal(calls,2);
  assert.equal(pool.stats().failed,1);
  pool.close();
});

test('tts-pool: queue timeout rejects a request that never gets dispatched',async()=>{
  const pool=createTtsPool({urls:['http://a'],queueTimeoutMs:40,synthesize:async(_u,_t,_v,signal)=>{await delay(300,signal);return ok();}});
  const first=pool.enqueue({key:'a',priority:1,text:'a'});
  const second=pool.enqueue({key:'b',priority:2,text:'b'});
  await assert.rejects(second,/queue timeout/);
  await first;
  pool.close();
});

test('tts-pool: cancel removes a queued request and aborts an in-flight one',async()=>{
  const pool=createTtsPool({urls:['http://a'],queueTimeoutMs:500,synthesize:async(_u,_t,_v,signal)=>{await delay(150,signal);return ok();}});
  const first=pool.enqueue({key:'a',priority:1,text:'a'});
  const second=pool.enqueue({key:'b',priority:2,text:'b'});
  assert.equal(pool.cancel('b'),true,'queued request cancelled');
  await assert.rejects(second,/cancelled/);
  assert.equal(pool.cancel('a'),true,'in-flight request cancelled');
  await assert.rejects(first,/cancelled/);
  assert.equal(pool.cancel('missing'),false);
  pool.close();
});

test('tts-pool: dispatch order is deterministic for an identical enqueue sequence',async()=>{
  const runOnce=async()=>{
    const seen=[];
    const pool=createTtsPool({urls:['http://a'],synthesize:async()=>ok(),onEvent:(event,data)=>{if(event==='tts.dispatch')seen.push(data.key);}});
    await Promise.all([
      pool.enqueue({key:'c3',priority:30,text:'x'}),
      pool.enqueue({key:'c1',priority:10,text:'x'}),
      pool.enqueue({key:'c2',priority:20,text:'x'}),
      pool.enqueue({key:'c0',priority:0,text:'x'}),
    ]);
    pool.close();
    return seen;
  };
  assert.deepEqual(await runOnce(),await runOnce());
});

test('tts-pool: pool URLs come from KOKORO_SERVER_URLS, then KOKORO_SERVER_URL',()=>{
  assert.deepEqual(poolUrlsFromEnv({KOKORO_SERVER_URLS:'http://127.0.0.1:8765, http://127.0.0.1:8766/'}),['http://127.0.0.1:8765','http://127.0.0.1:8766']);
  assert.deepEqual(poolUrlsFromEnv({KOKORO_SERVER_URL:'http://127.0.0.1:9999'}),['http://127.0.0.1:9999']);
  assert.deepEqual(poolUrlsFromEnv({}),['http://127.0.0.1:8765']);
});
