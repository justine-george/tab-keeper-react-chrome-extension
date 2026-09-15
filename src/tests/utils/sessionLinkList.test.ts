import { describe, expect, test } from 'vitest';

import { buildSession } from '../fixtures/sessionFixture';
import { sessionToLinkList } from '../../utils/functions/sessionExportHtml';
import type { tabData } from '../../redux/slices/tabContainerDataStateSlice';

// KAN-190. "Copy all links" pasted a bare wall of URLs, which is unreadable
// the moment there is more than one window: no titles, no seams, no way to
// tell where one window ended.
//
// What is pasted now is what a person would write out by hand: the session,
// then each window as a block, a tab per line as "Title (url)", and a blank
// line between windows.

const tab = (overrides: Partial<tabData> = {}): tabData => ({
  tabId: 't',
  favicon: '',
  title: 'Example Domain',
  url: 'https://example.com/',
  ...overrides,
});

const window = (title: string, tabs: tabData[]) => ({
  windowId: 'w-' + title,
  windowHeight: 1080,
  windowWidth: 1920,
  windowOffsetTop: 0,
  windowOffsetLeft: 0,
  tabCount: tabs.length,
  title,
  tabs,
});

const strings = {
  window: 'Window',
  tabCountLabel: (count: number) => `${count} Tabs`,
};

describe('the text put on the clipboard (KAN-190)', () => {
  test('each tab is one line carrying its title and its URL', () => {
    const session = buildSession({
      title: 'Weekend in Kyoto',
      windows: [
        window('Trip planning', [
          tab({ title: 'Nozomi timetable', url: 'https://jr.example/nozomi' }),
        ]),
      ],
    });

    const text = sessionToLinkList(session, strings);

    expect(text).toContain('Nozomi timetable (https://jr.example/nozomi)');
  });

  test('windows are separated by a blank line, under their own heading', () => {
    const session = buildSession({
      title: 'Weekend in Kyoto',
      windows: [
        window('Trip planning', [
          tab({ title: 'First', url: 'https://one.example/' }),
        ]),
        window('Food', [tab({ title: 'Second', url: 'https://two.example/' })]),
      ],
    });

    const text = sessionToLinkList(session, strings);

    expect(text).toBe(
      [
        'Weekend in Kyoto',
        '',
        'Window 1 · Trip planning (1 Tabs)',
        'First (https://one.example/)',
        '',
        'Window 2 · Food (1 Tabs)',
        'Second (https://two.example/)',
      ].join('\n')
    );
  });

  // The same rule the file follows: a tab with no title is named by its URL,
  // so no line is blank or reads as "( https://... )".
  test('a tab with no title is named by its URL, and not repeated twice', () => {
    const session = buildSession({
      windows: [
        window('One window', [
          tab({ title: '', url: 'https://nameless.example/page' }),
        ]),
      ],
    });

    const text = sessionToLinkList(session, strings);

    expect(text).toContain('https://nameless.example/page');
    expect(text).not.toContain('()');
    expect(text).not.toContain(
      'https://nameless.example/page (https://nameless.example/page)'
    );
  });

  // Unlike the FILE, nothing here is a link, so a chrome:// tab is just a
  // line of text -- dropping it would lose part of what the user saved.
  test('a chrome:// tab is kept, because this is text and not a link', () => {
    const session = buildSession({
      windows: [
        window('One window', [
          tab({ title: 'Settings', url: 'chrome://settings/downloads' }),
        ]),
      ],
    });

    const text = sessionToLinkList(session, strings);

    expect(text).toContain('Settings (chrome://settings/downloads)');
  });
});
