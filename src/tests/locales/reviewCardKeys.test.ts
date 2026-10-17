import { describe, expect, test } from 'vitest';

// KAN-653. The review card's words, in every locale, and the retired
// dialog's words in none.

const localeFiles = import.meta.glob('/public/locales/*/translation.json', {
  import: 'default',
  eager: true,
}) as Record<string, Record<string, string>>;

const locales = Object.entries(localeFiles).map(
  ([path, dict]) => [path.split('/')[3], dict] as const
);

const EN: Record<string, string> = {
  'Thanks for using Tab Keeper': 'Thanks for using Tab Keeper',
  'Your first session is saved': 'Your first session is saved',
  'Your tabs are saved': 'Your tabs are saved',
  'Your sessions are here': 'Your sessions are here',
  'Your tabs are back': 'Your tabs are back',
  ReviewCardBodyTime:
    "If it's useful to you, a rating on the Chrome Web Store helps other people find it.",
  ReviewCardBody:
    'If Tab Keeper is useful to you, a rating on the Chrome Web Store helps other people find it.',
  // KAN-659. A minute in, nobody knows yet whether it's useful; liking it is easy to say yes to.
  ReviewCardBodyFirstSave:
    'If you like it so far, a rating on the Chrome Web Store helps other people find Tab Keeper.',
  'Rate Tab Keeper': 'Rate Tab Keeper',
  'Never ask again': 'Never ask again',
};

const RETIRED = [
  'RequestUserReviewHeader',
  'RequestUserReviewText',
  'RequestUserReviewSignOff',
  'Maybe Later',
  'Never Remind Again',
];

// KAN-242: the ask is for a rating, never a good one. The steers each locale
// once used, listed, since a scan can only find what it knows to look for.
const STEERING = [
  'good review',
  'good rating',
  'positive Bewertung',
  'buena reseña',
  'bon avis',
  'recensione positiva',
  'avaliação positiva',
  'положительный отзыв',
  'सकारात्मक समीक्षा',
  'ポジティブなレビュー',
  '好评',
  '좋은 리뷰',
  '별 5개',
  'positivt omdöme',
  'bra recension',
  '好評',
  '五星',
  '5 star',
  'five star',
];

test('CONTROL: all thirteen locales were loaded', () => {
  expect(locales).toHaveLength(13);
});

test('en says exactly what was decided', () => {
  const en = localeFiles['/public/locales/en/translation.json'];
  for (const [key, value] of Object.entries(EN)) {
    expect(en[key], key).toBe(value);
  }
});

describe.each(locales)('%s', (_name, dict) => {
  test('has every card key, none empty', () => {
    for (const key of Object.keys(EN)) {
      expect(dict[key]?.trim(), key).toBeTruthy();
    }
  });

  test('keeps none of the dialog’s keys', () => {
    for (const key of RETIRED) {
      expect(dict, key).not.toHaveProperty(key);
    }
  });

  test('no card key takes a value: no title carries a session’s name', () => {
    for (const key of Object.keys(EN)) {
      expect(dict[key], key).not.toContain('{{');
    }
  });

  test('the bodies ask for a rating, not a good one', () => {
    for (const key of [
      'ReviewCardBody',
      'ReviewCardBodyTime',
      'ReviewCardBodyFirstSave',
    ]) {
      for (const steer of STEERING) {
        expect(dict[key].toLowerCase(), key).not.toContain(steer.toLowerCase());
      }
    }
  });
});
