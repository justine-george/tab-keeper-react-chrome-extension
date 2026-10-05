import {
  Language,
  SHIPPED_LANGUAGES,
} from '../../../redux/slices/settingsDataStateSlice';
import {
  matchUiLanguage,
  readUiLanguage,
} from '../../../utils/functions/uiLanguage';

// KAN-244. Each language named in its own language, never through t(): the
// language picker is the one screen that must be readable by someone who
// cannot read the current UI language, which is why they are on it. Sorted
// by the names' own collation (ICU: Latin scripts, then Cyrillic, Devanagari,
// Hangul, Han), which languagePicker.test.tsx pins. The two Chinese options
// name their script: with both present, a bare 中文 would not say which.
export const LANGUAGE_OPTIONS: ReadonlyArray<[Language, string]> = [
  [Language.DE, 'Deutsch'],
  [Language.EN, 'English'],
  [Language.ES, 'Español'],
  [Language.FR, 'Français'],
  [Language.IT, 'Italiano'],
  [Language.PT, 'Português'],
  [Language.SV, 'Svenska'],
  [Language.RU, 'Русский'],
  [Language.HI, 'हिन्दी'],
  [Language.KO, '한국어'],
  [Language.JA, '日本語'],
  [Language.ZH, '简体中文'],
  [Language.ZH_TW, '繁體中文'],
];

// Chrome's language first when this build ships it, else the picker order.
export function chromeLanguageFirst(
  uiLanguage: Language | undefined
): ReadonlyArray<[Language, string]> {
  return [
    ...LANGUAGE_OPTIONS.filter(([language]) => language === uiLanguage),
    ...LANGUAGE_OPTIONS.filter(([language]) => language !== uiLanguage),
  ];
}

// Reads Chrome's language on every call; callers read it once, in useState, so a pick never reorders.
export function chromeLanguageOrder(): ReadonlyArray<[Language, string]> {
  return chromeLanguageFirst(
    matchUiLanguage(readUiLanguage(), SHIPPED_LANGUAGES)
  );
}
