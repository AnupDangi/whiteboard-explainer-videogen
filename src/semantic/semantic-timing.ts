import {wordsFromDuration} from '../shared/voice-engine-client.js';
import type {VisualTiming,WordTiming} from './types.js';
import type {SpeechResult,V2Speech} from './speech.js';
import {mapConcurrent,concurrencyLimit} from './harness/concurrency.js';

/** Narration frozen per teaching beat. */
export interface NarrationBeats {text:string;beats:readonly Readonly<{id:string;text:string}>[]}
export type SpeechTimingSource='provider'|'aligner'|'semantic-segment'|'estimated';

/**
 * Deterministic WAV concatenation: every segment must share one fmt block.
 * Segment boundaries become exact because audio duration equals the timeline.
 */
export function joinWav(buffers:Buffer[]):Buffer{
 if(!buffers.length)throw new Error('Cannot join zero audio segments');
 const parsed=buffers.map((buffer,index)=>parseWav(buffer,index));
 for(const chunk of parsed.slice(1))if(!chunk.fmt.equals(parsed[0].fmt))throw new Error('Audio segment formats differ; refusing to concatenate');
 const data=Buffer.concat(parsed.map(chunk=>chunk.data));
 return buildWav(parsed[0].fmt,data);
}
function buildWav(fmt:Buffer,data:Buffer):Buffer{
 // Copy the source fmt payload verbatim (audioFormat, channels, sampleRate,
 // byteRate, blockAlign, bitsPerSample) instead of re-deriving any field.
 const header=Buffer.alloc(44);
 header.write('RIFF',0,'ascii');header.writeUInt32LE(36+data.length,4);header.write('WAVE',8,'ascii');
 header.write('fmt ',12,'ascii');header.writeUInt32LE(16,16);
 Buffer.from(fmt).subarray(0,16).copy(header,20);
 header.write('data',36,'ascii');header.writeUInt32LE(data.length,40);
 return Buffer.concat([header,data]);
}
function parseWav(buffer:Buffer,index:number){
 if(buffer.length<44||buffer.toString('ascii',0,4)!=='RIFF'||buffer.toString('ascii',8,12)!=='WAVE')throw new Error(`Audio segment ${index} is not a RIFF/WAVE buffer`);
 let offset=12,fmt:Buffer|undefined,dataOffset=-1,dataSize=0;
 while(offset+8<=buffer.length){
  const id=buffer.toString('ascii',offset,offset+4),size=buffer.readUInt32LE(offset+4);
  if(id==='fmt ')fmt=buffer.subarray(offset+8,offset+8+Math.min(size,16));
  if(id==='data'){dataOffset=offset+8;dataSize=Math.min(size,buffer.length-dataOffset);break;}
  offset+=8+size+(size%2);
 }
 if(!fmt||dataOffset<0)throw new Error(`Audio segment ${index} lacks a fmt/data pair`);
 return {fmt,data:buffer.subarray(dataOffset,dataOffset+dataSize)};
}

/** Exact segment starts; word boundaries inside a segment stay proportional. */
export function timingFromSegments(segments:{beatId:string;text:string;durationMs:number;timingSource:SpeechTimingSource;words?:WordTiming[]}[]):{kind:string;durationMs:number;timingSource:SpeechTimingSource;words:WordTiming[]}{
 if(!segments.length)throw new Error('Cannot time empty narration');
 const words:WordTiming[]=[];let offset=0;
 for(const segment of segments){
  if(!Number.isFinite(segment.durationMs)||segment.durationMs<=0)throw new Error(`Invalid segment duration for ${segment.beatId}`);
  if(segment.words?.length){
   for(const word of segment.words)words.push({...word,startMs:offset+word.startMs,endMs:offset+word.endMs});
  }else{
   for(const word of wordsFromDuration(segment.text,segment.durationMs).words)words.push({...word,startMs:offset+word.startMs,endMs:offset+word.endMs});
  }
  offset+=segment.durationMs;
 }
 const timingSource:SpeechTimingSource=segments.some(segment=>segment.timingSource==='provider')?'provider':segments.some(segment=>segment.timingSource==='aligner')?'aligner':'semantic-segment';
 return {kind:wordsFromDuration('x',100).kind,durationMs:offset,timingSource,words};
 }

 /**
  * Narrated speech for one scene: TTS per semantic segment when the narration
 * has multiple beats (exact segment durations), single call otherwise.
 * Any segment failure propagates; a speech failure never becomes silence.
 */
export async function narratedSpeech(narration:NarrationBeats,speech:V2Speech,signal?:AbortSignal,env:NodeJS.ProcessEnv=process.env):Promise<SpeechResult>{
 if(narration.beats.length<=1)return await speech(narration.text);
  /** Beats are independent and the merge is order-preserving, so they can be
   *  synthesised concurrently: the concatenation order, and therefore the audio
   *  and the timeline, is unchanged.
   *
   *  The default is 1 because the bundled engine is CPU-bound and concurrency
   *  buys almost nothing — measured on six beats: 10,943ms serial against
   *  10,226ms at three in flight, a 6.5% gain that mostly shows up as CPU
   *  contention. It is I/O, not compute, that a network TTS provider would make
   *  parallel, so raise V2_TTS_CONCURRENCY when the voice is remote. */
  const results=await mapConcurrent(narration.beats,concurrencyLimit(env,'V2_TTS_CONCURRENCY',1),beat=>speech(beat.text),signal);
  const segments:{beatId:string;text:string;result:SpeechResult}[]=narration.beats.map((beat,index)=>({beatId:beat.id,text:beat.text,result:results[index]}));
 const formats=new Set(segments.map(segment=>segment.result.format));
 if(formats.size!==1)throw new Error('Speech segments returned mixed formats');
 const timing=timingFromSegments(segments.map(segment=>({beatId:segment.beatId,text:segment.text,durationMs:segment.result.timing.durationMs,timingSource:segment.result.timingSource,words:segment.result.timingSource==='provider'||segment.result.timingSource==='aligner'?segment.result.timing.words:undefined})));
 const audio=joinWav(segments.map(segment=>segment.result.audio));
 const provider=segments.map(segment=>segment.result.provider).find(Boolean);
 return {timing,audio,format:segments[0].result.format as 'wav'|'mp3',provider,timingSource:timing.timingSource};
}
