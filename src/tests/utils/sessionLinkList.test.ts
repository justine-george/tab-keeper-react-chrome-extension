import { describe, expect, test } from 'vitest';

import { buildSession } from '../fixtures/sessionFixture';
import {
  dropNotificationCount,
  sessionToLinkHtml,
  sessionToLinkList,
  tidySessionForExport,
  unwrapSuspendedUrl,
  type LinkListStrings,
} from '../../utils/functions/sessionExportHtml';
import type {
  tabData,
  windowGroupData,
} from '../../redux/slices/tabContainerDataStateSlice';

// KAN-190 made "Copy all links" readable: the session, a block per window, a
// "Title (URL)" line per tab. On a real 47-tab session it was not (KAN-195):
// a tweet-length title and its URL fused into one paragraph, Chrome groups
// vanished, suspended tabs copied as chrome-extension:// wrappers, and titles
// carried notification counts like "(3)".
//
// Picked from a mock built on that session: the clipboard carries a RICH list
// for editors that read HTML and a PLAIN layout for everything else, and both
// get two clean-ups.

const tab = (overrides: Partial<tabData> = {}): tabData => ({
  tabId: 't',
  favicon: '',
  title: 'Example Domain',
  url: 'https://example.com/',
  ...overrides,
});

const window = (
  title: string,
  tabs: tabData[],
  overrides: Partial<windowGroupData> = {}
): windowGroupData => ({
  windowId: 'w-' + title,
  windowHeight: 1080,
  windowWidth: 1920,
  windowOffsetTop: 0,
  windowOffsetLeft: 0,
  tabCount: tabs.length,
  title,
  tabs,
  ...overrides,
});

const strings: LinkListStrings = {
  window: 'Window',
  tabCountLabel: (count) => `${count} ${count === 1 ? 'Tab' : 'Tabs'}`,
  countsLabel: '2 Windows · 4 Tabs',
  locale: 'en',
};

// A loose tab, a Chrome group of two, and a second window: the shape every
// layout rule below has to hold.
const KYOTO = buildSession({
  title: 'Weekend in Kyoto',
  windows: [
    window(
      'Trip planning',
      [
        tab({
          tabId: 'a',
          title: 'Nozomi timetable',
          url: 'https://jr.example/nozomi',
        }),
        tab({
          tabId: 'b',
          title: 'Haruka',
          url: 'https://haruka.example/',
          chromeGroupId: 'g',
        }),
        tab({
          tabId: 'c',
          title: 'Airport bus',
          url: 'https://bus.example/',
          chromeGroupId: 'g',
        }),
      ],
      { chromeTabGroups: [{ groupId: 'g', title: 'Flights', color: 'blue' }] }
    ),
    window('Food', [
      tab({
        tabId: 'd',
        title: 'Nishiki Market',
        url: 'https://nishiki.example/',
      }),
    ]),
  ],
});

describe('the plain text on the clipboard (KAN-195)', () => {
  // A tab starts with a dash on its own line and its URL sits indented under
  // it, so a title of any length wraps without swallowing the link.
  test('each tab is a dash and its title, with its URL on the next line; groups and windows are blocks', () => {
    expect(sessionToLinkList(KYOTO, strings)).toBe(
      [
        'Weekend in Kyoto',
        '2 Windows · 4 Tabs',
        '',
        'WINDOW 1 · Trip planning (3 Tabs)',
        '- Nozomi timetable',
        '  https://jr.example/nozomi',
        '',
        '  Flights (2 Tabs)',
        '    - Haruka',
        '      https://haruka.example/',
        '    - Airport bus',
        '      https://bus.example/',
        '',
        'WINDOW 2 · Food (1 Tab)',
        '- Nishiki Market',
        '  https://nishiki.example/',
      ].join('\n')
    );
  });

  // Only the LABEL is cased, and by the locale: a window title is the user's
  // own words and keeps its case.
  test('the window label is upper-cased for the locale, the window title is not', () => {
    const text = sessionToLinkList(
      buildSession({ windows: [window('Reise nach Kyoto', [tab()])] }),
      { ...strings, window: 'Fenster', locale: 'de' }
    );

    expect(text).toContain('FENSTER 1 · Reise nach Kyoto (1 Tab)');
  });

  test('a loose tab after a group starts its own line again, after a blank line', () => {
    const text = sessionToLinkList(
      buildSession({
        windows: [
          window(
            'W',
            [
              tab({ tabId: 'b', title: 'In group', chromeGroupId: 'g' }),
              tab({
                tabId: 'c',
                title: 'Loose',
                url: 'https://loose.example/',
              }),
            ],
            { chromeTabGroups: [{ groupId: 'g', title: 'G', color: 'red' }] }
          ),
        ],
      }),
      strings
    );

    expect(text).toContain(
      '    - In group\n      https://example.com/\n\n- Loose\n  https://loose.example/'
    );
    expect(text).not.toMatch(/\n\n\n/);
  });

  // An unnamed group is a real Chrome state; its heading is its size alone,
  // not an empty name followed by brackets.
  test('an unnamed group is headed by its tab count', () => {
    const text = sessionToLinkList(
      buildSession({
        windows: [
          window('W', [tab({ chromeGroupId: 'g' })], {
            chromeTabGroups: [{ groupId: 'g', title: '', color: 'grey' }],
          }),
        ],
      }),
      strings
    );

    expect(text).toContain('\n  1 Tab\n    - Example Domain');
  });

  // Carried over from KAN-190: the file's rule, a tab with no title is named
  // by its URL, and that URL is not then printed a second time.
  test('a tab with no title is named by its URL, once', () => {
    const text = sessionToLinkList(
      buildSession({
        windows: [
          window('W', [
            tab({ title: '', url: 'https://nameless.example/page' }),
          ]),
        ],
      }),
      strings
    );

    expect(text).toContain('- https://nameless.example/page');
    expect(text.split('https://nameless.example/page')).toHaveLength(2);
  });

  // Carried over from KAN-190: this is text, so a chrome:// tab is kept.
  test('a chrome:// tab is kept, because text is not a link', () => {
    const text = sessionToLinkList(
      buildSession({
        windows: [
          window('W', [
            tab({ title: 'Settings', url: 'chrome://settings/downloads' }),
          ]),
        ],
      }),
      strings
    );

    expect(text).toContain('- Settings\n  chrome://settings/downloads');
  });
});

