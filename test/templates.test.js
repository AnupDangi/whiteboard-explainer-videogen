import test from 'node:test';
import assert from 'node:assert/strict';
import {fixtures} from '../dist/src/fixtures.js';
import {validatePlan,compileScene,renderSVG} from '../dist/src/engine.js';
import {renderTemplate} from '../dist/src/templates.js';

const compile=(name,index)=>compileScene(validatePlan({version:1,title:fixtures[name].title,scenes:fixtures[name].scenes}).scenes[index]);

test('V3-4 templates: TLS ladder draws two lifelines and labeled message arrows',()=>{
  const scene=compile('templates',0);
  assert.equal(scene.template,'tls_handshake');
  const done=renderSVG(scene,scene.durationMs);
  assert((done.match(/stroke-dasharray="7 7"/g)||[]).length>=2,'two dashed lifelines');
  assert(done.includes('ClientHello'),'message label from edge labels');
  const early=renderSVG(scene,scene.nodes[0].startMs);
  assert(early.length<done.length,'ladder reveals progressively');
  assert.equal(renderSVG(scene,scene.durationMs),renderSVG(scene,scene.durationMs),'deterministic');
  assert.equal(renderTemplate(compile('attention',0),9999),'','no template field → no overlay');
});
test('V3-4 templates: supply/demand draws axes, two curves and the P*/Q* crossing',()=>{
  const scene=compile('templates',1);
  assert.equal(scene.template,'supply_demand');
  const done=renderSVG(scene,scene.durationMs);
  assert(done.includes('P*')&&done.includes('Q*'),'equilibrium tags');
  assert(done.includes('quantity')&&done.includes('price'),'axis labels');
  assert(done.includes('Demand curve')&&done.includes('Supply curve'),'curve labels from nodes');
  assert.equal(renderSVG(scene,scene.durationMs),renderSVG(scene,scene.durationMs),'deterministic');
});
test('V3-4 templates: attention matrix, DNA fork and tectonic section render deterministically',()=>{
  for(const [index,marker] of [[2,'weights'],[3,'unzips here'],[4,'hot material rises']]){
    const scene=compile('templates',index);
    const done=renderSVG(scene,scene.durationMs);
    assert(done.includes(marker),`scene ${index} renders its template (${marker})`);
    assert.equal(renderSVG(scene,scene.durationMs),renderSVG(scene,scene.durationMs),'deterministic');
    const early=renderSVG(scene,scene.nodes[1].startMs);
    assert(early.length<done.length,'template reveals progressively');
  }
});
test('V3-4 templates: unknown template values fail validation and merge',async()=>{
  const bad={version:1,title:'t',scenes:[{...structuredClone(fixtures.templates.scenes[0]),template:'freeform'}]};
  assert.throws(()=>validatePlan(bad),/Unknown scene template/);
  const {generateChapters}=await import('../dist/src/planner.js');
  const env={OPENROUTER_API_KEY:'test-only',OPENROUTER_MODEL:'test/model'};
  const source={kind:'text',label:'x',text:'some source text',sha256:'t'};
  const reply=(result)=>Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(result)}}],usage:{prompt_tokens:10,completion_tokens:10,cost:0.00001}});
  const fetcher=async(url,options)=>{
    if(url.endsWith('/models'))return Response.json({data:[{id:'test/model',pricing:{prompt:'0.0000001',completion:'0.0000004'}}]});
    const body=JSON.parse(options.body);const content=JSON.parse(body.messages[1].content);
    if(content.chapterCount)return reply({paperTitle:'P',centralQuestion:'Q',workedExample:{entity:'E',numbers:['1']},visualInventory:[],title:'O',chapters:[{title:'T',objective:'E',arc:'build',keyPoints:['Point one','Point two']}]});
    if(content.scenes)return reply({scenes:content.scenes.map(s=>({id:s.id,layout:'flow',template:'rainbow',nodes:s.nodes.map(n=>({id:n.id,kind:'generic',emphasis:false}))}))});
    const words='Point one Point two '+Array.from({length:60},(_,i)=>`term_${i}`).join(' ');
    return reply({version:1,title:'D',scenes:[0,1].map(i=>({id:`s${i}`,title:`A${i}`,narration:words,nodes:[{id:'a',label:'Point one',anchor:'term_0',keyPoint:'Point one'},{id:'b',label:'Point two',anchor:'term_10',keyPoint:'Point two'}],edges:[{from:'a',to:'b',label:'causes'}],note:''}))});
  };
  // The unknown template fails every director attempt at merge; after the retry budget the
  // chapter ends in the loud fallback failure — never a silently template-less commit.
  await assert.rejects(async()=>{for await(const _ of generateChapters(source,{env,fetcher,durationMinutes:1})){ }},/fallback exhausted|unknown template/);
});
