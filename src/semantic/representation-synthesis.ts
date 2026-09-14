import {createHash} from 'node:crypto';
import type {SynthesizedIllustrationSpec} from './representation.js';

const TOKEN=/^[a-z][a-z0-9_-]{0,63}$/;
const PRIMITIVES=new Set(['path','ellipse','rect','polygon','line']);
const cache=new Map<string,SynthesizedIllustrationSpec>();

/** Validates semantic structure only. Coordinates and SVG are deliberately absent. */
export function validateSynthesisSpec(input:unknown):SynthesizedIllustrationSpec{
 if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Synthesis spec must be an object');
 const value=input as Record<string,unknown>,allowed=new Set(['semanticSubject','parts','requestedAnchors','styleFamily']);for(const key of Object.keys(value))if(!allowed.has(key))throw new Error(`Unsafe synthesis field: ${key}`);
 if(typeof value.semanticSubject!=='string'||!TOKEN.test(value.semanticSubject))throw new Error('Invalid synthesis subject');
 if(typeof value.styleFamily!=='string'||!TOKEN.test(value.styleFamily))throw new Error('Invalid synthesis style');
 if(!Array.isArray(value.parts)||value.parts.length<1||value.parts.length>24)throw new Error('Synthesis parts must contain 1–24 items');
 const seen=new Set<string>();
 const parts=value.parts.map((raw,index)=>{if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error(`Invalid synthesis part ${index}`);const part=raw as Record<string,unknown>;for(const key of Object.keys(part))if(!['key','primitive','semanticRole'].includes(key))throw new Error(`Unsafe synthesis part field: ${key}`);if(typeof part.key!=='string'||!TOKEN.test(part.key)||seen.has(part.key))throw new Error(`Invalid synthesis part key: ${String(part.key)}`);seen.add(part.key);if(typeof part.primitive!=='string'||!PRIMITIVES.has(part.primitive))throw new Error(`Invalid synthesis primitive: ${String(part.primitive)}`);if(typeof part.semanticRole!=='string'||!TOKEN.test(part.semanticRole))throw new Error('Invalid synthesis semantic role');return {key:part.key,primitive:part.primitive as SynthesizedIllustrationSpec['parts'][number]['primitive'],semanticRole:part.semanticRole};});
 if(!Array.isArray(value.requestedAnchors)||value.requestedAnchors.length>24||value.requestedAnchors.some(a=>typeof a!=='string'||!TOKEN.test(a)))throw new Error('Invalid synthesis anchors');
 return {semanticSubject:value.semanticSubject,parts,requestedAnchors:[...new Set(value.requestedAnchors as string[])],styleFamily:value.styleFamily};
}
export function cacheSynthesisSpec(input:unknown):{hash:string;spec:SynthesizedIllustrationSpec}{const spec=validateSynthesisSpec(input),hash=createHash('sha256').update(JSON.stringify(spec)).digest('hex');if(!cache.has(hash))cache.set(hash,Object.freeze(structuredClone(spec)) as SynthesizedIllustrationSpec);return {hash,spec:structuredClone(cache.get(hash)!)};}
export function getSynthesizedSpec(hash:string):SynthesizedIllustrationSpec|undefined{const spec=cache.get(hash);return spec?structuredClone(spec):undefined;}
