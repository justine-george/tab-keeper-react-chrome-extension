// KAN-280 Part F (spec O12c). What a carry carries and where it came from; one reader for every consumer.
import type {
  CarriedRef,
  tabContainerData,
  windowGroupData,
} from './slices/tabContainerDataStateSlice';
import { isCarriedStillThere } from '../utils/functions/tabGroups';

// Only saved items today; Part F's PR 2 adds Open now's live items.
export type CarriedItem = { source: 'saved'; ref: CarriedRef };

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

export function pickOf(item: CarriedItem): CarriedPick {
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

export const sourceSessionIdOf = (item: CarriedItem): string =>
  item.ref.tabGroupId;

// The window the item is in, as the store holds it now; null once it is gone.
export function sourceWindowOf(
  tabGroups: readonly tabContainerData[],
  item: CarriedItem
): windowGroupData | null {
  return (
    tabGroups
      .find((g) => g.tabGroupId === item.ref.tabGroupId)
      ?.windows.find((w) => w.windowId === item.ref.windowId) ?? null
  );
}

export const isItemStillThere = (
  tabGroups: readonly tabContainerData[],
  item: CarriedItem
): boolean => isCarriedStillThere(tabGroups, item.ref);

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
