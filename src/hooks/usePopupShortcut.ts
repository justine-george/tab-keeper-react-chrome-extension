import { useEffect, useState } from 'react';

/**
 * The key Chrome has actually bound to opening the popup (KAN-256), or '' if
 * none -- read from chrome.commands.getAll(), never from the manifest's
 * suggestion, which Chrome honours only when the key is free.
 *
 * `undefined` until the first answer, so a caller can tell "not yet known"
 * from "known to be unset" and not flash "Not set" for a frame.
 *
 * Read again when the page becomes visible or focused: the shortcut is changed
 * on Chrome's own page, and the user comes back from it.
 */
export function usePopupShortcut(): string | undefined {
  // Initialised, not set in the effect: outside an extension there is no
  // chrome.commands and the answer is known at mount. Setting it from the
  // effect would be a synchronous setState in an effect -- a render for
  // nothing (react-hooks/set-state-in-effect).
  const hasCommands =
    typeof chrome !== 'undefined' && chrome.commands !== undefined;
  const [shortcut, setShortcut] = useState<string | undefined>(
    hasCommands ? undefined : ''
  );

  useEffect(() => {
    if (!hasCommands) return;
    let cancelled = false;
    // Only the newest read may answer: an older one can settle after it.
    let newest = 0;
    const read = () => {
      const mine = ++newest;
      void Promise.resolve(chrome.commands.getAll()).then((commands) => {
        if (cancelled || mine !== newest) return;
        const open = commands.find((c) => c.name === '_execute_action');
        setShortcut(open?.shortcut ?? '');
      });
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') read();
    };
    read();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', read);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', read);
    };
  }, [hasCommands]);

  return shortcut;
}

/** The one place Chrome lets a user rebind an extension's shortcuts. */
export const CHROME_SHORTCUTS_URL = 'chrome://extensions/shortcuts';

/**
 * Opens Chrome's shortcuts page right after this tab, as its child, so closing
 * it returns here. The popup is no tab, so it just opens one.
 */
export async function openShortcutsBeside(): Promise<void> {
  const current = await chrome.tabs.getCurrent().catch(() => undefined);
  if (current?.id === undefined || !Number.isInteger(current.index)) {
    await chrome.tabs.create({ url: CHROME_SHORTCUTS_URL });
    return;
  }
  await chrome.tabs.create({
    url: CHROME_SHORTCUTS_URL,
    index: current.index + 1,
    openerTabId: current.id,
    windowId: current.windowId,
  });
}
