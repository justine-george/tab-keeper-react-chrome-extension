import type { tabData } from '../../redux/slices/tabContainerDataStateSlice';
import { normalizeTitle, resolveTabUrl } from './local';

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

// KAN-824. The address a tab's hover shows: where it goes, its middle cut past ~300 characters (a data: image runs to megabytes).
const TOOLTIP_ADDRESS_MAX = 300;
export function tooltipAddress(url: string): string {
  const address = resolveTabUrl(url);
  if (address.length <= TOOLTIP_ADDRESS_MAX) return address;
  const half = TOOLTIP_ADDRESS_MAX / 2;
  return `${address.slice(0, half)}…${address.slice(-half)}`;
}

// KAN-824. A saved tab's hover: its address; a renamed one, its page title above that.
export function addressTooltip(
  tab: Pick<tabData, 'title' | 'url' | 'customTitle'>
): string {
  const address = tooltipAddress(tab.url);
  return tab.customTitle !== undefined && tab.title !== ''
    ? `${tab.title}\n${address}`
    : address;
}
