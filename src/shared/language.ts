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

/** Speaking rate that turns a requested lesson length into a word budget. One
 *  number for the whole product: the teaching prompt sizes its narration from
 *  it and `estimatedTiming` measures against it, so "one minute" means the same
 *  thing on both sides. It used to live only inside the timing estimator, where
 *  the planner could not see it — which is why a one-minute request produced
 *  60s, 64s and 93s from identical inputs.
 *
 *  CALIBRATED, not assumed. The previous value was 145 wpm, which the voice
 *  engine does not deliver: measured over four complete narrated lessons the
 *  real rate is 107.7 wpm (102.0, 103.3, 108.8, 120.8). Every lesson was
 *  therefore about 1.35x longer than the planner intended — a 145-word budget
 *  rendered as 86.5s of audio instead of the intended 60s. Re-measure with
 *  `scripts/` if the voice engine or language changes. */
export const NARRATION_WPM=108;

/** Narration length for a requested lesson. This is the number the teaching
 *  plan is held to; it is not advisory. */
export function wordsForMinutes(minutes:number,wpm:number=NARRATION_WPM):number{
 if(!Number.isFinite(minutes)||minutes<=0)throw new Error('Lesson length must be greater than zero');
 if(!Number.isFinite(wpm)||wpm<60||wpm>300)throw new Error('Invalid speech rate');
 return Math.round(minutes*wpm);
}

/** A scene is one board the learner reads while the narration runs. Thirty
 *  seconds is the teaching unit the layout was designed around, so scene count
 *  follows from the requested length rather than from a fixed default. */
export const SECONDS_PER_SCENE=30;
export const MAX_SCENES_PER_LESSON=120;

/** The shortest a planned chapter comes out in practice. Measured: asked for 54
 *  words the model returned ~102 twice, with an explicit "remove 48 words"
 *  instruction on both attempts. A chapter carries real content and has a floor,
 *  so a SHORT lesson must use FEWER chapters rather than a smaller budget for
 *  each. Two chapters at this floor made a "one-minute" lesson 207 words and 94s. */
export const NATURAL_CHAPTER_WORDS=110;

/** The board must not sit frozen while the teacher keeps talking. Expressed in
 *  SPOKEN WORDS rather than milliseconds because that is the thing the learner
 *  experiences: a pause is long relative to how fast the narration moves, not in
 *  absolute seconds. It was a bare 3500ms in two files, chosen when the speaking
 *  rate was assumed to be 145 wpm; at the measured 108 wpm the same board change
 *  cadence is longer. Eight words is about 4.4s. */
export const MAX_STATIC_WORDS=8;
export const MAX_STATIC_INTERVAL_MS=Math.round(60000/NARRATION_WPM*MAX_STATIC_WORDS);

export function scenesForMinutes(minutes:number):number{
 if(!Number.isFinite(minutes)||minutes<=0)throw new Error('Lesson length must be greater than zero');
 return Math.min(MAX_SCENES_PER_LESSON,Math.max(1,Math.ceil(minutes*60/SECONDS_PER_SCENE)));
}

/** Whitespace-insensitive text identity, used to verify a beat partition on any script. */
export function squash(text:string):string{return String(text??'').replace(/\s+/g,'');}
