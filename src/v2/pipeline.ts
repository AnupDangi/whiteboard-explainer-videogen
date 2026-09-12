/** V1 remains the release default until automatic, human and performance gates pass. */
export function visualPipeline(env:Record<string,string|undefined>):'v1'|'v2'{const value=env.VISUAL_PIPELINE??'v1';if(value!=='v1'&&value!=='v2')throw new Error('VISUAL_PIPELINE must be v1 or v2');return value;}
