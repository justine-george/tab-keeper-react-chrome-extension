import { Language } from '../../../redux/slices/settingsDataStateSlice';

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

// KAN-7 §5. The current language first, the other twelve in picker order.
export function languageOrderFor(
  current: Language
): ReadonlyArray<[Language, string]> {
  return [
    ...LANGUAGE_OPTIONS.filter(([language]) => language === current),
    ...LANGUAGE_OPTIONS.filter(([language]) => language !== current),
  ];
}
