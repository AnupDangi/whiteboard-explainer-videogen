import type {CollectionProfile,RetrievalMode} from './types.js';
import {licensePolicy} from './license.js';

/** Curated collection data. This is a review point, not a heuristic: a profile
 *  asserts a licence and a drawing style for a whole collection, so enabling a
 *  collection in P3 means verifying both against its published metadata first.
 *  `if (prefix === ...)` tables are deliberately avoided — everything reads
 *  these profiles. */
const profile=(prefix:string,licenseId:string,style:CollectionProfile['style']):CollectionProfile=>({prefix,license:{id:licenseId,policy:licensePolicy(licenseId)},style});

export const COLLECTION_PROFILES:Record<string,CollectionProfile>={
 tabler:profile('tabler','MIT',{outline:true,fill:false,duotone:false,strokeWeight:2,complexity:12}),
 lucide:profile('lucide','ISC',{outline:true,fill:false,duotone:false,strokeWeight:2,complexity:10}),
 feather:profile('feather','MIT',{outline:true,fill:false,duotone:false,strokeWeight:2,complexity:8}),
 iconoir:profile('iconoir','MIT',{outline:true,fill:false,duotone:false,strokeWeight:1.5,complexity:12}),
 heroicons:profile('heroicons','MIT',{outline:true,fill:true,duotone:false,strokeWeight:1.5,complexity:10}),
 bi:profile('bi','MIT',{outline:true,fill:true,duotone:false,complexity:14}),
 octicon:profile('octicon','MIT',{outline:true,fill:true,duotone:false,complexity:12}),
 ph:profile('ph','MIT',{outline:true,fill:true,duotone:true,strokeWeight:1.5,complexity:12}),
 mdi:profile('mdi','Apache-2.0',{outline:true,fill:true,duotone:false,complexity:20}),
 carbon:profile('carbon','Apache-2.0',{outline:true,fill:false,duotone:false,strokeWeight:1,complexity:16}),
 'material-symbols':profile('material-symbols','Apache-2.0',{outline:true,fill:true,duotone:false,complexity:14}),
 solar:profile('solar','CC-BY-4.0',{outline:true,fill:true,duotone:true,complexity:14}),
 twemoji:profile('twemoji','CC-BY-4.0',{outline:false,fill:true,duotone:true,complexity:30}),
 openmoji:profile('openmoji','CC-BY-SA-4.0',{outline:false,fill:true,duotone:true,complexity:40}),
};

export function profileFor(collection:string):CollectionProfile|undefined{return COLLECTION_PROFILES[collection];}
/** A collection drawn entirely with strokes — the one that matches the
 *  chalk-ink renderer without conversion loss. */
export function isStrokeOnly(p:CollectionProfile):boolean{return p.style.outline&&!p.style.fill;}

/** Collections allowed for a mode, in preference order. Blocked licences are
 *  never included, whatever the mode. */
export function collectionsFor(mode:RetrievalMode):string[]{
 if(mode==='off')return [];
 const permitted=Object.values(COLLECTION_PROFILES).filter(p=>p.license.policy!=='blocked');
 if(mode==='broad')return permitted.map(p=>p.prefix).sort();
 const strokeOnly=permitted.filter(isStrokeOnly).map(p=>p.prefix).sort();
 if(mode==='strict')return strokeOnly;
 const rest=permitted.filter(p=>!isStrokeOnly(p)).map(p=>p.prefix).sort();
 return [...strokeOnly,...rest];
}
