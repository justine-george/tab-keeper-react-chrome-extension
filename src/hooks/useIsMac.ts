import { useEffect, useState } from 'react';

// null until Chrome says the platform; false if it can't, as most platforms are not a Mac.
export function useIsMac(): boolean | null {
  const [isMac, setIsMac] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    chrome.runtime
      .getPlatformInfo()
      .then((info) => {
        if (live) setIsMac(info.os === 'mac');
      })
      .catch((error: unknown) => {
        console.warn('Could not read the platform: ', error);
        if (live) setIsMac(false);
      });
    return () => {
      live = false;
    };
  }, []);
  return isMac;
}

// KAN-592. For naming keys: false until Chrome says Mac, so a PC renders once and never again.
export function useMacKeys(): boolean {
  const [isMac, setIsMac] = useState(false);
  useEffect(() => {
    let live = true;
    chrome.runtime
      .getPlatformInfo()
      .then((info) => {
        if (live && info.os === 'mac') setIsMac(true);
      })
      .catch((error: unknown) => {
        console.warn('Could not read the platform: ', error);
      });
    return () => {
      live = false;
    };
  }, []);
  return isMac;
}
