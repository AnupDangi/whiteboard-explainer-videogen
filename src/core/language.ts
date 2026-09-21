/** General language and text handling. No per-language special-casing: every script is
 *  segmented by the runtime's Unicode rules (Intl.Segmenter), so Chinese, Hindi, Nepali,
 *  Arabic, Tamil, Swahili or anything else work the same way. */
const WORD_SEGMENTER=new Intl.Segmenter(undefined,{granularity:'word'});
const SENTENCE_SEGMENTER=new Intl.Segmenter(undefined,{granularity:'sentence'});

interface IndexedSegment{text:string;index:number}

/** Word-like segments for any script (Chinese words, Devanagari words, Latin words, ...). */
export function segmentWords(text:string):string[]{
 const out:string[]=[];for(const part of WORD_SEGMENTER.segment(String(text??'')))if(part.isWordLike)out.push(part.segment);return out;
}

/** Sentence segments, punctuation-aware for every script (。！？ as well as .!?). */
export function segmentSentencesWithIndex(text:string):IndexedSegment[]{
 const source=String(text??''),out:IndexedSegment[]=[];for(const part of SENTENCE_SEGMENTER.segment(source)){const trimmed=part.segment.trim();if(trimmed)out.push({text:trimmed,index:part.index});}return out;
}
