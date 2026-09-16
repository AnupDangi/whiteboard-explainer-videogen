import type {LicensePolicy} from './types.js';

/** Hard licence gate. Fail-closed: only licences on an explicit allow-list are
 *  permitted, so a new or unknown licence can never slip through by default.
 *  Share-alike and non-commercial terms are blocked outright rather than
 *  handled, because their obligations cannot be satisfied by a provenance
 *  record alone. */
const AUTO=new Set([
 'MIT','MIT-0','ISC','BSD','BSD-2-CLAUSE','BSD-3-CLAUSE','0BSD','UNLICENSE',
 'APACHE-2.0','CC0','CC0-1.0',
]);
const ATTRIBUTION=new Set([
 'CC-BY-4.0','CC-BY-3.0','CC-BY-2.0','OFL-1.1','OFL-1.0',
]);
const BLOCKING_TOKENS=new Set(['NC','NONCOMMERCIAL','SA','SHAREALIKE','ND','NODERIVATIVES']);

const tokens=(id:string):string[]=>id.toUpperCase().split(/[^A-Z0-9.]+/).filter(Boolean).map(token=>token.replace(/\.$/,''));

export function licensePolicy(id:string):LicensePolicy{
 if(!id||!id.trim())return 'blocked';
 const parts=tokens(id);
 if(parts.some(token=>BLOCKING_TOKENS.has(token)))return 'blocked';
 const canonical=parts.join('-');
 if(AUTO.has(canonical)||AUTO.has(parts[0]))return 'auto';
 if(ATTRIBUTION.has(canonical)||ATTRIBUTION.has(parts[0]))return 'attribution';
 return 'blocked';
}

export function isPermitted(id:string):boolean{return licensePolicy(id)!=='blocked';}

/** Throws for a blocked licence. Callers must not downgrade this to a warning:
 *  an unlicensed asset must never reach the converter. */
export function assertPermitted(id:string):void{
 const policy=licensePolicy(id);
 if(policy==='blocked')throw new Error(`Licence not permitted: ${id||'(empty)'}`);
}
