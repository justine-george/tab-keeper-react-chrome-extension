import type { ClosedItem, Reopened } from './reopen';
import type {
  OpenGroup,
  OpenTab,
  OpenWindow,
  OpenWindowBounds,
} from './openNow';
import { sanitizeTabGroupColor } from './tabGroups';

// The message Open now's page sends the service worker to reopen a closed
// tab or window, preferring its history when Chrome still has it, and the
// checks on both ends of it (KAN-280 Part D). DOM-free and free of runtime
// imports beyond tabGroups.ts: the service worker loads this file.

// What the page asks the service worker for. The item arrives as a
// structured clone, checked by isReopenPreferringHistoryRequest.
export const REOPEN_PREFERRING_HISTORY_MESSAGE = 'reopenPreferringHistory';

export interface ReopenPreferringHistoryRequest {
  type: typeof REOPEN_PREFERRING_HISTORY_MESSAGE;
  item: ClosedItem;
}

// The worker's answer, checked on the page's side.
export function isReopened(value: unknown): value is Reopened {
  if (!isRecord(value)) return false;
  if (value.kind === 'tab') return typeof value.tabId === 'number';
  if (value.kind === 'window') return typeof value.windowId === 'number';
  return false;
}

// The request guard. The item crosses from the page as a structured clone, so
// every field reopening reads is checked here, in the worker, before it is
// trusted.
export function isReopenPreferringHistoryRequest(
  message: unknown
): message is ReopenPreferringHistoryRequest {
  return (
    isRecord(message) &&
    message.type === REOPEN_PREFERRING_HISTORY_MESSAGE &&
    isClosedItem(message.item)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isClosedItem(value: unknown): value is ClosedItem {
  if (!isRecord(value)) return false;
  if (
    typeof value.restorableSessionId !== 'string' &&
    value.restorableSessionId !== null
  ) {
    return false;
  }
  if (!isOpenWindow(value.window)) return false;
  if (value.kind === 'window') return true;
  return (
    value.kind === 'tab' &&
    isOpenTab(value.tab) &&
    (value.group === null || isOpenGroup(value.group))
  );
}

const WINDOW_STATES: readonly unknown[] = [
  'normal',
  'minimized',
  'maximized',
  'fullscreen',
  'locked-fullscreen',
];

function isOpenWindow(value: unknown): value is OpenWindow {
  return (
    isRecord(value) &&
    typeof value.id === 'number' &&
    typeof value.isThisWindow === 'boolean' &&
    Array.isArray(value.tabs) &&
    value.tabs.every(isOpenTab) &&
    Array.isArray(value.groups) &&
    value.groups.every(isOpenGroup) &&
    (value.bounds === null || isBounds(value.bounds)) &&
    WINDOW_STATES.includes(value.state) &&
    typeof value.incognito === 'boolean'
  );
}

function isBounds(value: unknown): value is OpenWindowBounds {
  return (
    isRecord(value) &&
    typeof value.left === 'number' &&
    typeof value.top === 'number' &&
    typeof value.width === 'number' &&
    typeof value.height === 'number'
  );
}

function isOpenTab(value: unknown): value is OpenTab {
  return (
    isRecord(value) &&
    typeof value.id === 'number' &&
    typeof value.windowId === 'number' &&
    typeof value.title === 'string' &&
    typeof value.url === 'string' &&
    typeof value.favIconUrl === 'string' &&
    typeof value.active === 'boolean' &&
    typeof value.pinned === 'boolean' &&
    typeof value.audible === 'boolean' &&
    typeof value.muted === 'boolean' &&
    (value.groupId === null || typeof value.groupId === 'number') &&
    typeof value.index === 'number'
  );
}

function isOpenGroup(value: unknown): value is OpenGroup {
  return (
    isRecord(value) &&
    typeof value.id === 'number' &&
    typeof value.title === 'string' &&
    typeof value.color === 'string' &&
    sanitizeTabGroupColor(value.color) === value.color &&
    typeof value.collapsed === 'boolean'
  );
}
