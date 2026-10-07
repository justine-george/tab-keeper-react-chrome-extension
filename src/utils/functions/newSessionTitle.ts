import type {
  CarriedRef,
  tabContainerData,
} from '../../redux/slices/tabContainerDataStateSlice';
import { normalizeTitle } from './local';

/**
 * KAN-394 N4. What a session made by moving `carried` into it is called: a
 * tab's title; a group's name, else its first tab's title; a window's name,
 * else its first tab's title. '' when every candidate is blank, or the item is
 * not there.
 */
export function newSessionTitleOf(
  tabGroups: readonly tabContainerData[],
  carried: CarriedRef
): string {
  const w = tabGroups
    .find((g) => g.tabGroupId === carried.tabGroupId)
    ?.windows.find((x) => x.windowId === carried.windowId);
  if (w === undefined) return '';

  const candidates: string[] = [];
  switch (carried.kind) {
    case 'tab':
      candidates.push(
        w.tabs.find((t) => t.tabId === carried.tabId)?.title ?? ''
      );
      break;
    case 'group':
      candidates.push(
        w.chromeTabGroups?.find((g) => g.groupId === carried.groupId)?.title ??
          '',
        w.tabs.find((t) => t.chromeGroupId === carried.groupId)?.title ?? ''
      );
      break;
    case 'window':
      candidates.push(w.title, w.tabs[0]?.title ?? '');
      break;
  }
  return candidates.map(normalizeTitle).find((t) => t !== '') ?? '';
}
