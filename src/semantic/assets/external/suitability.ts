/** Semantic suitability of an icon name for a concept query.
 *
 *  Iconify search is textual, so a literal match can be confidently wrong:
 *  `floor` returns `floor-lamp` and `floor-plan`, `bill` returns `bill-x`. The
 *  provider's relevance order cannot catch that, because it is ranking words,
 *  not meaning. So an icon is only eligible when its name is the query once the
 *  variant vocabulary is removed — `database` matches `database-outline`, but
 *  `floor` never matches `floor-lamp` because `lamp` is a content word, not a
 *  style token. This is deliberately conservative: a missing icon costs a
 *  composition we already have, a wrong icon teaches the wrong thing. */
const STYLE_TOKENS=new Set([
 'outline','outlined','fill','filled','line','linear','bold','broken','solid','sharp','rounded',
 'twotone','duotone','alt','thin','light','regular','medium','heavy','small','large','negative',
 'box','minimal','subtle','simple','flat',
]);

const tokenize=(value:string):string[]=>value.normalize('NFKC').toLowerCase().split(/[^a-z0-9]+/g).filter(Boolean);
/** Content tokens only: style vocabulary and pure variant numbers are dropped. */
export const contentTokens=(value:string):string[]=>tokenize(value).filter(token=>!STYLE_TOKENS.has(token)&&!/^\d+$/.test(token));

export function iconNameMatchesQuery(name:string,query:string):boolean{
 const icon=contentTokens(name),wanted=contentTokens(query);
 if(!icon.length||!wanted.length)return false;
 const iconSet=new Set(icon),wantedSet=new Set(wanted);
 if(iconSet.size!==icon.length||wantedSet.size!==wanted.length)return false;
 if(icon.length!==wanted.length)return false;
 for(const token of iconSet)if(!wantedSet.has(token))return false;
 return true;
}
