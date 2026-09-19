import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path';

/** Persistence for validated artifacts only (`Architecture_plan.md` §51).
 *  `put` refuses an artifact that has not passed its schema + semantic gate, so
 *  unreliable model output can never be promoted into durable source knowledge.
 *  One JSON file per key, atomic write, path-derived from the key hash. */
export interface CacheStore {
  has(key:string):Promise<boolean>;
  get<T>(key:string):Promise<T|undefined>;
  put<T>(key:string, value:T, meta:{validated:boolean;kind:string}):Promise<void>;
}

export interface CachePutMeta {validated:boolean;kind:string}

export function createFileCache(root:string):CacheStore {
  const pathOf=(key:string)=>join(root,createHash('sha256').update(key).digest('hex')+'.json');
  return {
    async has(key:string){try{await readFile(pathOf(key));return true;}catch{return false;}},
    async get<T>(key:string){try{const parsed=JSON.parse(await readFile(pathOf(key),'utf8')) as {value?:T}|T;return (parsed&&typeof parsed==='object'&&'value' in (parsed as Record<string,unknown>))?(parsed as {value:T}).value:(parsed as T);}catch{return undefined;}},
    async put<T>(key:string,value:T,meta:CachePutMeta){
      if(!meta.validated)throw new Error(`Refusing to cache unvalidated ${meta.kind} artifact`);
      const path=pathOf(key);
      await mkdir(root,{recursive:true});
      await writeFile(path+'.tmp',JSON.stringify({kind:meta.kind,validatedAt:new Date().toISOString(),value}));
      await rename(path+'.tmp',path);
    },
  };
}

/** In-memory store for tests and single-process reuse. Same validation rule. */
export function createMemoryCache():CacheStore {
  const entries=new Map<string,string>();
  return {
    async has(key:string){return entries.has(key);},
    async get<T>(key:string){const raw=entries.get(key);return raw===undefined?undefined:JSON.parse(raw) as T;},
    async put<T>(key:string,value:T,meta:CachePutMeta){if(!meta.validated)throw new Error(`Refusing to cache unvalidated ${meta.kind} artifact`);entries.set(key,JSON.stringify(value));},
  };
}
