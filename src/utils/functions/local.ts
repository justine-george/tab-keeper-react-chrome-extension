import { Base64 } from 'js-base64';
import {
  TabMasterContainer,
  deletedTabGroup,
  tabContainerData,
  tabData,
  windowGroupData,
} from '../../redux/slices/tabContainerDataStateSlice';

// check validity of the timestamp
export function isValidDate(param: any) {
  if (typeof param === 'number' || param === '') {
    const date = new Date(param);
    return date instanceof Date && !isNaN(date.getTime());
  }
  return false;
}

// check if an object is empty
export function isEmptyObject(obj: any): boolean {
  return typeof obj === 'object' && Object.keys(obj).length === 0;
}

// convert Date object to formatted string
export function getStringDate(inputDate: Date): string {
  const [year, month, day, hour, minute, second] = [
    inputDate.getFullYear(),
    inputDate.getMonth() + 1, // Month is 0-indexed
    inputDate.getDate(),
    inputDate.getHours(),
    inputDate.getMinutes(),
    inputDate.getSeconds(),
  ].map((val) => String(val).padStart(2, '0'));

  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

// simulate a lottery win based on random number
export function isLotteryWon(): boolean {
  return Math.floor(Math.random() * 2) === 1;
}

// simulate a network delay
export function simulateNetworkDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// debounce a function
export function debounce(func: any, delay: number) {
  let timeoutId: null | ReturnType<typeof setTimeout>;
  return (...args: any[]) => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => {
      func(...args);
      timeoutId = null;
    }, delay);
  };
}

// validate email format
export function isValidEmail(email: string): boolean {
  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return regex.test(email);
}

// validate password format
export function isValidPassword(password: string): boolean {
  const hasLetters = /[a-zA-Z]/.test(password);
  const hasNumbers = /\d/.test(password);
  return password.length >= 8 && hasLetters && hasNumbers;
}

// a value read back from chrome.storage.sync is only usable as the Firestore
// documentId if it is a non-empty string
export function isUsableToken(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

// decide what to do with the tokenValue read from chrome.storage.sync:
//   'mint'   - nothing stored yet, issue a new token (new user)
//   'use'    - a usable documentId is stored (existing user)
//   'reject' - something is stored but it is not a usable documentId; the
//              caller must not overwrite it, that would strand the data
//              already saved under the existing documentId
export type TokenAction = 'mint' | 'use' | 'reject';

export function classifyStoredToken(value: unknown): TokenAction {
  if (value === undefined || value === null || value === '') return 'mint';
  return isUsableToken(value) ? 'use' : 'reject';
}

// filter tabGroup
export const filterTabGroups = (
  searchText: string,
  tabGroups: tabContainerData[]
): tabContainerData[] => {
  const loweredSearchText = searchText.toLowerCase();

  return tabGroups.reduce((acc: tabContainerData[], tabGroup) => {
    // add all windows if tabGroup title matches
    if (tabGroup.title.toLowerCase().includes(loweredSearchText)) {
      acc.push(tabGroup);
    } else {
      // add only matched windows if tabGroup title doesn't match
      const matchedWindows = tabGroup.windows.reduce(
        (windowAcc: windowGroupData[], window) => {
          // add all tabs if window title matches
          if (window.title.toLowerCase().includes(loweredSearchText)) {
            windowAcc.push(window);
          } else {
            // add only matched tabs if window title doesn't match
            const matchedTabs = window.tabs.filter(
              (tab) =>
                tab.title.toLowerCase().includes(loweredSearchText) ||
                (tab.url && tab.url.toLowerCase().includes(loweredSearchText))
            );

            if (matchedTabs.length) {
              // the counts narrow to describe the filtered view, but the window
              // keeps its own title: it is the identity the user recognises and
              // renames, not a value derived from whichever tab matched
              windowAcc.push({
                ...window,
                tabs: matchedTabs,
                tabCount: matchedTabs.length,
              });
            }
          }
          return windowAcc;
        },
        []
      );

      if (matchedWindows.length) {
        acc.push({
          ...tabGroup,
          windows: matchedWindows,
          windowCount: matchedWindows.length,
          tabCount: matchedWindows.reduce(
            (total, win) => total + win.tabCount,
            0
          ),
        });
      }
    }

    return acc;
  }, []);
};

// The sessions the right pane shows: the selected one, narrowed by the search
// box while the search panel is open.
//
// This lives in one place because three components depend on it agreeing with
// itself. RightPane derives its mount guard from the length of this list, and
// both of the children it mounts read element [0] of it. While each of them
// built the list itself, that agreement held only by coincidence of three
// copies of the predicate matching -- and the day one copy changed (a pinned
// sessions rule, a change to search behaviour) the parent would have mounted
// children against an empty list and [0] would have been undefined. KAN-16 and
// KAN-39 are that crash, found before it went live.
//
// It takes the state it needs rather than RootState so it stays pure and
// node-testable, and so callers keep their existing useSelector subscriptions:
// passing this to useSelector directly would return a new array on every store
// update and re-render all three components on every unrelated action.
export const selectVisibleTabGroups = (
  tabGroups: tabContainerData[],
  isSearchPanel: boolean,
  searchInputText: string
): tabContainerData[] => {
  const selectedTabGroups = tabGroups.filter((tabGroup) => tabGroup.isSelected);

  return isSearchPanel && searchInputText
    ? filterTabGroups(searchInputText, selectedTabGroups)
    : selectedTabGroups;
};

// save data to local storage
export const saveToLocalStorage = (key: string, data: any): void => {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch (error) {
    console.error('Failed to save to localStorage: ', error);
  }
};

// load data from local storage
//
// Returns `unknown` rather than `any`: the parsed value is whatever happens to
// be in localStorage, which a caller must narrow before use. Under automatic
// sync merging an unvalidated container is written back to Firestore, so an
// implicit `any` here silently propagates local corruption to the cloud copy.
export const loadFromLocalStorage = (key: string): unknown => {
  try {
    const serializedState = localStorage.getItem(key);
    if (!serializedState) return undefined;
    return JSON.parse(serializedState);
  } catch (error) {
    console.error('Error loading state from localStorage: ', error);
    return undefined;
  }
};

// Narrow a value read back from localStorage to the caller's settings shape.
//
// This is a boundary assertion, and a deliberately limited one: every settings
// reader defaults each field it pulls off, and none of them is on the path that
// writes back to Firestore. Session data gets the real treatment instead - it
// goes through isValidTabMasterContainer, which checks every field, because
// that is the object the sync merge replicates to the cloud.
export const asPartialSettings = <T>(value: unknown): Partial<T> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Partial<T>)
    : {};