describe('the rich list on the clipboard (KAN-195)', () => {
  test('windows are bold headings, groups nested lists, and each tab a link on its title', () => {
    expect(sessionToLinkHtml(KYOTO, strings)).toBe(
      '<h3>Weekend in Kyoto</h3>' +
        '<p>2 Windows · 4 Tabs</p>' +
        '<p><b>Window 1 · Trip planning</b> (3 Tabs)</p>' +
        '<ul>' +
        '<li><a href="https://jr.example/nozomi">Nozomi timetable</a></li>' +
        '<li><b>Flights</b> (2 Tabs)<ul>' +
        '<li><a href="https://haruka.example/">Haruka</a></li>' +
        '<li><a href="https://bus.example/">Airport bus</a></li>' +
        '</ul></li>' +
        '</ul>' +
        '<p><b>Window 2 · Food</b> (1 Tab)</p>' +
        '<ul><li><a href="https://nishiki.example/">Nishiki Market</a></li></ul>'
    );
  });

  // Pasted into someone else's email, a link is something they will click. A
  // saved javascript: or chrome:// address must never become one; it stays
  // readable text, as the exported file already treats it.
  test('only web addresses become links; anything else stays text', () => {
    const html = sessionToLinkHtml(
      buildSession({
        windows: [
          window('W', [
            tab({ title: 'Settings', url: 'chrome://settings/downloads' }),
            tab({ title: 'Trap', url: 'javascript:alert(1)' }),
          ]),
        ],
      }),
      strings
    );

    expect(html).not.toContain('href="chrome:');
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain('<li>Settings (chrome://settings/downloads)</li>');
    expect(html).toContain('<li>Trap (javascript:alert(1))</li>');
  });

  test('titles and addresses are escaped', () => {
    const html = sessionToLinkHtml(
      buildSession({
        title: 'A <b> & "quoted"',
        windows: [
          window('W<i>', [
            tab({
              title: '<img src=x onerror=alert(1)>',
              url: 'https://x.example/?a=1&b="2"',
            }),
          ]),
        ],
      }),
      strings
    );

    expect(html).toContain('<h3>A &lt;b&gt; &amp; &quot;quoted&quot;</h3>');
    expect(html).toContain('Window 1 · W&lt;i&gt;');
    expect(html).toContain(
      '<a href="https://x.example/?a=1&amp;b=&quot;2&quot;">&lt;img src=x onerror=alert(1)&gt;</a>'
    );
    expect(html).not.toContain('<img');
  });

  test('a tab with no title links its URL as the text', () => {
    const html = sessionToLinkHtml(
      buildSession({
        windows: [
          window('W', [tab({ title: '', url: 'https://nameless.example/' })]),
        ],
      }),
      strings
    );

    expect(html).toContain(
      '<a href="https://nameless.example/">https://nameless.example/</a>'
    );
  });
});

