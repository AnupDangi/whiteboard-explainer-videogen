/** Language normalization + provider capability tables. */

/** Supertonic 3's official 31-language set (plus `na` for unknown, not routed here). */
export const SUPERTONIC_LANGUAGES = [
  'ar', 'bg', 'hr', 'cs', 'da', 'nl', 'en', 'et', 'fi', 'fr', 'de', 'el',
  'hi', 'hu', 'id', 'it', 'ja', 'ko', 'lv', 'lt', 'pl', 'pt', 'ro', 'ru',
  'sk', 'sl', 'es', 'sv', 'tr', 'uk', 'vi',
] as const;

const SUPERTONIC_LANGUAGE_SET = new Set<string>(SUPERTONIC_LANGUAGES);

/** Piper default voice per base language code (voice id -> rhasspy/piper-voices).
 *  Region variant is folded to its base code; the first entry wins. */
export const PIPER_DEFAULT_VOICES: Record<string, string> = {
  ar: 'ar_JO-kareem-medium',
  bg: 'bg_BG-dimitar-medium',
  bn: 'bn_BD-google-medium',
  ca: 'ca_ES-upc_ona-medium',
  cs: 'cs_CZ-jirka-medium',
  cy: 'cy_GB-gwryw_gogleddol-medium',
  da: 'da_DK-talesyntese-medium',
  de: 'de_DE-thorsten-medium',
  el: 'el_GR-joy-medium',
  en: 'en_US-lessac-medium',
  es: 'es_ES-davefx-medium',
  et: 'et_EE-news-medium',
  eu: 'eu_ES-antton-medium',
  fa: 'fa_IR-amir-medium',
  fi: 'fi_FI-harri-medium',
  fr: 'fr_FR-siwis-medium',
  he: 'he_IL-saspeech-medium',
  hi: 'hi_IN-pratham-medium',
  hu: 'hu_HU-anna-medium',
  hy: 'hy_AM-gor-medium',
  id: 'id_ID-news_tts-medium',
  is: 'is_IS-bui-medium',
  it: 'it_IT-paola-medium',
  ja: 'ja_JA-hi_fi_captain-medium',
  ka: 'ka_GE-natia-medium',
  kk: 'kk_KZ-issai-high',
  ko: 'ko_KR-kss-medium',
  ku: 'ku_TR-berfin_renas-medium',
  lb: 'lb_LU-marylux-medium',
  lv: 'lv_LV-aivars-medium',
  ml: 'ml_IN-arjun-medium',
  mr: 'mr_IN-google-medium',
  ne: 'ne_NP-chitwan-medium',
  nl: 'nl_NL-alex-medium',
  no: 'no_NO-talesyntese-medium',
  pl: 'pl_PL-darkman-medium',
  pt: 'pt_BR-cadu-medium',
  ro: 'ro_RO-mihai-medium',
  ru: 'ru_RU-denis-medium',
  sk: 'sk_SK-lili-medium',
  sl: 'sl_SI-artur-medium',
  sq: 'sq_AL-edon-medium',
  sr: 'sr_RS-serbski_institut-medium',
  sv: 'sv_SE-alma-medium',
  sw: 'sw_CD-lanfrica-medium',
  te: 'te_IN-maya-medium',
  th: 'th_TH-tsync2-medium',
  tr: 'tr_TR-dfki-medium',
  uk: 'uk_UA-ukrainian_tts-medium',
  ur: 'ur_PK-aegis_female-medium',
  vi: 'vi_VN-vais1000-medium',
  zh: 'zh_CN-chaowen-medium',
};

const PIPER_LANGUAGE_SET = new Set<string>(Object.keys(PIPER_DEFAULT_VOICES));

/** Any script/region spelling mapped down to its base ISO 639-1 code. */
const LANGUAGE_NAMES: Record<string, string> = {
  arabic: 'ar', bulgarian: 'bg', croatian: 'hr', czech: 'cs', danish: 'da',
  dutch: 'nl', english: 'en', estonian: 'et', finnish: 'fi', french: 'fr',
  german: 'de', greek: 'el', hindi: 'hi', hungarian: 'hu', indonesian: 'id',
  italian: 'it', japanese: 'ja', korean: 'ko', latvian: 'lv',
  lithuanian: 'lt', polish: 'pl', portuguese: 'pt', romanian: 'ro',
  russian: 'ru', slovak: 'sk', slovenian: 'sl', spanish: 'es', swedish: 'sv',
  turkish: 'tr', ukrainian: 'uk', vietnamese: 'vi',
  catalan: 'ca', welsh: 'cy', persian: 'fa', farsi: 'fa', hebrew: 'he',
  bengali: 'bn', basque: 'eu', armenian: 'hy', georgian: 'ka', kazakh: 'kk',
  kurdish: 'ku', luxembourgish: 'lb', malayalam: 'ml', marathi: 'mr',
  nepali: 'ne', norwegian: 'no', albanian: 'sq', serbian: 'sr',
  swahili: 'sw', kiswahili: 'sw', telugu: 'te', thai: 'th', urdu: 'ur',
  chinese: 'zh', mandarin: 'zh',
};

/** Accepts `en`, `en-US`, `en_US`, `English` -> `en`. */
export function normalizeLanguage(input: string): string {
  const raw = String(input ?? '').trim().toLowerCase();
  if (!raw) throw new Error('language is required');
  const dashed = raw.replace(/_/g, '-');
  const base = dashed.split('-')[0];
  return LANGUAGE_NAMES[dashed] ?? LANGUAGE_NAMES[base] ?? base;
}

export function isSupertonicLanguage(language: string): boolean {
  return SUPERTONIC_LANGUAGE_SET.has(normalizeLanguage(language));
}

export function isPiperLanguage(language: string): boolean {
  return PIPER_LANGUAGE_SET.has(normalizeLanguage(language));
}
