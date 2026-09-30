import type { TFunction } from 'i18next';
import { beforeAll, describe, expect, test } from 'vitest';

import {
  sessionDateLabel,
  sessionDateStamp,
  sessionDateTitle,
  sessionWhen,
} from '../../../utils/functions/sessionDate';
import { getPrettyDate } from '../../../utils/functions/local';
import { tFor } from '../../setup/localeT';
import type { tabContainerData } from '../../../redux/slices/tabContainerDataStateSlice';

// KAN-141. The one date a session row shows, and the word that says which date
// it is.
//
// The word is the whole point. The row shows one number and the list has four
// possible orders, so without a label the number is a guess the moment anything
// but the default is chosen -- which is the state that produced the question
// this ticket came from: "is it saved date or modified date?".
//
// `t` is real en i18n. It used to be the identity, which worked only while the
// key was the English word; since KAN-286 the label is one phrase with the
// date inside it ("Edited {{date}}"), so the assertions read the words a user
// sees. ja and zh are here because they are why it became a phrase.

const CREATED = Date.UTC(2026, 2, 4, 12, 0, 0);
const EDITED = Date.UTC(2026, 8, 9, 18, 30, 0);

// KAN-347: the label's format depends on what day it is, so every test here
// passes a pinned "today" rather than reading the clock. Both instants above
// fall earlier in TODAY's year in every time zone.
const TODAY = new Date(2026, 8, 29, 17, 7, 0);

/** ICU may put U+202F before AM/PM; compare the text a reader sees. */
const norm = (s: string) => s.replace(/\s/g, ' ');

/** Local wall-clock instants, so the rendered text is the same in any time zone. */
const local = (y: number, m: number, d: number, h = 0, min = 0, s = 0) =>
  new Date(y, m, d, h, min, s).getTime();

let t: TFunction;
beforeAll(async () => {
  t = await tFor('en');
});

const build = (overrides: Partial<tabContainerData> = {}): tabContainerData =>
  ({
    tabGroupId: 's1',
    title: 'Research',
    // Deliberately a DIFFERENT moment from createdAt, so anything reading the
    // legacy wall clock instead of the instant is visible rather than lucky.
    createdTime: '2020-01-01 00:00:00',
    createdAt: CREATED,
    windowCount: 1,
    tabCount: 1,
    isAutoSave: false,
    isSelected: false,
    windows: [],
    ...overrides,
  }) as tabContainerData;

describe('sessionDateLabel', () => {
  test('shows the edited date, labelled, on the edited basis', () => {
    const group = build({ contentModified: EDITED });

    expect(sessionDateLabel(group, 'edited', 'en', t, TODAY)).toBe(
      `Edited ${sessionWhen(EDITED, 'en', TODAY)}`
    );
  });

  test('shows the created date, labelled, on the created basis', () => {
    const group = build({ contentModified: EDITED });

    expect(sessionDateLabel(group, 'created', 'en', t, TODAY)).toBe(
      `Created ${sessionWhen(CREATED, 'en', TODAY)}`
    );
  });

  // Both halves swap together. A version that changed the word but not the
  // number -- or the number but not the word -- passes half of the pair above
  // and is worse than either basis on its own, because the row would then be
  // actively lying rather than merely ambiguous.
  test('the word and the number always agree', () => {
    const group = build({ contentModified: EDITED });

    const edited = sessionDateLabel(group, 'edited', 'en', t, TODAY);
    const created = sessionDateLabel(group, 'created', 'en', t, TODAY);

    expect(edited).toContain(sessionWhen(EDITED, 'en', TODAY));
    expect(edited).not.toContain(sessionWhen(CREATED, 'en', TODAY));
    expect(created).toContain(sessionWhen(CREATED, 'en', TODAY));
    expect(created).not.toContain(sessionWhen(EDITED, 'en', TODAY));
  });

  // The one case the basis does not get to decide. A session with no
  // contentModified has never been edited, so "Edited" would be a false
  // statement about it whatever the setting says -- and contentInstant already
  // falls back to the creation instant for these, so the word has to fall back
  // with it or the two would disagree.
  test('a never-edited session says Created even on the edited basis', () => {
    const group = build();

    expect(sessionDateLabel(group, 'edited', 'en', t, TODAY)).toBe(
      `Created ${sessionWhen(CREATED, 'en', TODAY)}`
    );
  });

  // KAN-25 one level down: the fallback reaches createdAt, the instant, not
  // createdTime, a local wall clock with no offset that cannot be trusted once
  // a session crosses timezones.
  test('the fallback uses the instant, not the stored wall clock', () => {
    const group = build();

    expect(sessionDateLabel(group, 'edited', 'en', t, TODAY)).not.toContain(
      '2020'
    );
  });

  // The locale is threaded through rather than defaulted. Ten locales ship,
  // and KAN-85 was this exact mistake for dates.
  test('formats in the locale it is given', () => {
    const group = build({ contentModified: EDITED });

    const de = sessionDateLabel(group, 'edited', 'de', t, TODAY);
    expect(de).toContain(sessionWhen(EDITED, 'de', TODAY));
    expect(de).not.toContain(sessionWhen(EDITED, 'en', TODAY));
  });

  // KAN-286. The word used to be glued in front of the date in code, so no
  // locale could put the date first.
  test('ja puts the date first', async () => {
    const group = build({ contentModified: EDITED });
    const ja = await tFor('ja');

    expect(sessionDateLabel(group, 'edited', 'ja', ja, TODAY)).toBe(
      `${sessionWhen(EDITED, 'ja', TODAY)}に編集`
    );
  });

  test('zh reads 编辑于 <date>', async () => {
    const group = build({ contentModified: EDITED });
    const zh = await tFor('zh');

    expect(sessionDateLabel(group, 'edited', 'zh', zh, TODAY)).toBe(
      `编辑于 ${sessionWhen(EDITED, 'zh', TODAY)}`
    );
  });
});

