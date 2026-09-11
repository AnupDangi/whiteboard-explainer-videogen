import test from 'node:test';
import assert from 'node:assert/strict';
import {generateChapters,validateDuration} from '../dist/src/planner.js';
import {ingestSource,publicAddress,extractPdf} from '../dist/src/sources.js';
import {compileScene,renderSVG,validatePlan} from '../dist/src/engine.js';
const source={kind:'text',label:'unseen source',text:'A newly supplied source explains the core idea through a working example with an arbitrary experimental value of 739 liters.',sha256:'test'};
function adapter({failure=false,bad=false}={}) {
 const requests=[];
 return {requests,fetcher:async(url,options)=>{
  if(url.endsWith('/models'))return Response.json({data:[{id:'test/model',pricing:{prompt:'0.0000001',completion:'0.0000004'}}]});
  const body=JSON.parse(options.body);requests.push(body);if(failure)return new Response('',{status:429});
  const content=JSON.parse(body.messages[1].content);let result;
    if(content.chapterCount){
    // Stage 0 — outline v2: arc role + 2 canvas key points per chapter. Key points are
    // derived from the source text so LD6 grounding (evidenceIds) can pass honestly.
    const kps=sourceKeyPoints(content.source);
    result={paperTitle:'P',centralQuestion:'Q',workedExample:{entity:'E',numbers:['1']},visualInventory:[],title:'Dynamic outline',chapters:Array.from({length:content.chapterCount},(_,i)=>({title:`Topic ${i}`,objective:`Explain aspect ${i}`,arc:i===0?'hook':(i===content.chapterCount-1?'recap':'build'),keyPoints:kps}))};
   } else if(content.scenes){
    // Stage 2 — Visual Director: alternate icon/box so the shape-mix gate passes,
    // distinct kinds so the collision gate passes (generic nodes carry no shape).
    result={scenes:content.scenes.map(s=>({id:s.id,layout:'flow',nodes:s.nodes.map((n,j)=>({id:n.id,kind:j%2?'generic':'database',emphasis:false,...(j%2?{}:{shape:'icon'})}))}))};
   } else {
    // Stage 1 — Teaching Planner content: narration leads with the chapter key points
    // (passed in the payload) so key-point coverage holds; filler keeps word budget.
    const kps=content.chapterFrame&&Array.isArray(content.chapterFrame.chapterKeyPoints)&&content.chapterFrame.chapterKeyPoints.length?content.chapterFrame.chapterKeyPoints:['Cause point one','Effect point two'];
    const tag=(content.chapterFrame&&content.chapterFrame.chapter!==undefined?content.chapterFrame.chapter:JSON.stringify(content.objective||'x')).toString().replace(/\W+/g,'_').slice(0,20);
    const words=(kps.join(' ')+' '+Array.from({length:60},(_,i)=>`term${tag}_${i}`).join(' '));
    const evId=content.source&&Array.isArray(content.source.evidenceChunks)&&content.source.evidenceChunks.length?content.source.evidenceChunks[0].id:'p1:c1';
    result={version:1,title:'Dynamic explanation',scenes:[0,1].map(i=>({id:`s${i}`,title:`Aspect ${tag}-${i}`,narration:words,nodes:[{id:'a',label:kps[0],anchor:words.split(/\s+/).slice(0,3).join(' '),keyPoint:kps[0],evidenceIds:[evId]},{id:'b',label:kps[1]||kps[0],anchor:bad?'absent phrase':`term${tag}_45`,keyPoint:kps[1]||kps[0],evidenceIds:[evId]}],edges:[{from:'a',to:'b',label:'causes'}],note:''}))};
   }
  return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(result)}}],usage:{prompt_tokens:100,completion_tokens:100,cost:0.00005}});
 }};
}
const env={OPENROUTER_API_KEY:'test-only',OPENROUTER_MODEL:'test/model'};
// LD6 grounding: mock key points must be derivable from the source text so nodes can
// cite evidence chunks that genuinely support them (≥2 shared content words).
function sourceKeyPoints(src){
  const words=String(src&&src.text||'').split(/\s+/).filter(w=>/^[A-Za-z-]{2,}$/.test(w)&&!/^(a|an|the|with|of|and|or|is|through|into)$/i.test(w));
  return [words.slice(0,3).join(' ')||'core idea explanation',words.slice(3,6).join(' ')||'working example detail'];
}
for(const minutes of [1,5,10,30])test(`Duration ${minutes}: distinct chapter requests and progressive scene count (mock provider)`,async()=>{
 const mock=adapter();let scenes=[];let updates=0;
 for await(const p of generateChapters(source,{env:{...env,EXPLAIN_AUTO_DIRECT:'0'},fetcher:mock.fetcher,durationMinutes:minutes,onUsage:()=>updates++})){assert.equal(p.scenes.length,2);scenes.push(...p.scenes);}
 assert.equal(scenes.length,minutes*2);assert.equal(new Set(scenes.map(s=>s.id)).size,scenes.length);
 // 1 outline call + (1 content + 1 director) per chapter in the happy path.
 assert.equal(mock.requests.length,1+minutes*2);assert.equal(updates,1+minutes*2);
  const contentRequests=mock.requests.filter(r=>{const c=JSON.parse(r.messages[1].content);return c.chapterFrame&&typeof c.chapterFrame.chapter==='number';});
 assert.equal(contentRequests.length,minutes);
 assert(contentRequests.every(r=>r.messages[1].content.includes(source.text)));
 assert.equal(mock.requests[1].response_format.type,'json_schema');
 validatePlan({version:1,title:'Long plan',scenes});for(const s of scenes){const c=compileScene(s);assert.equal(renderSVG(c,999),renderSVG(c,999));}
});
test('Phase 0 spans: outline/chapter wall ms and cached tokens accumulate on usage',async()=>{
  const mock=adapter();let last=null;
  for await(const _ of generateChapters(source,{env,fetcher:mock.fetcher,durationMinutes:1,onUsage:(u)=>{last=u;}})){}
  assert.equal(typeof last.cachedTokens,'number');
  assert(last.spans.outlineMs>=0);
  assert.deepEqual(Object.keys(last.spans.chapters),['1']);
  assert(last.spans.chapters['1'].contentMs>=0&&last.spans.chapters['1'].directorMs>=0);
});
test('Invalid duration and exhausted budget prevent model calls',async()=>{
 for(const d of [0,2,31,NaN,Infinity])assert.throws(()=>validateDuration(d));
 const mock=adapter();await assert.rejects(async()=>{for await(const _ of generateChapters(source,{env,fetcher:mock.fetcher,maxCostUsd:0.0000001})){}},/budget/);assert.equal(mock.requests.length,0);
});
test('A transient failure on the very first content/director call retries in place, not as a full chapter regeneration',async()=>{
 const requests=[];let contentCalls=0,directorCalls=0;
 const reply=(result)=>Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(result)}}],usage:{prompt_tokens:10,completion_tokens:10,cost:0.00001}});
 const fetcher=async(url,options)=>{
  if(url.endsWith('/models'))return Response.json({data:[{id:'test/model',pricing:{prompt:'0.0000001',completion:'0.0000004'}}]});
  const body=JSON.parse(options.body);requests.push(body);
  const content=JSON.parse(body.messages[1].content);
   if(content.chapterCount)return reply({paperTitle:'P',centralQuestion:'Q',workedExample:{entity:'E',numbers:['1']},visualInventory:[],title:'Outline',chapters:[{title:'Topic',objective:'Explain it',arc:'build',keyPoints:['Core idea point','Working example point']}]});
   if(content.scenes){
    directorCalls++;
    if(directorCalls===1)return new Response('',{status:429});
    const director={scenes:content.scenes.map(s=>({id:s.id,layout:'flow',nodes:s.nodes.map((n,j)=>({id:n.id,kind:j%2?'generic':'database',emphasis:false,...(j%2?{}:{shape:'icon'})}))}))};
    return reply(director);
   }
   contentCalls++;
   if(contentCalls===1)return new Response('',{status:429});
   const words='Core idea point Working example point '+Array.from({length:60},(_,i)=>`term_${i}`).join(' ');
   const evId=content.source&&Array.isArray(content.source.evidenceChunks)&&content.source.evidenceChunks.length?content.source.evidenceChunks[0].id:'p1:c1';
    const result={version:1,title:'D',scenes:[0,1].map(i=>({id:`s${i}`,title:`Aspect ${i}`,narration:words,nodes:[{id:'a',label:'Core idea',anchor:'term_0',keyPoint:'Core idea point',evidenceIds:[evId]},{id:'b',label:'Working example',anchor:'term_45',keyPoint:'Working example point',evidenceIds:[evId]}],edges:[{from:'a',to:'b',label:'causes'}],note:''}))};
    return reply(result);
  };
  const scenes=[];
  for await(const p of generateChapters(source,{env:{...env,EXPLAIN_AUTO_DIRECT:'0'},fetcher,durationMinutes:1}))scenes.push(...p.scenes);
  assert.equal(scenes.length,2);
  assert.equal(contentCalls,2,'content retried once in place after its first-call failure');
 assert.equal(directorCalls,2,'director retried once in place after its first-call failure');
 // 1 outline + 2 content attempts + 2 director attempts — not the doubled request count a
 // full chapter regeneration (re-running outline-independent work from scratch) would cause.
 assert.equal(requests.length,5);
});
test('Exhausted director retries fail loudly instead of shipping all-generic boxes',async()=>{
  const reply=(result)=>Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(result)}}],usage:{prompt_tokens:10,completion_tokens:10,cost:0.00001}});
  const requests=[];
  const fetcher=async(url,options)=>{
    if(url.endsWith('/models'))return Response.json({data:[{id:'test/model',pricing:{prompt:'0.0000001',completion:'0.0000004'}}]});
    const body=JSON.parse(options.body);requests.push(body);
    const content=JSON.parse(body.messages[1].content);
    if(content.chapterCount)return reply({paperTitle:'P',centralQuestion:'Q',workedExample:{entity:'E',numbers:['1']},visualInventory:[],title:'Outline',chapters:[{title:'Topic',objective:'Explain it',arc:'build',keyPoints:['Core idea point','Working example point']}]});
    if(content.scenes)return reply({scenes:content.scenes.map(s=>({id:s.id,layout:'nope-not-a-layout',nodes:s.nodes.map(n=>({id:n.id,kind:'generic',emphasis:false}))}))});
    const words='Core idea point Working example point '+Array.from({length:60},(_,i)=>`term_${i}`).join(' ');
    const evId=content.source&&Array.isArray(content.source.evidenceChunks)&&content.source.evidenceChunks.length?content.source.evidenceChunks[0].id:'p1:c1';
    return reply({version:1,title:'D',scenes:[0,1].map(i=>({id:`s${i}`,title:`Aspect ${i}`,narration:words,nodes:[{id:'a',label:'Core idea',anchor:'term_0',keyPoint:'Core idea point',evidenceIds:[evId]},{id:'b',label:'Working example',anchor:'term_45',keyPoint:'Working example point',evidenceIds:[evId]}],edges:[{from:'a',to:'b',label:'causes'}],note:''}))});
  };
  await assert.rejects(async()=>{for await(const _ of generateChapters(source,{env:{...env,EXPLAIN_AUTO_DIRECT:'0'},fetcher,durationMinutes:1})){ }},/fallback exhausted/);
  // 1 outline + [1 content + 3 failed director attempts] × 2 chapter regenerations;
  // no silent fallback commit on either pass.
  assert.equal(requests.length,9);
});
test('Auto-director: mappable labels skip the director LLM call entirely',async()=>{
  const autoSource={kind:'text',label:'t',text:'The user request goes to the database storage. A token model reads the file quickly.',sha256:'auto'};
  const requests=[];
  const fetcher=async(url,options)=>{
    if(url.endsWith('/models'))return Response.json({data:[{id:'test/model',pricing:{prompt:'0.0000001',completion:'0.0000004'}}]});
    const body=JSON.parse(options.body);requests.push(body);
    const content=JSON.parse(body.messages[1].content);
    const reply=(result)=>Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(result)}}],usage:{prompt_tokens:10,completion_tokens:10,cost:0.00001}});
    if(content.chapterCount)return reply({paperTitle:'P',centralQuestion:'Q',workedExample:{entity:'E',numbers:['1']},visualInventory:[],title:'O',chapters:[{title:'T',objective:'Explain it',arc:'build',keyPoints:['User request','Database storage']}]});
    if(content.scenes)return reply({scenes:content.scenes.map(s=>({id:s.id,layout:'flow',nodes:s.nodes.map(n=>({id:n.id,kind:'generic',emphasis:false}))}))});
    const evId=content.source.evidenceChunks[0].id;
    const words='User request Database storage '+Array.from({length:60},(_,i)=>`term_${i}`).join(' ');
    return reply({version:1,title:'D',scenes:[0,1].map(i=>({id:`s${i}`,title:`A${i}`,narration:words,nodes:[{id:'a',label:'User request',anchor:'User request',keyPoint:'User request',evidenceIds:[evId]},{id:'b',label:'Database storage',anchor:'term_45',keyPoint:'Database storage',evidenceIds:[evId]}],edges:[{from:'a',to:'b',label:'sends'}],note:''}))});
  };
  for await(const p of generateChapters(autoSource,{env,fetcher,durationMinutes:1})){}
  const directorCalls=requests.filter(r=>{const c=JSON.parse(r.messages[1].content);return Array.isArray(c.scenes)&&!c.repairError&&!c.chapterFrame;});
  assert.equal(directorCalls.length,0,'no LLM director call — compiler composed both scenes');
});

