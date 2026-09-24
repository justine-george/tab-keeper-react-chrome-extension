import { useCallback, useSyncExternalStore } from 'react';

// Whether `query` matches now, re-rendering when that changes (a resized
// window). The CSS in the same component answers the same question for the
// layout; this answers it for what is rendered at all.
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    [query]
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches
  );
}
