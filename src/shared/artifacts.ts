import {createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import type {StageArtifact} from './contracts.js';

const normalize=(value:unknown):unknown=>{
  if(Array.isArray(value))return value.map(normalize);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,normalize(item)]));
  return value;
};

export const stableJson=(value:unknown):string=>JSON.stringify(normalize(value));
export const sha256=(value:string|Uint8Array):string=>createHash('sha256').update(value).digest('hex');

export function stageArtifact<T>(input:unknown,payload:T,meta:{schemaVersion:string;stageVersion:string;promptVersion?:string;modelId?:string;modelParams?:Record<string,string|number|boolean>}):StageArtifact<T>{
  const inputHash=sha256(stableJson(input));
  const contentHash=sha256(stableJson(payload));
  return {...meta,inputHash,contentHash,payload};
}

export async function writeJsonArtifact(root:string,name:string,value:unknown):Promise<string>{
  const path=join(root,name);await mkdir(dirname(path),{recursive:true});
  await writeFile(path,`${JSON.stringify(value,null,2)}\n`,'utf8');return path;
}

export async function verifyArtifact<T>(artifact:StageArtifact<T>):Promise<void>{
  if(sha256(stableJson(artifact.payload))!==artifact.contentHash)throw new Error(`Artifact content hash mismatch for ${artifact.stageVersion}`);
}
