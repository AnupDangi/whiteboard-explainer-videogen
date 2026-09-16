import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile,rename,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import type {AssetDefinition} from '../types.js';
import {validateAsset} from '../validator.js';
import type {IconifyClient,IconifySearchHit} from './iconify.js';
import {convertSvgToAsset,type ConversionMetadata,type AssetProvenance} from './convert.js';
import {searchCandidates} from './search.js';
import {profileFor} from './policy.js';
import type {ExternalConceptRequest,ExternalResolveOptions,ExternalResolveOutcome} from './resolve.js';
import {log} from '../../../shared/logger.js';

/** P4: an icon cache that turns a resumed run into an offline one.
 *
 *  Two things are worth keeping across runs: the provider SEARCH results (a
 *  network round trip with no body) and the CONVERTED ASSET (the polylines the
 *  renderer actually reuses). Raw SVG is deliberately not cached — the asset is
 *  the durable artefact and re-validating it on read is cheaper and safer than
 *  replaying the normalizer. A cache must never break the pipeline: every read
 *  and write failure is swallowed and treated as a miss, and a write failure is
 *  surfaced once through the shared logger rather than on every key. */

export interface CachedResolution{asset:AssetDefinition;conversion?:ConversionMetadata;provenance?:AssetProvenance}

export interface IconCache{
 getAsset(key:string):Promise<AssetDefinition|undefined>;
 putAsset(key:string,asset:AssetDefinition):Promise<void>;
 getSearch(key:string):Promise<IconifySearchHit[]|undefined>;
 putSearch(key:string,hits:IconifySearchHit[]):Promise<void>;
 /** Optional richer record: a cache hit can then also return the conversion
  *  metadata and provenance captured when the asset was built. */
 getResolution?(key:string):Promise<CachedResolution|undefined>;
 putResolution?(key:string,resolution:CachedResolution):Promise<void>;
}

export function searchCacheKey(provider:string,query:string,mode:string,limit:number):string{
 return `search|${provider}|${mode}|${limit}|${query}`;
}
export function assetCacheKey(collection:string,name:string,sourceHash:string,normalizerVersion:string):string{
 return `asset|${collection}|${name}|${sourceHash}|${normalizerVersion}`;
}
/** The pre-fetch key. `sourceHash` only exists after the body is fetched, so a
 *  resolved asset is indexed by collection and name and re-validated on read. */
const resolvedAssetKey=(collection:string,name:string):string=>`resolved|${collection}|${name}`;

type RawRecord=Record<string,unknown>;

function parseRecord(raw:string):RawRecord|undefined{
 try{
  const value:unknown=JSON.parse(raw);
  return value&&typeof value==='object'&&!Array.isArray(value)?value as RawRecord:undefined;
 }catch{return undefined;}
}
function asAsset(value:unknown):AssetDefinition|undefined{
 return value&&typeof value==='object'&&typeof (value as AssetDefinition).id==='string'?value as AssetDefinition:undefined;
}
function asSearchHits(value:unknown):IconifySearchHit[]|undefined{
 if(!Array.isArray(value))return undefined;
 const hits:IconifySearchHit[]=[];
 for(const entry of value){
  if(!entry||typeof entry!=='object')return undefined;
  const {prefix,name}=entry as {prefix?:unknown;name?:unknown};
  if(typeof prefix!=='string'||typeof name!=='string')return undefined;
  hits.push({prefix,name});
 }
 return hits;
}
function recordToResolution(record:RawRecord|undefined):CachedResolution|undefined{
 if(!record)return undefined;
 const asset=asAsset(record.asset);
 if(!asset)return undefined;
 return {asset,...(record.conversion!==undefined?{conversion:record.conversion as ConversionMetadata}:{}),...(record.provenance!==undefined?{provenance:record.provenance as AssetProvenance}:{})};
}
function resolutionToRecord(resolution:CachedResolution):RawRecord{
 return {kind:'resolution',asset:resolution.asset,...(resolution.conversion!==undefined?{conversion:resolution.conversion}:{}),...(resolution.provenance!==undefined?{provenance:resolution.provenance}:{})};
}

