import {createHash} from 'node:crypto';
import type {VisualSceneV2} from '../types.js';

/** Voice profile and TTS cache key (`Architecture_plan.md` §37-41, §43). One
 *  profile per lesson so every scene sounds like the same teacher. Local
 *  engines return duration, not word timings, so any timing derived here stays
 *  visibly estimated upstream. */
export interface VoiceProfile {
  engine:string;
  voiceId:string;
  language:string;
  speakingRate:number;
  pronunciationDictionary:Record<string,string>;
  sentenceStyle:string;
  pausePolicy:string;
}

export function voiceProfileFromEnv(env:NodeJS.ProcessEnv,language:string):VoiceProfile{
  return {
    engine:env.VOICE_ENGINE_PROVIDER||'auto',
    voiceId:env.VOICE_ENGINE_VOICE||'default',
    language,
    speakingRate:Number.isFinite(Number(env.VOICE_ENGINE_RATE))&&Number(env.VOICE_ENGINE_RATE)>0?Number(env.VOICE_ENGINE_RATE):1,
    pronunciationDictionary:{},
    sentenceStyle:'direct explanatory prose',
    pausePolicy:'pause at beat boundaries only',
  };
}

/** The narration the TTS engine receives: one string per scene, not per beat. */
export function narrationForScene(scene:VisualSceneV2):string{
  return scene.beats.map(beat=>beat.narration.trim()).filter(Boolean).join(' ');
}

/** TTS cache key (`§41`): a change to narration, voice or rate invalidates it;
 *  an unchanged narration is never regenerated. */
export function ttsCacheKey(profile:VoiceProfile,narration:string):string{
  const pronunciationHash=createHash('sha256').update(JSON.stringify(profile.pronunciationDictionary)).digest('hex');
  const narrationHash=createHash('sha256').update(narration).digest('hex');
  return createHash('sha256').update([profile.engine,profile.voiceId,profile.language,String(profile.speakingRate),pronunciationHash,narrationHash,profile.sentenceStyle,profile.pausePolicy].join('\u0000')).digest('hex');
}
