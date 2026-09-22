import i18next, { type TFunction } from 'i18next';

// A real i18next `t` for one locale, with every shipped translation file
// inlined. For tests whose subject is the phrase a locale produces -- plural
// choice, word order, interpolation -- where an identity or hand-rolled lookup
// would test itself instead of the strings users see. Fresh instance per call,
// so no test inherits another's language.
const localeFiles = import.meta.glob('/public/locales/*/translation.json', {
  import: 'default',
  eager: true,
}) as Record<string, Record<string, string>>;

export const localeDicts = Object.entries(localeFiles).map(
  ([path, dict]) => [path.split('/')[3], dict] as const
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
