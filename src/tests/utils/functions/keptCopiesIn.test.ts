import { describe, expect, test } from 'vitest';

import {
  duplicateTabsIn,
  keptCopiesIn,
} from '../../../utils/functions/duplicateTabs';

// KAN-996. The rows that light up after Remove duplicate tabs: the first copy
// of each address that loses a later one, inside the scope only.

const t = (tabId: string, url: string, chromeGroupId?: string) => ({
  tabId,
  favicon: '',
  title: tabId,
  url,
  ...(chromeGroupId === undefined ? {} : { chromeGroupId }),
});
const A = 'https://a.test/';
const B = 'https://b.test/';
const session = {
  windows: [
    {
      windowId: 'w1',
      tabs: [t('a1', A), t('b1', B), t('a2', A, 'g'), t('a3', A, 'g')],
    },
    { windowId: 'w2', tabs: [t('b2', B), t('n1', ''), t('n2', '')] },
  ],
};
const ids = (tabs: { tabId: string }[]) => tabs.map((x) => x.tabId);

describe('keptCopiesIn', () => {
  test('the session: the first a and the first b, once each, in reading order', () => {
    expect(ids(keptCopiesIn(session))).toEqual(['a1', 'b1']);
    expect(ids(duplicateTabsIn(session))).toEqual(['a2', 'a3', 'b2']);
  });

  test('a window: only its own tabs compete', () => {
    expect(ids(keptCopiesIn(session, { windowId: 'w1' }))).toEqual(['a1']);
    expect(ids(keptCopiesIn(session, { windowId: 'w2' }))).toEqual([]);
  });

  test('a group: its first copy, not the window’s', () => {
    expect(
      ids(keptCopiesIn(session, { windowId: 'w1', groupId: 'g' }))
    ).toEqual(['a2']);
  });

  test('a tab with no address is never a copy, so none is kept', () => {
    expect(ids(keptCopiesIn({ windows: [session.windows[1]] }))).toEqual([]);
  });
});
