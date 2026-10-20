import { suspendedTabAddress } from './sessionExportHtml';

/**
 * KAN-708. Puts one tab's address on the clipboard: the page a suspended tab stands for, not its placeholder.
 *
 * Resolves false when the write is refused, never rejects; the caller shows no toast for a copy that did not happen.
 */
export async function copyTabLink(url: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(suspendedTabAddress(url));
    return true;
  } catch {
    return false;
  }
}