describe('unwrapping a suspended tab (KAN-195)', () => {
  test('the query form carries the real address in url=', () => {
    expect(
      unwrapSuspendedUrl(
        'chrome-extension://laameccjpleogmfhilmffpdbiibgbekf/suspended.html?title=Extensions&url=chrome%3A%2F%2Fextensions%2F&time=1789103928026'
      )
    ).toBe('chrome://extensions/');
    expect(
      unwrapSuspendedUrl(
        'chrome-extension://laameccjpleogmfhilmffpdbiibgbekf/suspended.html?title=Settings&url=chrome%3A%2F%2Fsettings%2F%3Fsearch%3Dzoom&time=1788746910025'
      )
    ).toBe('chrome://settings/?search=zoom');
  });

  // The Marvellous Suspender form: uri= comes last in the hash, unencoded, so
  // an & inside the address belongs to the address.
  test('the hash form carries it, unencoded, in a trailing uri=', () => {
    expect(
      unwrapSuspendedUrl(
        'chrome-extension://noogafoofpebimajpfpamcfhoaifemoa/suspended.html#ttl=Example&pos=0&uri=https://example.com/a?b=1&c=2'
      )
    ).toBe('https://example.com/a?b=1&c=2');
  });

  test('anything that is not a suspended-tab wrapper is left alone', () => {
    const untouched = [
      // Another extension's own page that happens to take a url parameter.
      'chrome-extension://abcdefghijklmnop/reader.html?url=https%3A%2F%2Fexample.com%2F',
      // A web page with a url parameter.
      'https://example.com/redirect?url=https%3A%2F%2Fother.example%2F',
      // A suspended page with nothing to unwrap, or nothing that parses.
      'chrome-extension://abcdefghijklmnop/suspended.html?title=Gone',
      'chrome-extension://abcdefghijklmnop/suspended.html?url=not%20a%20url',
      'not a url at all',
    ];
    for (const url of untouched) expect(unwrapSuspendedUrl(url)).toBe(url);
  });
});

describe('dropping a notification count (KAN-195)', () => {
  test('a leading (N) or (N+) is dropped', () => {
    expect(dropNotificationCount('(3) @levelsio on X')).toBe('@levelsio on X');
    expect(dropNotificationCount('(1) Rive on X: "GPU Canvas"')).toBe(
      'Rive on X: "GPU Canvas"'
    );
    expect(dropNotificationCount('(20+) Inbox')).toBe('Inbox');
  });

  test('a year, a count inside the title, or a count that is the whole title stays', () => {
    for (const title of [
      '(2024) Annual report',
      'Draft (3) of the plan',
      '(1)',
      '(1)NoSpace',
      '(abc) Letters',
    ]) {
      expect(dropNotificationCount(title)).toBe(title);
    }
  });
});

// KAN-202. The clean-ups moved to one step, run where the page loads the
// session, so these feed the builders what the page feeds them.
describe('both clipboard versions get the clean-ups (KAN-195)', () => {
  const SUSPENDED = buildSession({
    windows: [
      window('W', [
        tab({ title: '(3) @levelsio on X', url: 'https://x.example/levelsio' }),
        tab({
          title: 'Extensions',
          url: 'chrome-extension://laameccjpleogmfhilmffpdbiibgbekf/suspended.html?title=Extensions&url=chrome%3A%2F%2Fextensions%2F&time=1',
        }),
        tab({
          title: '',
          url: 'chrome-extension://laameccjpleogmfhilmffpdbiibgbekf/suspended.html?url=https%3A%2F%2Fsleeping.example%2F',
        }),
      ]),
    ],
  });

  test('the plain text', () => {
    const text = sessionToLinkList(tidySessionForExport(SUSPENDED), strings);

    expect(text).toContain('- @levelsio on X\n  https://x.example/levelsio');
    expect(text).toContain('- Extensions\n  chrome://extensions/');
    // A titleless suspended tab is named by its REAL address, once.
    expect(text).toContain('- https://sleeping.example/');
    expect(text.split('https://sleeping.example/')).toHaveLength(2);
    expect(text).not.toContain('chrome-extension://');
    expect(text).not.toContain('(3)');
  });

  test('the rich list', () => {
    const html = sessionToLinkHtml(tidySessionForExport(SUSPENDED), strings);

    expect(html).toContain('>@levelsio on X</a>');
    // Unwrapped to a web address, a sleeping tab becomes a real link.
    expect(html).toContain(
      '<a href="https://sleeping.example/">https://sleeping.example/</a>'
    );
    expect(html).toContain('<li>Extensions (chrome://extensions/)</li>');
    expect(html).not.toContain('chrome-extension://');
  });
});
