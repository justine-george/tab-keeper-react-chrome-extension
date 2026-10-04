import { describe, expect, test } from 'vitest';

import { buildSession } from '../fixtures/sessionFixture';
import {
  applyExportEdits,
  countExportEdits,
  exportRowKey,
  NO_EXPORT_EDITS,
  type ExportEdits,
} from '../../utils/functions/sessionExportEdits';
import {
  sessionToHtml,
  sessionToLinkList,
  type SessionExportOptions,
} from '../../utils/functions/sessionExportHtml';
import type {
  tabData,
  windowGroupData,
} from '../../redux/slices/tabContainerDataStateSlice';

// Edits apply to a copy, never the store, and one function feeds every
// generator so the outputs cannot disagree about what was hidden.

const tab = (tabId: string, overrides: Partial<tabData> = {}): tabData => ({
  tabId,
  favicon: '',
  title: `Tab ${tabId}`,
  url: `https://${tabId}.example/`,
  ...overrides,
});

const win = (
  windowId: string,
  tabs: tabData[],
  overrides: Partial<windowGroupData> = {}
): windowGroupData => ({
  windowId,
  windowHeight: 1080,
  windowWidth: 1920,
  windowOffsetTop: 0,
  windowOffsetLeft: 0,
  tabCount: tabs.length,
  title: `Window ${windowId}`,
  tabs,
  ...overrides,
});

// The first window's Chrome group sits between loose tabs, the shape every rule
// must survive.
const W1 = win(
  'w1',
  [
    tab('a', { title: 'Order Details - Apple' }),
    tab('b', { chromeGroupId: 'g1' }),
    tab('c', { chromeGroupId: 'g1' }),
    tab('d'),
  ],
  {
    title: 'Planning',
    chromeTabGroups: [{ groupId: 'g1', title: 'Flights', color: 'blue' }],
  }
);
const W2 = win('w2', [tab('e'), tab('f')], { title: 'Reading' });

const SESSION = buildSession({
  title: 'Weekend in Kyoto',
  windowCount: 2,
  tabCount: 6,
  windows: [W1, W2],
});

const edits = (partial: Partial<ExportEdits>): ExportEdits => ({
  ...NO_EXPORT_EDITS,
  ...partial,
});

const tabIds = (session: typeof SESSION) =>
  session.windows.map((w) => w.tabs.map((t) => t.tabId));

const OPTIONS: SessionExportOptions = {
  layout: 'compact',
  scheme: 'light',
  dateLabel: 'Sep 10, 2026',
  countsLabel: '2 Windows · 6 Tabs',
  tabCountLabel: (count) => `${count} Tabs`,
  strings: {
    window: 'Window',
    notAWebLink: 'not a web link',
    savedWith: 'Saved with {{brand}} on {{date}}',
    getExtension: 'Get the extension',
  },
  mark: 'data:image/png;base64,',
  storeUrl: 'https://store.example/',
  savedOn: 'Sep 15, 2026',
};

