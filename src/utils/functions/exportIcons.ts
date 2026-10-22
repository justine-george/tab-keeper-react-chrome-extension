import { Base64 } from 'js-base64';

import type { tabContainerData } from '../../redux/slices/tabContainerDataStateSlice';

// KAN-603. Never visited, so Chrome's cache answers it with the globe (measured).
export const GLOBE_PROBE_URL = 'https://never-visited.invalid/';
export const ICON_FETCH_TIMEOUT_MS = 800;

const PNG_DATA_URI = /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/;

// KAN-603. The only icon value the file or the editor ever writes: nothing that can close a url() or an attribute.
export const isPngDataUri = (value: string): boolean =>
  PNG_DATA_URI.test(value);

// KAN-603. Chrome's cached icon for any page, chrome:// and about: included (resolveFaviconUrl is http(s) only).
export function faviconRequestOf(pageUrl: string): string {
  const url = new URL(chrome.runtime.getURL('/_favicon/'));
  url.searchParams.set('pageUrl', pageUrl);
  url.searchParams.set('size', '32');
  return url.toString();
}

// KAN-594/603. The PNG at address, inlined; null on a throw, non-OK, zero bytes, or past timeoutMs when given.
export async function fetchPngDataUri(
  address: string,
  timeoutMs?: number
): Promise<string | null> {
  const controller = new AbortController();
  const timer =
    timeoutMs === undefined
      ? undefined
      : setTimeout(() => controller.abort(), timeoutMs);
  const read = async (): Promise<string | null> => {
    const response = await fetch(address, { signal: controller.signal });
    if (!response.ok) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length === 0) return null;
    return `data:image/png;base64,${Base64.fromUint8Array(bytes)}`;
  };
  const aborted = new Promise<null>((resolve) =>
    controller.signal.addEventListener('abort', () => resolve(null))
  );
  try {
    return await Promise.race([read(), aborted]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// KAN-603. Each distinct address once, all in parallel; an empty or failed one takes the globe, absent when even that fails.
export async function readExportIcons(
  urls: readonly string[]
): Promise<ReadonlyMap<string, string>> {
  const distinct = [...new Set(urls)];
  const read = async (url: string) =>
    url ? fetchPngDataUri(faviconRequestOf(url), ICON_FETCH_TIMEOUT_MS) : null;
  const [globe, ...answers] = (
    await Promise.allSettled([read(GLOBE_PROBE_URL), ...distinct.map(read)])
  ).map((settled) => (settled.status === 'fulfilled' ? settled.value : null));
  const icons = new Map<string, string>();
  distinct.forEach((url, i) => {
    const icon = answers[i] ?? globe;
    if (icon) icons.set(url, icon);
  });
  return icons;
}

// KAN-603. Changes only when the set of addresses does, so renames and hides never refetch.
export const exportIconKey = (session: tabContainerData): string =>
  [
    ...new Set(
      session.windows.flatMap((window) => window.tabs.map((tab) => tab.url))
    ),
  ]
    .sort()
    .join('\n');