// Every lazy-load placeholder is a base64 data document, and both the save path
// and the background worker recognise one by this prefix.
const PLACEHOLDER_URL_PREFIX = 'data:text/html;base64,';

// A page controls its own title, and the title is interpolated straight into
// the placeholder document. Unescaped, a title of `</h2><script>...</script>`
// closes the heading and runs as markup. Escaping is applied to every
// interpolated value rather than only the obviously hostile ones, because
// which values are attacker-controlled is not a property worth tracking
// per-field.
//
// `&` must be replaced first: doing it later would re-escape the ampersands
// introduced by the other replacements.
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// The inverse, needed because the placeholder's href is not just markup -- it
// is where decodeDataUrl and placeholderTarget read the real page back from.
// Escaping the href without unescaping it here would hand every caller a URL
// with `&amp;` in place of `&`, corrupting every query string the moment it
// round-tripped.
//
// `&amp;` must be replaced last, mirroring escapeHtml: undoing it first would
// turn `&amp;lt;` into `<` rather than the literal `&lt;` it stands for.
export function unescapeHtml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

// generate placeholder URL for quicker session loads and lesser memory consumption
export function generatePlaceholderURL(
  title: string,
  faviconURL: string,
  url: string,
  goToURLText: string
) {
  const safeTitle = escapeHtml(title);
  const safeFaviconURL = escapeHtml(faviconURL);
  const safeUrl = escapeHtml(url);
  const safeGoToURLText = escapeHtml(goToURLText);

  const html = `<html> <head> <meta charset="UTF-8" /> <link rel="icon" type="image/x-icon" href="${safeFaviconURL}" /> <meta name="viewport" content="width=device-width, initial-scale=1.0" /> <title>${safeTitle}</title> <style> body { background-color: #181818; color: #ffffff; font-family: "Libre Franklin", sans-serif; display: flex; margin: 20px; flex-direction: column; justify-content: flex-start; align-items: flex-start; height: 100vh; } #copyButton { cursor: pointer; background-color: #2c2c2c; padding: 10px 20px; border: none; border-radius: 10px; color: #ffffff; font-family: "Libre Franklin", sans-serif; font-size: 14px; transition: background-color 0.125s ease, color 0.125s ease; } #copyButton:hover { background-color: #77dd77; color: black; } h1,h2,p { margin: 10px 3px; } a { text-decoration: none; color: inherit; } p { font-size: 0.9rem; margin-bottom: 15px; } </style> </head> <body> <h2>${safeTitle}</h2> <a href="${safeUrl}"><p>${safeUrl}</p></a> <a href="${safeUrl}"><button id="copyButton">${safeGoToURLText}</button></a> </body></html>`;
  const base64Html = Base64.encode(html);
  return `${PLACEHOLDER_URL_PREFIX}${base64Html}`;
}

