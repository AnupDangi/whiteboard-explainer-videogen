export type Pipeline='explainer'|'semantic'|'semantic-v3';
/** `semantic` (V2) is the default and receives all current work. `semantic-v3`
 *  is the target front end (`Architecture_plan.md`) built alongside V2 behind
 *  this switch — until its migration gates pass it must NOT become the default
 *  (§69). `explainer` (V1) is FROZEN LEGACY. The executable gates live in
 *  `eval/live/gates.ts`; there is no gate list in the plan files.
 *  Legacy aliases: `v1`/`classic` → explainer, `v2` → semantic, `v3` → semantic-v3. */
export function visualPipeline(env:Record<string,string|undefined>):Pipeline{
 const raw=(env.VISUAL_PIPELINE??'semantic').trim().toLowerCase();
 const value=raw==='v1'||raw==='classic'?'explainer':raw==='v2'?'semantic':raw==='v3'?'semantic-v3':raw;
 if(value!=='explainer'&&value!=='semantic'&&value!=='semantic-v3')throw new Error('VISUAL_PIPELINE must be semantic|semantic-v3|explainer (or legacy v2|v3|v1|classic)');
 return value;
}