describe('sessionWhen (KAN-347)', () => {
  test('earlier this year: date and time, no seconds, no year', () => {
    expect(norm(sessionWhen(local(2026, 8, 24, 2, 51, 57), 'en', TODAY))).toBe(
      'Sep 24, 2:51 AM'
    );
  });

  test('another year: the date with its year, no time', () => {
    expect(norm(sessionWhen(local(2025, 2, 14, 10, 30), 'en', TODAY))).toBe(
      'Mar 14, 2025'
    );
  });

  // "This year" is today's year, not the instant's: on Jan 1 last week's
  // Dec 20 needs its year.
  test('the year boundary follows today', () => {
    const jan1 = new Date(2027, 0, 1, 9, 0);
    expect(norm(sessionWhen(local(2026, 11, 20, 8, 0), 'en', jan1))).toBe(
      'Dec 20, 2026'
    );
  });

  test('formats in the locale it is given', () => {
    expect(norm(sessionWhen(local(2026, 8, 24, 2, 51), 'de', TODAY))).toBe(
      '24. Sept., 2:51'
    );
  });

  // Review Focus 3: the locale comes from localStorage.
  test('a malformed locale falls back to en rather than throwing', () => {
    expect(
      norm(sessionWhen(local(2026, 8, 24, 2, 51), 'not a locale!!', TODAY))
    ).toBe('Sep 24, 2:51 AM');
  });

  // Review Focus 4: createdInstant returns 0 for a corrupt createdTime, and
  // Intl throws a RangeError on an Invalid Date.
  // Instant 0 is Jan 1, 1970 in UTC but Dec 31, 1969 west of it, so the year
  // expected is the local one.
  test('a corrupt time: 0 is a dated year, NaN is empty, neither throws', () => {
    expect(sessionWhen(0, 'en', TODAY)).toContain(
      String(new Date(0).getFullYear())
    );
    expect(sessionWhen(Number.NaN, 'en', TODAY)).toBe('');
  });

  test('the label carries the trimmed date', () => {
    const group = build({ contentModified: local(2026, 8, 24, 2, 51, 57) });
    expect(norm(sessionDateLabel(group, 'edited', 'en', t, TODAY))).toBe(
      'Edited Sep 24, 2:51 AM'
    );
  });
});

describe('sessionDateTitle (KAN-347)', () => {
  // The hover holds what the label trimmed away, for the same instant.
  test('the full timestamp of the same instant the label shows', () => {
    const group = build({ contentModified: EDITED });
    expect(sessionDateTitle(group, 'edited', 'en')).toBe(
      getPrettyDate(EDITED, 'en')
    );
    expect(sessionDateTitle(group, 'created', 'en')).toBe(
      getPrettyDate(CREATED, 'en')
    );
    expect(sessionDateTitle(build(), 'edited', 'en')).toBe(
      getPrettyDate(CREATED, 'en')
    );
  });
});

describe('sessionDateStamp (KAN-347)', () => {
  // An exported file is read later, so its date line keeps the full
  // timestamp; a trimmed or relative date there would go stale.
  test('the word and the full timestamp, for a file', () => {
    const group = build({ contentModified: EDITED });
    expect(sessionDateStamp(group, 'edited', 'en', t)).toBe(
      `Edited ${getPrettyDate(EDITED, 'en')}`
    );
    expect(sessionDateStamp(group, 'created', 'en', t)).toBe(
      `Created ${getPrettyDate(CREATED, 'en')}`
    );
    expect(sessionDateStamp(build(), 'edited', 'en', t)).toBe(
      `Created ${getPrettyDate(CREATED, 'en')}`
    );
  });
});
