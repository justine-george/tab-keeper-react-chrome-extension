import type {
  tabContainerData,
  tabData,
  windowGroupData,
} from '../../redux/slices/tabContainerDataStateSlice';
import {
  partitionTabsIntoRuns,
  sanitizeTabGroupColor,
  TAB_GROUP_COLOR_HEX,
} from './tabGroups';

export type ExportLayout = 'comfortable' | 'compact';

/**
 * Whether the FILE is written light or dark. Taken from the theme the session
 * was exported under, not from the reader system setting: the person who
 * exported it saw what they were sending, and a document that changes
 * appearance on someone else machine is a surprise, not a feature.
 */
export type ExportScheme = 'light' | 'dark';

/**
 * The file's colours, per scheme. Exported for the export page's Edit mode
 * (KAN-194), which edits the rows in the page rather than in the sandboxed
 * preview, and has to look like the file it is editing -- so it reads the
 * file's own palette instead of keeping a copy that could drift.
 */
export interface ExportPalette {
  bg: string;
  text: string;
  muted: string;
  rule: string;
  link: string;
  visited: string;
  plain: string;
  groupBg: string;
}

export const EXPORT_PALETTE: Record<ExportScheme, ExportPalette> = {
  light: {
    bg: '#ffffff',
    text: '#1d2025',
    muted: '#5f6670',
    rule: '#e3e6ea',
    link: '#1a56c4',
    visited: '#6b3fb0',
    plain: '#8a9099',
    groupBg: '#f5f7fa',
  },
  // Neutral greys (KAN-197): the tinted #17191d family read as a second,
  // bluish dark under Darkenheimer's neutral header. Each grey is the nearest
  // neutral that keeps every contrast ratio at least what the tinted palette
  // had; links keep their hues, because blue and violet mean "link".
  dark: {
    bg: '#171717',
    text: '#e8e8e8',
    muted: '#a0a0a0',
    rule: '#303030',
    link: '#8ab4f8',
    visited: '#c7a4f5',
    plain: '#818181',
    groupBg: '#212121',
  },
};

export interface SessionExportOptions {
  layout: ExportLayout;
  scheme: ExportScheme;
  /** Locale-formatted, as the session header shows it. */
  dateLabel: string;
  /** Locale-formatted, e.g. "2 Windows - 9 Tabs". */
  countsLabel: string;
  /** Per-window heading suffix, e.g. (3) => "3 Tabs". */
  tabCountLabel: (count: number) => string;
  strings: {
    window: string;
    notAWebLink: string;
    /**
     * Carries {{brand}} and {{date}}. The brand is substituted as markup, so
     * the product name is emphasised wherever a translation places it --
     * rather than by matching the literal "Tab Keeper" in a sentence that a
     * translator is free to rewrite.
     */
    savedWith: string;
    getExtension: string;
  };
  /** The extension's own icon, as a data: URI. */
  mark: string;
  storeUrl: string;
  savedOn: string;
}

// This module is imported by the popup and by the export page, and it must
// stay DOM-free: it builds a string, never a node. Same constraint, and the
// same reason, as tabGroups.ts.

/**
 * The only schemes that may become an anchor.
 *
 * The exported file is opened from `file://`, where a `javascript:` link runs
 * on click and a `data:` link opens markup this file did not write. `chrome://`
 * cannot be navigated to from a page at all, so a link there would be a dead
 * control. Everything outside this list is rendered as text.
 */
const LINKABLE = /^https?:\/\//i;

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[c] as string
  );
}

/** A tab's visible label: its title, or its URL when it has none. */
function labelOf(tab: tabData): string {
  return tab.title.trim() ? tab.title : tab.url;
}

/**
 * What the row shows beneath (comfortable) or beside (compact) the link.
 *
 * Compact trades the path for density: the site is enough to tell two links
 * apart at a glance, and the whole URL is still in the href. A URL the parser
 * refuses is shown whole rather than dropped -- it is the user's data.
 *
 * SO IS A URL THAT IS NOT A LINK (KAN-212). The trade above rests entirely on
 * the href holding what the text drops, and a non-linkable address has no href
 * to hold it: `chrome://extensions/` came out as the bare word "extensions",
 * and a `chrome-extension://<id>/page.html?x=1` would lose its path with
 * nothing anywhere to recover it from.
 *
 * True since KAN-190 but confined to the layout nobody opened on. Making
 * compact the default is what turns it from rare into what everyone sees,
 * which is why it is fixed here rather than left for later.
 */
