import test from 'node:test';
import assert from 'node:assert/strict';
import {generateChapters,healOutline,validateOutline,healSchemaFields,resolveAnchors} from '../dist/src/planner.js';

const source={kind:'text',label:'unseen source',text:'A newly supplied source explains the core idea through a working example with an arbitrary experimental value of 739 liters.',sha256:'test'};
const reply=(result,extra={})=>Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(result)}}],usage:{prompt_tokens:100,completion_tokens:100,cost:0.00005},...extra});
function outline(count,kps){
  return {paperTitle:'P',centralQuestion:'Q',workedExample:{entity:'E',numbers:['1']},visualInventory:[],title:'Dynamic outline',
    chapters:Array.from({length:count},(_,i)=>({title:`Topic ${i}`,objective:`Explain aspect ${i}`,arc:i===0?'hook':(count>2&&i===count-1?'recap':'build'),keyPoints:kps}))};
}
const defaultKps=['arbitrary experimental value','core idea explanation'];

test('healOutline: trims over-length key points and drops entity-only ones',()=>{
  const outline={chapters:[{title:'Ch',objective:'Plants make food',arc:'hook',keyPoints:['New architecture: Transformer','+ 6O2']}]};
  const healed=healOutline(outline);
  assert(healed.some(h=>h.includes('trimmed')),'long key point trimmed');
  assert(healed.some(h=>h.includes('entity-only')),'entity-only key point dropped before validation');
  assert.deepEqual(validateOutline({...outline,title:'T',paperTitle:'P',centralQuestion:'Q',workedExample:{entity:'E',numbers:[]},visualInventory:[]},1),[]);
});

test('healOutline: clamps a chapter with no usable key point back to one from its own objective',()=>{
  const outline={chapters:[{objective:'Sunlight powers sugar production',arc:'build',keyPoints:['+ 6O2']}]};
  healOutline(outline);
  assert.equal(outline.chapters[0].keyPoints.length,1);
  assert(/sunlight|powers|sugar/i.test(outline.chapters[0].keyPoints[0]));
});

test('validateOutline: returns named clauses, not a bare boolean',()=>{
  const failures=validateOutline({title:'T',paperTitle:'P',centralQuestion:'Q',workedExample:{entity:'E',numbers:[]},visualInventory:[],chapters:[]},2);
  assert(failures.some(f=>f.includes('chapters count 0 != 2')));
});

test('healSchemaFields: normalizes model-metadata format fields instead of throwing',()=>{
  const scenes=[{nodes:[
    {id:'a',conceptId:'Query Key!',visualIntent:'  ',evidenceIds:['not-a-chunk','p1:c2','p1:c2','p9:c9']},
    {id:'b',conceptId:'x'.repeat(60),visualIntent:'word '.repeat(40),keyPoint:'k'.repeat(80)},
  ]}];
  const healed=healSchemaFields(scenes);
  assert(!scenes[0].nodes[0].visualIntent,'empty visualIntent dropped');
  assert.equal(scenes[0].nodes[0].conceptId,'query-key','conceptId charset-normalized');
  assert.deepEqual(scenes[0].nodes[0].evidenceIds,['p1:c2','p9:c9'],'invalid ids filtered, duplicates removed');
  assert.equal(scenes[0].nodes[1].conceptId.length,40,'conceptId capped at 40');
  assert(scenes[0].nodes[1].visualIntent.length<=120,'visualIntent capped at 120');
  assert(scenes[0].nodes[1].keyPoint.length<=60,'keyPoint capped at 60');
  assert(healed.length>=4);
});

test('resolveAnchors: malformed conceptId/visualIntent/evidenceIds are healed, not fatal',()=>{
  const raw={version:1,title:'T',scenes:[{id:'s1',title:'S',narration:'alpha beta gamma delta',layout:'flow',nodes:[
    {id:'n1',label:'alpha',anchor:'alpha',wordIndex:0,conceptId:'Needs Fixing!',visualIntent:'y'.repeat(150),evidenceIds:['bogus','p1:c2']},
    {id:'n2',label:'beta',anchor:'beta',wordIndex:1,conceptId:'ok-id',visualIntent:'valid intent',evidenceIds:['p2:c3']},
  ],edges:[]}]};
  const plan=resolveAnchors(raw);
  const n1=plan.scenes[0].nodes.find(n=>n.id==='n1');
  assert.equal(n1.conceptId,'needs-fixing');
  assert(n1.visualIntent.length<=120);
  assert.deepEqual(n1.evidenceIds,['p1:c2']);
});

