import type {CompiledObject} from '../types.js';
import {BOARD} from './zones.js';
export function occupancy(objects:CompiledObject[]):{areaRatio:number;heroRatio:number}{const roots=objects.filter(o=>!o.parentId);const area=roots.reduce((n,o)=>n+o.w*o.h,0),hero=roots.filter(o=>o.role==='hero').reduce((n,o)=>n+o.w*o.h,0);return {areaRatio:area/(BOARD.safe.w*BOARD.safe.h),heroRatio:area?hero/area:0};}
