import {NODE_KINDS,KIND_KEYWORDS,type NodeKind} from '../domain/vocabulary.js';

/** Deterministic semantic kind resolver. Instead of a hand-maintained label→kind regex
 *  table, it scores a node's text against the central `KIND_KEYWORDS` lexicon and returns
 *  the best-matching kind — vocabulary-driven, so adding a kind to the lexicon (and the
 *  prompt) makes it selectable everywhere with no extra wiring. Pure and stable: ties
 *  break on the earliest matched semantic term, then explicit NODE_KINDS priority. This
 *  keeps compound labels such as “User request” and “chlorophyll absorbs light” anchored
 *  to the first subject rather than a trailing noun. */

function normalize(text:string):string{
  return ` ${text.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()} `;
}

export function resolveKind(text:string):NodeKind|undefined{
  const hay=normalize(text);
  let best:NodeKind|undefined;
  let bestScore=0;
  let bestPosition=Number.POSITIVE_INFINITY;
  for(const kind of NODE_KINDS){
    const words=KIND_KEYWORDS[kind];
    if(!words)continue;
    let score=0,firstPosition=Number.POSITIVE_INFINITY;
    for(const word of words){
      const position=hay.indexOf(` ${word} `);
      if(position>=0){
        // Multi-word domain phrases carry more semantic information than a
        // generic single-word hit. Without this weighting, “people + dark web”
        // resolves to the user glyph before the browser/safety representation,
        // producing a generic person in a security lesson.
        score+=word.trim().split(/\s+/).length;
        firstPosition=Math.min(firstPosition,position);
      }
    }
    if(score>bestScore||(score===bestScore&&firstPosition<bestPosition)){
      best=kind;bestScore=score;bestPosition=firstPosition;
    }
  }
  return best;
}
