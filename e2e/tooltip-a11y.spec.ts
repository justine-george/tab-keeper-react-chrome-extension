import type { BrowserContext, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { grantedTest } from './fixtures/grantedExtension';
import { seedSessions, seedSettings } from './fixtures/seed';
import {
  FULL,
  FULL_VIEW_PATH,
  openFullView,
  openPage,
  openPopup,
} from './fixtures/onboarding';
import { standIn } from './fixtures/standInPages';
import { groupedWindow, openSaved, session } from './fixtures/savedWindows';
import {
  POPUP_RUN,
  cardAt,
  landedAt,
  nextTo,
  openRunFromHelp,
} from './fixtures/run';

// KAN-695. What Chrome's accessibility tree says about every titled control,
// recorded on main before the native tooltip is replaced. A `title` on a
// control that already has a name is its description, so removing `title`
// must leave these arrays as they are (the decided text changes aside).
// Each key comes from the markup (data-tour-anchor, aria-label, text), never
// from `title`, so it survives the swap.

/** Every element that carries a tooltip. The one line the swap changes. */
const TITLED = '[title]:not(iframe)';

interface AxReading {
  role: string;
  name: string;
  description: string;
}

interface AxRecord extends AxReading {
  surface: string;
  key: string;
}

/**
 * What Chromium's own accessibility tree says about each element matching
 * `selector`, in document order: what a screen reader is given. An element
 * Chrome does not expose reads as role "none" with no name or description.
 */
async function axOf(page: Page, selector: string): Promise<AxReading[]> {
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send('Accessibility.enable');
    const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
    const { nodeIds } = await cdp.send('DOM.querySelectorAll', {
      nodeId: root.nodeId,
      selector,
    });
    const readings: AxReading[] = [];
    for (const nodeId of nodeIds) {
      const { node } = await cdp.send('DOM.describeNode', { nodeId });
      const { nodes } = await cdp.send('Accessibility.getPartialAXTree', {
        nodeId,
        fetchRelatives: false,
      });
      const own = nodes.find((n) => n.backendDOMNodeId === node.backendNodeId);
      readings.push(
        own === undefined || own.ignored === true
          ? { role: 'none', name: '', description: '' }
          : {
              role: String(own.role?.value ?? ''),
              name: String(own.name?.value ?? ''),
              description: String(own.description?.value ?? ''),
            }
      );
    }
    return readings;
  } finally {
    await cdp.detach();
  }
}

