import {loggedFetch,log} from '../shared/logger.js';
export interface CriticImage{label:string;pngBase64:string}
export interface CriticContext{goal:string;requirements:string[];narration:string}
export interface CriticVerdict{preferred:'A'|'B'|'tie';criticalErrors:string[];reason:string}
export interface VisionCall{model:string;elapsedMs:number;promptTokens:number;completionTokens:number;costUsd:number}
export interface VisionJudge{judge(a:CriticImage,b:CriticImage,context:CriticContext):Promise<CriticVerdict>;calls:VisionCall[]}
const SYSTEM='You are evaluating whether a whiteboard teaching scene teaches the required mechanism. Do not judge only aesthetics. Check: required concepts present; critical relations visually correct including arrow direction; chosen mental model appropriate; hero obvious; labels readable and spatially connected to targets; each beat creates the right visual change and required reveals happen while their narration is still being spoken; nothing decorative or distracting; final composition makes the mechanism understandable. Frames in each sheet are ordered in time and labelled with their timestamp. Compare candidate A with candidate B and prefer the one that teaches the required mechanism more clearly. Return strict JSON {"preferred":"A"|"B"|"tie","criticalErrors":[],"reason":"..."} with no markdown or extra text.';
/** Provider boundary for the V2 visual critic: metered, no fallback, both-order calibration input. */
export function createVisionJudge(options:{env?:NodeJS.ProcessEnv;fetcher?:typeof fetch;signal?:AbortSignal;maxCostUsd?:number}={}):VisionJudge{
 const env=options.env??process.env,key=env.OPENROUTER_API_KEY;if(!key)throw new Error('OPENROUTER_API_KEY required for the V2 visual critic');
 const model=env.OPENROUTER_VISION_MODEL||'google/gemini-3.8-flash',fetcher=loggedFetch('openrouter',options.fetcher??fetch),maxCost=options.maxCostUsd??.25,calls:VisionCall[]=[];
 if(!Number.isFinite(maxCost)||maxCost<=0||maxCost>2)throw new Error('V2 critic cost budget must be greater than zero and at most $2');
 let prices:Map<string,{prompt:number;completion:number}>|undefined;
 async function request(url:string,init:RequestInit){const signal=options.signal?AbortSignal.any([options.signal,AbortSignal.timeout(90000)]):AbortSignal.timeout(90000);const response=await fetcher(url,{...init,signal});const raw=await response.text();if(raw.length>4_000_000)throw new Error('Critic response exceeds 4 MB');if(!response.ok)throw new Error(`OpenRouter ${response.status}: ${raw.slice(0,400)}`);return JSON.parse(raw);}
 return {calls,async judge(a,b,context){
  if(!prices){const catalog=await request('https://openrouter.ai/api/v1/models',{headers:{authorization:`Bearer ${key}`}});prices=new Map();for(const m of catalog.data??[]){const prompt=Number(m.pricing?.prompt),completion=Number(m.pricing?.completion);if(Number.isFinite(prompt)&&prompt>=0&&Number.isFinite(completion)&&completion>=0)prices.set(m.id,{prompt,completion});}}
  const price=prices.get(model);if(!price)throw new Error(`No verified pricing for ${model}`);
  const imageBytes=Math.ceil((a.pngBase64.length+b.pngBase64.length)*.75),upperBound=(imageBytes/750+4096)*price.prompt+1024*price.completion,spent=calls.reduce((sum,c)=>sum+c.costUsd,0);
  if(spent+upperBound>maxCost)throw new Error('V2 critic request exceeds remaining cost budget');
  const messages=[{role:'system',content:SYSTEM},{role:'user',content:[{type:'text',text:`Teaching goal: ${context.goal}\nRequired: ${context.requirements.join('; ')}\nNarration: ${context.narration}\nCandidates follow in order A then B.`},{type:'image_url',image_url:{url:`data:image/png;base64,${a.pngBase64}`}},{type:'image_url',image_url:{url:`data:image/png;base64,${b.pngBase64}`}}]}];
  const started=performance.now(),response=await request('https://openrouter.ai/api/v1/chat/completions',{method:'POST',headers:{authorization:`Bearer ${key}`,'content-type':'application/json'},body:JSON.stringify({model,messages,max_tokens:900,reasoning:{max_tokens:256},response_format:{type:'json_object'},provider:{require_parameters:true},temperature:0})});
  const usage=response.usage,promptTokens=usage?.prompt_tokens,completionTokens=usage?.completion_tokens;
  if(!Number.isFinite(promptTokens)||promptTokens<0||!Number.isFinite(completionTokens)||completionTokens<0)throw new Error('Critic provider omitted valid token usage; refusing unmetered continuation');
  const costUsd=Number.isFinite(usage.cost)&&usage.cost>=0?usage.cost:promptTokens*price.prompt+completionTokens*price.completion;
  const call={model,elapsedMs:performance.now()-started,promptTokens,completionTokens,costUsd};calls.push(call);log('v2.critic.call',call);
  if(calls.reduce((n,c)=>n+c.costUsd,0)>maxCost)throw new Error('V2 critic cost ceiling exhausted');
  if(response.choices?.[0]?.finish_reason!=='stop')throw new Error(`V2 critic response incomplete or refused: ${response.choices?.[0]?.finish_reason??'missing finish reason'}`);
  let text=String(response.choices[0].message.content??'').trim();const fenced=text.match(/```(?:json)?\s*([\s\S]*?)```/i);if(fenced)text=fenced[1].trim();const start=text.indexOf('{'),end=text.lastIndexOf('}');
  if(start<0||end<start){log('v2.critic.invalid',{raw:text.slice(0,1500)});throw new Error(`V2 critic returned non-JSON content: ${text.slice(0,200)}`);}
  let verdict:unknown;try{verdict=JSON.parse(text.slice(start,end+1));}catch{log('v2.critic.invalid',{raw:text.slice(0,1500)});throw new Error(`V2 critic returned invalid JSON: ${text.slice(0,200)}`);}
  const value=verdict as Partial<CriticVerdict>;
  if(!value||!['A','B','tie'].includes(value.preferred as string)||!Array.isArray(value.criticalErrors)||typeof value.reason!=='string')throw new Error('V2 critic returned an invalid verdict');
  return {preferred:value.preferred as CriticVerdict['preferred'],criticalErrors:value.criticalErrors.map(String),reason:value.reason};
 }};
}
