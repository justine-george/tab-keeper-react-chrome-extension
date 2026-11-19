import i18next, { type TFunction } from 'i18next';

import { SHIPPED_LANGUAGES } from '../../utils/functions/languages';

// A real i18next `t` for one locale, with every shipped translation file
// inlined. For tests whose subject is the phrase a locale produces -- plural
// choice, word order, interpolation -- where an identity or hand-rolled lookup
// would test itself instead of the strings users see. Fresh instance per call,
// so no test inherits another's language.
const localeFiles = import.meta.glob('/public/locales/*/translation.json', {
  import: 'default',
  eager: true,
}) as Record<string, Record<string, string>>;

// KAN-968. One dictionary per shipped language, throwing on a missing file, so a
// loop over them can never pass with nothing checked (supportedLanguages.test.ts
// holds the folders to the languages).
export function dictFor(lang: string): Record<string, string> {
  const dict = localeFiles[`/public/locales/${lang}/translation.json`];
  if (dict === undefined) throw new Error(`no translation file for ${lang}`);
  return dict;
}

export const localeDicts = SHIPPED_LANGUAGES.map(
  (lang) => [lang, dictFor(lang)] as const
);

export async function tFor(lng: string): Promise<TFunction> {
  const instance = i18next.createInstance();
  await instance.init({
    lng,
    fallbackLng: 'en',
    resources: Object.fromEntries(
      localeDicts.map(([name, dict]) => [name, { translation: dict }])
    ),
    interpolation: { escapeValue: false },
  });
  return instance.t;
}
