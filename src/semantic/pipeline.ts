export type Pipeline='explainer'|'semantic';
/** The semantic (V2) pipeline is the default: all current work targets it.
 *  `explainer` (V1) is FROZEN LEGACY — kept as the comparison baseline and the
 *  documented fallback until the migration gates in `PLAN_TO_IMPLEMENT.md` pass,
 *  but it receives no new capability work. Select it explicitly with
 *  `VISUAL_PIPELINE=explainer`. Legacy `v1`/`classic` and `v2` are aliases. */
export function visualPipeline(env:Record<string,string|undefined>):Pipeline{
 const raw=(env.VISUAL_PIPELINE??'semantic').trim().toLowerCase();
 const value=raw==='v1'||raw==='classic'?'explainer':raw==='v2'?'semantic':raw;
 if(value!=='explainer'&&value!=='semantic')throw new Error('VISUAL_PIPELINE must be semantic|explainer (or legacy v2|v1|classic)');
 return value;
}
