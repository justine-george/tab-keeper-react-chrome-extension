// KAN-746 Part 2. Sort groups by name: only the groups move, into the slots groups held; loose and pinned tabs keep theirs.
import type { windowGroupData } from '../../redux/slices/tabContainerDataStateSlice';
import { nameCollator } from './nameCollator';

// What the order reads of a tab; saved and live tabs both map onto it.
interface GroupedTab {
  key: string;
  groupKey: string | null;
}

// `keys` by name A→Z, unnamed (empty or only spaces) last; equal names and unnamed keep the order given.
export function byName<K>(
  keys: readonly K[],
  titleOf: (key: K) => string,
  locale: string
): K[] {
  const collator = nameCollator(locale);
  const named = (key: K) => titleOf(key).trim() !== '';
  // Array sort is stable, so ties keep their order.
  return [...keys].sort((a, b) => {
    if (named(a) && named(b)) return collator.compare(titleOf(a), titleOf(b));
    return Number(named(b)) - Number(named(a));
  });
}

// A window's slots: each loose tab, and each group once, at its first tab.
type Slot<T> = { tab: T } | { group: string };

export function sortGroupsByName<T extends GroupedTab>(
  tabs: readonly T[],
  titleOf: (groupKey: string) => string,
  locale: string
): T[] {
  const slots: Slot<T>[] = [];
  const members = new Map<string, T[]>();
  for (const tab of tabs) {
    if (tab.groupKey === null) {
      slots.push({ tab });
      continue;
    }
    const block = members.get(tab.groupKey);
    if (block) block.push(tab);
    else {
      members.set(tab.groupKey, [tab]);
      slots.push({ group: tab.groupKey });
    }
  }
  const sorted = byName([...members.keys()], titleOf, locale);
  let next = 0;
  return slots.flatMap((slot) =>
    'tab' in slot ? [slot.tab] : (members.get(sorted[next++]) ?? [])
  );
}

export function isSortedGroupsByName(
  tabs: readonly GroupedTab[],
  titleOf: (groupKey: string) => string,
  locale: string
): boolean {
  return sortGroupsByName(tabs, titleOf, locale).every(
    (tab, i) => tab === tabs[i]
  );
}

// A saved group's title by its uuid; a group with no chromeTabGroups entry has none.
export function savedGroupTitles(
  window: Pick<windowGroupData, 'chromeTabGroups'>
): (groupKey: string) => string {
  const titles = new Map(
    (window.chromeTabGroups ?? []).map((g) => [g.groupId, g.title])
  );
  return (groupKey) => titles.get(groupKey) ?? '';
}

export function isSavedWindowGroupsSortedByName(
  window: Pick<windowGroupData, 'tabs' | 'chromeTabGroups'>,
  locale: string
): boolean {
  return isSortedGroupsByName(
    window.tabs.map((tab) => ({
      key: tab.tabId,
      groupKey: tab.chromeGroupId ?? null,
    })),
    savedGroupTitles(window),
    locale
  );
}
