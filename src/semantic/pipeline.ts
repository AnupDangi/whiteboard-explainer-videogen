export type Pipeline='explainer'|'semantic';
/** `explainer` (node/edge whiteboard pipeline) is the default until the semantic
 *  pipeline passes its migration gates. Legacy `v1`/`classic` and `v2` are aliases. */
export function visualPipeline(env:Record<string,string|undefined>):Pipeline{
 const raw=(env.VISUAL_PIPELINE??'explainer').trim().toLowerCase();
 const value=raw==='v1'||raw==='classic'?'explainer':raw==='v2'?'semantic':raw;
 if(value!=='explainer'&&value!=='semantic')throw new Error('VISUAL_PIPELINE must be explainer|semantic (or legacy v1|classic|v2)');
 return value;
}
