import { describe, expect, test } from 'vitest';

import { buildSession } from '../fixtures/sessionFixture';
import {
  sessionToHtml,
  tidySessionForExport,
  type SessionExportOptions,
} from '../../utils/functions/sessionExportHtml';
import type {
  tabData,
  windowGroupData,
} from '../../redux/slices/tabContainerDataStateSlice';

// KAN-202. KAN-195 added two clean-ups and I scoped them to Copy alone, so the
// document people actually share still carried "(3)" in front of titles and
// the tab-suspender's chrome-extension:// wrapper instead of the address it
// stands for. The session is tidied ONCE, when the page loads it, so the
// editor, the preview, the saved file, the PDF and both clipboard versions
// show the same text -- and an explicit rename still wins over it.

const tab = (overrides: Partial<tabData> = {}): tabData => ({
  tabId: 't',
  favicon: '',
  title: 'Example Domain',
  url: 'https://example.com/',
  ...overrides,
});

const window = (tabs: tabData[]): windowGroupData => ({
  windowId: 'w',
  windowHeight: 1080,
  windowWidth: 1920,
  windowOffsetTop: 0,
  windowOffsetLeft: 0,
  tabCount: tabs.length,
  title: 'One window',
  tabs,
});

const SUSPENDED =
  'chrome-extension://laameccjpleogmfhilmffpdbiibgbekf/suspended.html?title=Extensions&url=chrome%3A%2F%2Fextensions%2F&time=1';

const options = (): SessionExportOptions => ({
  layout: 'comfortable',
  scheme: 'light',
  dateLabel: 'Sep 10, 2026',
  countsLabel: '1 Window · 2 Tabs',
  tabCountLabel: (count) => `${count} Tabs`,
  strings: {
    window: 'Window',
    notAWebLink: 'not a web link',
    savedWith: '{{brand}} {{date}}',
    getExtension: 'Get the extension',
  },
  mark: 'data:image/png;base64,',
  storeUrl: 'https://store.example/',
  savedOn: 'Sep 15, 2026',
});

describe('tidying a session for export (KAN-202)', () => {
  test('a leading notification count is dropped from a tab title', () => {
    const tidy = tidySessionForExport(
      buildSession({
        windows: [window([tab({ title: '(3) Rive on X: "GPU Canvas"' })])],
      })
    );

    expect(tidy.windows[0].tabs[0].title).toBe('Rive on X: "GPU Canvas"');
  });

  test('a suspended tab carries the address it stands for', () => {
    const tidy = tidySessionForExport(
      buildSession({
        windows: [window([tab({ title: 'Extensions', url: SUSPENDED })])],
      })
    );

    expect(tidy.windows[0].tabs[0].url).toBe('chrome://extensions/');
  });

  // The guards of both clean-ups still hold, and nothing else is touched: no
  // deduplication, no tracking parameters stripped, no site suffix trimmed.
  test('everything else is left exactly as saved', () => {
    const session = buildSession({
      title: '(2) My session',
      windows: [
        {
          ...window([
            tab({ title: '(2024) Annual report', url: 'https://one.example/' }),
            tab({
              title: 'Kyoto restaurants – Eater',
              url: 'https://www.eater.com/kyoto?utm_source=x',
            }),
            tab({ title: 'Duplicate', url: 'https://one.example/' }),
          ]),
          title: '(1) Window kept as named',
          chromeTabGroups: [
            { groupId: 'g', title: '(4) Twitter', color: 'blue' },
          ],
        },
      ],
    });

    const tidy = tidySessionForExport(session);

    expect(tidy.title, "the session name is the user's own").toBe(
      '(2) My session'
    );
    expect(tidy.windows[0].title).toBe('(1) Window kept as named');
    expect(tidy.windows[0].chromeTabGroups?.[0].title).toBe('(4) Twitter');
    expect(tidy.windows[0].tabs.map((t) => t.title)).toEqual([
      '(2024) Annual report',
      'Kyoto restaurants – Eater',
      'Duplicate',
    ]);
    expect(tidy.windows[0].tabs.map((t) => t.url)).toEqual([
      'https://one.example/',
      'https://www.eater.com/kyoto?utm_source=x',
      'https://one.example/',
    ]);
  });

  test('the saved session is not modified', () => {
    const session = buildSession({
      windows: [window([tab({ title: '(3) Counted', url: SUSPENDED })])],
    });
    const before = structuredClone(session);

    tidySessionForExport(session);

    expect(session).toEqual(before);
  });

  test('tidying twice changes nothing more', () => {
    const once = tidySessionForExport(
      buildSession({
        windows: [window([tab({ title: '(3) Counted', url: SUSPENDED })])],
      })
    );

    expect(tidySessionForExport(once)).toEqual(once);
  });

  // What the ticket is about: the file itself.
  test('the file built from a tidied session carries neither', () => {
    const html = sessionToHtml(
      tidySessionForExport(
        buildSession({
          windows: [
            window([
              tab({ title: '(3) Rive on X', url: 'https://x.example/rive' }),
              tab({ title: 'Extensions', url: SUSPENDED }),
            ]),
          ],
        })
      ),
      options()
    );

    expect(html).toContain('>Rive on X</a>');
    expect(html).not.toContain('(3) Rive');
    expect(html).toContain('chrome://extensions/');
    expect(html).not.toContain('chrome-extension://');
  });
});
