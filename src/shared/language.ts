/** General language and text handling. No per-language special-casing: every script is
 *  segmented by the runtime's Unicode rules (Intl.Segmenter) and named by Intl.DisplayNames,
 *  so Chinese, Hindi, Nepali, Arabic, Tamil, Swahili or anything else work the same way. */
const WORD_SEGMENTER=new Intl.Segmenter(undefined,{granularity:'word'});
const SENTENCE_SEGMENTER=new Intl.Segmenter(undefined,{granularity:'sentence'});

export interface IndexedSegment{text:string;index:number}

/** Human-readable name for any BCP-47 code or language name; falls back to the raw input. */
export function languageLabel(input:string):string{
 const raw=String(input??'').trim()||'en';
 try{const name=new Intl.DisplayNames(['en'],{type:'language'}).of(raw);return name&&name.toLowerCase()!==raw.toLowerCase()?`${name} (${raw})`:raw;}
 catch{return raw;}
}

/** Word-like segments for any script (Chinese words, Devanagari words, Latin words, ...). */
export function segmentWords(text:string):string[]{
 const out:string[]=[];for(const part of WORD_SEGMENTER.segment(String(text??'')))if(part.isWordLike)out.push(part.segment);return out;
}

export function segmentWordsWithIndex(text:string):IndexedSegment[]{
 const source=String(text??''),out:IndexedSegment[]=[];for(const part of WORD_SEGMENTER.segment(source))if(part.isWordLike)out.push({text:part.segment,index:part.index});return out;
}

/** Sentence segments, punctuation-aware for every script (。！？ as well as .!?). */
export function segmentSentencesWithIndex(text:string):IndexedSegment[]{
 const source=String(text??''),out:IndexedSegment[]=[];for(const part of SENTENCE_SEGMENTER.segment(source)){const trimmed=part.segment.trim();if(trimmed)out.push({text:trimmed,index:part.index});}return out;
}

export function countWords(text:string):number{return segmentWords(text).length;}

/** Whitespace-insensitive text identity, used to verify a beat partition on any script. */
export function squash(text:string):string{return String(text??'').replace(/\s+/g,'');}