describe('applying export edits (KAN-194)', () => {
  test('with no edits, the session comes back as it was', () => {
    expect(applyExportEdits(SESSION, NO_EXPORT_EDITS)).toEqual(SESSION);
    expect(countExportEdits(SESSION, NO_EXPORT_EDITS)).toEqual({
      renamed: 0,
      hiddenTabs: 0,
    });
  });

  test('every kind of title can be renamed: session, window, group, tab', () => {
    const result = applyExportEdits(
      SESSION,
      edits({
        titles: {
          [exportRowKey.session()]: 'Kyoto links',
          [exportRowKey.window(W1)]: 'Getting there',
          [exportRowKey.group(W1, 'g1')]: 'Trains',
          [exportRowKey.tab(W2, 'e')]: 'Temple guide',
        },
      })
    );

    expect(result.title).toBe('Kyoto links');
    expect(result.windows[0].title).toBe('Getting there');
    expect(result.windows[0].chromeTabGroups?.[0].title).toBe('Trains');
    expect(result.windows[1].tabs[0].title).toBe('Temple guide');
    // CONTROL: only the named rows changed.
    expect(result.windows[1].title).toBe('Reading');
    expect(result.windows[1].tabs[1].title).toBe('Tab f');
  });

  // Export edits never blank a session or window (KAN-84), though the popup lets a window go blank; a tab or group can be.
  test('a cleared session or window title keeps its name; a cleared tab or group title is blank', () => {
    const result = applyExportEdits(
      SESSION,
      edits({
        titles: {
          [exportRowKey.session()]: '   ',
          [exportRowKey.window(W1)]: '',
          [exportRowKey.group(W1, 'g1')]: '',
          [exportRowKey.tab(W1, 'd')]: '',
        },
      })
    );

    expect(result.title).toBe('Weekend in Kyoto');
    expect(result.windows[0].title).toBe('Planning');
    expect(result.windows[0].chromeTabGroups?.[0].title).toBe('');
    expect(result.windows[0].tabs[3].title).toBe('');
    expect(
      sessionToLinkList(result, {
        window: OPTIONS.strings.window,
        tabCountLabel: OPTIONS.tabCountLabel,
        countsLabel: OPTIONS.countsLabel,
        locale: 'en',
      })
    ).toContain('https://d.example/');
  });

  test('a hidden tab is left out, and the counts follow', () => {
    const result = applyExportEdits(
      SESSION,
      edits({ hidden: new Set([exportRowKey.tab(W1, 'a')]) })
    );

    expect(tabIds(result)).toEqual([
      ['b', 'c', 'd'],
      ['e', 'f'],
    ]);
    expect(result.windows[0].tabCount).toBe(3);
    expect(result.tabCount).toBe(5);
    expect(result.windowCount).toBe(2);
  });

  test('hiding a group leaves out its tabs and the group itself', () => {
    const result = applyExportEdits(
      SESSION,
      edits({ hidden: new Set([exportRowKey.group(W1, 'g1')]) })
    );

    expect(tabIds(result)[0]).toEqual(['a', 'd']);
    expect(result.windows[0].chromeTabGroups ?? []).toEqual([]);
    expect(result.tabCount).toBe(4);
  });

  test('a group whose every tab is hidden is not printed as an empty band', () => {
    const result = applyExportEdits(
      SESSION,
      edits({
        hidden: new Set([exportRowKey.tab(W1, 'b'), exportRowKey.tab(W1, 'c')]),
      })
    );

    // The HTML alone can't fail: the renderer never draws a group without tabs.
    expect(result.windows[0].chromeTabGroups ?? []).toEqual([]);
    expect(sessionToHtml(result, OPTIONS)).not.toContain('Flights');
  });

  test('a hidden window is left out, and the next one becomes Window 1', () => {
    const result = applyExportEdits(
      SESSION,
      edits({ hidden: new Set([exportRowKey.window(W1)]) })
    );

    expect(result.windows.map((w) => w.windowId)).toEqual(['w2']);
    expect(result.windowCount).toBe(1);
    expect(result.tabCount).toBe(2);
    expect(sessionToHtml(result, OPTIONS)).toContain('Window 1 · Reading');
  });

  test('a window whose every tab is hidden is left out', () => {
    const result = applyExportEdits(
      SESSION,
      edits({
        hidden: new Set([exportRowKey.tab(W2, 'e'), exportRowKey.tab(W2, 'f')]),
      })
    );

    expect(result.windows.map((w) => w.windowId)).toEqual(['w1']);
    expect(result.windowCount).toBe(1);
  });

  // An import or a merge can repeat a uuid across windows.
  test('the same tab id in two windows is two rows', () => {
    const twin = buildSession({
      windows: [win('w1', [tab('x')]), win('w2', [tab('x')])],
    });

    const result = applyExportEdits(
      twin,
      edits({
        hidden: new Set([exportRowKey.tab(twin.windows[0], 'x')]),
        titles: { [exportRowKey.tab(twin.windows[1], 'x')]: 'Kept' },
      })
    );

    expect(result.windows.map((w) => w.windowId)).toEqual(['w2']);
    expect(result.windows[0].tabs[0].title).toBe('Kept');
  });

  // A sync or popup edit can remove a row while the page is open.
  test('edits naming rows that do not exist are ignored', () => {
    const stale = edits({
      titles: { [exportRowKey.tab(W1, 'gone')]: 'Old' },
      hidden: new Set(['tab:w9:zz']),
    });

    expect(applyExportEdits(SESSION, stale)).toEqual(SESSION);
    expect(countExportEdits(SESSION, stale)).toEqual({
      renamed: 0,
      hiddenTabs: 0,
    });
  });

  test('the saved session is never modified', () => {
    const before = structuredClone(SESSION);

    applyExportEdits(
      SESSION,
      edits({
        titles: {
          [exportRowKey.session()]: 'Changed',
          [exportRowKey.tab(W1, 'a')]: 'Changed',
        },
        hidden: new Set([exportRowKey.group(W1, 'g1')]),
      })
    );

    expect(SESSION).toEqual(before);
  });
});

describe('the tally shown while editing (KAN-194)', () => {
  test('counts renamed rows and every tab left out, however it was hidden', () => {
    const tally = countExportEdits(
      SESSION,
      edits({
        titles: {
          [exportRowKey.session()]: 'Kyoto links',
          [exportRowKey.tab(W1, 'd')]: 'Renamed',
        },
        hidden: new Set([
          exportRowKey.group(W1, 'g1'),
          exportRowKey.tab(W2, 'f'),
        ]),
      })
    );

    // Group g1 takes two tabs with it, plus f.
    expect(tally).toEqual({ renamed: 2, hiddenTabs: 3 });
  });

  test('a title typed back to what it was is not a rename', () => {
    expect(
      countExportEdits(
        SESSION,
        edits({
          titles: {
            [exportRowKey.window(W1)]: 'Planning',
            [exportRowKey.tab(W1, 'a')]: 'Order Details - Apple',
          },
        })
      ).renamed
    ).toBe(0);
  });

  // The file never draws a group with no tabs, so its rename is not in the
  // file.
  test('a renamed group whose tabs are all hidden is not counted as renamed', () => {
    expect(
      countExportEdits(
        SESSION,
        edits({
          titles: { [exportRowKey.group(W1, 'g1')]: 'Trains' },
          hidden: new Set([
            exportRowKey.tab(W1, 'b'),
            exportRowKey.tab(W1, 'c'),
          ]),
        })
      )
    ).toEqual({ renamed: 0, hiddenTabs: 2 });
  });

  // The tally describes the file, which carries no rename for a hidden row.
  test('a renamed row that is also hidden is counted as hidden, not renamed', () => {
    expect(
      countExportEdits(
        SESSION,
        edits({
          titles: { [exportRowKey.tab(W2, 'e')]: 'Renamed' },
          hidden: new Set([exportRowKey.tab(W2, 'e')]),
        })
      )
    ).toEqual({ renamed: 0, hiddenTabs: 1 });
  });
});