/** A locator that does not read `title`: the tour anchor, else tag, explicit role and the label or text. */
function markupKeysOf(page: Page, selector: string): Promise<string[]> {
  return page.evaluate((selector) => {
    const seen = new Map<string, number>();
    return Array.from(document.querySelectorAll(selector)).map((el) => {
      const anchor = el.getAttribute('data-tour-anchor');
      const role = el.getAttribute('role');
      const label = (el.getAttribute('aria-label') ?? el.textContent ?? '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 60);
      const base =
        anchor !== null
          ? `anchor:${anchor}`
          : `${el.tagName.toLowerCase()}${role === null ? '' : `[${role}]`} "${label}"`;
      const nth = (seen.get(base) ?? 0) + 1;
      seen.set(base, nth);
      return `${base} #${nth}`;
    });
  }, selector);
}

async function recordAx(page: Page, surface: string): Promise<AxRecord[]> {
  await expectUtc(page);
  const [readings, keys] = await Promise.all([
    axOf(page, TITLED),
    markupKeysOf(page, TITLED),
  ]);
  expect(keys, `${surface}: one key per reading`).toHaveLength(readings.length);
  expect(readings.length, `${surface}: some element is titled`).toBeGreaterThan(
    0
  );
  return readings.map((reading, i) => ({ surface, key: keys[i], ...reading }));
}

/** One row per element: surface, key, role, name, description. */
type AxRow = [string, string, string, string, string];
const asRecords = (rows: AxRow[]): AxRecord[] =>
  rows.map(([surface, key, role, name, description]) => ({
    surface,
    key,
    role,
    name,
    description,
  }));

// prettier-ignore
const EXPECTED: Record<string, AxRecord[]> = {
  home: asRecords([
    ['home', 'div[button] "Open full view" #1', 'button', 'Open full view', ''],
    ['home', 'div[button] "Sort sessions" #1', 'button', 'Sort sessions', ''],
    ['home', 'div[button] "Undo" #1', 'button', 'Undo', ''],
    ['home', 'div[button] "Redo" #1', 'button', 'Redo', ''],
    ['home', 'div[button] "Sync now" #1', 'button', 'Sync now', 'Cloud sync on'],
    ['home', 'div[button] "Settings" #1', 'button', 'Settings', ''],
    ['home', 'button "Save all open windows as a session" #1', 'button', 'Save all open windows as a session', ''],
    ['home', 'div[button] "More actions" #1', 'button', 'More actions', ''],
    ['home', 'div "Research" #1', 'generic', '', ''],
    ['home', 'div "Created Sep 1, 9:00 AM" #1', 'generic', '', 'Sep 1, 2026, 9:00:00 AM'],
    ['home', 'anchor:row-open #1', 'button', 'Open', 'Open session, keeping current windows'],
    ['home', 'anchor:row-switch #1', 'button', 'Switch', 'Close current windows and open this session'],
    ['home', 'anchor:row-replace #1', 'button', 'Replace', 'Replace with open windows'],
    ['home', 'div "Research" #2', 'generic', '', ''],
    ['home', 'div[button] "Rename session" #1', 'button', 'Rename session', ''],
    ['home', 'div "Created Sep 1, 9:00 AM" #2', 'generic', '', 'Sep 1, 2026, 9:00:00 AM'],
    ['home', 'div[button] "Collapse all windows" #1', 'button', 'Collapse all windows', ''],
    ['home', 'div[button] "Open session, keeping current windows" #1', 'button', 'Open session, keeping current windows', ''],
    ['home', 'div[button] "Close current windows and open this session" #1', 'button', 'Close current windows and open this session', ''],
    ['home', 'div[button] "Replace with open windows" #1', 'button', 'Replace with open windows', ''],
    ['home', 'div[button] "More actions" #2', 'button', 'More actions', ''],
    ['home', 'button "Add current window" #1', 'button', 'Add current window', 'Add current window to this session'],
    ['home', 'div[button] "Collapse: Morning reading" #1', 'button', 'Collapse: Morning reading', ''],
    ['home', 'button "Open in new window: Morning reading" #1', 'button', 'Open in new window: Morning reading', ''],
    ['home', 'div[button] "Add current tab" #1', 'button', 'Add current tab', ''],
    ['home', 'div[button] "More actions" #3', 'button', 'More actions', ''],
    ['home', 'div[button] "Delete tab" #1', 'button', 'Delete tab', ''],
  ]),
  settings: asRecords([
    ['settings: Display', 'button "Go back" #1', 'button', 'Go back', ''],
    ['settings: Language', 'button "Go back" #1', 'button', 'Go back', ''],
    ['settings: Quick access', 'button "Go back" #1', 'button', 'Go back', ''],
    ['settings: Sync & backup', 'button "Go back" #1', 'button', 'Go back', ''],
    ['settings: Sessions', 'button "Go back" #1', 'button', 'Go back', ''],
    ['settings: Recently deleted', 'button "Go back" #1', 'button', 'Go back', ''],
    ['settings: About', 'button "Go back" #1', 'button', 'Go back', ''],
    ['settings: Help', 'button "Go back" #1', 'button', 'Go back', ''],
  ]),
  export: asRecords([
    ['export', 'button "Light" #1', 'button', 'Light', ''],
    ['export', 'button "Dark" #1', 'button', 'Dark', ''],
  ]),
  setup: asRecords([
    ['setup: step 1', 'anchor:compact #1', 'none', '', ''],
    ['setup: step 1', 'div[button] "Sort sessions" #1', 'none', '', ''],
    ['setup: step 1', 'div[button] "Undo" #1', 'none', '', ''],
    ['setup: step 1', 'div[button] "Redo" #1', 'none', '', ''],
    ['setup: step 1', 'div[button] "Sync now" #1', 'none', '', ''],
    ['setup: step 1', 'div[button] "Settings" #1', 'none', '', ''],
    ['setup: step 1', 'button "Save all open windows as a session" #1', 'none', '', ''],
    ['setup: step 1', 'div[button] "More actions" #1', 'none', '', ''],
    ['setup: step 1', 'div "Research" #1', 'none', '', ''],
    ['setup: step 1', 'div "Created Sep 1, 9:00 AM" #1', 'none', '', ''],
    ['setup: step 1', 'div[button] "Collapse all windows" #1', 'none', '', ''],
    ['setup: step 1', 'div[button] "Save all open windows as a session" #1', 'none', '', ''],
    ['setup: step 1', 'anchor:fold #1', 'none', '', ''],
    ['setup: step 1', 'button "Back to last tab" #1', 'none', '', ''],
    ['setup: step 1', 'div[button] "Collapse: Window 1" #1', 'none', '', ''],
    ['setup: step 1', 'button "Save window as a session: Window 1" #1', 'none', '', ''],
    ['setup: step 1', 'div[button] "Close tab: about:blank" #1', 'none', '', ''],
    ['setup: step 1', 'div[button] "Skip setup" #1', 'button', 'Skip setup', ''],
    ['setup: step 2', 'anchor:compact #1', 'none', '', ''],
    ['setup: step 2', 'div[button] "Sort sessions" #1', 'none', '', ''],
    ['setup: step 2', 'div[button] "Undo" #1', 'none', '', ''],
    ['setup: step 2', 'div[button] "Redo" #1', 'none', '', ''],
    ['setup: step 2', 'div[button] "Sync now" #1', 'none', '', ''],
    ['setup: step 2', 'div[button] "Settings" #1', 'none', '', ''],
    ['setup: step 2', 'button "Save all open windows as a session" #1', 'none', '', ''],
    ['setup: step 2', 'div[button] "More actions" #1', 'none', '', ''],
    ['setup: step 2', 'div "Research" #1', 'none', '', ''],
    ['setup: step 2', 'div "Created Sep 1, 9:00 AM" #1', 'none', '', ''],
    ['setup: step 2', 'div[button] "Collapse all windows" #1', 'none', '', ''],
    ['setup: step 2', 'div[button] "Save all open windows as a session" #1', 'none', '', ''],
    ['setup: step 2', 'anchor:fold #1', 'none', '', ''],
    ['setup: step 2', 'button "Back to last tab" #1', 'none', '', ''],
    ['setup: step 2', 'div[button] "Collapse: Window 1" #1', 'none', '', ''],
    ['setup: step 2', 'button "Save window as a session: Window 1" #1', 'none', '', ''],
    ['setup: step 2', 'div[button] "Close tab: about:blank" #1', 'none', '', ''],
    ['setup: step 2', 'div[button] "Skip setup" #1', 'button', 'Skip setup', ''],
    ['setup: step 3', 'anchor:compact #1', 'none', '', ''],
    ['setup: step 3', 'div[button] "Sort sessions" #1', 'none', '', ''],
    ['setup: step 3', 'div[button] "Undo" #1', 'none', '', ''],
    ['setup: step 3', 'div[button] "Redo" #1', 'none', '', ''],
    ['setup: step 3', 'div[button] "Sync now" #1', 'none', '', ''],
    ['setup: step 3', 'div[button] "Settings" #1', 'none', '', ''],
    ['setup: step 3', 'button "Save all open windows as a session" #1', 'none', '', ''],
    ['setup: step 3', 'div[button] "More actions" #1', 'none', '', ''],
    ['setup: step 3', 'div "Research" #1', 'none', '', ''],
    ['setup: step 3', 'div "Created Sep 1, 9:00 AM" #1', 'none', '', ''],
    ['setup: step 3', 'div[button] "Collapse all windows" #1', 'none', '', ''],
    ['setup: step 3', 'div[button] "Save all open windows as a session" #1', 'none', '', ''],
    ['setup: step 3', 'anchor:fold #1', 'none', '', ''],
    ['setup: step 3', 'button "Back to last tab" #1', 'none', '', ''],
    ['setup: step 3', 'div[button] "Collapse: Window 1" #1', 'none', '', ''],
    ['setup: step 3', 'button "Save window as a session: Window 1" #1', 'none', '', ''],
    ['setup: step 3', 'div[button] "Close tab: about:blank" #1', 'none', '', ''],
    ['setup: step 3', 'div[button] "Skip setup" #1', 'button', 'Skip setup', ''],
    ['setup: step 4', 'anchor:compact #1', 'none', '', ''],
    ['setup: step 4', 'div[button] "Sort sessions" #1', 'none', '', ''],
    ['setup: step 4', 'div[button] "Undo" #1', 'none', '', ''],
    ['setup: step 4', 'div[button] "Redo" #1', 'none', '', ''],
    ['setup: step 4', 'div[button] "Sync now" #1', 'none', '', ''],
    ['setup: step 4', 'div[button] "Settings" #1', 'none', '', ''],
    ['setup: step 4', 'button "Save all open windows as a session" #1', 'none', '', ''],
    ['setup: step 4', 'div[button] "More actions" #1', 'none', '', ''],
    ['setup: step 4', 'div "Research" #1', 'none', '', ''],
    ['setup: step 4', 'div "Created Sep 1, 9:00 AM" #1', 'none', '', ''],
    ['setup: step 4', 'div[button] "Collapse all windows" #1', 'none', '', ''],
    ['setup: step 4', 'div[button] "Save all open windows as a session" #1', 'none', '', ''],
    ['setup: step 4', 'anchor:fold #1', 'none', '', ''],
    ['setup: step 4', 'button "Back to last tab" #1', 'none', '', ''],
    ['setup: step 4', 'div[button] "Collapse: Window 1" #1', 'none', '', ''],
    ['setup: step 4', 'button "Save window as a session: Window 1" #1', 'none', '', ''],
    ['setup: step 4', 'div[button] "Close tab: about:blank" #1', 'none', '', ''],
    ['setup: step 4', 'div[button] "Skip setup" #1', 'button', 'Skip setup', ''],
    ['setup: step 5', 'anchor:compact #1', 'none', '', ''],
    ['setup: step 5', 'div[button] "Sort sessions" #1', 'none', '', ''],
    ['setup: step 5', 'div[button] "Undo" #1', 'none', '', ''],
    ['setup: step 5', 'div[button] "Redo" #1', 'none', '', ''],
    ['setup: step 5', 'div[button] "Sync now" #1', 'none', '', ''],
    ['setup: step 5', 'div[button] "Settings" #1', 'none', '', ''],
    ['setup: step 5', 'button "Save all open windows as a session" #1', 'none', '', ''],
    ['setup: step 5', 'div[button] "More actions" #1', 'none', '', ''],
    ['setup: step 5', 'div "Research" #1', 'none', '', ''],
    ['setup: step 5', 'div "Created Sep 1, 9:00 AM" #1', 'none', '', ''],
    ['setup: step 5', 'div[button] "Collapse all windows" #1', 'none', '', ''],
    ['setup: step 5', 'div[button] "Save all open windows as a session" #1', 'none', '', ''],
    ['setup: step 5', 'anchor:fold #1', 'none', '', ''],
    ['setup: step 5', 'button "Back to last tab" #1', 'none', '', ''],
    ['setup: step 5', 'div[button] "Collapse: Window 1" #1', 'none', '', ''],
    ['setup: step 5', 'button "Save window as a session: Window 1" #1', 'none', '', ''],
    ['setup: step 5', 'div[button] "Close tab: about:blank" #1', 'none', '', ''],
    ['setup: step 5', 'div[button] "Skip setup" #1', 'button', 'Skip setup', ''],
  ]),
  tour: asRecords([
    ['tour: step 3', 'div[button] "Open full view" #1', 'button', 'Open full view', ''],
    ['tour: step 3', 'div[button] "Sort sessions" #1', 'button', 'Sort sessions', ''],
    ['tour: step 3', 'div[button] "Undo" #1', 'button', 'Undo', ''],
    ['tour: step 3', 'div[button] "Redo" #1', 'button', 'Redo', ''],
    ['tour: step 3', 'div[button] "Sync now" #1', 'button', 'Sync now', 'Cloud sync on'],
    ['tour: step 3', 'div[button] "Settings" #1', 'button', 'Settings', ''],
    ['tour: step 3', 'button "Save all open windows as a session" #1', 'button', 'Save all open windows as a session', ''],
    ['tour: step 3', 'div[button] "More actions" #1', 'button', 'More actions', ''],
    ['tour: step 3', 'div "Inbox" #1', 'generic', '', ''],
    ['tour: step 3', 'div "Edited today, 12:00 PM" #1', 'generic', '', 'Oct 19, 2026, 12:00:00 PM'],
    ['tour: step 3', 'anchor:row-open #1', 'button', 'Open', 'Open works after the tour'],
    ['tour: step 3', 'anchor:row-switch #1', 'button', 'Switch', 'Switch works after the tour'],
    ['tour: step 3', 'anchor:row-replace #1', 'button', 'Replace', 'Replace works after the tour'],
    ['tour: step 3', 'div "Research" #1', 'generic', '', ''],
    ['tour: step 3', 'div "Created Sep 1, 9:00 AM" #1', 'generic', '', 'Sep 1, 2026, 9:00:00 AM'],
    ['tour: step 3', 'div "Inbox" #2', 'generic', '', ''],
    ['tour: step 3', 'div[button] "Rename session" #1', 'button', 'Rename session', ''],
    ['tour: step 3', 'div "Edited today, 12:00 PM" #2', 'generic', '', 'Oct 19, 2026, 12:00:00 PM'],
    ['tour: step 3', 'div[button] "Collapse all windows" #1', 'button', 'Collapse all windows', ''],
    ['tour: step 3', 'div[button] "Open works after the tour" #1', 'button', 'Open works after the tour', ''],
    ['tour: step 3', 'div[button] "Switch works after the tour" #1', 'button', 'Switch works after the tour', ''],
    ['tour: step 3', 'div[button] "Replace works after the tour" #1', 'button', 'Replace works after the tour', ''],
    ['tour: step 3', 'div[button] "More actions" #2', 'button', 'More actions', ''],
    ['tour: step 3', 'button "Add current window" #1', 'button', 'Add current window', 'Add current window to this session'],
    ['tour: step 3', 'div[button] "Collapse: Window 1" #1', 'button', 'Collapse: Window 1', ''],
    ['tour: step 3', 'button "Open in new window: Window 1" #1', 'button', 'Open in new window: Window 1', 'Open works after the tour'],
    ['tour: step 3', 'div[button] "Add current tab" #1', 'button', 'Add current tab', ''],
    ['tour: step 3', 'div[button] "More actions" #3', 'button', 'More actions', ''],
    ['tour: step 3', 'button "Open in new tab: about:blank" #1', 'button', 'Open in new tab: about:blank', 'Open works after the tour'],
    ['tour: step 3', 'div[button] "Delete tab" #1', 'button', 'Delete tab', ''],
    ['tour: step 3', 'button "Open in new tab: Inbox" #1', 'button', 'Open in new tab: Inbox', 'Open works after the tour'],
    ['tour: step 3', 'div[button] "Delete tab" #2', 'button', 'Delete tab', ''],
    ['tour: step 4', 'div[button] "Open full view" #1', 'button', 'Open full view', ''],
    ['tour: step 4', 'div[button] "Sort sessions" #1', 'button', 'Sort sessions', ''],
    ['tour: step 4', 'div[button] "Undo" #1', 'button', 'Undo', ''],
    ['tour: step 4', 'div[button] "Redo" #1', 'button', 'Redo', ''],
    ['tour: step 4', 'div[button] "Sync now" #1', 'button', 'Sync now', 'Cloud sync on'],
    ['tour: step 4', 'div[button] "Settings" #1', 'button', 'Settings', ''],
    ['tour: step 4', 'button "Save all open windows as a session" #1', 'button', 'Save all open windows as a session', ''],
    ['tour: step 4', 'div[button] "More actions" #1', 'button', 'More actions', ''],
    ['tour: step 4', 'div "Inbox" #1', 'generic', '', ''],
    ['tour: step 4', 'div "Edited today, 12:00 PM" #1', 'generic', '', 'Oct 19, 2026, 12:00:00 PM'],
    ['tour: step 4', 'anchor:row-open #1', 'button', 'Open', 'Open works after the tour'],
    ['tour: step 4', 'anchor:row-switch #1', 'button', 'Switch', 'Switch works after the tour'],
    ['tour: step 4', 'anchor:row-replace #1', 'button', 'Replace', 'Replace works after the tour'],
    ['tour: step 4', 'div "Research" #1', 'generic', '', ''],
    ['tour: step 4', 'div "Created Sep 1, 9:00 AM" #1', 'generic', '', 'Sep 1, 2026, 9:00:00 AM'],
    ['tour: step 4', 'div "Inbox" #2', 'generic', '', ''],
    ['tour: step 4', 'div[button] "Rename session" #1', 'button', 'Rename session', ''],
    ['tour: step 4', 'div "Edited today, 12:00 PM" #2', 'generic', '', 'Oct 19, 2026, 12:00:00 PM'],
    ['tour: step 4', 'div[button] "Collapse all windows" #1', 'button', 'Collapse all windows', ''],
    ['tour: step 4', 'div[button] "Open works after the tour" #1', 'button', 'Open works after the tour', ''],
    ['tour: step 4', 'div[button] "Switch works after the tour" #1', 'button', 'Switch works after the tour', ''],
    ['tour: step 4', 'div[button] "Replace works after the tour" #1', 'button', 'Replace works after the tour', ''],
    ['tour: step 4', 'div[button] "More actions" #2', 'button', 'More actions', ''],
    ['tour: step 4', 'button "Add current window" #1', 'button', 'Add current window', 'Add current window to this session'],
    ['tour: step 4', 'div[button] "Collapse: Window 1" #1', 'button', 'Collapse: Window 1', ''],
    ['tour: step 4', 'button "Open in new window: Window 1" #1', 'button', 'Open in new window: Window 1', 'Open works after the tour'],
    ['tour: step 4', 'div[button] "Add current tab" #1', 'button', 'Add current tab', ''],
    ['tour: step 4', 'div[button] "More actions" #3', 'button', 'More actions', ''],
    ['tour: step 4', 'button "Open in new tab: about:blank" #1', 'button', 'Open in new tab: about:blank', 'Open works after the tour'],
    ['tour: step 4', 'div[button] "Delete tab" #1', 'button', 'Delete tab', ''],
    ['tour: step 4', 'button "Open in new tab: Inbox" #1', 'button', 'Open in new tab: Inbox', 'Open works after the tour'],
    ['tour: step 4', 'div[button] "Delete tab" #2', 'button', 'Delete tab', ''],
    ['tour: step 5', 'div[button] "Open full view" #1', 'button', 'Open full view', ''],
    ['tour: step 5', 'div[button] "Sort sessions" #1', 'button', 'Sort sessions', ''],
    ['tour: step 5', 'div[button] "Undo" #1', 'button', 'Undo', ''],
    ['tour: step 5', 'div[button] "Redo" #1', 'button', 'Redo', ''],
    ['tour: step 5', 'div[button] "Sync now" #1', 'button', 'Sync now', 'Cloud sync on'],
    ['tour: step 5', 'div[button] "Settings" #1', 'button', 'Settings', ''],
    ['tour: step 5', 'button "Save all open windows as a session" #1', 'button', 'Save all open windows as a session', ''],
    ['tour: step 5', 'div[button] "More actions" #1', 'button', 'More actions', ''],
    ['tour: step 5', 'div "Inbox" #1', 'generic', '', ''],
    ['tour: step 5', 'div "Edited today, 12:00 PM" #1', 'generic', '', 'Oct 19, 2026, 12:00:00 PM'],
    ['tour: step 5', 'anchor:row-open #1', 'button', 'Open', 'Open works after the tour'],
    ['tour: step 5', 'anchor:row-switch #1', 'button', 'Switch', 'Switch works after the tour'],
    ['tour: step 5', 'anchor:row-replace #1', 'button', 'Replace', 'Replace works after the tour'],
    ['tour: step 5', 'div "Research" #1', 'generic', '', ''],
    ['tour: step 5', 'div "Created Sep 1, 9:00 AM" #1', 'generic', '', 'Sep 1, 2026, 9:00:00 AM'],
    ['tour: step 5', 'div "Inbox" #2', 'generic', '', ''],
    ['tour: step 5', 'div[button] "Rename session" #1', 'button', 'Rename session', ''],
    ['tour: step 5', 'div "Edited today, 12:00 PM" #2', 'generic', '', 'Oct 19, 2026, 12:00:00 PM'],
    ['tour: step 5', 'div[button] "Collapse all windows" #1', 'button', 'Collapse all windows', ''],
    ['tour: step 5', 'div[button] "Open works after the tour" #1', 'button', 'Open works after the tour', ''],
    ['tour: step 5', 'div[button] "Switch works after the tour" #1', 'button', 'Switch works after the tour', ''],
    ['tour: step 5', 'div[button] "Replace works after the tour" #1', 'button', 'Replace works after the tour', ''],
    ['tour: step 5', 'div[button] "More actions" #2', 'button', 'More actions', ''],
    ['tour: step 5', 'button "Add current window" #1', 'button', 'Add current window', 'Add current window to this session'],
    ['tour: step 5', 'div[button] "Collapse: Window 1" #1', 'button', 'Collapse: Window 1', ''],
    ['tour: step 5', 'button "Open in new window: Window 1" #1', 'button', 'Open in new window: Window 1', 'Open works after the tour'],
    ['tour: step 5', 'div[button] "Add current tab" #1', 'button', 'Add current tab', ''],
    ['tour: step 5', 'div[button] "More actions" #3', 'button', 'More actions', ''],
    ['tour: step 5', 'button "Open in new tab: about:blank" #1', 'button', 'Open in new tab: about:blank', 'Open works after the tour'],
    ['tour: step 5', 'div[button] "Delete tab" #1', 'button', 'Delete tab', ''],
    ['tour: step 5', 'button "Open in new tab: Inbox" #1', 'button', 'Open in new tab: Inbox', 'Open works after the tour'],
    ['tour: step 5', 'div[button] "Delete tab" #2', 'button', 'Delete tab', ''],
  ]),
  fullView: asRecords([
    ['full view: Open now', 'anchor:compact #1', 'button', 'Open compact view', ''],
    ['full view: Open now', 'div[button] "Sort sessions" #1', 'button', 'Sort sessions', ''],
    ['full view: Open now', 'div[button] "Undo" #1', 'button', 'Undo', ''],
    ['full view: Open now', 'div[button] "Redo" #1', 'button', 'Redo', ''],
    ['full view: Open now', 'div[button] "Sync now" #1', 'button', 'Sync now', 'Cloud sync on'],
    ['full view: Open now', 'div[button] "Settings" #1', 'button', 'Settings', ''],
    ['full view: Open now', 'button "Save all open windows as a session" #1', 'button', 'Save all open windows as a session', ''],
    ['full view: Open now', 'div[button] "More actions" #1', 'button', 'More actions', ''],
    ['full view: Open now', 'div "Research" #1', 'generic', '', ''],
    ['full view: Open now', 'div "Created Sep 1, 9:00 AM" #1', 'generic', '', 'Sep 1, 2026, 9:00:00 AM'],
    ['full view: Open now', 'anchor:row-open #1', 'button', 'Open', 'Open session, keeping current windows'],
    ['full view: Open now', 'anchor:row-replace #1', 'button', 'Replace', 'Replace with open windows'],
    ['full view: Open now', 'div "Research" #2', 'generic', '', ''],
    ['full view: Open now', 'div[button] "Rename session" #1', 'button', 'Rename session', ''],
    ['full view: Open now', 'div "Created Sep 1, 9:00 AM" #2', 'generic', '', 'Sep 1, 2026, 9:00:00 AM'],
    ['full view: Open now', 'div[button] "Collapse all windows" #1', 'button', 'Collapse all windows', ''],
    ['full view: Open now', 'div[button] "Open session, keeping current windows" #1', 'button', 'Open session, keeping current windows', ''],
    ['full view: Open now', 'div[button] "Replace with open windows" #1', 'button', 'Replace with open windows', ''],
    ['full view: Open now', 'div[button] "More actions" #2', 'button', 'More actions', ''],
    ['full view: Open now', 'button "Add current window" #1', 'button', 'Add current window', 'Add current window to this session'],
    ['full view: Open now', 'div[button] "Collapse: Morning reading" #1', 'button', 'Collapse: Morning reading', ''],
    ['full view: Open now', 'button "Open in new window: Morning reading" #1', 'button', 'Open in new window: Morning reading', ''],
    ['full view: Open now', 'div[button] "More actions" #3', 'button', 'More actions', ''],
    ['full view: Open now', 'div[button] "Delete tab" #1', 'button', 'Delete tab', ''],
    ['full view: Open now', 'div[button] "Collapse all windows" #2', 'button', 'Collapse all windows', ''],
    ['full view: Open now', 'div[button] "Save all open windows as a session" #1', 'button', 'Save all open windows as a session', ''],
    ['full view: Open now', 'anchor:fold #1', 'button', 'Fold the saved session away', ''],
    ['full view: Open now', 'button "Back to last tab" #1', 'button', 'Back to last tab', ''],
    ['full view: Open now', 'div[button] "Collapse: Window 1" #1', 'button', 'Collapse: Window 1', ''],
    ['full view: Open now', 'button "Save window as a session: Window 1" #1', 'button', 'Save window as a session: Window 1', ''],
    ['full view: Open now', 'div[button] "Close tab: about:blank" #1', 'button', 'Close tab: about:blank', ''],
    ['full view: Open now', 'div[button] "Collapse: Window 2" #1', 'button', 'Collapse: Window 2', ''],
    ['full view: Open now', 'button "Go to window: Window 2" #1', 'button', 'Go to window: Window 2', ''],
    ['full view: Open now', 'button "Save window as a session: Window 2" #1', 'button', 'Save window as a session: Window 2', ''],
    ['full view: Open now', 'div[button] "More actions: Window 2" #1', 'button', 'More actions: Window 2', ''],
    ['full view: Open now', 'div[button] "Change group color: Kyoto" #1', 'button', 'Change group color: Kyoto', ''],
    ['full view: Open now', 'button "Save group as a session: Kyoto" #1', 'button', 'Save group as a session: Kyoto', ''],
    ['full view: Open now', 'div[button] "More actions: Kyoto" #1', 'button', 'More actions: Kyoto', ''],
    ['full view: Open now', 'div[button] "Close tab: Temples" #1', 'button', 'Close tab: Temples', ''],
    ['full view: Open now', 'div[button] "Close tab: Gardens" #1', 'button', 'Close tab: Gardens', ''],
    ['full view: Open now', 'div[button] "Close tab: Loose" #1', 'button', 'Close tab: Loose', ''],
    ['full view: group colour picker open', 'anchor:compact #1', 'button', 'Open compact view', ''],
    ['full view: group colour picker open', 'div[button] "Sort sessions" #1', 'button', 'Sort sessions', ''],
    ['full view: group colour picker open', 'div[button] "Undo" #1', 'button', 'Undo', ''],
    ['full view: group colour picker open', 'div[button] "Redo" #1', 'button', 'Redo', ''],
    ['full view: group colour picker open', 'div[button] "Sync now" #1', 'button', 'Sync now', 'Cloud sync on'],
    ['full view: group colour picker open', 'div[button] "Settings" #1', 'button', 'Settings', ''],
    ['full view: group colour picker open', 'button "Save all open windows as a session" #1', 'button', 'Save all open windows as a session', ''],
    ['full view: group colour picker open', 'div[button] "More actions" #1', 'button', 'More actions', ''],
    ['full view: group colour picker open', 'div "Research" #1', 'generic', '', ''],
    ['full view: group colour picker open', 'div "Created Sep 1, 9:00 AM" #1', 'generic', '', 'Sep 1, 2026, 9:00:00 AM'],
    ['full view: group colour picker open', 'anchor:row-open #1', 'button', 'Open', 'Open session, keeping current windows'],
    ['full view: group colour picker open', 'anchor:row-replace #1', 'button', 'Replace', 'Replace with open windows'],
    ['full view: group colour picker open', 'div "Research" #2', 'generic', '', ''],
    ['full view: group colour picker open', 'div[button] "Rename session" #1', 'button', 'Rename session', ''],
    ['full view: group colour picker open', 'div "Created Sep 1, 9:00 AM" #2', 'generic', '', 'Sep 1, 2026, 9:00:00 AM'],
    ['full view: group colour picker open', 'div[button] "Collapse all windows" #1', 'button', 'Collapse all windows', ''],
    ['full view: group colour picker open', 'div[button] "Open session, keeping current windows" #1', 'button', 'Open session, keeping current windows', ''],
    ['full view: group colour picker open', 'div[button] "Replace with open windows" #1', 'button', 'Replace with open windows', ''],
    ['full view: group colour picker open', 'div[button] "More actions" #2', 'button', 'More actions', ''],
    ['full view: group colour picker open', 'button "Add current window" #1', 'button', 'Add current window', 'Add current window to this session'],
    ['full view: group colour picker open', 'div[button] "Collapse: Morning reading" #1', 'button', 'Collapse: Morning reading', ''],
    ['full view: group colour picker open', 'button "Open in new window: Morning reading" #1', 'button', 'Open in new window: Morning reading', ''],
    ['full view: group colour picker open', 'div[button] "More actions" #3', 'button', 'More actions', ''],
    ['full view: group colour picker open', 'div[button] "Delete tab" #1', 'button', 'Delete tab', ''],
    ['full view: group colour picker open', 'div[button] "Collapse all windows" #2', 'button', 'Collapse all windows', ''],
    ['full view: group colour picker open', 'div[button] "Save all open windows as a session" #1', 'button', 'Save all open windows as a session', ''],
    ['full view: group colour picker open', 'anchor:fold #1', 'button', 'Fold the saved session away', ''],
    ['full view: group colour picker open', 'button "Back to last tab" #1', 'button', 'Back to last tab', ''],
    ['full view: group colour picker open', 'div[button] "Collapse: Window 1" #1', 'button', 'Collapse: Window 1', ''],
    ['full view: group colour picker open', 'button "Save window as a session: Window 1" #1', 'button', 'Save window as a session: Window 1', ''],
    ['full view: group colour picker open', 'div[button] "Close tab: about:blank" #1', 'button', 'Close tab: about:blank', ''],
    ['full view: group colour picker open', 'div[button] "Collapse: Window 2" #1', 'button', 'Collapse: Window 2', ''],
    ['full view: group colour picker open', 'button "Go to window: Window 2" #1', 'button', 'Go to window: Window 2', ''],
    ['full view: group colour picker open', 'button "Save window as a session: Window 2" #1', 'button', 'Save window as a session: Window 2', ''],
    ['full view: group colour picker open', 'div[button] "More actions: Window 2" #1', 'button', 'More actions: Window 2', ''],
    ['full view: group colour picker open', 'div[button] "Change group color: Kyoto" #1', 'button', 'Change group color: Kyoto', ''],
    ['full view: group colour picker open', 'button[menuitemradio] "Grey" #1', 'menuitemradio', 'Grey', ''],
    ['full view: group colour picker open', 'button[menuitemradio] "Blue" #1', 'menuitemradio', 'Blue', ''],
    ['full view: group colour picker open', 'button[menuitemradio] "Red" #1', 'menuitemradio', 'Red', ''],
    ['full view: group colour picker open', 'button[menuitemradio] "Yellow" #1', 'menuitemradio', 'Yellow', ''],
    ['full view: group colour picker open', 'button[menuitemradio] "Green" #1', 'menuitemradio', 'Green', ''],
    ['full view: group colour picker open', 'button[menuitemradio] "Pink" #1', 'menuitemradio', 'Pink', ''],
    ['full view: group colour picker open', 'button[menuitemradio] "Purple" #1', 'menuitemradio', 'Purple', ''],
    ['full view: group colour picker open', 'button[menuitemradio] "Cyan" #1', 'menuitemradio', 'Cyan', ''],
    ['full view: group colour picker open', 'button[menuitemradio] "Orange" #1', 'menuitemradio', 'Orange', ''],
    ['full view: group colour picker open', 'button "Save group as a session: Kyoto" #1', 'button', 'Save group as a session: Kyoto', ''],
    ['full view: group colour picker open', 'div[button] "More actions: Kyoto" #1', 'button', 'More actions: Kyoto', ''],
    ['full view: group colour picker open', 'div[button] "Close tab: Temples" #1', 'button', 'Close tab: Temples', ''],
    ['full view: group colour picker open', 'div[button] "Close tab: Gardens" #1', 'button', 'Close tab: Gardens', ''],
    ['full view: group colour picker open', 'div[button] "Close tab: Loose" #1', 'button', 'Close tab: Loose', ''],
    ['full view: folded rail', 'anchor:compact #1', 'button', 'Open compact view', ''],
    ['full view: folded rail', 'div[button] "Sort sessions" #1', 'button', 'Sort sessions', ''],
    ['full view: folded rail', 'div[button] "Undo" #1', 'button', 'Undo', ''],
    ['full view: folded rail', 'div[button] "Redo" #1', 'button', 'Redo', ''],
    ['full view: folded rail', 'div[button] "Sync now" #1', 'button', 'Sync now', 'Cloud sync on'],
    ['full view: folded rail', 'div[button] "Settings" #1', 'button', 'Settings', ''],
    ['full view: folded rail', 'button "Save all open windows as a session" #1', 'button', 'Save all open windows as a session', ''],
    ['full view: folded rail', 'div[button] "More actions" #1', 'button', 'More actions', ''],
    ['full view: folded rail', 'div "Research" #1', 'generic', '', ''],
    ['full view: folded rail', 'div "Created Sep 1, 9:00 AM" #1', 'generic', '', 'Sep 1, 2026, 9:00:00 AM'],
    ['full view: folded rail', 'anchor:row-open #1', 'button', 'Open', 'Open session, keeping current windows'],
    ['full view: folded rail', 'anchor:row-replace #1', 'button', 'Replace', 'Replace with open windows'],
    ['full view: folded rail', 'div "Research" #2', 'generic', '', ''],
    ['full view: folded rail', 'div[button] "Rename session" #1', 'button', 'Rename session', ''],
    ['full view: folded rail', 'div "Created Sep 1, 9:00 AM" #2', 'generic', '', 'Sep 1, 2026, 9:00:00 AM'],
    ['full view: folded rail', 'div[button] "Collapse all windows" #1', 'button', 'Collapse all windows', ''],
    ['full view: folded rail', 'div[button] "Open session, keeping current windows" #1', 'button', 'Open session, keeping current windows', ''],
    ['full view: folded rail', 'div[button] "Replace with open windows" #1', 'button', 'Replace with open windows', ''],
    ['full view: folded rail', 'div[button] "More actions" #2', 'button', 'More actions', ''],
    ['full view: folded rail', 'button "Add current window" #1', 'button', 'Add current window', 'Add current window to this session'],
    ['full view: folded rail', 'div[button] "Collapse: Morning reading" #1', 'button', 'Collapse: Morning reading', ''],
    ['full view: folded rail', 'button "Open in new window: Morning reading" #1', 'button', 'Open in new window: Morning reading', ''],
    ['full view: folded rail', 'div[button] "More actions" #3', 'button', 'More actions', ''],
    ['full view: folded rail', 'div[button] "Delete tab" #1', 'button', 'Delete tab', ''],
    ['full view: folded rail', 'button "Open now, 4 Tabs" #1', 'button', 'Open now, 4 Tabs', ''],
    ['full view: Open now drawer', 'anchor:compact #1', 'button', 'Open compact view', ''],
    ['full view: Open now drawer', 'div[button] "Sort sessions" #1', 'button', 'Sort sessions', ''],
    ['full view: Open now drawer', 'div[button] "Undo" #1', 'button', 'Undo', ''],
    ['full view: Open now drawer', 'div[button] "Redo" #1', 'button', 'Redo', ''],
    ['full view: Open now drawer', 'div[button] "Sync now" #1', 'button', 'Sync now', 'Cloud sync on'],
    ['full view: Open now drawer', 'div[button] "Settings" #1', 'button', 'Settings', ''],
    ['full view: Open now drawer', 'button "Save all open windows as a session" #1', 'button', 'Save all open windows as a session', ''],
    ['full view: Open now drawer', 'div[button] "More actions" #1', 'button', 'More actions', ''],
    ['full view: Open now drawer', 'div "Research" #1', 'generic', '', ''],
    ['full view: Open now drawer', 'div "Created Sep 1, 9:00 AM" #1', 'generic', '', 'Sep 1, 2026, 9:00:00 AM'],
    ['full view: Open now drawer', 'anchor:row-open #1', 'button', 'Open', 'Open session, keeping current windows'],
    ['full view: Open now drawer', 'anchor:row-replace #1', 'button', 'Replace', 'Replace with open windows'],
    ['full view: Open now drawer', 'div "Research" #2', 'generic', '', ''],
    ['full view: Open now drawer', 'div[button] "Rename session" #1', 'button', 'Rename session', ''],
    ['full view: Open now drawer', 'div "Created Sep 1, 9:00 AM" #2', 'generic', '', 'Sep 1, 2026, 9:00:00 AM'],
    ['full view: Open now drawer', 'div[button] "Collapse all windows" #1', 'button', 'Collapse all windows', ''],
    ['full view: Open now drawer', 'div[button] "Open session, keeping current windows" #1', 'button', 'Open session, keeping current windows', ''],
    ['full view: Open now drawer', 'div[button] "Replace with open windows" #1', 'button', 'Replace with open windows', ''],
    ['full view: Open now drawer', 'div[button] "More actions" #2', 'button', 'More actions', ''],
    ['full view: Open now drawer', 'button "Add current window" #1', 'button', 'Add current window', 'Add current window to this session'],
    ['full view: Open now drawer', 'div[button] "Collapse: Morning reading" #1', 'button', 'Collapse: Morning reading', ''],
    ['full view: Open now drawer', 'button "Open in new window: Morning reading" #1', 'button', 'Open in new window: Morning reading', ''],
    ['full view: Open now drawer', 'div[button] "More actions" #3', 'button', 'More actions', ''],
    ['full view: Open now drawer', 'div[button] "Delete tab" #1', 'button', 'Delete tab', ''],
    ['full view: Open now drawer', 'button "Open now, 4 Tabs" #1', 'button', 'Open now, 4 Tabs', ''],
    ['full view: Open now drawer', 'div[button] "Collapse all windows" #2', 'button', 'Collapse all windows', ''],
    ['full view: Open now drawer', 'div[button] "Save all open windows as a session" #1', 'button', 'Save all open windows as a session', ''],
    ['full view: Open now drawer', 'anchor:fold #1', 'button', 'Fold the saved session away', ''],
    ['full view: Open now drawer', 'div[button] "Close Open now" #1', 'button', 'Close Open now', ''],
    ['full view: Open now drawer', 'button "Back to last tab" #1', 'button', 'Back to last tab', ''],
    ['full view: Open now drawer', 'div[button] "Collapse: Window 1" #1', 'button', 'Collapse: Window 1', ''],
    ['full view: Open now drawer', 'button "Save window as a session: Window 1" #1', 'button', 'Save window as a session: Window 1', ''],
    ['full view: Open now drawer', 'div[button] "Close tab: about:blank" #1', 'button', 'Close tab: about:blank', ''],
    ['full view: Open now drawer', 'div[button] "Collapse: Window 2" #1', 'button', 'Collapse: Window 2', ''],
    ['full view: Open now drawer', 'button "Go to window: Window 2" #1', 'button', 'Go to window: Window 2', ''],
    ['full view: Open now drawer', 'button "Save window as a session: Window 2" #1', 'button', 'Save window as a session: Window 2', ''],
    ['full view: Open now drawer', 'div[button] "More actions: Window 2" #1', 'button', 'More actions: Window 2', ''],
    ['full view: Open now drawer', 'div[button] "Change group color: Kyoto" #1', 'button', 'Change group color: Kyoto', ''],
    ['full view: Open now drawer', 'button "Save group as a session: Kyoto" #1', 'button', 'Save group as a session: Kyoto', ''],
    ['full view: Open now drawer', 'div[button] "More actions: Kyoto" #1', 'button', 'More actions: Kyoto', ''],
    ['full view: Open now drawer', 'div[button] "Close tab: Temples" #1', 'button', 'Close tab: Temples', ''],
    ['full view: Open now drawer', 'div[button] "Close tab: Gardens" #1', 'button', 'Close tab: Gardens', ''],
    ['full view: Open now drawer', 'div[button] "Close tab: Loose" #1', 'button', 'Close tab: Loose', ''],
  ]),
  savedGroup: asRecords([
    ['saved group', 'anchor:compact #1', 'button', 'Open compact view', ''],
    ['saved group', 'div[button] "Sort sessions" #1', 'button', 'Sort sessions', ''],
    ['saved group', 'div[button] "Undo" #1', 'button', 'Undo', ''],
    ['saved group', 'div[button] "Redo" #1', 'button', 'Redo', ''],
    ['saved group', 'div[button] "Sync now" #1', 'button', 'Sync now', 'Cloud sync on'],
    ['saved group', 'div[button] "Settings" #1', 'button', 'Settings', ''],
    ['saved group', 'button "Save all open windows as a session" #1', 'button', 'Save all open windows as a session', ''],
    ['saved group', 'div[button] "More actions" #1', 'button', 'More actions', ''],
    ['saved group', 'div "Kyoto trip" #1', 'generic', '', ''],
    ['saved group', 'div "Created Sep 1, 9:00 AM" #1', 'generic', '', 'Sep 1, 2026, 9:00:00 AM'],
    ['saved group', 'anchor:row-open #1', 'button', 'Open', 'Open session, keeping current windows'],
    ['saved group', 'anchor:row-replace #1', 'button', 'Replace', 'Replace with open windows'],
    ['saved group', 'div "Kyoto trip" #2', 'generic', '', ''],
    ['saved group', 'div[button] "Rename session" #1', 'button', 'Rename session', ''],
    ['saved group', 'div "Created Sep 1, 9:00 AM" #2', 'generic', '', 'Sep 1, 2026, 9:00:00 AM'],
    ['saved group', 'div[button] "Collapse all windows" #1', 'button', 'Collapse all windows', ''],
    ['saved group', 'div[button] "Open session, keeping current windows" #1', 'button', 'Open session, keeping current windows', ''],
    ['saved group', 'div[button] "Replace with open windows" #1', 'button', 'Replace with open windows', ''],
    ['saved group', 'div[button] "More actions" #2', 'button', 'More actions', ''],
    ['saved group', 'button "Add current window" #1', 'button', 'Add current window', 'Add current window to this session'],
    ['saved group', 'div[button] "Collapse: Window 1" #1', 'button', 'Collapse: Window 1', ''],
    ['saved group', 'button "Open in new window: Window 1" #1', 'button', 'Open in new window: Window 1', ''],
    ['saved group', 'div[button] "More actions" #3', 'button', 'More actions', ''],
    ['saved group', 'div[button] "Change group color: Temples" #1', 'button', 'Change group color: Temples', ''],
    ['saved group', 'button[menuitemradio] "Grey" #1', 'menuitemradio', 'Grey', ''],
    ['saved group', 'button[menuitemradio] "Blue" #1', 'menuitemradio', 'Blue', ''],
    ['saved group', 'button[menuitemradio] "Red" #1', 'menuitemradio', 'Red', ''],
    ['saved group', 'button[menuitemradio] "Yellow" #1', 'menuitemradio', 'Yellow', ''],
    ['saved group', 'button[menuitemradio] "Green" #1', 'menuitemradio', 'Green', ''],
    ['saved group', 'button[menuitemradio] "Pink" #1', 'menuitemradio', 'Pink', ''],
    ['saved group', 'button[menuitemradio] "Purple" #1', 'menuitemradio', 'Purple', ''],
    ['saved group', 'button[menuitemradio] "Cyan" #1', 'menuitemradio', 'Cyan', ''],
    ['saved group', 'button[menuitemradio] "Orange" #1', 'menuitemradio', 'Orange', ''],
    ['saved group', 'button "Open group: Temples" #1', 'button', 'Open group: Temples', ''],
    ['saved group', 'div[button] "More actions" #4', 'button', 'More actions', ''],
    ['saved group', 'div[button] "Delete tab" #1', 'button', 'Delete tab', ''],
    ['saved group', 'div[button] "Delete tab" #2', 'button', 'Delete tab', ''],
    ['saved group', 'div[button] "Collapse all windows" #2', 'button', 'Collapse all windows', ''],
    ['saved group', 'div[button] "Save all open windows as a session" #1', 'button', 'Save all open windows as a session', ''],
    ['saved group', 'anchor:fold #1', 'button', 'Fold the saved session away', ''],
    ['saved group', 'button "Back to last tab" #1', 'button', 'Back to last tab', ''],
    ['saved group', 'div[button] "Collapse: Window 1" #2', 'button', 'Collapse: Window 1', ''],
    ['saved group', 'button "Save window as a session: Window 1" #1', 'button', 'Save window as a session: Window 1', ''],
    ['saved group', 'div[button] "Close tab: about:blank" #1', 'button', 'Close tab: about:blank', ''],
  ]),
};

// Dates and times read the same on every machine and day.
const FIXED_NOW = new Date('2026-10-19T12:00:00Z');
async function pinClockAndZone(context: BrowserContext): Promise<void> {
  await context.clock.setFixedTime(FIXED_NOW);
  context.on('page', (page) => {
    void context
      .newCDPSession(page)
      .then((cdp) =>
        cdp.send('Emulation.setTimezoneOverride', { timezoneId: 'UTC' })
      )
      .catch(() => undefined);
  });
}

async function expectUtc(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)
    )
    .toBe('UTC');
}

