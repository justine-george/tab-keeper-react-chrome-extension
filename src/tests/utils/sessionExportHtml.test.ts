import { describe, expect, test } from 'vitest';

import { buildSession } from '../fixtures/sessionFixture';
import {
  EXPORT_PALETTE,
  exportFileName,
  sessionToHtml,
  type ExportPalette,
  type SessionExportOptions,
} from '../../utils/functions/sessionExportHtml';
import { contrast } from '../setup/contrast';
import type { tabData } from '../../redux/slices/tabContainerDataStateSlice';
import { TAB_GROUP_COLOR_HEX } from '../../utils/functions/tabGroups';

// KAN-190. The exported file is opened from `file://`, by someone who may not
// be the person who exported it, and it is the artefact a stranger judges Tab
// Keeper by. So three things are load-bearing and all three are asserted here
// rather than left to the eye: what becomes a link, what is escaped, and that
// the file fetches nothing.
//
// The generator is pure and DOM-free on purpose -- it runs in the popup, and
// the same output is what gets written to disk, so it must be testable without
// a browser. e2e/session-export.spec.ts is what proves the page actually
// writes THIS string to a file.

const MARK = 'data:image/png;base64,iVBORw0KGgo=';
const STORE =
  'https://chromewebstore.google.com/detail/tab-keeper/abc?ref=export';

const options = (
  overrides: Partial<SessionExportOptions> = {}
): SessionExportOptions => ({
  layout: 'comfortable',
  scheme: 'light',
  dateLabel: 'Created Sep 10, 2026, 9:48:00 PM',
  countsLabel: '2 Windows - 9 Tabs',
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

  // The worst path, and the reason this file has a security rule at all: a
  // javascript: or data: URL that reached an href would RUN when the file is
  // opened from disk and the link is clicked. chrome:// cannot be opened from
  // a page either. None of them may become an anchor.
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
    // The URL keeps working as a link, with its ampersand escaped in markup.
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

  // The backstop behind escaping: even if a title ever slipped through, the
  // document may not load or run anything.
  test('carries a security rule that allows only inline styles and the inlined mark', () => {
    const html = sessionToHtml(oneTab(), options());

    expect(html).toContain(
      `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">`
    );
  });

  // "Works offline, and tells no site it was opened." A favicon or a webfont
  // would beacon on open; a remote stylesheet would leave the file unstyled on
  // a plane. Anchors are the only place a remote URL belongs.
  test('fetches nothing: no scripts, no remote styles, no remote images', () => {
    const html = sessionToHtml(oneTab(), options());

    expect(html).not.toContain('<script');
    expect(html).not.toContain('<link');
    expect(html).not.toContain('@import');
    // Every src= in the document is the inlined mark.
    for (const [, src] of html.matchAll(/\ssrc="([^"]*)"/g)) {
      expect(src.startsWith('data:image/')).toBe(true);
    }
    // It styles itself.
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

  test('comfortable shows each tab with its whole URL underneath', () => {
    const html = sessionToHtml(session(), options({ layout: 'comfortable' }));

    expect(html).toContain('https://example.com/a/very/deep/path?with=query');
  });

  // Compact trades the path for density: the site is enough to tell two links
  // apart, and the full URL is still in the href.
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

  // KAN-212. The trade above rests ENTIRELY on the href holding what the text
  // drops, and a non-linkable address has no href to hold it. Shortened, the
  // real address existed nowhere in the file: `chrome://extensions/` rendered
  // as the bare word "extensions", and an unwrapped suspender address would
  // lose its whole path.
  //
  // True since KAN-190 and invisible because compact was not the layout anyone
  // opened on. KAN-212 made it the default, which is what made this worth
  // fixing rather than noting.
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
    // CONTROL: a linkable address in the SAME file is still shortened, so this
    // cannot pass by the shortening having been dropped altogether.
    expect(html).toContain('>example.com<');
  });

  // CONTROL: the layouts differ in presentation only. A layout that dropped a
  // tab, or reordered them, would satisfy "they are different" and be a bug.
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
    // A control character reaches a title from a crafted page, and has no
    // business in a file name. Written as an escape, so the byte is visible
    // in this source rather than invisible in it.
    ['Weekend \u0000 in Kyoto', 'Weekend in Kyoto - 2026-09-15.html'],
    ['Q3: research/notes', 'Q3 research notes - 2026-09-15.html'],
    ['   ', 'Tab Keeper session - 2026-09-15.html'],
    // A hyphen is a title, not a path problem -- "e-commerce" must survive.
    ['Notes on e-commerce', 'Notes on e-commerce - 2026-09-15.html'],
    ['a'.repeat(120), `${'a'.repeat(60)} - 2026-09-15.html`],
  ])('%s becomes %s', (title, expected) => {
    expect(exportFileName(title, new Date('2026-09-15T08:30:00Z'))).toBe(
      expected
    );
  });
});

// KAN-190, found on a real export: the file was written with
// `@media (prefers-color-scheme: dark)`, so it followed the READER's system
// setting. Exported from the Light theme on a Mac in dark mode, it opened
// dark inside a light toolbar -- and the preview then showed something other
// than what a recipient would see, which is the one promise this page makes.
//
// The file now takes its polarity from the theme it was exported under, and
// keeps it wherever it is opened.
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

    expect(html).toContain('--bg:#171717');
    expect(html).toContain('color-scheme:dark');
  });

  // The whole point: the reader's machine does not get a vote, because the
  // person who exported it already saw what they were sending.
  test.each([['light'], ['dark']] as const)(
    'a %s file does not change with the reader system setting',
    (scheme) => {
      const html = sessionToHtml(oneTab(), options({ scheme }));

      expect(html).not.toContain('prefers-color-scheme');
    }
  );
});

