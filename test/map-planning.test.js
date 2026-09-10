import test from 'node:test';
import assert from 'node:assert/strict';
import {generateChapters} from '../dist/src/planner.js';
import {renderMapForOutline} from '../dist/src/document-map.js';

const env={OPENROUTER_API_KEY:'test-only',OPENROUTER_MODEL:'test/model'};

function adapter(mapSections){
  const requests=[];
  return {requests,fetcher:async(url,options)=>{
    if(url.endsWith('/models'))return Response.json({data:[{id:'test/model',pricing:{prompt:'0.0000001',completion:'0.0000004'}}]});
    const body=JSON.parse(options.body);requests.push(body);
    const content=JSON.parse(body.messages[1].content);
    if(content.chapterCount){
      // Outline reply routes chapters to map sections (large-source branch). Key points
      // derive from what each chapter actually retrieves so LD6 grounding passes honestly.
      const isMap=String(content.source.text).includes('DOCUMENT MAP');
      const result={paperTitle:'Large Book',centralQuestion:'Q',workedExample:{entity:'E',numbers:['1']},visualInventory:[],title:'Mapped outline',chapters:Array.from({length:content.chapterCount},(_,i)=>({title:`Topic ${i}`,objective:`Explain ${isMap?(i%2===0?'alpha material':'beta material'):'the core idea'}`,arc:i===0?'hook':(i===content.chapterCount-1?'recap':'build'),keyPoints:isMap?(i%2===0?['alpha mechanism','markerA components']:['beta pipeline','markerB components']):['core idea explanation','working example detail'],sourceSections:[mapSections[i%mapSections.length].id]}))};
      return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(result)}}],usage:{prompt_tokens:100,completion_tokens:100,cost:0.00005}});
    }
    if(content.scenes){
      const result={scenes:content.scenes.map(s=>({id:s.id,layout:'flow',nodes:s.nodes.map((n,j)=>({id:n.id,kind:j%2?'generic':'database',emphasis:false,...(j%2?{}:{shape:'icon'})}))}))};
      return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(result)}}],usage:{prompt_tokens:100,completion_tokens:100,cost:0.00005}});
    }
    const kps=content.chapterFrame.chapterKeyPoints;
    const tag=content.chapterFrame.chapter;
    const words=(kps.join(' ')+' '+Array.from({length:60},(_,i)=>`term${tag}_${i}`).join(' '));
    const evId=content.source&&Array.isArray(content.source.evidenceChunks)&&content.source.evidenceChunks.length?content.source.evidenceChunks[0].id:'p1:c1';
    const result={version:1,title:'Mapped explanation',scenes:[0,1].map(i=>({id:`s${i}`,title:`Aspect ${i}`,narration:words,nodes:[{id:'a',label:kps[0],anchor:words.split(/\s+/).slice(0,3).join(' '),keyPoint:kps[0],evidenceIds:[evId]},{id:'b',label:kps[1]||kps[0],anchor:`term${tag}_45`,keyPoint:kps[1]||kps[0],evidenceIds:[evId]}],edges:[{from:'a',to:'b',label:'causes'}],note:''}))};
    return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(result)}}],usage:{prompt_tokens:100,completion_tokens:100,cost:0.00005}});
  }};
}

function bigSource(){
  const sections=[
    {id:'s1',title:'Alpha Section',page:1,summary:'Teaches alpha material with markerA words.'},
    {id:'s2',title:'Beta Section',page:2,summary:'Teaches beta material with markerB words.'},
  ];
  const body1=Array.from({length:300},(_,i)=>`Alpha paragraph ${i}: the alpha mechanism uses markerA components and alpha numbers ${i} to explain alpha behavior in detail.`).join('\n\n');
  const body2=Array.from({length:300},(_,i)=>`Beta paragraph ${i}: the beta pipeline uses markerB components and beta numbers ${i} to explain beta behavior in detail.`).join('\n\n');
  const text=`${body1}\n\n${body2}`;
  const map={kind:'book',sections:[{...sections[0],start:0,end:body1.length,charCount:body1.length},{...sections[1],start:body1.length+2,end:text.length,charCount:body2.length}]};
  return {source:{kind:'pdf',label:'Large Book',text,sha256:'big',pages:[{page:1,start:0},{page:2,start:body1.length+2}],map},sections:map.sections};
}

test('LD5: large mapped source routes the outline over the map and scopes chapter evidence',async()=>{
  const {source,sections}=bigSource();
  const mock=adapter(sections);
  for await(const _ of generateChapters(source,{env,fetcher:mock.fetcher,durationMinutes:5})){}
  const outlineRequest=mock.requests[0];
  const outlinePayload=JSON.parse(outlineRequest.messages[1].content);
  assert(outlinePayload.source.text.includes('DOCUMENT MAP'),'outline sees the map');
  assert(outlinePayload.source.text.includes('s1 | page 1'));
  assert(!outlinePayload.source.text.includes('markerA components and alpha numbers 30'),'raw text does NOT ride into the outline');
  // Content calls are scoped: chapter 1 routed to s1 must see alpha material,
  // not beta paragraphs.
  const contentRequests=mock.requests.filter(r=>{const c=JSON.parse(r.messages[1].content);return c.chapterFrame&&typeof c.chapterFrame.chapter==='number';});
  assert.equal(contentRequests.length,5);
  const ch1=JSON.parse(contentRequests[0].messages[1].content);
  assert(ch1.source.text.includes('markerA'),'routed section text present');
  assert(!ch1.source.text.includes('markerB'),'unrouted section excluded');
  const ch2=JSON.parse(contentRequests[1].messages[1].content);
  assert(ch2.source.text.includes('markerB'),'second chapter routed to its own section');
});

test('LD5: small sources keep the legacy whole-text outline (no map, no routing)',async()=>{
  const source={kind:'text',label:'t',text:'A short source explains the core idea through a working example with numbers.',sha256:'small'};
  const mock=adapter([{id:'s1',title:'T',page:1,summary:'S',start:0,end:source.text.length,charCount:source.text.length}]);
  for await(const _ of generateChapters(source,{env,fetcher:mock.fetcher,durationMinutes:1})){}
  const outlinePayload=JSON.parse(mock.requests[0].messages[1].content);
  assert(!outlinePayload.source.text.includes('DOCUMENT MAP'),'small source does not use the map');
  assert(outlinePayload.source.text.includes('core idea'));
});

test('LD5 renderMapForOutline: bounded ids and routing instruction',()=>{
  const text=renderMapForOutline({kind:'book',sections:[{id:'s1',title:'Intro',page:1,start:0,end:10,charCount:10,summary:'First bits.'}]});
  assert(text.includes('s1 | page 1 | Intro'));
  assert(text.includes('sourceSections'));
});
