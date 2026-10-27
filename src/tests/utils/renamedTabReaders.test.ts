import { describe, expect, test } from 'vitest';

import { buildSession } from '../fixtures/sessionFixture';
import {
  groupLinkScope,
  scopeToLinkList,
  sessionToLinkList,
  tidySessionForExport,
  windowLinkScope,
  type LinkListStrings,
} from '../../utils/functions/sessionExportHtml';
import {
  applyExportEdits,
  countExportEdits,
  exportRowKey,
} from '../../utils/functions/sessionExportEdits';
import { filterTabGroups } from '../../utils/functions/local';
import { titleOfPick } from '../../utils/functions/newSessionTitle';
import { tabsToCopy } from '../../utils/functions/liveCopy';
import type {
  tabData,
  windowGroupData,
} from '../../redux/slices/tabContainerDataStateSlice';

// KAN-824. Every reader that prints a tab's name prints the one the user sees.
// A custom name is the user's words: never tidied (as KAN-210 refuses for typed names).

const RENAMED: tabData = {
  tabId: 'r',
  favicon: '',
  title: 'Alex Jo on X: "Sync is hard" / X',
  url: 'https://x.com/alexjo/1',
  customTitle: '(3) Meeting notes',
  chromeGroupId: 'g',
};
const COUNTED: tabData = {
  tabId: 'c',
  favicon: '',
  title: '(3) Inbox',
  url: 'https://mail.test/',
};

const win = (tabs: tabData[]): windowGroupData => ({
  windowId: 'w',
  windowHeight: 1080,
  windowWidth: 1920,
  windowOffsetTop: 0,
  windowOffsetLeft: 0,
  tabCount: tabs.length,
  title: '',
  chromeTabGroups: [{ groupId: 'g', title: 'Work', color: 'blue' }],
  tabs,
});
const SESSION = buildSession({
  title: 'Mine',
  windows: [win([RENAMED, COUNTED])],
});

const strings: LinkListStrings = {
  window: 'Window',
  tabCountLabel: (count) => `${count} ${count === 1 ? 'Tab' : 'Tabs'}`,
  countsLabel: '1 Window · 2 Tabs',
  locale: 'en',
};

describe('the export and copied links (KAN-824)', () => {
  test('tidying shows the custom name verbatim and still tidies page titles', () => {
    const [renamed, counted] = tidySessionForExport(SESSION).windows[0].tabs;
    expect(renamed.title).toBe('(3) Meeting notes');
    expect(renamed).not.toHaveProperty('customTitle');
    expect(counted.title).toBe('Inbox');
  });

  test('Copy all links prints the custom name', () => {
    const text = sessionToLinkList(tidySessionForExport(SESSION), strings);
    expect(text).toContain('- (3) Meeting notes');
    expect(text).not.toContain('Alex Jo');
    expect(text).toContain('- Inbox');
  });

  test("a window's and a group's copied links print the custom name", () => {
    expect(
      scopeToLinkList(windowLinkScope('W', win([RENAMED])), strings)
    ).toContain('(3) Meeting notes');
    expect(
      scopeToLinkList(groupLinkScope('Work', win([RENAMED]), 'g'), strings)
    ).toContain('(3) Meeting notes');
  });

  test('the export editor starts from the shown name: leaving it is no rename', () => {
    const tidied = tidySessionForExport(SESSION);
    const key = exportRowKey.tab(tidied.windows[0], 'r');
    const edits = {
      titles: { [key]: '(3) Meeting notes' },
      hidden: new Set<string>(),
    };
    expect(countExportEdits(tidied, edits).renamed).toBe(0);
  });

  test('an export-only edit layers on top of the custom name, for that export', () => {
    const tidied = tidySessionForExport(SESSION);
    const key = exportRowKey.tab(tidied.windows[0], 'r');
    const edited = applyExportEdits(tidied, {
      titles: { [key]: 'For the team' },
      hidden: new Set(),
    });
    expect(edited.windows[0].tabs[0].title).toBe('For the team');
    expect(edited.windows[0].tabs[0]).not.toHaveProperty('customTitle');
    // The session itself is untouched.
    expect(SESSION.windows[0].tabs[0].customTitle).toBe('(3) Meeting notes');
  });
});

describe('search (KAN-824)', () => {
  const groups = [
    buildSession({ title: 'Mine', windows: [win([RENAMED, COUNTED])] }),
  ];
  const found = (term: string) =>
    filterTabGroups(term, groups, true).flatMap((g) =>
      g.windows.flatMap((w) => w.tabs.map((t) => t.tabId))
    );

  test('finds a renamed tab by its own name', () => {
    expect(found('meeting')).toEqual(['r']);
  });

  test('finds it by its page title too', () => {
    expect(found('alex')).toEqual(['r']);
  });
});

describe('a new session named from a moved tab (KAN-824)', () => {
  test('a renamed tab gives its own name', () => {
    expect(
      titleOfPick(win([RENAMED]), { kind: 'tab', windowId: 'w', tabId: 'r' })
    ).toBe('(3) Meeting notes');
  });

  test("an unnamed window falls back to its first tab's shown name", () => {
    expect(
      titleOfPick(win([RENAMED, COUNTED]), { kind: 'window', windowId: 'w' })
    ).toBe('(3) Meeting notes');
  });

  test("an unnamed group falls back to its first tab's shown name", () => {
    const unnamed = {
      ...win([RENAMED]),
      chromeTabGroups: [{ groupId: 'g', title: '', color: 'blue' as const }],
    };
    expect(
      titleOfPick(unnamed, { kind: 'group', windowId: 'w', groupId: 'g' })
    ).toBe('(3) Meeting notes');
  });
});

describe('a copy of a renamed tab (KAN-824 spec 10)', () => {
  test('keeps its name', () => {
    const copied = tabsToCopy(win([RENAMED]), {
      kind: 'tab',
      windowId: 'w',
      tabId: 'r',
    });
    expect(copied?.tabs[0].customTitle).toBe('(3) Meeting notes');
  });
});