/** Disk cache: one JSON file per key, named by a sha256 of the key so a raw key
 *  (which carries slashes and query text) never becomes a path. The directory is
 *  created lazily. Write failures log once and are otherwise ignored. */
export function createFileIconCache(root:string):IconCache{
 let writeWarned=false;
 const fileFor=(key:string):string=>join(root,`${createHash('sha256').update(key).digest('hex')}.json`);
 const readRecord=async(key:string):Promise<RawRecord|undefined>=>{
  try{return parseRecord(await readFile(fileFor(key),'utf8'));}catch{return undefined;}
 };
 const writeRecord=async(key:string,record:RawRecord):Promise<void>=>{
  try{
   await mkdir(root,{recursive:true});
   const target=fileFor(key);
   const temp=`${target}.${process.pid}.${randomUUID()}.tmp`;
   await writeFile(temp,JSON.stringify(record));
   await rename(temp,target);
  }catch(error){
   if(!writeWarned){writeWarned=true;log('v2.icons.cache-write-failed',{root,error:String(error)},'warn');}
  }
 };
 return {
  async getAsset(key){const record=await readRecord(key);return record?asAsset(record.asset):undefined;},
  async putAsset(key,asset){await writeRecord(key,{kind:'asset',asset});},
  async getSearch(key){const record=await readRecord(key);return record?asSearchHits(record.hits):undefined;},
  async putSearch(key,hits){await writeRecord(key,{kind:'search',hits});},
  async getResolution(key){return recordToResolution(await readRecord(key));},
  async putResolution(key,resolution){await writeRecord(key,resolutionToRecord(resolution));},
 };
}

/** In-memory cache with identical semantics, for tests and single-process runs. */
export function createMemoryIconCache():IconCache{
 const store=new Map<string,string>();
 const readRecord=(key:string):RawRecord|undefined=>{const raw=store.get(key);return raw===undefined?undefined:parseRecord(raw);};
 const writeRecord=(key:string,record:RawRecord):void=>{try{store.set(key,JSON.stringify(record));}catch{/* never break the pipeline */}};
 return {
  async getAsset(key){const record=readRecord(key);return record?asAsset(record.asset):undefined;},
  async putAsset(key,asset){writeRecord(key,{kind:'asset',asset});},
  async getSearch(key){const record=readRecord(key);return record?asSearchHits(record.hits):undefined;},
  async putSearch(key,hits){writeRecord(key,{kind:'search',hits});},
  async getResolution(key){return recordToResolution(readRecord(key));},
  async putResolution(key,resolution){writeRecord(key,resolutionToRecord(resolution));},
 };
}

/** Wrap a client so provider SEARCH results are cached. `fetchSvg` passes
 *  through unchanged: the pipeline caches the converted asset, not the SVG. */
export function createCachingClient(client:IconifyClient,cache:IconCache):IconifyClient{
 return {
  async search(query,options={}){
   const limit=options.limit??20;
   const key=searchCacheKey('iconify',query,'any',limit);
   try{const cached=await cache.getSearch(key);if(cached)return cached;}catch{/* a cache read must never break the pipeline */}
   const hits=await client.search(query,options);
   try{await cache.putSearch(key,hits);}catch{/* a cache write must never break the pipeline */}
   return hits;
  },
  fetchSvg(hit,options){return client.fetchSvg(hit,options);},
 };
}

export type CachedResolveOptions=ExternalResolveOptions&{cache?:IconCache};

async function readResolution(cache:IconCache|undefined,key:string):Promise<CachedResolution|undefined>{
 if(!cache)return undefined;
 try{
  const get=cache.getResolution;
  if(get)return await get.call(cache,key);
  const asset=await cache.getAsset(key);
  return asset?{asset}:undefined;
 }catch{return undefined;}
}
async function writeResolution(cache:IconCache|undefined,key:string,resolution:CachedResolution):Promise<void>{
 if(!cache)return;
 try{
  const put=cache.putResolution;
  if(put)return await put.call(cache,key,resolution);
  await cache.putAsset(key,resolution.asset);
 }catch{/* never break the pipeline */}
}

