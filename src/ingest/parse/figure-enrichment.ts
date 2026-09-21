import {readFile} from 'node:fs/promises';
import {log} from '../../core/logger.js';
import {getOutputBudget,getLatencyBudget} from '../../core/budgets.js';
import {LLMGateway} from '../../gateway/llm-gateway.js';
import {OpenRouterProvider} from '../../gateway/openrouter-provider.js';
import {DEFAULT_VISION_MODEL} from '../../core/model-router.js';
import {semaphore} from '../../core/concurrency.js';
import type {FigureDescription} from './docling-blocks.js';

/** Selective multimodal enrichment for Docling crops (I2). Never sends every image to a
 *  VLM: images are deduplicated by content hash, tiny/decorative crops are skipped, the
 *  count is bounded, and any failure keeps the figure undescribed rather than failing the
 *  job. The renderer never sees pixels — only the validated description text. */

interface FigureAsset {sha256:string;path:string;width?:number;height?:number;page?:number|null}

export function figureDescribeEnabled(env:NodeJS.ProcessEnv=process.env):boolean{
  if((env.FIGURE_DESCRIBE||'').toLowerCase()==='off')return false;
  if((env.FIGURE_DESCRIBE||'').toLowerCase()==='on')return true;
  return !!env.OPENROUTER_API_KEY;
}

const figureSchema={type:'object',additionalProperties:false,properties:{caption:{type:'string',maxLength:280},kind:{type:'string',enum:['figure','table']},dataHint:{type:'string',maxLength:280},keyNumbers:{type:'array',items:{type:'string',maxLength:24},maxItems:4}},required:['caption','kind','dataHint','keyNumbers']};

interface DescribeFigureDeps {
  env?:NodeJS.ProcessEnv;
  gateway?:LLMGateway;
  jobId?:string;
  budgetLimitUsd?:number;
  /** Injectable for tests; defaults to one bounded gateway call per asset. */
  describe?:(asset:FigureAsset,imageBase64:string)=>Promise<FigureDescription|null>;
  maxFigures?:number;
  minWidth?:number;
  minHeight?:number;
  concurrency?:number;
  signal?:AbortSignal;
}

/** Select unique, substantial crops and describe them (bounded concurrency). Returns a
 *  sha256 -> description map; duplicates and small crops are excluded deterministically. */
export async function describeFigureAssets(assets:FigureAsset[],deps:DescribeFigureDeps={}):Promise<Map<string,FigureDescription>>{
  const env=deps.env??process.env;
  const maxFigures=deps.maxFigures??Number(env.FIGURE_DESCRIBE_MAX||6);
  const minWidth=deps.minWidth??Number(env.FIGURE_MIN_WIDTH||120);
  const minHeight=deps.minHeight??Number(env.FIGURE_MIN_HEIGHT||80);
  const selected:FigureAsset[]=[];
  const seen=new Set<string>();
  for(const asset of assets){
    if(!asset.sha256||seen.has(asset.sha256))continue;
    seen.add(asset.sha256);
    if((asset.width??0)<minWidth||(asset.height??0)<minHeight)continue;
    selected.push(asset);
    if(selected.length>=maxFigures)break;
  }
  const result=new Map<string,FigureDescription>();
  if(!selected.length)return result;

  const gateway=deps.gateway??new LLMGateway({openrouter:new OpenRouterProvider(env)});
  const describe=deps.describe??(async(asset,imageBase64)=>{
    const prompt=[{type:'text',text:`Describe this figure or table from source page ${asset.page??'?'} so a whiteboard explainer can later redraw it. Return ONLY JSON {caption,kind,dataHint,keyNumbers}.`},{type:'image_url',image_url:{url:`data:image/png;base64,${imageBase64}`}}];
    const response=await gateway.executeStructured<FigureDescription>({
      jobId:deps.jobId??'source-figure',taskId:`figure:${asset.sha256}`,label:'figure',provider:'openrouter',
      model:env.OPENROUTER_VISION_MODEL||env.OPENROUTER_MODEL||DEFAULT_VISION_MODEL,
      system:'You describe one figure or table from a document so a whiteboard explainer can redraw it. Return ONLY the requested JSON.',
      prompt,schema:figureSchema,schemaName:'figure',promptVersion:'figure-v2',schemaVersion:'figure-v2',
      maxTokens:getOutputBudget('figure'),temperature:0.2,signal:AbortSignal.timeout(getLatencyBudget('figure')),
      estimatedCostUsd:0.02,budgetLimitUsd:deps.budgetLimitUsd??2,maxAttempts:1,
    });
    return response.value;
  });

  const sem=semaphore(deps.concurrency??3);
  await Promise.all(selected.map(asset=>sem.acquire().then(async()=>{
    try{
      const bytes=await readFile(asset.path);
      const description=await describe(asset,bytes.toString('base64'));
      if(description&&typeof description.caption==='string'&&description.caption.trim()){
        result.set(asset.sha256,{
          caption:description.caption.slice(0,280),
          kind:description.kind==='table'?'table':'figure',
          dataHint:typeof description.dataHint==='string'?description.dataHint.slice(0,280):'',
          keyNumbers:Array.isArray(description.keyNumbers)?description.keyNumbers.filter(value=>typeof value==='string').slice(0,4):[],
        });
        log('parse.figure-described',{sha:asset.sha256.slice(0,12),page:asset.page,caption:description.caption.slice(0,60)});
      }
    }catch(error){
      log('parse.figure-describe-failed',{sha:asset.sha256.slice(0,12),error:error instanceof Error?error.message:String(error)},'warn');
    }finally{sem.release();}
  })));
  return result;
}
