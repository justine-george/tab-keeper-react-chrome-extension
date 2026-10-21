import { describe, expect, test } from 'vitest';

import { buildSession } from '../fixtures/sessionFixture';
import {
  EXPORT_PALETTE,
  exportFileName,
  sessionToHtml,
  type SessionExportOptions,
} from '../../utils/functions/sessionExportHtml';
import { contrast } from '../setup/contrast';
import type { tabData } from '../../redux/slices/tabContainerDataStateSlice';
import { TAB_GROUP_COLOR_HEX } from '../../utils/functions/tabGroups';

// KAN-190. The file is opened from file:// by strangers, so what becomes a
// link, what is escaped, and that nothing is fetched are asserted, not
// eyeballed. Writing it to disk is proven in e2e/session-export.spec.ts.

const MARK = 'data:image/png;base64,iVBORw0KGgo=';
const STORE =
  'https://chromewebstore.google.com/detail/tab-keeper/abc?ref=export';

const options = (
  overrides: Partial<SessionExportOptions> = {}
): SessionExportOptions => ({
  layout: 'comfortable',
  scheme: 'light',
  dateLabel: 'Created Sep 10, 2026, 9:48:00 PM',
  countsLabel: '2 Windows · 9 Tabs',
  tabCountLabel: (count) => `${count} Tabs`,
  strings: {
    window: 'Window',
    notAWebLink: 'not a web link',
    savedWith: 'Saved with {{brand}} on {{date}}',
    getExtension: 'Get the extension',
  },
  mark: MARK,
  storeUrl: STORE,
  savedOn: 'Sep 15, 2026',
  ...overrides,
});

const tab = (overrides: Partial<tabData> = {}): tabData => ({
  tabId: 'tab-1',
  favicon: '',
  title: 'Example Domain',
  url: 'https://example.com/',
  ...overrides,
});

/** Every href the document links to, in order. */
function hrefs(html: string): string[] {
  return [...html.matchAll(/<a[^>]+href="([^"]*)"/g)].map((m) => m[1]);
}

describe('the exported file lists a session as links (KAN-190)', () => {
  test('every tab becomes a link to its own URL, in the order the app shows', () => {
    const session = buildSession({
      windows: [
        {
          windowId: 'w-1',
          windowHeight: 1080,
          windowWidth: 1920,
          windowOffsetTop: 0,
          windowOffsetLeft: 0,
          tabCount: 3,
          title: 'Trip planning',
          tabs: [
            tab({ tabId: 't-1', title: 'First', url: 'https://one.example/' }),
            tab({ tabId: 't-2', title: 'Second', url: 'https://two.example/' }),
            tab({
              tabId: 't-3',
              title: 'Third',
              url: 'https://three.example/',
            }),
          ],
        },
      ],
    });

    const html = sessionToHtml(session, options());

    expect(hrefs(html).filter((h) => h !== STORE)).toEqual([
      'https://one.example/',
      'https://two.example/',
      'https://three.example/',
    ]);
    expect(html).toContain('First');
    expect(html).toContain('Third');
  });

  // Worst path: a javascript: or data: href would run when clicked; chrome://
  // cannot open from a page.
  test.each([
    ['chrome://settings/downloads'],
    ['javascript:alert(document.cookie)'],
    ['data:text/html,<script>alert(1)</script>'],
    ['file:///Users/someone/notes.txt'],
  ])('%s is shown as text, never as a link', (url) => {
    const session = buildSession({
      windows: [
        {
          windowId: 'w-1',
          windowHeight: 1080,
          windowWidth: 1920,
          windowOffsetTop: 0,
          windowOffsetLeft: 0,
          tabCount: 1,
          title: 'One window',
          tabs: [tab({ title: 'Settings', url })],
        },
      ],
    });

    const html = sessionToHtml(session, options());

    expect(hrefs(html).filter((h) => h !== STORE)).toEqual([]);
    expect(html).toContain('not a web link');
  });

  test('a hostile title cannot break out of the markup', () => {
    const session = buildSession({
      title: '</title><script>alert(1)</script>',
      windows: [
        {
          windowId: 'w-1',
          windowHeight: 1080,
          windowWidth: 1920,
          windowOffsetTop: 0,
          windowOffsetLeft: 0,
          tabCount: 1,
          title: 'Fish & chips <b>',
          tabs: [
            tab({
              title: '<img src=x onerror=alert(1)>',
              url: 'https://example.com/?a=1&b=2',
            }),
          ],
        },
      ],
    });

    const html = sessionToHtml(session, options());

    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('Fish &amp; chips &lt;b&gt;');
    expect(html).toContain('href="https://example.com/?a=1&amp;b=2"');
  });

  test('a tab with no title falls back to its URL, so no row is blank', () => {
    const session = buildSession({
      windows: [
        {
          windowId: 'w-1',
          windowHeight: 1080,
          windowWidth: 1920,
          windowOffsetTop: 0,
          windowOffsetLeft: 0,
          tabCount: 1,
          title: 'One window',
          tabs: [tab({ title: '', url: 'https://nameless.example/page' })],
        },
      ],
    });

    const html = sessionToHtml(session, options());

    expect(html).toContain('>https://nameless.example/page</a>');
  });
});