// decode dataurl before saving - bugfix to prevent saving base64 encoded urls
export function decodeDataUrl(url: string): string {
  if (url.startsWith(PLACEHOLDER_URL_PREFIX)) {
    const base64Data = url.replace(PLACEHOLDER_URL_PREFIX, '');
    const decodedHtml = Base64.decode(base64Data);

    // extract the actual URL from the HTML content
    //
    // The href is HTML-escaped by generatePlaceholderURL, so it has to be
    // unescaped here to give back the URL that went in. Placeholders written
    // before escaping existed are unaffected: unescaping a string with no
    // entities in it is a no-op.
    const urlMatch = decodedHtml.match(/<a href="([^"]+)">/);
    if (urlMatch && urlMatch[1]) {
      return unescapeHtml(urlMatch[1]);
    }
  }
  return url;
}

// Parameter names that tab suspenders use to carry the page they stand for.
const SUSPENDED_URL_PARAMS = ['url', 'uri'];

// Only http(s) is worth restoring. This also stops a crafted extension page
// from redirecting a restore to javascript:, data: or another extension.
function isRestorablePageUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

// A suspended tab's real page survives only inside the suspender's own URL, so
// a session saved while tabs were suspended stores placeholders - and becomes
// unrecoverable if that suspender is ever removed. Recover the page instead.
//
// The two families encode it differently. Tab Suspender uses a percent-encoded
// `url` query parameter, while the Great Suspender family uses a hash fragment
// whose `uri=` is raw and deliberately last, because the page's own URL may
// contain '&' - splitting the fragment on '&' would truncate it.
export function unwrapSuspendedUrl(url: string): string {
  if (!url.startsWith('chrome-extension://')) return url;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }

  const fragment = parsed.hash.slice(1);
  const rawUriIndex = fragment.indexOf('uri=');
  if (rawUriIndex >= 0) {
    const candidate = fragment.slice(rawUriIndex + 4);
    if (isRestorablePageUrl(candidate)) return candidate;
  }

  const params = [...parsed.searchParams, ...new URLSearchParams(fragment)];

  for (const name of SUSPENDED_URL_PARAMS) {
    const match = params.find(([key]) => key === name);
    if (match && isRestorablePageUrl(match[1])) return match[1];
  }

  // An unrecognised suspender may name its parameter anything, so fall back to
  // any restorable value - but only on a page that presents itself as a
  // suspend page, so an ordinary extension page that merely references a URL
  // (an onboarding screen with ?ref=, say) is never rewritten.
  if (/suspend/i.test(parsed.pathname)) {
    const match = params.find(([, value]) => isRestorablePageUrl(value));
    if (match) return match[1];
  }

  return url;
}

// Give the real page for a captured or stored tab URL. A tab can be wrapped
// more than once - a suspended tab saved while lazy load was on carries Tab
// Keeper's placeholder around the suspender's URL - so unwrap until the URL
// stops changing, bounded so a pathological input cannot loop.
export function resolveTabUrl(url: string): string {
  let current = url;

  for (let unwraps = 0; unwraps < 3; unwraps++) {
    const next = unwrapSuspendedUrl(decodeDataUrl(current));
    if (next === current) break;
    current = next;
  }

  return current;
}

// A lazy-load placeholder carries its own real page, so nothing has to remember
// what a restore opened: the background worker reads the answer off the tab it
// was handed. That matters because the popup is destroyed the moment the
// restored window takes focus, taking any record it was holding with it.
//
// Returns null for everything that is not one of our placeholders. The worker
// asks this of every tab the user activates, and a wrong answer would navigate
// a page they were reading, so a foreign data: document, a decode that yields
// nothing, and any non-http(s) target all decline.
export function placeholderTarget(tabUrl: string): string | null {
  if (!tabUrl.startsWith(PLACEHOLDER_URL_PREFIX)) return null;

  const resolved = resolveTabUrl(tabUrl);
  if (resolved === tabUrl) return null;

  return isRestorablePageUrl(resolved) ? resolved : null;
}

// Firestore rejects any document larger than 1 MiB.
export const FIRESTORE_MAX_DOCUMENT_BYTES = 1048576;

// Chrome hands back some favicons as `data:image/png;base64,...` URIs weighing
// 5-20KB each, rather than a remote URL of ~60 bytes. Stored verbatim, a large
// session pushes the document past the Firestore ceiling and the write is
// rejected outright. Dropping the embedded ones keeps remote URLs intact, so
// most favicons still render.
export function stripEmbeddedFavicons(
  data: TabMasterContainer
): TabMasterContainer {
  return {
    ...data,
    tabGroups: data.tabGroups.map((tabGroup) => ({
      ...tabGroup,
      windows: tabGroup.windows.map((window) => ({
        ...window,
        tabs: window.tabs.map((tab) =>
          tab.favicon?.startsWith('data:') ? { ...tab, favicon: '' } : tab
        ),
      })),
    })),
  };
}

