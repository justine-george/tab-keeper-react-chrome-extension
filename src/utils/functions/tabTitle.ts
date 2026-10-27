import type { tabData } from '../../redux/slices/tabContainerDataStateSlice';
import { normalizeTitle } from './local';

// KAN-824. The name a saved tab shows: the user's own, else the page's.
export function shownTitle(
  tab: Pick<tabData, 'title' | 'customTitle'>
): string {
  return tab.customTitle ?? tab.title;
}

// For outputs that print one name per tab (export, copied links): title becomes the shown name.
export function withShownTitle(tab: tabData): tabData {
  const out = { ...tab, title: shownTitle(tab) };
  delete out.customTitle;
  return out;
}

// The custom name a typed rename keeps: none when it is blank or the page title itself.
export function customTitleFrom(
  typed: string,
  pageTitle: string
): string | undefined {
  const name = normalizeTitle(typed);
  return name === '' || name === normalizeTitle(pageTitle) ? undefined : name;
}
