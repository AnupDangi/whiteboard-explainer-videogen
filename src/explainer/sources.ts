/** V1 compatibility shim. The single ingestion pathway now lives in the neutral
 *  `shared/ingestion/source.ts` (`Architecture_plan.md` §4) so the semantic
 *  pipeline no longer imports `explainer/`. Existing V1 imports keep working. */
export * from '../shared/ingestion/source.js';