async function seedAnswered(context: BrowserContext): Promise<void> {
  await pinClockAndZone(context);
  await seedSessions(context);
  await seedSettings(context, {});
}

test('popup home: session rows, header, toolbar and the sync button', async ({
  context,
  extensionId,
}) => {
  await seedAnswered(context);
  const page = await openPopup(context, extensionId);
  const ax = await recordAx(page, 'home');
  expect(ax).toEqual(EXPECTED.home);
});

const PANES = [
  'Display',
  'Language',
  'Quick access',
  'Sync & backup',
  'Sessions',
  'Recently deleted',
  'About',
  'Help',
];

test('Settings: every pane (no swatch or icon pair carries a title today)', async ({
  context,
  extensionId,
}) => {
  await seedAnswered(context);
  const page = await openPopup(context, extensionId);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const ax: AxRecord[] = [];
  for (const pane of PANES) {
    await page.getByRole('button', { name: pane, exact: true }).click();
    await expect(
      page.getByRole('button', { name: pane, exact: true })
    ).toBeVisible();
    ax.push(...(await recordAx(page, `settings: ${pane}`)));
  }
  expect(ax).toEqual(EXPECTED.settings);
});

test('the export page', async ({ context, extensionId }) => {
  await seedAnswered(context);
  const page = await context.newPage();
  await page.goto(
    `chrome-extension://${extensionId}/export.html?session=session-1`
  );
  await page.getByRole('button', { name: 'Edit' }).waitFor();
  const ax = await recordAx(page, 'export');
  expect(ax).toEqual(EXPECTED.export);
});

