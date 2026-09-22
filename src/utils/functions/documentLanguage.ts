import type { i18n as I18n } from 'i18next';

/**
 * Keeps `root.lang` equal to the UI language, now and on every change.
 *
 * Chrome picks the glyph variant of a Han character from the lang attribute,
 * so with the pages fixed at lang="en" a zh-TW or ja UI was drawn in the
 * Simplified forms (KAN-283). Safe to call before `init()`: the listener sees
 * the first language when it arrives.
 */
export function mirrorLanguageOnDocument(
  i18n: I18n,
  root: { lang: string }
): void {
  if (i18n.language) root.lang = i18n.language;
  i18n.on('languageChanged', (lng) => {
    root.lang = lng;
  });
}
