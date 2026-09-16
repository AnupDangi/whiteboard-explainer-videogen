import {log} from '../../../shared/logger.js';

/** Iconify search and fetch. The only module in the asset pipeline that performs
 *  network I/O, so it is injectable and every failure is surfaced rather than
 *  swallowed: a caller must be able to tell "no icon matched" from "the provider
 *  was unreachable". */
export interface IconifySearchHit{prefix:string;name:string}
export interface IconifyClient{
 search(query:string,options?:{limit?:number;signal?:AbortSignal}):Promise<IconifySearchHit[]>;
 fetchSvg(hit:IconifySearchHit,options?:{signal?:AbortSignal}):Promise<string>;
}
export interface IconifyOptions{
 baseUrl?:string;
 fetchImpl?:typeof fetch;
 searchTimeoutMs?:number;
 fetchTimeoutMs?:number;
 provider?:string;
}

const DEFAULT_BASE='https://api.iconify.design';

function mergeSignals(signal:AbortSignal|undefined,timeoutMs:number):AbortSignal{
 const timeout=AbortSignal.timeout(timeoutMs);
 return signal?AbortSignal.any([signal,timeout]):timeout;
}

export function createIconifyClient(options:IconifyOptions={}):IconifyClient{
 const base=options.baseUrl??DEFAULT_BASE,doFetch=options.fetchImpl??fetch,provider=options.provider??'iconify';
 const searchTimeoutMs=options.searchTimeoutMs??2000,fetchTimeoutMs=options.fetchTimeoutMs??2000;
 if(!(searchTimeoutMs>0&&searchTimeoutMs<=10000))throw new Error('searchTimeoutMs must be 1-10000');
 if(!(fetchTimeoutMs>0&&fetchTimeoutMs<=10000))throw new Error('fetchTimeoutMs must be 1-10000');
 const request=async(url:string,signal:AbortSignal|undefined,timeoutMs:number,kind:string):Promise<string>=>{
  const started=performance.now();
  let response:Response;
  try{response=await doFetch(url,{signal:mergeSignals(signal,timeoutMs),headers:{accept:'application/json, image/svg+xml'}});}
  catch(error){log('v2.icons.request-failed',{provider,kind,url,error:String(error)},'warn');throw new Error(`icon provider unreachable (${kind}): ${error instanceof Error?error.message:String(error)}`);}
  const body=await response.text();
  log('v2.icons.response',{provider,kind,status:response.status,elapsedMs:Math.round(performance.now()-started),bytes:body.length});
  if(!response.ok)throw new Error(`icon provider ${response.status} (${kind})`);
  if(body.length>300_000)throw new Error(`icon provider response too large (${kind})`);
  return body;
 };
 return {
  async search(query,searchOptions={}){
   const limit=searchOptions.limit??20;
   if(!Number.isInteger(limit)||limit<1||limit>100)throw new Error('search limit must be 1-100');
   if(!query.trim())throw new Error('search query is empty');
   const body=await request(`${base}/search?query=${encodeURIComponent(query)}&limit=${limit}`,searchOptions.signal,searchTimeoutMs,'search');
   let parsed:unknown;
   try{parsed=JSON.parse(body);}catch{throw new Error('icon provider returned malformed JSON (search)');}
   const icons=(parsed as {icons?:unknown}).icons;
   if(!Array.isArray(icons))throw new Error('icon provider search response has no icons array');
   const hits:IconifySearchHit[]=[];
   for(const entry of icons){
    if(typeof entry!=='string')continue;
    const [prefix,name]=entry.split(':');
    if(!prefix||!name)continue;
    hits.push({prefix,name});
   }
   return hits;
  },
  async fetchSvg(hit,fetchOptions={}){
   if(!/^[a-z0-9-]+$/i.test(hit.prefix)||!/^[a-z0-9-]+$/i.test(hit.name))throw new Error(`Invalid icon reference: ${hit.prefix}:${hit.name}`);
   return request(`${base}/${hit.prefix}/${hit.name}.svg`,fetchOptions.signal,fetchTimeoutMs,'fetch');
  },
 };
}