// KAN-190. "Save as PDF" is the browser's print dialog, so the PRINTED file
// has to be the same document: same links, same structure, readable.
//
// Two things break that if left alone. Chrome does not print backgrounds by
// default, so a group's tint disappears and its block dissolves into the list.
// And a DARK file printed on white paper is pale grey text on nothing --
// unreadable, and the one case where following the screen exactly would be a
// regression rather than fidelity.
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

  test.each([['light'], ['dark']] as const)(
    'a %s file carries print rules',
    (scheme) => {
      const html = sessionToHtml(oneTab(), options({ scheme }));

      expect(html).toContain('@media print');
    }
  );

  test('a row is never split across two pages', () => {
    const html = sessionToHtml(oneTab(), options());

    expect(html).toMatch(
      /@media print\{[\s\S]*?li\.tab\{[^}]*break-inside:avoid/
    );
  });

  // KAN-192. The rules this replaces made paper differ from screen on purpose
  // -- a border instead of the tint, a forced light palette, underlined links
  // -- and these tests asserted them, which is how the PDF stopped looking
  // like the file. Print may now change only WHERE a page breaks, never what
  // anything looks like. e2e/session-export.spec.ts holds the pixels to that.
  test.each([['light'], ['dark']] as const)(
    'a %s file changes nothing about its appearance when printed',
    (scheme) => {
      const html = sessionToHtml(oneTab(), options({ scheme }));
      const print = html.match(/@media print\{[\s\S]*?\}\}/)?.[0] ?? '';

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

  // Chrome's print header and footer are drawn into the page margin, and they
  // carried the extension's own chrome-extension:// address and the session
  // id into a document meant for other people. No margin, nowhere to draw.
  test('the page leaves no margin for a browser header or footer', () => {
    const html = sessionToHtml(oneTab(), options());

    expect(html).toContain('@page{margin:0}');
  });

  // Tints and a dark background are the file's appearance, and the print
  // dialog drops backgrounds unless the page says otherwise.
  test('backgrounds print without the user ticking a box', () => {
    const html = sessionToHtml(oneTab(), options({ scheme: 'dark' }));

    expect(html).toContain('print-color-adjust:exact');
  });

  // With no page margin, the file's own padding is the only thing keeping
  // content off the paper edge -- and plain padding applies to the first page
  // only. Measured: page 2 printed flush against the top edge until the
  // padding was cloned onto every fragment.
  test('every printed page keeps its top and bottom padding', () => {
    const html = sessionToHtml(oneTab(), options());

    expect(html).toMatch(/@media print\{[\s\S]*?box-decoration-break:clone/);
  });
});

// KAN-197. Under a Darkenheimer header -- neutral greys, #2A2A2A and #333333 --
// the dark file's #17191d ground and cool greys read as a second, bluish dark,
// so the export page looked two-tone. The file keeps its two palettes (it is a
// document for other people, independent of whoever exported it), and the dark
// one becomes neutral.
describe('the dark file palette is neutral (KAN-197)', () => {
  // The tinted palette the dark file was built and tested with, kept here as
  // the floor: the neutral greys may not read worse than these did.
  const TINTED: ExportPalette = {
    bg: '#17191d',
    text: '#e6e8eb',
    muted: '#9aa1ab',
    rule: '#2c3037',
    link: '#8ab4f8',
    visited: '#c7a4f5',
    plain: '#7b828c',
    groupBg: '#1f2227',
  };
  const GREYS = ['bg', 'text', 'muted', 'rule', 'plain', 'groupBg'] as const;

  test('every grey in the dark palette has red, green and blue equal', () => {
    const tinted = GREYS.filter((token) => {
      const hex = EXPORT_PALETTE.dark[token].replace('#', '');
      return !(
        hex.slice(0, 2) === hex.slice(2, 4) &&
        hex.slice(2, 4) === hex.slice(4, 6)
      );
    });

    expect(
      tinted,
      `tinted: ${tinted
        .map((t) => `${t} ${EXPORT_PALETTE.dark[t]}`)
        .join(', ')}`
    ).toEqual([]);
  });

  // Links keep their hues: blue and violet mean "a link" and "visited", which
  // is information, not a tint.
  test('links keep their colours', () => {
    expect(EXPORT_PALETTE.dark.link).toBe(TINTED.link);
    expect(EXPORT_PALETTE.dark.visited).toBe(TINTED.visited);
  });

  test.each([
    ['text', 'bg'],
    ['muted', 'bg'],
    ['link', 'bg'],
    ['visited', 'bg'],
    ['plain', 'bg'],
    ['rule', 'bg'],
    ['groupBg', 'bg'],
    ['text', 'groupBg'],
    ['muted', 'groupBg'],
    ['link', 'groupBg'],
    ['visited', 'groupBg'],
    ['plain', 'groupBg'],
  ] as const)('%s on %s reads at least as clearly as it did', (fg, bg) => {
    const was = contrast(TINTED[fg], TINTED[bg]);
    const now = contrast(EXPORT_PALETTE.dark[fg], EXPORT_PALETTE.dark[bg]);

    expect(
      now,
      `${fg} on ${bg}: ${was.toFixed(3)} before, ${now.toFixed(3)} now`
    ).toBeGreaterThanOrEqual(was);
  });

  // CONTROL, and the scope: only the dark palette was asked for.
  test('the light palette is unchanged', () => {
    expect(EXPORT_PALETTE.light).toEqual({
      bg: '#ffffff',
      text: '#1d2025',
      muted: '#5f6670',
      rule: '#e3e6ea',
      link: '#1a56c4',
      visited: '#6b3fb0',
      plain: '#8a9099',
      groupBg: '#f5f7fa',
    });
  });
});