describe('the exported file stands alone (KAN-190)', () => {
  const oneTab = () =>
    buildSession({
      windows: [
        {
          windowId: 'w-1',
          windowHeight: 1080,
          windowWidth: 1920,
          windowOffsetTop: 0,
          windowOffsetLeft: 0,
          tabCount: 1,
          title: 'One window',
          tabs: [tab()],
        },
      ],
    });

  // The backstop if escaping ever fails.
  test('carries a security rule that allows only inline styles and the inlined mark', () => {
    const html = sessionToHtml(oneTab(), options());

    expect(html).toContain(
      `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">`
    );
  });

  // A remote favicon or font would beacon on open; only anchors may hold a
  // remote URL.
  test('fetches nothing: no scripts, no remote styles, no remote images', () => {
    const html = sessionToHtml(oneTab(), options());

    expect(html).not.toContain('<script');
    expect(html).not.toContain('<link');
    expect(html).not.toContain('@import');
    for (const [, src] of html.matchAll(/\ssrc="([^"]*)"/g)) {
      expect(src.startsWith('data:image/')).toBe(true);
    }
    expect(html).toContain('<style>');
  });

  test('signs itself with the mark, the date, and a link that can be attributed', () => {
    const html = sessionToHtml(oneTab(), options());

    expect(html).toContain(`src="${MARK}"`);
    expect(html).toContain(
      'Saved with <strong>Tab Keeper</strong> on Sep 15, 2026'
    );
    expect(html).toContain(`href="${STORE}"`);
    expect(html).toContain('Get the extension');
  });
});