test('Provider and schema errors stay errors; no fixture fallback',async()=>{ const prev=process.env.EXPLAIN_ANCHOR_HEAL;process.env.EXPLAIN_ANCHOR_HEAL='0';try{ for(const options of [{failure:true},{bad:true}]){const mock=adapter(options);await assert.rejects(async()=>{for await(const _ of generateChapters(source,{env,fetcher:mock.fetcher})){}},options.failure?/429/:/Anchor/);}}finally{if(prev===undefined)delete process.env.EXPLAIN_ANCHOR_HEAL;else process.env.EXPLAIN_ANCHOR_HEAL=prev;}
});
test('Source text is preserved and fingerprint changes with content',async()=>{
 const a=await ingestSource({kind:'text',text:source.text}),b=await ingestSource({kind:'text',text:source.text.replace('739','831')});assert.equal(a.text,source.text);assert.notEqual(a.sha256,b.sha256);
  await assert.rejects(ingestSource({kind:'text',text:''}),/readable/);const clipped=await ingestSource({kind:'text',text:('word '.repeat(1100000))});assert(clipped.text.length<=5000000);assert.equal(clipped.pages,undefined);
});
test('P1 sources: markdown, json and docx ingest deterministically',async()=>{
  const md=await ingestSource({kind:'markdown',text:'# Heading\n\nMarkdown body with plenty of readable characters for the gate.'});
  assert.equal(md.kind,'markdown');assert(md.text.includes('Markdown body'));
  const json=await ingestSource({kind:'json',text:'{"topic":"braking","trials":4}',name:'j'});
  assert(json.text.includes('braking'));
  await assert.rejects(ingestSource({kind:'json',text:'{not json'}),/Invalid JSON/);
  const {execFile}=await import('node:child_process');
  const {promisify}=await import('node:util');
  const {mkdtemp,writeFile,rm,mkdir,readFile}=await import('node:fs/promises');
  const {tmpdir}=await import('node:os');
  const dir=await mkdtemp(`${tmpdir()}/docx-test-`);await mkdir(`${dir}/word`,{recursive:true});
  await writeFile(`${dir}/word/document.xml`,'<w:document xmlns:w="w"><w:body><w:p><w:t>Word body with enough readable text</w:t></w:p></w:body></w:document>');
  await promisify(execFile)('zip',['-q','-r',`${dir}/t.docx`,'.'],{cwd:dir});
  const docxBytes=await readFile(`${dir}/t.docx`);await rm(dir,{recursive:true,force:true});
  const doc=await ingestSource({kind:'docx',base64:docxBytes.toString('base64'),name:'t.docx'});
  assert.equal(doc.text,'Word body with enough readable text');
  await assert.rejects(ingestSource({kind:'docx',base64:Buffer.from('not a zip').toString('base64')}),/missing its main text|central-directory|Invalid document/);
  await assert.rejects(ingestSource({kind:'bogus'}),/Choose prompt/);
});
test('Source fetching rejects private, mapped and reserved addresses',async()=>{
 for(const ip of ['127.0.0.1','10.0.0.1','169.254.169.254','::1','::ffff:127.0.0.1','fc00::1','192.168.1.1','0.0.0.0'])assert.equal(publicAddress(ip),false,ip);
 assert.equal(publicAddress('8.8.8.8'),true);await assert.rejects(ingestSource({kind:'url',url:'file:///etc/passwd'}),/HTTPS/);await assert.rejects(extractPdf(Buffer.from('not a PDF')),/Invalid PDF/);
});
test('Phase 3 caching: breakpoint + session pinning by default, plain string without',async()=>{
  const mock=adapter();
  for await(const _ of generateChapters(source,{env,fetcher:mock.fetcher,durationMinutes:1,sessionId:'job-123'})){}
  const first=mock.requests[0];
  assert.equal(first.session_id,'job-123');
  assert(Array.isArray(first.messages[0].content)&&first.messages[0].content[0].cache_control.type==='ephemeral');
  const mock2=adapter();
  for await(const _ of generateChapters(source,{env,fetcher:mock2.fetcher,durationMinutes:1,cachePrompts:false})){}
  assert.equal(mock2.requests[0].session_id,undefined);
  assert.equal(typeof mock2.requests[0].messages[0].content,'string');
});
test('A4: a real director result using one shape throughout (a legitimate token row) is accepted without repair',async()=>{
  const reply=(result)=>Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(result)}}],usage:{prompt_tokens:10,completion_tokens:10,cost:0.00001}});
  let directorCalls=0;
  // LD6: the token-row key points must exist in the source so nodes can cite honest evidence.
  const tokenSource={kind:'text',label:'tokens',text:'A token instance ordering matters because an ordered token row repeats the same visual kind.',sha256:'tok'};
  const fetcher=async(url,options)=>{
    if(url.endsWith('/models'))return Response.json({data:[{id:'test/model',pricing:{prompt:'0.0000001',completion:'0.0000004'}}]});
    const body=JSON.parse(options.body);
    const content=JSON.parse(body.messages[1].content);
    if(content.chapterCount)return reply({paperTitle:'P',centralQuestion:'Q',workedExample:{entity:'E',numbers:['1']},visualInventory:[],title:'Outline',chapters:[{title:'Topic',objective:'Explain it',arc:'build',keyPoints:['Token instance','Ordered token']}]});
    if(content.scenes){
      directorCalls++;
      // Same shape ('box', via no shape field) and same kind ('token') on every node, with
      // numbered labels the director echoes back unchanged — a legitimate repeated-instance
      // token row. Before A4 this tripped the hard shape-mix gate and forced a repair/fallback.
      return reply({scenes:content.scenes.map(s=>({id:s.id,layout:'flow',nodes:s.nodes.map((n,j)=>({id:n.id,kind:'token',emphasis:false}))}))});
    }
    const words='Token instance Ordered token '+Array.from({length:60},(_,i)=>`term_${i}`).join(' ');
    const evId=content.source&&Array.isArray(content.source.evidenceChunks)&&content.source.evidenceChunks.length?content.source.evidenceChunks[0].id:'p1:c1';
    const result={version:1,title:'D',scenes:[0,1].map(i=>({id:`s${i}`,title:`Aspect ${i}`,narration:words,
      nodes:[{id:'a',label:'Token 1',anchor:'term_0',keyPoint:'Token instance',evidenceIds:[evId]},{id:'b',label:'Token 2',anchor:'term_45',keyPoint:'Ordered token',evidenceIds:[evId]}],
      edges:[{from:'a',to:'b',label:'precedes'}],note:''}))};
    return reply(result);
  };
  const scenes=[];
  for await(const p of generateChapters(tokenSource,{env:{...env,EXPLAIN_AUTO_DIRECT:'0'},fetcher,durationMinutes:1}))scenes.push(...p.scenes);
  assert.equal(scenes.length,2,'both scenes committed — no chapter regeneration was needed');
  assert.equal(directorCalls,1,'the director succeeded on its first attempt — no repair/fallback was triggered by shape uniformity');
  for(const scene of scenes)assert(scene.nodes.filter(n=>!n.auto).every(n=>(n.shape||'box')==='box'),'the single-shape token row survived unchanged (the additive takeaway board is excluded), as intended by A4');
});
test('A5: a single-scene critic repair validates and actually applies (was previously a silent no-op)',async()=>{
  const reply=(result)=>Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(result)}}],usage:{prompt_tokens:10,completion_tokens:10,cost:0.00001}});
  let repairCalls=0;
  const fetcher=async(url,options)=>{
    if(url.endsWith('/models'))return Response.json({data:[
      {id:'test/model',pricing:{prompt:'0.0000001',completion:'0.0000004'}},
      {id:'openai/gpt-5.6-luna',pricing:{prompt:'0.0000002',completion:'0.0000006'}},
    ]});
    const body=JSON.parse(options.body);
    const userContent=body.messages[1].content;
    if(Array.isArray(userContent)){
      // The critic's vision call: request one repair, every time.
      return reply({issues:['scene reads as cluttered'],needsRepair:true});
    }
    const content=JSON.parse(userContent);
    if(content.chapterCount)return reply({paperTitle:'P',centralQuestion:'Q',workedExample:{entity:'E',numbers:['1']},visualInventory:[],title:'Outline',chapters:[{title:'Topic',objective:'Explain it',arc:'build',keyPoints:['Core idea point','Working example point']}]});
    if(content.repairError&&Array.isArray(content.scenes)&&content.scenes.length===1){
      // The A5 repair call: exactly one scene in the prompt. Flip the kind so the test can
      // observe the repair actually landing (before the A5 fix, this call silently failed
      // schema validation and repairFromCritique's catch kept the original, unrepaired scene).
      repairCalls++;
      return reply({scenes:[{id:content.scenes[0].id,layout:'flow',nodes:content.scenes[0].nodes.map((n,j)=>({id:n.id,kind:'success',emphasis:false,...(j===0?{shape:'icon'}:{})}))}]});
    }
    if(content.scenes){
      // Normal 2-scene director call: distinct icon/box shapes, distinct kinds, so it succeeds
      // on the first attempt and the critic is what triggers the repair, not a director retry.
      return reply({scenes:content.scenes.map(s=>({id:s.id,layout:'flow',nodes:s.nodes.map((n,j)=>({id:n.id,kind:j%2?'generic':'database',emphasis:false,...(j%2?{}:{shape:'icon'})}))}))});
    }
    const words='Core idea point Working example point '+Array.from({length:60},(_,i)=>`term_${i}`).join(' ');
    const evId=content.source&&Array.isArray(content.source.evidenceChunks)&&content.source.evidenceChunks.length?content.source.evidenceChunks[0].id:'p1:c1';
    return reply({version:1,title:'D',scenes:[0,1].map(i=>({id:`s${i}`,title:`Aspect ${i}`,narration:words,
      nodes:[{id:'a',label:'Core idea',anchor:'term_0',keyPoint:'Core idea point',evidenceIds:[evId]},{id:'b',label:'Working example',anchor:'term_45',keyPoint:'Working example point',evidenceIds:[evId]}],
      edges:[{from:'a',to:'b',label:'causes'}],note:''}))});
  };
  const scenes=[];
  for await(const p of generateChapters(source,{env:{...env,EXPLAIN_AUTO_DIRECT:'0'},fetcher,durationMinutes:1,visualCritic:true}))scenes.push(...p.scenes);
  assert.equal(repairCalls,2,'the critic requested a repair for both scenes and each repair call validated (1-scene schema)');
  assert(scenes.every(s=>s.nodes[0].kind==='success'),'the repaired kind actually reached the committed scene, not just the repair response');
});
