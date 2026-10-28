// KAN-851. The saved look of each copy Tab Keeper opened in Currently open, by
// the id Chrome gave it. Chrome has no title for a new tab until its page
// loads, so Open now draws the saved one meanwhile (toOpenWindows). Kept in
// the page that opened the copies, for as long as Chrome is loading them.

export interface CopyLook {
  title: string;
  favIconUrl: string;
}

const looks = new Map<number, CopyLook>();

export function rememberCopyLook(tabId: number, look: CopyLook): void {
  looks.set(tabId, look);
}

export function copyLooks(): ReadonlyMap<number, CopyLook> {
  return looks;
}

// Forgets each copy `windows` shows loaded. Not one they leave out: a read
// begun before Chrome made it does not list it yet. Chrome never reuses a tab
// id, so a copy closed while loading leaves a look no other tab takes.
export function forgetCopyLooks(
  windows: readonly chrome.windows.Window[]
): void {
  for (const w of windows)
    for (const t of w.tabs ?? [])
      if (t.id !== undefined && t.status === 'complete') looks.delete(t.id);
}