test('the Setup dialog, step by step', async ({ context, extensionId }) => {
  await pinClockAndZone(context);
  await seedSessions(context);
  await seedSettings(context, { setupState: 'pending' });
  const page = await openFullView(context, extensionId);
  const dialog = page.getByRole('dialog', {
    name: 'Make Tab Keeper yours',
    exact: true,
  });
  const ax: AxRecord[] = [];
  for (let step = 1; step <= 5; step++) {
    await expect(dialog).toBeVisible();
    ax.push(...(await recordAx(page, `setup: step ${step}`)));
    if (step < 5) {
      await dialog.getByRole('button', { name: 'Next', exact: true }).click();
    }
  }
  expect(ax).toEqual(EXPECTED.setup);
});

// The run's own session waits for the tour: its Open, Switch and Replace read the reason (KAN-413, KAN-586).
test('the tour: Open, Switch and Replace wait for the tour', async ({
  context,
  extensionId,
}) => {
  await seedAnswered(context);
  await (await context.newPage()).goto(standIn('Inbox'));
  const page = await openRunFromHelp(context, extensionId, POPUP_RUN);
  await page
    .locator('[data-tour-anchor="save"]')
    .getByRole('button', {
      name: 'Save all open windows as a session',
      exact: true,
    })
    .click();
  await expect(cardAt(page, 2)).toBeVisible();
  const ax: AxRecord[] = [];
  for (let step = 3; step <= 5; step++) {
    await nextTo(page, step);
    await landedAt(page, step);
    ax.push(...(await recordAx(page, `tour: step ${step}`)));
  }
  expect(ax).toEqual(EXPECTED.tour);
});

