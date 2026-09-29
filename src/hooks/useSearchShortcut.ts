import { useEffect, useRef } from 'react';

import { isSearchShortcut } from '../components/home/opennow/searchShortcut';

/**
 * Calls `onShortcut` on the search shortcut (KAN-330 O14b) while it is not
 * null. The latest handler is read through a ref, so a caller passing a new
 * closure each render doesn't re-bind the listener.
 */
export function useSearchShortcut(onShortcut: (() => void) | null): void {
  const latest = useRef(onShortcut);
  useEffect(() => {
    latest.current = onShortcut;
  });
  const active = onShortcut !== null;
  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isSearchShortcut(event)) return;
      // Before focus moves: otherwise the / is typed into the field.
      event.preventDefault();
      latest.current?.();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [active]);
}
