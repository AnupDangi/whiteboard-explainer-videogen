import {CATALOG} from './templates/catalog.js';
import {plant} from './illustrations/plant.js';
import {sun,water,co2} from './icons/inputs.js';
import {validateAsset} from './validator.js';
import type {AssetDefinition} from './types.js';
function freeze<T>(value:T):T {if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
export const ASSETS:readonly AssetDefinition[]=freeze([plant,sun,water,co2,...CATALOG].map(validateAsset));
if(new Set(ASSETS.map(a=>a.id)).size!==ASSETS.length)throw new Error('Duplicate asset ID');
export function getAsset(id:string):AssetDefinition {const a=ASSETS.find(a=>a.id===id);if(!a)throw new Error(`Unknown asset: ${id}`);return a;}

/** Explicit asset-owned semantic aliases, never fuzzy matching across different subparts. */
export function canonicalAnchor(assetRef:string,anchor:string):string{return getAsset(assetRef).anchorAliases?.[anchor]??anchor;}