grantedTest(
  'full view: Open now, its folded rail and a group colour picker',
  async ({ context, extensionId, serviceWorker }) => {
    await pinClockAndZone(context);
    await seedSessions(context);
    await seedSettings(context, { foldSavedSessionInTabView: false });
    const page = await openPage(context, extensionId, FULL_VIEW_PATH, FULL);
    const { windowId } = await serviceWorker.evaluate(async (urls) => {
      const win = await chrome.windows.create({ url: urls, focused: false });
      const [first, second] = (win?.tabs ?? []).map((tab) => tab.id ?? -1);
      const groupId = await chrome.tabs.group({
        tabIds: [first, second],
        createProperties: { windowId: win?.id },
      });
      await chrome.tabGroups.update(groupId, { title: 'Kyoto', color: 'blue' });
      return { windowId: win?.id ?? -1 };
    }, ['Temples', 'Gardens', 'Loose'].map(standIn));
    const block = page.locator(`[data-open-window-id="${windowId}"]`);
    // Barrier: the group's name and every tab's title have arrived.
    await block
      .getByRole('button', { name: 'Change group color: Kyoto' })
      .waitFor();
    for (const title of ['Temples', 'Gardens', 'Loose']) {
      await block
        .getByRole('button', { name: `Close tab: ${title}` })
        .waitFor();
    }
    const ax: AxRecord[] = await recordAx(page, 'full view: Open now');

    await block
      .getByRole('button', { name: 'Change group color: Kyoto' })
      .click();
    await page.getByRole('menuitemradio', { name: 'Green' }).waitFor();
    ax.push(...(await recordAx(page, 'full view: group colour picker open')));
    await page.keyboard.press('Escape');

    await page.setViewportSize({ width: 900, height: 800 });
    const rail = page.getByRole('button', { name: /^Open now/ });
    await rail.waitFor();
    ax.push(...(await recordAx(page, 'full view: folded rail')));
    await rail.click();
    await page.getByRole('dialog', { name: 'Open now' }).waitFor();
    ax.push(...(await recordAx(page, 'full view: Open now drawer')));
    expect(ax).toEqual(EXPECTED.fullView);
  }
);

grantedTest(
  'full view: a saved session with a Chrome group, its band and colour picker',
  async ({ context, extensionId }) => {
    await pinClockAndZone(context);
    const grouped = session('S1', 'Kyoto trip', [
      groupedWindow('w1', 'Window 1', [
        { groupId: 'g1', title: 'Temples', color: 'blue' },
      ]),
    ]);
    const page = await openSaved(context, extensionId, 'tab view', {
      sessions: [grouped],
    });
    await page
      .getByRole('button', { name: 'Change group color: Temples' })
      .click();
    await page.getByRole('menuitemradio', { name: 'Green' }).waitFor();
    const ax = await recordAx(page, 'saved group');
    expect(ax).toEqual(EXPECTED.savedGroup);
  }
);
