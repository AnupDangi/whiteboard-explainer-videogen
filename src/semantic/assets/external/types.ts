/** Deterministic retrieval contracts. Nothing here performs I/O: the network
 *  boundary (P3 proper) consumes these decisions, so the policy, licence and
 *  ranking behaviour is testable without a provider. */

/** How far to widen the search.
 *   off      no external retrieval at all (default)
 *   strict   only collections that are natively outline and style-compatible
 *   balanced strict first, then any legally approved collection
 *   broad    every legally approved collection */
export type RetrievalMode='off'|'strict'|'balanced'|'broad';

/** Licence obligations. `blocked` is a hard exclusion, never a warning. */
export type LicensePolicy='auto'|'attribution'|'blocked';

export interface CollectionProfile{
 /** Iconify collection prefix, e.g. `tabler`. */
 prefix:string;
 license:{id:string;policy:LicensePolicy};
 style:{
  /** Every glyph is drawn with strokes (matches the chalk-ink renderer). */
  outline:boolean;
  /** Glyphs may be filled shapes. */
  fill:boolean;
  /** A single glyph may use two tones. */
  duotone:boolean;
  /** Typical stroke weight in the 24-unit design grid, when known. */
  strokeWeight?:number;
  /** Typical path-command count; higher means a busier glyph. */
  complexity?:number;
 };
}

/** What a search result exposes before any body is fetched. The director must
 *  never see SVG, only this. */
export interface ExternalCandidateMetadata{
 provider:string;
 collection:string;
 name:string;
 licenseId:string;
 hasStroke:boolean;
 hasFill:boolean;
 duotone?:boolean;
 /** Number of path commands, when the search result reports it. */
 partCount?:number;
 /** Position in the provider's own result list. The provider ranks by textual
  *  relevance; discarding that would let a style tie-break pick a less apt
  *  icon, so it is carried through as a scoring signal. */
 providerRank?:number;
}

export interface CandidateScore{
 collection:string;
 name:string;
 score:number;
 reasons:string[];
}
