/** Bounded concurrency with deterministic output.
 *
 *  Results are placed at the index of the item they came from, so the returned
 *  array is in input order regardless of which task finished first — callers
 *  concatenate audio, merge plans and build timelines in that order and must not
 *  depend on completion timing. The first failure stops scheduling new work and
 *  rejects the whole call, so a partial result is never mistaken for a complete
 *  one. */
export async function mapConcurrent<T,R>(
 items:readonly T[],
 limit:number,
 run:(item:T,index:number)=>Promise<R>,
 signal?:AbortSignal,
):Promise<R[]>{
 if(!Number.isInteger(limit)||limit<1||limit>8)throw new Error('Concurrency limit must be 1-8');
 if(!items.length)return [];
 const results=new Array<R>(items.length);
 let next=0,failed=false;
 const worker=async():Promise<void>=>{
  for(;;){
   if(failed)return;
   const index=next++;
   if(index>=items.length)return;
   try{
    signal?.throwIfAborted();
    results[index]=await run(items[index],index);
   }catch(error){
    failed=true;
    throw error;
   }
  }
 };
 await Promise.all(Array.from({length:Math.min(limit,items.length)},worker));
 return results;
}

/** A bounded worker count from the environment, clamped to something a local
 *  provider can absorb. Default 3: enough to hide per-call latency, not enough
 *  to saturate a CPU synthesiser. */
export function concurrencyLimit(env:NodeJS.ProcessEnv,key:string,fallback=3):number{
 const raw=Number(env[key]);
 const value=Number.isFinite(raw)&&raw>=1?Math.floor(raw):fallback;
 return Math.max(1,Math.min(8,value));
}