describe('the two layouts (KAN-190)', () => {
  const session = () =>
    buildSession({
      windows: [
        {
          windowId: 'w-1',
          windowHeight: 1080,
          windowWidth: 1920,
          windowOffsetTop: 0,
          windowOffsetLeft: 0,
          tabCount: 2,
          title: 'Trip planning',
          tabs: [
            tab({
              tabId: 't-1',
              title: 'Deep link',
              url: 'https://example.com/a/very/deep/path?with=query',
              chromeGroupId: 'g-1',
            }),
            tab({
              tabId: 't-2',
              title: 'Loose',
              url: 'https://loose.example/',
            }),
          ],
          chromeTabGroups: [
            { groupId: 'g-1', title: 'Flights', color: 'blue' },
          ],
        },
      ],
    });

  // The href holds the whole URL in every layout, so read the shown line.
  test('comfortable shows each tab with its whole URL underneath', () => {
    const html = sessionToHtml(session(), options({ layout: 'comfortable' }));

    expect(html).toContain(
      '<div class="url">https://example.com/a/very/deep/path?with=query</div>'
    );
  });

  test('compact shows only the site, while the link still points at the full URL', () => {
    const html = sessionToHtml(session(), options({ layout: 'compact' }));

    expect(html).toContain(
      'href="https://example.com/a/very/deep/path?with=query"'
    );
    expect(html).toContain('>example.com<');
    expect(html).not.toContain(
      '>https://example.com/a/very/deep/path?with=query<'
    );
  });

  // KAN-212. Shortening relies on the href keeping the full address; a
  // non-linkable one has none.
  test('compact shows a non-linkable address whole, since no href carries it', () => {
    const withPlain = session();
    withPlain.windows[0].tabs.push({
      tabId: 't-plain',
      favicon: '',
      title: 'Extensions',
      url: 'chrome://extensions/',
    });

    const html = sessionToHtml(withPlain, options({ layout: 'compact' }));

    expect(html).toContain('>chrome://extensions/<');
    // CONTROL: a linkable address in the same file is still shortened.
    expect(html).toContain('>example.com<');
  });

  // A layout that dropped or reordered a tab would still satisfy "they differ".
  test('CONTROL: both layouts carry the same links, in the same order, with the group intact', () => {
    const comfortable = sessionToHtml(
      session(),
      options({ layout: 'comfortable' })
    );
    const compact = sessionToHtml(session(), options({ layout: 'compact' }));

    const links = (html: string) => hrefs(html).filter((h) => h !== STORE);

    expect(links(compact)).toEqual(links(comfortable));
    expect(links(comfortable)).toEqual([
      'https://example.com/a/very/deep/path?with=query',
      'https://loose.example/',
    ]);
    for (const html of [comfortable, compact]) {
      expect(html).toContain('Flights');
      expect(html).toContain(TAB_GROUP_COLOR_HEX.blue);
    }
    expect(comfortable).not.toBe(compact);
  });
});

describe('the file name (KAN-190)', () => {
  test.each([
    // A crafted page can put a control character in a title; escaped so it is
    // visible here.
    ['Weekend \u0000 in Kyoto', 'Weekend in Kyoto - 2026-09-15.html'],
    ['Q3: research/notes', 'Q3 research notes - 2026-09-15.html'],
    ['   ', 'Tab Keeper session - 2026-09-15.html'],
    // A hyphen is not a path problem.
    ['Notes on e-commerce', 'Notes on e-commerce - 2026-09-15.html'],
    ['a'.repeat(120), `${'a'.repeat(60)} - 2026-09-15.html`],
  ])('%s becomes %s', (title, expected) => {
    expect(exportFileName(title, new Date('2026-09-15T08:30:00Z'))).toBe(
      expected
    );
  });
});

// KAN-190. Polarity comes from the export theme, never the reader's
// prefers-color-scheme, so the recipient sees what the preview showed.
// KAN-731. The file's two palettes are Chalk's and Charcoal's ramps.
describe('the exported palettes (KAN-731)', () => {
  test('light is Chalk and dark is Charcoal', () => {
    expect(EXPORT_PALETTE).toEqual({
      light: {
        bg: '#ffffff',
        text: '#1e1f21',
        muted: '#505258',
        rule: '#d8dadd',
        link: '#1a56c4',
        visited: '#6b3fb0',
        plain: '#6c6e75',
        groupBg: '#f3f5f7',
      },
      dark: {
        bg: '#18191a',
        text: '#f0f1f2',
        muted: '#a9abb0',
        rule: '#313336',
        link: '#8ab4f8',
        visited: '#c7a4f5',
        plain: '#97999e',
        groupBg: '#242528',
      },
    });
  });
});

describe('the file looks the way it did when it was exported (KAN-190)', () => {
  const oneTab = () =>
    buildSession({
      windows: [
        {
          windowId: 'w-1',
          windowHeight: 1080,
          windowWidth: 1920,
          windowOffsetTop: 0,
          windowOffsetLeft: 0,
          tabCount: 1,
          title: 'One window',
          tabs: [tab()],
        },
      ],
    });

  test('a light theme writes a light file', () => {
    const html = sessionToHtml(oneTab(), options({ scheme: 'light' }));

    expect(html).toContain('--bg:#ffffff');
    expect(html).toContain('color-scheme:light');
  });

  test('a dark theme writes a dark file', () => {
    const html = sessionToHtml(oneTab(), options({ scheme: 'dark' }));

    expect(html).toContain('--bg:#18191a');
    expect(html).toContain('color-scheme:dark');
  });

  test.each([['light'], ['dark']] as const)(
    'a %s file does not change with the reader system setting',
    (scheme) => {
      const html = sessionToHtml(oneTab(), options({ scheme }));

      expect(html).not.toContain('prefers-color-scheme');
    }
  );
});

