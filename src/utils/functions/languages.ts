// KAN-642. The shipped languages and how one is picked. Worker-safe: no window,
// no redux, no storage at load. The settings slice re-exports all of it.
import { matchUiLanguage } from './uiLanguage';

export enum Language {
  DE = 'de',
  EN = 'en',
  ES = 'es',
  FR = 'fr',
  HI = 'hi',
  IT = 'it',
  JA = 'ja',
  KO = 'ko',
  PT = 'pt',
  RU = 'ru',
  SV = 'sv',
  // Simplified. A BCP 47 tag, hyphenated, because the value goes straight to
  // Intl -- the manifest's zh_TW spelling throws there (KAN-283).
  ZH = 'zh',
  ZH_TW = 'zh-TW',
}

export const SHIPPED_LANGUAGES = Object.values(Language);

/**
 * The language the popup opens in (KAN-282): the one saved here, else the
 * browser's UI language mapped onto one this build ships, else English.
 *
 * Every user who has ever changed any setting has `language` saved, because
 * each setting write persists the whole object -- so detection only ever
 * decides a first run, and never moves an existing user.
 *
 * A saved value this build does not ship counts as nothing saved rather than
 * being handed to i18next, which would fetch a locale file that does not exist
 * (#42). The quote strip predates this: #42's `i18nextLng` key was JSON-quoted.
 */
export function startupLanguage(stored: unknown, uiTag: unknown): Language {
  return (
    asShippedLanguage(stored) ??
    matchUiLanguage(uiTag, SHIPPED_LANGUAGES) ??
    Language.EN
  );
}

/**
 * A stored language value, if it names one this build ships; else undefined.
 * Anything else handed to i18next makes it fetch a locale file that does not
 * exist (#42). Quotes are stripped first: #42's `i18nextLng` key was
 * JSON-quoted. Also guards another page's settings write (KAN-279 D9).
 */
export function asShippedLanguage(value: unknown): Language | undefined {
  return typeof value === 'string'
    ? SHIPPED_LANGUAGES.find((l) => l === value.replace(/"/g, ''))
    : undefined;
}
