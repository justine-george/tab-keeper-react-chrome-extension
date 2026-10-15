// KAN-280 Part F (spec O12c). What a carry carries and where it came from; one reader for every consumer.
import type {
  CarriedRef,
  tabContainerData,
  windowGroupData,
} from './slices/tabContainerDataStateSlice';
import { isCarriedStillThere } from '../utils/functions/tabGroups';

// A saved item is its ref; a live one (KAN-280 Part F) its snapshot.
export type CarriedItem =
  { source: 'saved'; ref: CarriedRef } | { source: 'live'; live: LiveSnapshot };

export const savedItem = (ref: CarriedRef): CarriedItem => ({
  source: 'saved',
  ref,
});

// The item's kind and its ids inside its source window.
export type CarriedPick =
  | { kind: 'tab'; windowId: string; tabId: string }
  | { kind: 'group'; windowId: string; groupId: string }
  | { kind: 'window'; windowId: string };

// KAN-280 Part F (Q1 A). A live item as it was picked up: its pick inside its Chrome window, converted to storage shape then.
export interface LiveSnapshot {
  pick: CarriedPick;
  window: windowGroupData;
  // The Chrome window it was read from, for the place read when the carry starts (P6).
  chromeWindowId: number;
}

export const liveItem = (live: LiveSnapshot): CarriedItem => ({
  source: 'live',
  live,
});

export function pickOf(item: CarriedItem): CarriedPick {
  if (item.source === 'live') return item.live.pick;
  const { ref } = item;
  switch (ref.kind) {
    case 'tab':
      return { kind: 'tab', windowId: ref.windowId, tabId: ref.tabId };
    case 'group':
      return { kind: 'group', windowId: ref.windowId, groupId: ref.groupId };
    case 'window':
      return { kind: 'window', windowId: ref.windowId };
  }
}

// Null for a live item: it came from no saved session (P3).
export const sourceSessionIdOf = (item: CarriedItem): string | null =>
  item.source === 'saved' ? item.ref.tabGroupId : null;

// The window the item is in: a saved one as the store holds it now (null once it is gone), a live one's snapshot.
export function sourceWindowOf(
  tabGroups: readonly tabContainerData[],
  item: CarriedItem
): windowGroupData | null {
  if (item.source === 'live') return item.live.window;
  return (
    tabGroups
      .find((g) => g.tabGroupId === item.ref.tabGroupId)
      ?.windows.find((w) => w.windowId === item.ref.windowId) ?? null
  );
}

// Q1 A. A live item is its snapshot, so nothing can take it away.
export const isItemStillThere = (
  tabGroups: readonly tabContainerData[],
  item: CarriedItem
): boolean =>
  item.source === 'live' || isCarriedStillThere(tabGroups, item.ref);

// Q2 A. A live tab or group lands only in a saved window of its own kind, or a new one (`undefined`); a saved item, or none, anywhere.
export const acceptsCarriedIn = (
  item: CarriedItem | null,
  window: Pick<windowGroupData, 'incognito'> | undefined
): boolean =>
  item === null ||
  item.source === 'saved' ||
  window === undefined ||
  (window.incognito === true) === (item.live.window.incognito === true);

export function isCarriedTabPinned(
  tabGroups: readonly tabContainerData[],
  item: CarriedItem
): boolean {
  const pick = pickOf(item);
  if (pick.kind !== 'tab') return false;
  return (
    sourceWindowOf(tabGroups, item)?.tabs.find((t) => t.tabId === pick.tabId)
      ?.pinned === true
  );
}
