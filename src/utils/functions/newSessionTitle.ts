import type {
  tabContainerData,
  windowGroupData,
} from '../../redux/slices/tabContainerDataStateSlice';
import {
  pickOf,
  sourceWindowOf,
  type CarriedItem,
  type CarriedPick,
} from '../../redux/carriedItem';
import { normalizeTitle } from './local';

// KAN-394 N4, KAN-280 Part F. The same rule for a pick inside any window: a saved source, or a live snapshot (P12).
export function titleOfPick(w: windowGroupData, pick: CarriedPick): string {
  const candidates: string[] = [];
  switch (pick.kind) {
    case 'tab':
      candidates.push(w.tabs.find((t) => t.tabId === pick.tabId)?.title ?? '');
      break;
    case 'group':
      candidates.push(
        w.chromeTabGroups?.find((g) => g.groupId === pick.groupId)?.title ?? '',
        w.tabs.find((t) => t.chromeGroupId === pick.groupId)?.title ?? ''
      );
      break;
    case 'window':
      candidates.push(w.title, w.tabs[0]?.title ?? '');
      break;
  }
  return candidates.map(normalizeTitle).find((t) => t !== '') ?? '';
}

/**
 * KAN-394 N4. What a session made by moving `item` into it is called: a
 * tab's title; a group's name, else its first tab's title; a window's name,
 * else its first tab's title. '' when every candidate is blank, or the item is
 * not there.
 */
export function newSessionTitleOf(
  tabGroups: readonly tabContainerData[],
  item: CarriedItem
): string {
  const w = sourceWindowOf(tabGroups, item);
  return w === null ? '' : titleOfPick(w, pickOf(item));
}
