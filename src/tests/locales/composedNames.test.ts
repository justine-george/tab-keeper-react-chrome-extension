import { describe, expect, test } from 'vitest';

import {
  formatActionOnItem,
  formatGroupCounts,
  formatNameWithCount,
} from '../../utils/functions/local';
import { localeDicts, tFor } from '../setup/localeT';

// KAN-307. A name built from translated pieces takes its punctuation from the
// locale. Asserted on rendered phrases, because a locale missing a key falls
// back to en and still reads as a sensible string.
const COLON: Record<string, string> = {
  de: ': ',
  en: ': ',
  es: ': ',
  fr: '\u00a0: ',
  hi: ': ',
  it: ': ',
  ja: '：',
  ko: ': ',
  pt: ': ',
  ru: ': ',
  sv: ': ',
  zh: '：',
  'zh-TW': '：',
};

const COMMA: Record<string, string> = {
  ...Object.fromEntries(Object.keys(COLON).map((lng) => [lng, ', '])),
  ja: '、',
  zh: '，',
  'zh-TW': '，',
};

const WINDOW_ONE: Record<string, string> = {
  de: 'Fenster 1',
  en: 'Window 1',
  es: 'Ventana 1',
  fr: 'Fenêtre 1',
  hi: 'विंडो 1',
  it: 'Finestra 1',
  ja: 'ウィンドウ 1',
  ko: '창 1',
  pt: 'Janela 1',
  ru: 'Окно 1',
  sv: 'Fönster 1',
  zh: '窗口 1',
  'zh-TW': '視窗 1',
};

const LOCALES = localeDicts.map(([lng]) => lng);

describe('composed names use the locale punctuation', () => {
  test('the tables cover every shipped locale', () => {
    expect(Object.keys(COLON).sort()).toEqual([...LOCALES].sort());
  });

  test.each(LOCALES)('%s joins an action and its item', async (lng) => {
    const t = await tFor(lng);

    expect(formatActionOnItem('Act', 'Docs', t)).toBe(`Act${COLON[lng]}Docs`);
  });

  test.each(LOCALES)('%s joins a name and its count', async (lng) => {
    const t = await tFor(lng);

    expect(formatNameWithCount('Name', '5', t)).toBe(`Name${COMMA[lng]}5`);
  });

  test.each(LOCALES)('%s numbers an unnamed window', async (lng) => {
    const t = await tFor(lng);

    expect(t('WindowNumbered', { number: 1 })).toBe(WINDOW_ONE[lng]);
  });

  test.each(['ja', 'zh', 'zh-TW'])(
    '%s leaves no space after its full-width Matches colon',
    async (lng) => {
      const t = await tFor(lng);

      expect(formatGroupCounts(1, 1, true, t)).toMatch(/：\S/);
    }
  );

  test.each(['de', 'en', 'fr', 'ko'])(
    '%s keeps the space after its Matches colon',
    async (lng) => {
      const t = await tFor(lng);

      expect(formatGroupCounts(1, 1, true, t)).toMatch(/: \S/);
    }
  );
});

describe('an item is carried through untouched', () => {
  // Tab titles are page-controlled, so they must not be read as i18next syntax.
  test.each([
    ['nesting', '$t(Open now)'],
    ['interpolation', '{{action}} {{count}}'],
    ['a replace pattern', 'Save $& and $1'],
    ['markup', '<b>A & B</b>'],
    ['a colon', 'Docs: Getting started'],
  ])('with %s in it', async (_name, title) => {
    const t = await tFor('ja');

    expect(formatActionOnItem('Act', title, t)).toBe(`Act：${title}`);
  });

  test('an empty item leaves the action and its joiner', async () => {
    const t = await tFor('en');

    expect(formatActionOnItem('Act', '', t)).toBe('Act: ');
  });
});

describe('no component glues a name by hand', () => {
  const sources = import.meta.glob('/src/components/**/*.tsx', {
    query: '?raw',
    import: 'default',
    eager: true,
  }) as Record<string, string>;
  const GLUED = /': ' \+|`[^`]*\}[:,] \$\{/;

  test('the scan sees a glued name', () => {
    expect(GLUED.test("t('Close tab') + ': ' + tab.title")).toBe(true);
    expect(GLUED.test("`${t('Hide')}: ${name}`")).toBe(true);
    expect(GLUED.test("`${t('Open now')}, ${count}`")).toBe(true);
  });

  test('none is left', () => {
    const glued = Object.entries(sources)
      .filter(([, source]) => source.split('\n').some((l) => GLUED.test(l)))
      .map(([file]) => file);

    expect(glued).toEqual([]);
  });
});
