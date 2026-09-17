import type {CompiledVisualAction,VisualSceneV2,VisualTiming} from '../types.js';
import {segmentWords} from '../../shared/language.js';
const normalize=(s:string)=>s.toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
export function estimatedTiming(scene:VisualSceneV2,wpm=145):VisualTiming{
 if(!Number.isFinite(wpm)||wpm<60||wpm>300)throw new Error('Invalid speech rate');const tokens=scene.beats.flatMap(b=>segmentWords(b.narration)),step=60000/wpm;
 return {kind:'estimated',durationMs:tokens.length*step,words:tokens.map((word,i)=>({word,startMs:i*step,endMs:(i+1)*step}))};
}
export function compileTimeline(scene:VisualSceneV2,timing:VisualTiming,diagnostics?:string[]):CompiledVisualAction[]{
 const words=scene.beats.flatMap(b=>segmentWords(b.narration));if(words.length!==timing.words.length||!Number.isFinite(timing.durationMs)||timing.durationMs<=0||timing.durationMs>180000)throw new Error('Timing does not match narration');
 let prior=0;timing.words.forEach((w,i)=>{if(normalize(w.word)!==normalize(words[i])||![w.startMs,w.endMs].every(Number.isFinite)||w.startMs<prior||w.endMs<w.startMs||w.endMs>timing.durationMs)throw new Error('Invalid word timing');prior=w.endMs;});
 let offset=0;const actions:CompiledVisualAction[]=[];
 for(const beat of scene.beats){const count=segmentWords(beat.narration).length,local=timing.words.slice(offset,offset+count),beatStart=local[0].startMs,beatEnd=local.at(-1)!.endMs;
  for(const a of beat.actions){let anchorMs=beatStart;
   if(a.anchor){const target=segmentWords(a.anchor.text).map(normalize),matches:number[]=[];for(let i=0;i<=local.length-target.length;i++)if(target.every((t,j)=>normalize(local[i+j].word)===t))matches.push(i);const index=matches[a.anchor.occurrence];
    /** The model named a spoken phrase that is not in this beat's narration —
     *  measured live on "ensure", "chambers", "world model". Failing threw away
     *  the whole generation and then bought a director repair that reproduced the
     *  same anchor, so the lesson died twice over one word. Degrading to the beat
     *  start keeps the timing honest (the action still lands inside its beat) and
     *  is recorded. */
    if(index===undefined){diagnostics?.push(`representation fallback: spoken anchor "${a.anchor.text}" not found in ${beat.id}; used the beat start`);anchorMs=beatStart;}
    else anchorMs=local[index].startMs;}
   const startMs=Math.max(beatStart,anchorMs+a.leadMs),durationMs=Math.min(a.durationMs,beatEnd-startMs);if(durationMs<=0)throw new Error('Action outside beat');
   actions.push({...a,beatId:beat.id,startMs,anchorMs,signedLagMs:startMs-anchorMs,durationMs});
  }offset+=count;
 }
 return actions.sort((a,b)=>a.startMs-b.startMs||a.id.localeCompare(b.id));
}
/** Union motion intervals; captions and intentional pauses never count as teaching motion. */
export function staticIntervals(scene:VisualSceneV2,timing:VisualTiming,actions:CompiledVisualAction[]):{startMs:number;endMs:number}[]{
 const active=actions.map(a=>({startMs:a.startMs,endMs:a.startMs+(a.type==='reveal'?1:a.durationMs)}));let offset=0;
 for(const b of scene.beats){const count=segmentWords(b.narration).length;if(b.intentionalPause)active.push({startMs:timing.words[offset].startMs,endMs:timing.words[offset+count-1].endMs});offset+=count;}
 active.sort((a,b)=>a.startMs-b.startMs);const gaps=[];let cursor=timing.words[0].startMs;const end=timing.words.at(-1)!.endMs;
 for(const a of active){if(a.startMs>cursor)gaps.push({startMs:cursor,endMs:Math.min(end,a.startMs)});cursor=Math.max(cursor,a.endMs);}if(cursor<end)gaps.push({startMs:cursor,endMs:end});return gaps.filter(g=>g.endMs>g.startMs);
}