const safe=(value:string):string=>value.toLowerCase().replace(/[^a-z0-9-]+/g,'-').replace(/^-+|-+$/g,'');

/** Cache-aware twin of `resolveExternalConcept`: identical outcome shape and
 *  identical search/rank/convert behaviour, but a warm cache turns the second
 *  (or resumed) run of a concept into zero network fetches. A cached asset is
 *  re-validated before it is trusted, so a corrupt blob degrades to a miss. */
export async function resolveExternalConceptCached(request:ExternalConceptRequest,options:CachedResolveOptions):Promise<ExternalResolveOutcome>{
 const outcome:ExternalResolveOutcome={conceptId:request.conceptId,warnings:[],rejected:[]};
 if(options.mode==='off')return outcome;
 const maxFetches=options.maxFetches??3;
 if(!Number.isInteger(maxFetches)||maxFetches<1||maxFetches>5)throw new Error('maxFetches must be 1-5');
 const query=request.query.trim();
 if(!query)return outcome;
 const cache=options.cache;
 const limit=options.searchLimit??20;

 let hits:IconifySearchHit[];
 const searchKey=cache?searchCacheKey('iconify',query,'any',limit):undefined;
 let cachedHits:IconifySearchHit[]|undefined;
 if(searchKey){try{cachedHits=await cache!.getSearch(searchKey);}catch{cachedHits=undefined;}}
 if(cachedHits){
  hits=cachedHits;
 }else{
  try{hits=await options.client.search(query,{limit,...(options.signal?{signal:options.signal}:{})});}
  catch(error){outcome.warnings.push(`external search failed for ${request.conceptId}: ${error instanceof Error?error.message:String(error)}`);return outcome;}
  if(searchKey){try{await cache!.putSearch(searchKey,hits);}catch{/* never break the pipeline */}}
 }

 const ranked=searchCandidates(hits,options.mode,{maxCandidates:maxFetches,query});
 outcome.rejected.push(...ranked.rejected);
 if(!ranked.ranked.length){outcome.warnings.push(`no suitable candidate for ${request.conceptId} (query "${query}")`);return outcome;}

 for(const candidate of ranked.ranked){
  const id=`external.${safe(candidate.collection)}.${safe(candidate.name)}`;
  const key=resolvedAssetKey(candidate.collection,candidate.name);
  const cached=await readResolution(cache,key);
  if(cached&&cached.asset.id===id){
   try{
    outcome.assetId=id;
    outcome.asset=validateAsset(cached.asset);
    if(cached.conversion)outcome.conversion=cached.conversion;
    if(cached.provenance)outcome.provenance=cached.provenance;
    return outcome;
   }catch{/* corrupt cached blob: fall through and re-resolve */}
  }
  try{
   const svg=await options.client.fetchSvg({prefix:candidate.collection,name:candidate.name},{...(options.signal?{signal:options.signal}:{})});
   const converted=convertSvgToAsset({
    id,
    svg,
    aliases:[query],
    tags:[query,candidate.collection],
    semanticTypes:['entity'],
    archetypes:request.archetypes,
    provenance:{provider:'iconify',collection:candidate.collection,sourceAssetId:candidate.name,licenseId:profileFor(candidate.collection)!.license.id,fetchedAt:options.fetchedAt},
    ...(options.curveSegments!==undefined?{curveSegments:options.curveSegments}:{}),
   });
   await writeResolution(cache,key,{asset:converted.asset,conversion:converted.conversion,provenance:converted.provenance});
   outcome.assetId=id;
   outcome.asset=converted.asset;
   outcome.conversion=converted.conversion;
   outcome.provenance=converted.provenance;
   outcome.warnings.push(...converted.warnings);
   return outcome;
  }catch(error){
   outcome.warnings.push(`candidate ${candidate.collection}:${candidate.name} rejected: ${error instanceof Error?error.message:String(error)}`);
  }
 }
 outcome.warnings.push(`no usable icon for ${request.conceptId} after ${ranked.ranked.length} candidate(s)`);
 return outcome;
}
