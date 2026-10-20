import { suspendedTabAddress } from './sessionExportHtml';

// KAN-708. Copies a tab's address (a suspended tab's real page); false if refused, never rejects.
export async function copyTabLink(url: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(suspendedTabAddress(url));
    return true;
  } catch {
    return false;
  }
}
