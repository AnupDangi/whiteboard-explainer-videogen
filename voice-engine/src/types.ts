export type ProviderName = 'supertonic' | 'piper';

export type ProviderSelector = 'auto' | 'supertonic' | 'piper';

export interface SynthesizeInput {
  text: string;
  language: string;
  voice?: string;
  provider?: ProviderSelector;
}

export interface SynthesizeResult {
  audioPath: string;
  provider: ProviderName;
  language: string;
  voice: string;
  generationMs: number;
  audioDurationMs: number;
  rtf: number;
}

export interface ProviderRequest {
  text: string;
  language: string;
  voice?: string;
  audioPath: string;
}

export interface ProviderResult {
  audioPath: string;
  voice: string;
  generationMs: number;
  audioDurationMs: number;
}

export interface RouteDecision {
  provider: 'supertonic' | 'piper';
  language: string;
}