// KAN-190. The PDF comes from the print dialog, so the printed file must be the
// same document.
describe('the file prints as itself (KAN-190)', () => {
  const oneTab = () =>
    buildSession({
      windows: [
        {
          windowId: 'w-1',
          windowHeight: 1080,
          windowWidth: 1920,
          windowOffsetTop: 0,
          windowOffsetLeft: 0,
          tabCount: 1,
          title: 'One window',
          tabs: [tab()],
        },
      ],
    });

  test('a row is never split across two pages', () => {
    const html = sessionToHtml(oneTab(), options());

    expect(html).toMatch(
      /@media print\{[\s\S]*?li\.tab\{[^}]*break-inside:avoid/
    );
  });

  // KAN-192. Print may change only where a page breaks, never the appearance.
  // e2e/session-export.spec.ts checks the pixels.
  test.each([['light'], ['dark']] as const)(
    'a %s file changes nothing about its appearance when printed',
    (scheme) => {
      const html = sessionToHtml(oneTab(), options({ scheme }));
      const print = html.match(/@media print\{[\s\S]*?\}\}/)?.[0] ?? '';

      // Also proves the file carries print rules at all.
      expect(print).not.toBe('');
      for (const appearance of [
        'text-decoration',
        '--link',
        '--bg',
        'background:transparent',
        'border-left',
        'color:#',
      ]) {
        expect(print, `print must not restyle: ${appearance}`).not.toContain(
          appearance
        );
      }
    }
  );

  // Chrome draws its header/footer (our chrome-extension:// URL, the session
  // id) in the margin.
  test('the page leaves no margin for a browser header or footer', () => {
    const html = sessionToHtml(oneTab(), options());

    expect(html).toContain('@page{margin:0}');
  });

  // The print dialog drops backgrounds unless the page opts in.
  test('backgrounds print without the user ticking a box', () => {
    const html = sessionToHtml(oneTab(), options({ scheme: 'dark' }));

    expect(html).toContain('print-color-adjust:exact');
  });

  // With no page margin, padding is the only inset. Measured: without the
  // clone, page 2 prints flush to the top edge.
  test('every printed page keeps its top and bottom padding', () => {
    const html = sessionToHtml(oneTab(), options());

    expect(html).toMatch(/@media print\{[\s\S]*?box-decoration-break:clone/);
  });
});

// KAN-731. Each file palette holds its floors on the page and in a group's band
// (KAN-358 plain, KAN-674 rule); links keep the hues they had (KAN-197).
describe.each(['light', 'dark'] as const)(
  'the %s file palette floors',
  (scheme) => {
    const palette = EXPORT_PALETTE[scheme];

    test.each([
      ['text', 'bg'],
      ['muted', 'bg'],
      ['link', 'bg'],
      ['visited', 'bg'],
      ['plain', 'bg'],
      ['text', 'groupBg'],
      ['muted', 'groupBg'],
      ['link', 'groupBg'],
      ['visited', 'groupBg'],
      ['plain', 'groupBg'],
    ] as const)('%s on %s reads at 4.5:1', (fg, bg) => {
      const ratio = contrast(palette[fg], palette[bg]);

      expect(
        ratio,
        `${fg} on ${bg}: ${ratio.toFixed(2)}`
      ).toBeGreaterThanOrEqual(4.5);
    });

    test('the rule holds 1.2:1 in a group band', () => {
      expect(contrast(palette.rule, palette.groupBg)).toBeGreaterThanOrEqual(
        1.2
      );
    });

    // A group's band stays visible on the page: light measures 1.093, dark 1.149.
    test('the group band holds 1.09:1 on the page', () => {
      expect(contrast(palette.groupBg, palette.bg)).toBeGreaterThanOrEqual(
        1.09
      );
    });

    test('links keep their colours', () => {
      expect(palette.link).toBe(scheme === 'dark' ? '#8ab4f8' : '#1a56c4');
      expect(palette.visited).toBe(scheme === 'dark' ? '#c7a4f5' : '#6b3fb0');
    });
  }
);

// KAN-358. WCAG AA on the page and a group band. Includes `plain`: the "not a
// web link" chip, not a faint colour, marks such a row.
describe('every colour the file writes words in reads at 4.5:1 (KAN-358)', () => {
  const WORDS = ['text', 'muted', 'link', 'visited', 'plain'] as const;
  const GROUNDS = ['bg', 'groupBg'] as const;
  const cases = (['light', 'dark'] as const).flatMap((scheme) =>
    WORDS.flatMap((fg) =>
      GROUNDS.map((ground) => [scheme, fg, ground] as const)
    )
  );

  test.each(cases)('%s: %s on %s', (scheme, fg, ground) => {
    const palette = EXPORT_PALETTE[scheme];
    const ratio = contrast(palette[fg], palette[ground]);

    expect(
      ratio,
      `${palette[fg]} on ${palette[ground]}: ${ratio.toFixed(3)}:1`
    ).toBeGreaterThanOrEqual(4.5);
  });
});

// KAN-674. The lines between tabs reach dividerContrast's 1.20 floor on the page and inside a group.
describe('every line the file draws can be seen (KAN-674)', () => {
  const VISIBLE_FLOOR = 1.2;
  const cases = (['light', 'dark'] as const).flatMap((scheme) =>
    (['bg', 'groupBg'] as const).map((ground) => [scheme, ground] as const)
  );

  test.each(cases)('%s: rule on %s', (scheme, ground) => {
    const palette = EXPORT_PALETTE[scheme];
    const ratio = contrast(palette.rule, palette[ground]);

    expect(
      ratio,
      `${palette.rule} on ${palette[ground]}: ${ratio.toFixed(3)}:1`
    ).toBeGreaterThanOrEqual(VISIBLE_FLOOR);
  });

  // The editor's eye fills with the rule when pressed; its muted glyph keeps 3:1 there.
  test.each(['light', 'dark'] as const)(
    '%s: the pressed eye glyph on the rule',
    (scheme) => {
      const palette = EXPORT_PALETTE[scheme];
      expect(contrast(palette.muted, palette.rule)).toBeGreaterThanOrEqual(3);
    }
  );
});

// KAN-208. A capture of open windows has no date; a leading " · " would imply a
// missing one.
describe('the meta line (KAN-208)', () => {
  test('with a date, it reads date then counts', () => {
    const html = sessionToHtml(buildSession(), options());

    expect(html).toContain(
      '<p class="meta">Created Sep 10, 2026, 9:48:00 PM · 2 Windows · 9 Tabs</p>'
    );
  });

  test('without a date, the counts stand alone', () => {
    const html = sessionToHtml(
      buildSession(),
      options({ dateLabel: undefined })
    );

    expect(html).toContain('<p class="meta">2 Windows · 9 Tabs</p>');
    expect(html).not.toContain('Created');
    expect(html).not.toContain('"meta"> ·');
  });
});

// KAN-394. An unnamed window's heading is the label alone, with no separator.
describe('a window with no name (KAN-394)', () => {
  const twoWindows = () =>
    buildSession({
      windows: ['', 'Trip planning'].map((title, i) => ({
        windowId: `w-${i}`,
        windowHeight: 1080,
        windowWidth: 1920,
        windowOffsetTop: 0,
        windowOffsetLeft: 0,
        tabCount: 1,
        title,
        tabs: [tab()],
      })),
    });

  test('the heading is "Window 1" with no separator, a named one keeps its title', () => {
    const html = sessionToHtml(twoWindows(), options());

    expect(html).toContain('<h2>Window 1 <span>(');
    expect(html).toContain('<h2>Window 2 · Trip planning <span>(');
    expect(html).not.toContain('Window 1 ·');
  });
});
