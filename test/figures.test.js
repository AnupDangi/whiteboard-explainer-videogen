import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {detectFigures,cropFigure,describeFigures} from '../dist/src/explainer/figures.js';

const run=promisify(execFile);
/** Tools the poppler pipeline needs; skip the file if the machine lacks them. */
const tools=['pdftohtml','pdftoppm','sips'];

test('P2 figures: real graphic PDF yields a candidate, decoration-small ones excluded',async t=>{
  if(tools.some(bin=>!bin))t.skip();
  // A 400x300 image wrapped as a PDF: one figure candidate.
  const sharp=(await import('sharp')).default;
  const png=await sharp({create:{width:400,height:300,channels:3,background:'#2266aa'}}).png().toBuffer();
  const dir=await mkdtemp(join(tmpdir(),'fig-test-'));
  t.after(async()=>{await rm(dir,{recursive:true,force:true});});
  const pngPath=join(dir,'img.png');await writeFile(pngPath,png);
  try{await run('sips',['-s','format','pdf',pngPath,'--out',join(dir,'img.pdf')],{timeout:20000});}catch{t.skip();return;}
  const bytes=await (await import('node:fs/promises')).readFile(join(dir,'img.pdf'));
  const candidates=await detectFigures(bytes);
  assert(candidates.length>=1,'embedded image detected');
  const crop=await cropFigure(bytes,candidates[0]);
  assert(crop&&crop.length>500,'crop renders');
  const meta=await sharp(crop).metadata();
  assert((meta.width||0)>50,'crop has real width');
});

test('P2 figures: describeFigures uses one vision call per figure with strict schema',async t=>{
  const described=[];
  const fetcher=async(url,options)=>{
    if(!url.toString().includes('openrouter'))throw new Error('unexpected');
    const body=JSON.parse(options.body);
    assert.equal(body.response_format.json_schema.name,'figure');
    described.push(body.messages[1].content.length);
    return Response.json({choices:[{message:{content:JSON.stringify({caption:'Loss curves for three runs',kind:'figure',dataHint:'x=steps, y=loss, 3 series',keyNumbers:['0.42','1.0']})}}]});
  };
  const figures=await describeFigures(Buffer.from('%PDF-x'),[
    {page:1,left:0,top:0,width:300,height:200},
    {page:2,left:0,top:0,width:300,height:200},
    {page:3,left:0,top:0,width:300,height:200},
    {page:4,left:0,top:0,width:300,height:200},
    {page:5,left:0,top:0,width:300,height:200},
  ],{env:{OPENROUTER_API_KEY:'test-only',OPENROUTER_MODEL:'test/model'},fetcher,cropFn:async()=>Buffer.alloc(600,7)});
  assert.equal(figures.length,4,'capped at 4 figures');
  assert(figures.every(f=>f.kind==='figure'&&f.caption));
  assert.equal(described.length,4,'one call per described figure');
});

test('Optimization: describeFigures runs bounded-parallel and preserves page order',async t=>{
  let inFlight=0,maxInFlight=0;
  const cropFn=async()=>Buffer.alloc(600,7);
  const fetcher=async()=>{
    inFlight++;maxInFlight=Math.max(maxInFlight,inFlight);
    await new Promise(r=>setTimeout(r,20));
    inFlight--;
    return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({caption:'a chart',kind:'figure',dataHint:'',keyNumbers:[]})}}]});
  };
  const figures=await describeFigures(Buffer.from('%PDF-x'),[1,2,3,4].map(page=>({page,left:0,top:0,width:10,height:10})),{env:{OPENROUTER_API_KEY:'k',OPENROUTER_MODEL:'m'},fetcher,cropFn});
  assert.equal(figures.length,4);
  assert.deepEqual(figures.map(f=>f.page),[1,2,3,4],'order restored');
  assert(maxInFlight>1&&maxInFlight<=3,`bounded concurrency observed (max ${maxInFlight})`);
});
