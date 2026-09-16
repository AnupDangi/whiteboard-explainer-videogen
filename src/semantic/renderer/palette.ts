import {COLORS} from './style.js';

/** Colour roles let an asset state intent ("outline", "primary", "accent")
 *  instead of naming a palette token, which is what external/normalized assets
 *  can be converted into. Existing curated assets keep naming `stroke`/`fill`
 *  tokens directly and resolve byte-identically through `COLORS`. */
export type AssetColorRole='outline'|'primary'|'primaryShadow'|'secondary'|'secondaryShadow'|'accent'|'neutral'|'muted'|'white';
export type FillMode='none'|'wash'|'solid';
export type ThemeName='chalk-ink-v2';
export interface ThemePalette{outline:string;primary:string;primaryShadow:string;secondary:string;secondaryShadow:string;accent:string;neutral:string;muted:string;white:string}

/** `chalk-ink-v2` is the compatibility theme: every role it resolves is the hex
 *  the curated assets already draw with, so a role-based part and a token-based
 *  part of the same colour produce identical markup. */
export const THEMES:Record<ThemeName,ThemePalette>={
 'chalk-ink-v2':{outline:COLORS.ink,primary:COLORS.green,primaryShadow:COLORS.red,secondary:COLORS.blue,secondaryShadow:'#2b6b86',accent:COLORS.amber,neutral:COLORS.earth,muted:'#65776b',white:'#ffffff'},
};
export const DEFAULT_THEME:ThemeName='chalk-ink-v2';
export function themePalette(name:ThemeName=DEFAULT_THEME):ThemePalette{const palette=THEMES[name];if(!palette)throw new Error(`Unknown theme: ${name}`);return palette;}

/** A part resolves by role when it declares one, else by its legacy token.
 *  Returning `undefined` means "no colour", not "black". */
export function resolveAssetColor(token:string|undefined,role:AssetColorRole|undefined,palette:ThemePalette):string|undefined{
 if(role)return palette[role];
 return token?COLORS[token as keyof typeof COLORS]:undefined;
}
