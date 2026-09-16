import type {Point,VisualArchetype,ObjectState} from '../types.js';
import type {AssetColorRole,FillMode} from '../renderer/palette.js';
/** Trusted polyline geometry: exact length and cursor interpolation share the same points.
 *
 *  Colour is addressed one of two ways and never both: a curated asset names a
 *  palette token (`stroke`/`fill`) and resolves byte-identically through
 *  `COLORS`; a converted/external asset names a role (`strokeRole`/`fillRole`)
 *  and resolves through the theme palette. `fillMode`/`fillOpacity` default to
 *  today's translucent wash, so an existing part renders unchanged. */
export interface AssetPart {id:string;points:Point[];closed:boolean;stroke?:'ink'|'green'|'blue'|'amber'|'earth'|'red';fill?:'green'|'blue'|'amber'|'earth'|'red';strokeRole?:AssetColorRole;fillRole?:AssetColorRole;fillMode?:FillMode;fillOpacity?:number;order:number;durationWeight:number;fillAfter:boolean;semanticRole:string}
export interface AssetDefinition {id:string;flowPortPolicy?:'facing';anchorAliases?:Record<string,string>;type:'icon'|'illustration'|'diagram_template'|'composed';semanticTypes:string[];aliases:string[];tags:string[];archetypes:VisualArchetype[];viewBox:[number,number,number,number];parts:AssetPart[];anchors:Record<string,Point>;states:Partial<Record<ObjectState,{partIds:string[]}>>;styleFamily:string;source:string;license:string}
