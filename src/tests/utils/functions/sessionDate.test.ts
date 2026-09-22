import type { TFunction } from 'i18next';
import { beforeAll, describe, expect, test } from 'vitest';

import { sessionDateLabel } from '../../../utils/functions/sessionDate';
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

    expect(sessionDateLabel(group, 'edited', 'en', t)).toBe(
      `Edited ${getPrettyDate(EDITED, 'en')}`
    );
  });

  test('shows the created date, labelled, on the created basis', () => {
    const group = build({ contentModified: EDITED });

    expect(sessionDateLabel(group, 'created', 'en', t)).toBe(
      `Created ${getPrettyDate(CREATED, 'en')}`
    );
  });

  // Both halves swap together. A version that changed the word but not the
  // number -- or the number but not the word -- passes half of the pair above
  // and is worse than either basis on its own, because the row would then be
  // actively lying rather than merely ambiguous.
  test('the word and the number always agree', () => {
    const group = build({ contentModified: EDITED });

    const edited = sessionDateLabel(group, 'edited', 'en', t);
    const created = sessionDateLabel(group, 'created', 'en', t);

    expect(edited).toContain(getPrettyDate(EDITED, 'en'));
    expect(edited).not.toContain(getPrettyDate(CREATED, 'en'));
    expect(created).toContain(getPrettyDate(CREATED, 'en'));
    expect(created).not.toContain(getPrettyDate(EDITED, 'en'));
  });

  // The one case the basis does not get to decide. A session with no
  // contentModified has never been edited, so "Edited" would be a false
  // statement about it whatever the setting says -- and contentInstant already
  // falls back to the creation instant for these, so the word has to fall back
  // with it or the two would disagree.
  test('a never-edited session says Created even on the edited basis', () => {
    const group = build();

    expect(sessionDateLabel(group, 'edited', 'en', t)).toBe(
      `Created ${getPrettyDate(CREATED, 'en')}`
    );
  });

  // KAN-25 one level down: the fallback reaches createdAt, the instant, not
  // createdTime, a local wall clock with no offset that cannot be trusted once
  // a session crosses timezones.
  test('the fallback uses the instant, not the stored wall clock', () => {
    const group = build();

    expect(sessionDateLabel(group, 'edited', 'en', t)).not.toContain(
      getPrettyDate('2020-01-01 00:00:00', 'en')
    );
  });

  // The locale is threaded through rather than defaulted. Ten locales ship,
  // and KAN-85 was this exact mistake for dates.
  test('formats in the locale it is given', () => {
    const group = build({ contentModified: EDITED });

    const de = sessionDateLabel(group, 'edited', 'de', t);
    expect(de).toContain(getPrettyDate(EDITED, 'de'));
    expect(de).not.toContain(getPrettyDate(EDITED, 'en'));
  });

  // KAN-286. The word used to be glued in front of the date in code, so no
  // locale could put the date first.
  test('ja puts the date first', async () => {
    const group = build({ contentModified: EDITED });
    const ja = await tFor('ja');

    expect(sessionDateLabel(group, 'edited', 'ja', ja)).toBe(
      `${getPrettyDate(EDITED, 'ja')}に編集`
    );
  });

  test('zh reads 编辑于 <date>', async () => {
    const group = build({ contentModified: EDITED });
    const zh = await tFor('zh');

    expect(sessionDateLabel(group, 'edited', 'zh', zh)).toBe(
      `编辑于 ${getPrettyDate(EDITED, 'zh')}`
    );
  });
});