function mockAdapter({onOutline}={}){
  const requests=[];
  let outlineCalls=0;
  const fetcher=async(url,options)=>{
    if(url.endsWith('/models'))return Response.json({data:[
      {id:'test/model',pricing:{prompt:'0.0000001',completion:'0.0000004'}},
      {id:'qwen/qwen3.7-flash',pricing:{prompt:'0.0000001',completion:'0.0000004'}},
    ]});
    const body=JSON.parse(options.body);requests.push(body);
    const content=JSON.parse(body.messages[1].content);
    if(content.chapterCount){
      outlineCalls++;
      if(onOutline)return onOutline({body,content,outlineCalls,reply});
      return reply(outline(content.chapterCount,defaultKps));
    }
    if(content.scenes){
      return reply({scenes:content.scenes.map(s=>({id:s.id,layout:'flow',nodes:s.nodes.map((n,j)=>({id:n.id,kind:j%2?'generic':'database',emphasis:false,...(j%2?{}:{shape:'icon'})}))}))});
    }
    const kps=content.chapterFrame&&content.chapterFrame.chapterKeyPoints.length?content.chapterFrame.chapterKeyPoints:defaultKps;
    const tag=('c'+content.chapterFrame.chapter).replace(/\W+/g,'_');
    const words=kps.join(' ')+' '+Array.from({length:60},(_,i)=>`term${tag}_${i}`).join(' ');
    const evId=content.source.evidenceChunks[0].id;
    return reply({version:1,title:'Dynamic explanation',scenes:[0,1].map(i=>({id:`s${i}`,title:`Aspect ${tag}-${i}`,narration:words,nodes:[{id:'a',label:kps[0],anchor:words.split(/\s+/).slice(0,3).join(' '),keyPoint:kps[0],evidenceIds:[evId]},{id:'b',label:kps[1]||kps[0],anchor:`term${tag}_45`,keyPoint:kps[1]||kps[0],evidenceIds:[evId]}],edges:[{from:'a',to:'b',label:'causes'}],note:''}))});
  };
  return {requests,fetcher};
}
const env={OPENROUTER_API_KEY:'test-only',OPENROUTER_MODEL:'test/model'};

test('outline repair: a wrong chapter count triggers exactly one repair carrying the named clause, then completes',async()=>{
  const mock=mockAdapter({onOutline:({content,outlineCalls,reply})=>outlineCalls===1?reply(outline(2,defaultKps)):reply(outline(content.chapterCount,defaultKps))});
  let scenes=[];for await(const p of generateChapters(source,{env:{...env,EXPLAIN_AUTO_DIRECT:'0'},fetcher:mock.fetcher,durationMinutes:1}))scenes.push(...p.scenes);
  assert.equal(scenes.length,2,'plan completes after the outline repair');
  const outlineReqs=mock.requests.filter(r=>{const c=JSON.parse(r.messages[1].content);return typeof c.chapterCount==='number';});
  assert.equal(outlineReqs.length,2,'one outline + one outline-repair');
  assert.match(JSON.parse(outlineReqs[1].messages[1].content).repairError,/chapters count 2 != 1/,'repair names the exact clause');
});

test('outline repair: entity-only key points are healed without spending a repair call',async()=>{
  const mock=mockAdapter({onOutline:({content,reply})=>reply(outline(content.chapterCount,['arbitrary experimental value','+ 6O2']))});
  let scenes=[];for await(const p of generateChapters(source,{env:{...env,EXPLAIN_AUTO_DIRECT:'0'},fetcher:mock.fetcher,durationMinutes:1}))scenes.push(...p.scenes);
  assert.equal(scenes.length,2,'heal made the outline valid on the first call');
  const outlineReqs=mock.requests.filter(r=>{const c=JSON.parse(r.messages[1].content);return typeof c.chapterCount==='number';});
  assert.equal(outlineReqs.length,1,'no repair call was needed');
});

test('finish_reason length: one retry at a raised budget, then completes',async()=>{
  const mock=mockAdapter({onOutline:({content,outlineCalls,reply})=>outlineCalls===1
    ? Response.json({choices:[{finish_reason:'length',message:{content:'{"paperTitle":"P"'}}],usage:{prompt_tokens:10,completion_tokens:3000,cost:0.00005}})
    : reply(outline(content.chapterCount,defaultKps))});
  let scenes=[];for await(const p of generateChapters(source,{env:{...env,EXPLAIN_AUTO_DIRECT:'0'},fetcher:mock.fetcher,durationMinutes:1}))scenes.push(...p.scenes);
  assert.equal(scenes.length,2,'truncated outline recovers');
  const outlineReqs=mock.requests.filter(r=>{const c=JSON.parse(r.messages[1].content);return typeof c.chapterCount==='number';});
  assert.equal(outlineReqs.length,2);
  assert(outlineReqs[1].max_tokens>outlineReqs[0].max_tokens,'retry raises the output budget');
  assert(outlineReqs[1].reasoning.max_tokens<outlineReqs[0].reasoning.max_tokens,'retry cuts reasoning');
});

test('finish_reason content_filter: fails loudly with a distinct message, no retry',async()=>{
  const mock=mockAdapter({onOutline:()=>Response.json({choices:[{finish_reason:'content_filter',message:{content:''}}],usage:{prompt_tokens:10,completion_tokens:0,cost:0.00001}})});
  await assert.rejects(async()=>{for await(const _ of generateChapters(source,{env,fetcher:mock.fetcher,durationMinutes:1})){}},/content filter/i);
});

test('require_parameters: pinned for strict models, omitted for known non-strict tiers',async()=>{
  const strict=mockAdapter();
  for await(const _ of generateChapters(source,{env:{...env,EXPLAIN_AUTO_DIRECT:'0'},fetcher:strict.fetcher,durationMinutes:1})){}
  const strictOutline=strict.requests.find(r=>{const c=JSON.parse(r.messages[1].content);return typeof c.chapterCount==='number';});
  assert.equal(strictOutline.provider?.require_parameters,true,'strict model pins schema support');

  const lenient=mockAdapter();
  for await(const _ of generateChapters(source,{env:{...env,OPENROUTER_OUTLINE_MODEL:'qwen/qwen3.7-flash',EXPLAIN_AUTO_DIRECT:'0'},fetcher:lenient.fetcher,durationMinutes:1})){}
  const lenientOutline=lenient.requests.find(r=>{const c=JSON.parse(r.messages[1].content);return typeof c.chapterCount==='number';});
  assert.equal(lenientOutline.provider?.require_parameters,undefined,'qwen tier omits the unsupported parameter');
});
