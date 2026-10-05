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

// KAN-420. Chrome's language first when this build ships it, else the picker
// order; a pick never moves, so this is read once and not from the setting.
export function chromeLanguageFirst(
  uiLanguage: Language | undefined
): ReadonlyArray<[Language, string]> {
  return [
    ...LANGUAGE_OPTIONS.filter(([language]) => language === uiLanguage),
    ...LANGUAGE_OPTIONS.filter(([language]) => language !== uiLanguage),
  ];
}

// Chrome's language is read here, once, by whoever mounts the grid.
export function chromeLanguageOrder(): ReadonlyArray<[Language, string]> {
  return chromeLanguageFirst(
    matchUiLanguage(readUiLanguage(), SHIPPED_LANGUAGES)
  );
}