function shownUrl(url: string, layout: ExportLayout): string {
  if (layout !== 'compact') return url;
  if (!LINKABLE.test(url)) return url;
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function tabHtml(tab: tabData, options: SessionExportOptions): string {
  const label = escapeHtml(labelOf(tab));
  const url = escapeHtml(tab.url);
  const shown = escapeHtml(shownUrl(tab.url, options.layout));

  if (!LINKABLE.test(tab.url)) {
    return (
      `<li class="tab"><span class="plain">${label}</span>` +
      `<span class="note">${escapeHtml(options.strings.notAWebLink)}</span>` +
      `<div class="url">${shown}</div></li>`
    );
  }

  return (
    `<li class="tab"><a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>` +
    `<div class="url">${shown}</div></li>`
  );
}

function windowHtml(
  window: windowGroupData,
  index: number,
  options: SessionExportOptions
): string {
  const runs = partitionTabsIntoRuns(window.tabs, window.chromeTabGroups);

  const body = runs
    .map((run) => {
      const tabs = run.tabs.map((tab) => tabHtml(tab, options)).join('');
      if (run.kind === 'ungrouped') return tabs;

      const color = TAB_GROUP_COLOR_HEX[sanitizeTabGroupColor(run.group.color)];
      return (
        `<li><div class="group" style="border-color:${color}">` +
        `<p class="group-name">${escapeHtml(run.group.title)}</p>` +
        `<ul>${tabs}</ul></div></li>`
      );
    })
    .join('');

  const heading =
    `${escapeHtml(options.strings.window)} ${index + 1} · ` +
    `${escapeHtml(window.title)} ` +
    `<span>(${escapeHtml(options.tabCountLabel(window.tabs.length))})</span>`;

  return `<section><h2>${heading}</h2><ul>${body}</ul></section>`;
}

/**
 * The file's whole stylesheet. Inlined, in system fonts, because the document
 * may not fetch anything -- a webfont would beacon on open and leave the file
 * unstyled offline.
 *
 * Both layouts ship in every file and one class on <body> chooses between
 * them, so the two can never drift into different documents.
 */
function styles(scheme: ExportScheme): string {
  const palette = EXPORT_PALETTE[scheme];
  return (
    `:root{--bg:${palette.bg};--text:${palette.text};--muted:${palette.muted};--rule:${palette.rule};--link:${palette.link};--visited:${palette.visited};--plain:${palette.plain};--group-bg:${palette.groupBg};color-scheme:${scheme}}` +
    `*{box-sizing:border-box}` +
    `body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;padding:30px 24px 40px}` +
    `main{max-width:720px;margin:0 auto}` +
    `h1{font-size:26px;line-height:1.2;margin:0 0 6px;text-wrap:balance}` +
    `.meta{color:var(--muted);font-size:13px;margin:0}` +
    `section{margin-top:28px}` +
    `ul{list-style:none;margin:0;padding:0}` +
    `a{color:var(--link);text-decoration:none}a:visited{color:var(--visited)}a:hover{text-decoration:underline}` +
    `.url{color:var(--muted);font-size:12px;overflow-wrap:anywhere}` +
    `.plain{color:var(--plain)}` +
    `.note{font-size:11px;color:var(--muted);border:1px solid var(--rule);border-radius:3px;padding:0 5px;margin-left:6px;white-space:nowrap}` +
    `.group{border-left:4px solid;background:var(--group-bg)}` +
    `.group-name{font-weight:600;margin:0 0 2px}` +
    `.sig{margin-top:34px;padding-top:14px;border-top:1px solid var(--rule);color:var(--muted);font-size:13px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}` +
    `.sig img{border-radius:4px}` +
    `.sig strong{color:var(--text);font-weight:600}` +
    `.sig a{margin-left:auto;color:var(--link)}` +
    // Comfortable: a reading layout, the whole URL under each link.
    `.comfortable h2{font-size:12px;letter-spacing:.07em;text-transform:uppercase;color:var(--muted);margin:0 0 10px;padding-bottom:8px;border-bottom:1px solid var(--rule);font-weight:600}` +
    `.comfortable h2 span{text-transform:none;letter-spacing:0;font-weight:400}` +
    `.comfortable li.tab{padding:7px 0}` +
    `.comfortable .group{margin:8px 0;padding:6px 0 6px 14px;border-radius:0 4px 4px 0}` +
    `.comfortable .group-name{font-size:13px}` +
    `.comfortable .group li.tab{padding:5px 12px 5px 0}` +
    // Compact: one line per tab, the site pushed to the right.
    `.compact section{margin-top:20px}` +
    `.compact h2{font-size:14px;margin:0 0 6px;font-weight:600}` +
    `.compact h2 span{color:var(--muted);font-weight:400}` +
    `.compact li.tab{display:flex;gap:10px;align-items:baseline;padding:3px 0;border-bottom:1px solid var(--rule);min-width:0}` +
    `.compact li.tab a,.compact li.tab .plain{flex:0 1 auto;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:14px}` +
    `.compact li.tab .url{flex:1 1 0;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:right}` +
    // Padding on BOTH sides: the site sits at the right end of a compact row,
    // so a block padded only on its left let the text touch its own edge.
    `.compact .group{margin:2px 0;padding:0 10px 0 10px}` +
    `.compact .group-name{font-size:12px;color:var(--muted);margin:6px 0 0}` +
    // Printing is how this file becomes a PDF, and the PDF has to BE the file
    // (KAN-192). So print may decide where a page breaks and nothing else: no
    // palette, no underlines, no borders standing in for tints.
    //
    // Three things are needed to get there, each measured in a real PDF.
    // - `@page{margin:0}`: Chrome draws its header and footer into the page
    //   margin, and they put the chrome-extension:// address and the session id
    //   into a document meant for other people.
    // - `print-color-adjust:exact`: the print dialog drops backgrounds by
    //   default, and the tints and a dark page ARE the appearance.
    // - The body padding moves onto <main> with `box-decoration-break:clone`.
    //   With no page margin that padding is all that keeps text off the paper
    //   edge, and plain padding applies to the first page only -- page 2
    //   printed flush against the top. main grows by the padding it takes, so
    //   the text keeps the width it has on screen (48px inset either way).
    `@page{margin:0}` +
    `@media print{` +
    `html,body{-webkit-print-color-adjust:exact;print-color-adjust:exact}` +
    `body{padding:0}` +
    `main{max-width:768px;padding:30px 24px 40px;-webkit-box-decoration-break:clone;box-decoration-break:clone}` +
    `li.tab{break-inside:avoid}` +
    `.group{break-inside:avoid}` +
    `h2{break-after:avoid}` +
    `.sig{break-inside:avoid}` +
    `}`
  );
}

/**
 * The sign-off. The mark is the extension's own icon as a data: URI, so it
 * travels with the file; the link carries whatever `ref` the caller put on it,
 * which is how an install arriving from a shared file can be attributed.
 */
function signature(options: SessionExportOptions): string {
  const savedWith = escapeHtml(options.strings.savedWith)
    .replace('{{brand}}', '<strong>Tab Keeper</strong>')
    .replace('{{date}}', escapeHtml(options.savedOn));

  return (
    `<footer class="sig">` +
    `<img src="${options.mark}" width="18" height="18" alt="">` +
    `<span>${savedWith}</span>` +
    `<a href="${escapeHtml(options.storeUrl)}">${escapeHtml(
      options.strings.getExtension
    )}</a>` +
    `</footer>`
  );
}

export function sessionToHtml(
  session: tabContainerData,
  options: SessionExportOptions
): string {
  const title = escapeHtml(session.title);
  const windows = session.windows
    .map((window, index) => windowHtml(window, index, options))
    .join('');

  return (
    `<!doctype html><html><head><meta charset="utf-8">` +
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<title>${title}</title><style>${styles(options.scheme)}</style></head>` +
    `<body class="${options.layout}"><main>` +
    `<h1>${title}</h1>` +
    `<p class="meta">${escapeHtml(options.dateLabel)} · ${escapeHtml(
      options.countsLabel
    )}</p>` +
    `${windows}${signature(options)}</main></body></html>`
  );
}

/** What the clipboard versions need from the page (KAN-195). */
export interface LinkListStrings {
  window: string;
  /** Per-window and per-group suffix, e.g. (3) => "3 Tabs". */
  tabCountLabel: (count: number) => string;
  /** Locale-formatted session counts, e.g. "2 Windows - 47 Tabs". */
  countsLabel: string;
  /** For casing the window label in the plain text. */
  locale: string;
}

/**
 * The real address of a tab a tab-suspender extension put to sleep.
 *
 * Such a tab is saved as the extension's placeholder page, with the address
 * it stands for inside it: `?url=` (encoded) for the suspender found in a real
 * session, or a trailing, unencoded `#...&uri=` for The Marvellous Suspender.
 * Only a chrome-extension:// page whose path mentions "suspend" is unwrapped,
 * and only to something that parses as an address; anything else, including
 * another extension's own page that happens to take a url, comes back as it
 * went in.
 */
export function unwrapSuspendedUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (
    parsed.protocol !== 'chrome-extension:' ||
    !/suspend/i.test(parsed.pathname)
  ) {
    return url;
  }

  const candidate =
    parsed.searchParams.get('url') ??
    parsed.searchParams.get('uri') ??
    // Last in the hash and unencoded, so an & inside it belongs to it.
    /(?:^#|&)uri=(.*)$/.exec(parsed.hash)?.[1] ??
    new URLSearchParams(parsed.hash.slice(1)).get('url');
  if (!candidate) return url;

  try {
    new URL(candidate);
    return candidate;
  } catch {
    return url;
  }
}

/**
 * A title without the unread count a site puts in front of it: "(3) @levelsio
 * on X" is "@levelsio on X".
 *
 * Only a leading count of one to three digits, optionally "+", followed by a
 * space and more title. "(2024) Annual report" keeps its year, and a title that
 * is nothing but a count keeps it, since removing it would leave nothing.
 */
export function dropNotificationCount(title: string): string {
  const match = /^\(\d{1,3}\+?\)\s+(\S[\s\S]*)$/.exec(title);
  return match ? match[1] : title;
}

/**
 * The session as the export should read it (KAN-202).
 *
 * Two clean-ups, applied ONCE where the page loads the session, so the editor,
 * the preview, the saved file, the PDF and both clipboard versions show the
 * same text: a leading notification count is dropped from a tab's title, and a
 * tab a suspender extension put to sleep carries the address it stands for.
 *
 * Only a tab's title and address. The session, window and group names are the
 * user's own words, and nothing else about the data is touched -- no
 * deduplication, no tracking parameters stripped, no site suffix trimmed;
 * those were rejected in KAN-195 as changing what was saved without asking.
 *
 * Returns a copy, and tidying an already tidy session changes nothing.
 */
export function tidySessionForExport(
  session: tabContainerData
): tabContainerData {
  return {
    ...session,
    windows: session.windows.map((window) => ({
      ...window,
      tabs: window.tabs.map((tab) => {
        const title = dropNotificationCount(tab.title);
        const url = unwrapSuspendedUrl(tab.url);
        return title === tab.title && url === tab.url
          ? tab
          : { ...tab, title, url };
      }),
    })),
  };
}

function groupHeading(
  group: { title: string },
  count: number,
  strings: LinkListStrings
): string {
  const size = strings.tabCountLabel(count);
  // An unnamed group is a real Chrome state: its size alone heads it.
  return group.title.trim() ? `${group.title} (${size})` : size;
}

/**
 * The session as plain text, for the clipboard (KAN-195).
 *
 * Each tab is a dash and its title with its address indented on the next line,
 * so a title of any length wraps without swallowing the link. A Chrome group
 * is an indented block under its name, and windows are separated by a blank
 * line. Every tab is kept, including those the file will not link: this is
 * text, so a chrome:// address is just an address.
 */
export function sessionToLinkList(
  session: tabContainerData,
  strings: LinkListStrings
): string {
  const label = strings.window.toLocaleUpperCase(strings.locale);
  const lines: string[] = [session.title, strings.countsLabel];

  const tabLines = (tab: tabData, indent: string): string[] => {
    const url = tab.url;
    const title = labelOf(tab);
    return title === url
      ? [`${indent}- ${url}`]
      : [`${indent}- ${title}`, `${indent}  ${url}`];
  };

  session.windows.forEach((window, index) => {
    lines.push(
      '',
      `${label} ${index + 1} · ${window.title} ` +
        `(${strings.tabCountLabel(window.tabs.length)})`
    );
    partitionTabsIntoRuns(window.tabs, window.chromeTabGroups).forEach(
      (run, runIndex) => {
        if (run.kind === 'ungrouped') {
          // Loose tabs after a group start again below a blank line.
          if (runIndex > 0) lines.push('');
          run.tabs.forEach((tab) => lines.push(...tabLines(tab, '')));
          return;
        }
        lines.push(
          '',
          `  ${groupHeading(run.group, run.tabs.length, strings)}`
        );
        run.tabs.forEach((tab) => lines.push(...tabLines(tab, '    ')));
      }
    );
  });

  return lines.join('\n');
}

/**
 * The session as a rich list, for the clipboard's text/html (KAN-195).
 *
 * An editor that reads HTML -- Gmail, Docs, Notion -- pastes a document: each
 * window a bold heading, each group a nested list, each tab a link on its
 * title. Only a web address becomes a link: pasted into someone else's email,
 * a link is something they will click, and a saved javascript: or chrome://
 * address must never be one. Those stay readable text, as the file treats
 * them.
 */
export function sessionToLinkHtml(
  session: tabContainerData,
  strings: LinkListStrings
): string {
  const item = (tab: tabData): string => {
    const url = tab.url;
    const title = labelOf(tab);
    if (!LINKABLE.test(url)) {
      return `<li>${escapeHtml(
        title === url ? url : `${title} (${url})`
      )}</li>`;
    }
    return `<li><a href="${escapeHtml(url)}">${escapeHtml(title)}</a></li>`;
  };

  const windows = session.windows
    .map((window, index) => {
      const body = partitionTabsIntoRuns(window.tabs, window.chromeTabGroups)
        .map((run) => {
          const items = run.tabs.map(item).join('');
          if (run.kind === 'ungrouped') return items;
          const size = escapeHtml(strings.tabCountLabel(run.tabs.length));
          const heading = run.group.title.trim()
            ? `<b>${escapeHtml(run.group.title)}</b> (${size})`
            : size;
          return `<li>${heading}<ul>${items}</ul></li>`;
        })
        .join('');
      return (
        `<p><b>${escapeHtml(strings.window)} ${index + 1} · ` +
        `${escapeHtml(window.title)}</b> ` +
        `(${escapeHtml(strings.tabCountLabel(window.tabs.length))})</p>` +
        `<ul>${body}</ul>`
      );
    })
    .join('');

  return (
    `<h3>${escapeHtml(session.title)}</h3>` +
    `<p>${escapeHtml(strings.countsLabel)}</p>` +
    windows
  );
}

/**
 * Punctuation no common filesystem accepts in a name. Hyphens are NOT here:
 * "e-commerce" is a title, not a path problem.
 */
const FORBIDDEN_IN_FILENAME = /[\\/:*?"<>|]/g;

/**
 * Control characters, stripped by code point rather than by a regex range --
 * a range would put literal control bytes in this source, where nobody can
 * see them. A title carrying one came from somewhere odd (a crafted page
 * title), and it has no business in a file name.
 */
const stripControlCharacters = (value: string): string =>
  [...value].map((char) => (char.charCodeAt(0) < 32 ? ' ' : char)).join('');

/** Long enough to stay recognisable, short enough for any filesystem. */
const MAX_TITLE_LENGTH = 60;

/**
 * `<session title> - YYYY-MM-DD.html`, with the title made safe for a
 * filesystem. A session named only of forbidden characters, or of nothing,
 * still gets a usable name rather than a file called ` - 2026-09-15.html`.
 */
export function exportFileName(sessionTitle: string, now: Date): string {
  const cleaned = stripControlCharacters(sessionTitle)
    .replace(FORBIDDEN_IN_FILENAME, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TITLE_LENGTH)
    .trim();

  const date = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');

  return `${cleaned || 'Tab Keeper session'} - ${date}.html`;
}
