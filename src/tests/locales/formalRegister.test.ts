import { describe, expect, test } from 'vitest';

// KAN-304. These locales address the user formally; one informal line slipped into de.
const localeFiles = import.meta.glob<Record<string, string>>(
  '/public/locales/*/translation.json',
  { import: 'default', eager: true }
);

const dictFor = (locale: string) =>
  localeFiles[`/public/locales/${locale}/translation.json`];

// \b is ASCII-only in JS, so words are bounded by non-letters instead.
const words = (list: string[]) =>
  new RegExp(`(?<!\\p{L})(${list.join('|')})(?!\\p{L})`, 'iu');

const REGISTERS = [
  {
    locale: 'de',
    informal: words([
      'du',
      'dich',
      'dir',
      'dein',
      'deine',
      'deinen',
      'deinem',
      'deiner',
      'deines',
    ]),
    formal: words(['Sie', 'Ihr', 'Ihre', 'Ihren', 'Ihrem', 'Ihrer', 'Ihres']),
  },
  {
    locale: 'fr',
    informal: words(['tu', 'toi', 'ton', 'ta', 'tes']),
    formal: words(['vous', 'votre', 'vos']),
  },
  {
    locale: 'ru',
    informal: words(['ты', 'тебя', 'тебе', 'твой', 'твоя', 'твоё', 'твои']),
    formal: words(['вы', 'вас', 'вам', 'ваш', 'ваша', 'ваше', 'ваши']),
  },
];

describe.each(REGISTERS)('$locale keeps the formal register', (r) => {
  const values = Object.values(dictFor(r.locale));

  test('no line addresses the user informally', () => {
    expect(values.filter((v) => r.informal.test(v))).toEqual([]);
  });

  test('CONTROL: the formal forms are found', () => {
    expect(values.some((v) => r.formal.test(v))).toBe(true);
  });
});
