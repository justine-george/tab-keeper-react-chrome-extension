import { useEffect, useState } from 'react';

/**
 * The key Chrome has actually bound to opening the popup (KAN-256), or '' if
 * none -- read from chrome.commands.getAll(), never from the manifest's
 * suggestion, which Chrome honours only when the key is free.
 *
 * `undefined` until the first answer, so a caller can tell "not yet known"
 * from "known to be unset" and not flash "Not set" for a frame.
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
    void Promise.resolve(chrome.commands.getAll()).then((commands) => {
      if (cancelled) return;
      const open = commands.find((c) => c.name === '_execute_action');
      setShortcut(open?.shortcut ?? '');
    });
    return () => {
      cancelled = true;
    };
  }, [hasCommands]);

  return shortcut;
}

/** The one place Chrome lets a user rebind an extension's shortcuts. */
export const CHROME_SHORTCUTS_URL = 'chrome://extensions/shortcuts';
