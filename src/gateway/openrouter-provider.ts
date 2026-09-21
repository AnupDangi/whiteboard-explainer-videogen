import {loggedFetch} from '../core/logger.js';
import type {StructuredModelProvider,StructuredProviderRequest,StructuredProviderResult} from './llm-gateway.js';

interface OpenRouterModel {id:string;pricing?:{prompt?:string|number;completion?:string|number;request?:string|number}}

export class OpenRouterProvider implements StructuredModelProvider {
  private readonly fetcher:typeof fetch;
  constructor(private readonly env:NodeJS.ProcessEnv=process.env,fetcher:typeof fetch=fetch){this.fetcher=loggedFetch('openrouter',fetcher);}

  async catalog(signal?:AbortSignal):Promise<OpenRouterModel[]>{
    const response=await this.fetcher('https://openrouter.ai/api/v1/models',{signal});
    if(!response.ok)throw new Error(`Model catalog HTTP ${response.status}`);
    const body=await response.json() as {data?:OpenRouterModel[]};
    return Array.isArray(body.data)?body.data:[];
  }

  async execute(request:StructuredProviderRequest):Promise<StructuredProviderResult>{
    const key=this.env.OPENROUTER_API_KEY;
    if(!key)throw new Error('Configure OPENROUTER_API_KEY');
    const strictSchema=!['qwen/','inclusionai/','deepseek/'].some(prefix=>request.model.startsWith(prefix));
    const init:RequestInit={method:'POST',signal:request.signal,
      headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({
        model:request.model,temperature:request.temperature,max_tokens:request.maxTokens,
        ...(request.seed===undefined?{}:{seed:request.seed}),
        reasoning:{max_tokens:request.reasoningMaxTokens??Math.min(1200,Math.max(200,Math.round(request.maxTokens/4)))},
        response_format:{type:'json_schema',json_schema:{name:request.schemaName,strict:true,schema:request.schema}},
        ...(strictSchema?{provider:{require_parameters:true}}:{}),
        ...(request.sessionId?{session_id:request.sessionId}:{}),
        messages:[{role:'system',content:request.system},{role:'user',content:request.prompt}],
      })};
    let response!:Response;
    for(let throttle=0;;throttle++){
      response=await this.fetcher('https://openrouter.ai/api/v1/chat/completions',init);
      if(response.status!==429||throttle>=2)break;
      const seconds=Number(response.headers.get('retry-after'))||[15,30][throttle]||30;
      await new Promise<void>((resolve,reject)=>{const timer=setTimeout(resolve,seconds*1000);request.signal?.addEventListener('abort',()=>{clearTimeout(timer);reject(request.signal?.reason??new Error('Aborted'));},{once:true});});
    }
    if(!response.ok){
      const body=await response.text().catch(()=>'');
      const error=new Error(`OpenRouter HTTP ${response.status}${body?` — ${body.slice(0,300)}`:''}`) as Error&{status?:number};
      error.status=response.status;throw error;
    }
    const data=await response.json() as any;
    const content=data.choices?.[0]?.message?.content;
    if(typeof content!=='string')throw new Error('OpenRouter returned no structured content');
    return {
      content,finishReason:data.choices?.[0]?.finish_reason??'stop',
      providerRequestId:response.headers.get('request-id')??response.headers.get('x-request-id')??undefined,
      rawResponse:data,usage:{
        promptTokens:Number(data.usage?.prompt_tokens)||0,
        completionTokens:Number(data.usage?.completion_tokens)||0,
        cachedTokens:Number(data.usage?.cached_tokens??data.usage?.prompt_tokens_details?.cached_tokens)||0,
        costUsd:Number(data.usage?.cost)||0,
      },
    };
  }
}
