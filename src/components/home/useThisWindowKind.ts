import { useEffect, useState } from 'react';

import { isIncognitoAllowed } from '../../utils/functions/restoreSession';

// KAN-892 spec 7. Whether this window is incognito, read as Open's press
// reads it (chrome.windows.getCurrent), and whether Tab Keeper may open
// incognito windows; null until both are known, or when this window can't be
// read. Read once per mount.
export interface ThisWindowKind {
  incognito: boolean;
  incognitoAllowed: boolean;
}

export function useThisWindowKind(): ThisWindowKind | null {
  const [kind, setKind] = useState<ThisWindowKind | null>(null);
  useEffect(() => {
    let live = true;
    const read = async (): Promise<ThisWindowKind | null> => {
      try {
        const current: chrome.windows.Window | undefined =
          await chrome.windows.getCurrent();
        if (current === undefined) return null;
        return {
          incognito: current.incognito,
          incognitoAllowed: await isIncognitoAllowed(),
        };
      } catch {
        return null;
      }
    };
    void read().then((read) => {
      if (live) setKind(read);
    });
    return () => {
      live = false;
    };
  }, []);
  return kind;
}