// Chrome keeps a favicon cache for pages the user has visited, reachable through
// the `favicon` permission. Deriving the icon from the page URL costs no storage,
// so a tab whose embedded favicon was dropped by stripEmbeddedFavicons still
// renders. Only http(s) pages are derived; anything else keeps the caller's own
// fallback so behaviour there is unchanged.
export function resolveFaviconUrl(favicon: string, pageUrl: string): string {
  if (favicon) return favicon;
  if (!pageUrl || !/^https?:\/\//i.test(pageUrl)) return '';
  if (typeof chrome === 'undefined' || !chrome?.runtime?.getURL) return '';

  const url = new URL(chrome.runtime.getURL('/_favicon/'));
  url.searchParams.set('pageUrl', pageUrl);
  url.searchParams.set('size', '32');
  return url.toString();
}

// These validators run on whatever JSON a user hands the import dialog, so the
// input is genuinely unknown rather than merely untyped. Taking `unknown` is
// what forces the null check below: `typeof null.lastModified` throws, and the
// import handler prints error.message straight to a toast, so a missing guard
// surfaced as "Cannot read properties of null" instead of "Invalid JSON
// structure." Arrays are excluded too - every field lookup on one is undefined,
// so they would fall through as merely invalid rather than the wrong shape.
const isRecord = (data: unknown): data is Record<string, unknown> =>
  typeof data === 'object' && data !== null && !Array.isArray(data);

// validate import JSON structure - deletedTabGroup
const isValidDeletedTabGroup = (data: unknown): data is deletedTabGroup =>
  isRecord(data) &&
  typeof data.tabGroupId === 'string' &&
  typeof data.deletedAt === 'number';

// Absent is valid: every container written before tombstones existed lacks the
// field, and rejecting those would discard every pre-migration session. Present
// but malformed is not - the merge iterates this list, and a string would be
// walked character by character.
const hasValidTombstones = (value: unknown): boolean =>
  value === undefined ||
  (Array.isArray(value) && value.every(isValidDeletedTabGroup));

// validate import JSON structure - TabMasterContainer
export const isValidTabMasterContainer = (
  data: unknown
): data is TabMasterContainer => {
  return (
    isRecord(data) &&
    typeof data.lastModified === 'number' &&
    (typeof data.selectedTabGroupId === 'string' ||
      data.selectedTabGroupId === null) &&
    Array.isArray(data.tabGroups) &&
    data.tabGroups.every(isValidTabContainerData) &&
    hasValidTombstones(data.deletedTabGroups)
  );
};

// validate import JSON structure - tabContainerData
const isValidTabContainerData = (data: unknown): data is tabContainerData => {
  return (
    isRecord(data) &&
    typeof data.tabGroupId === 'string' &&
    typeof data.title === 'string' &&
    typeof data.createdTime === 'string' &&
    typeof data.windowCount === 'number' &&
    typeof data.tabCount === 'number' &&
    typeof data.isAutoSave === 'boolean' &&
    typeof data.isSelected === 'boolean' &&
    Array.isArray(data.windows) &&
    data.windows.every(isValidWindowGroupData)
  );
};

// validate import JSON structure - windowGroupData
const isValidWindowGroupData = (data: unknown): data is windowGroupData => {
  return (
    isRecord(data) &&
    typeof data.windowId === 'string' &&
    typeof data.tabCount === 'number' &&
    typeof data.title === 'string' &&
    Array.isArray(data.tabs) &&
    data.tabs.every(isValidTabData)
  );
};

// validate import JSON structure - tabData
const isValidTabData = (data: unknown): data is tabData => {
  return (
    isRecord(data) &&
    typeof data.tabId === 'string' &&
    typeof data.favicon === 'string' &&
    typeof data.title === 'string' &&
    typeof data.url === 'string'
  );
};

// convert datestring and timestamp to "mmm DD, yyyy at H:MM:SS AM/PM" format
export const getPrettyDate = (dateOrTimeStamp: string | number): string => {
  const MONTHS = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sept',
    'Oct',
    'Nov',
    'Dec',
  ];

  const date = new Date(dateOrTimeStamp);

  const year = date.getFullYear();
  const month = MONTHS[date.getMonth()];
  const day = date.getDate();
  const hours = date.getHours();
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const seconds = date.getSeconds().toString().padStart(2, '0');

  const ampm = hours >= 12 ? 'PM' : 'AM';
  const formattedHours = hours > 12 ? hours - 12 : hours === 0 ? 12 : hours;

  return `${month} ${day}, ${year} at ${formattedHours}:${minutes}:${seconds} ${ampm}`;
};
