import { useEffect, useRef } from 'react';

// KAN-724, KAN-927. React's onMouseLeave is built from mouseout, and a field
// removed from under the pointer sends none; the native mouseleave still comes.
// It does not bubble, so one capturing listener hears every element's.
export function useNativeMouseLeave(
  isWatched: (element: Element) => boolean,
  onLeave: () => void
): void {
  const latest = useRef({ isWatched, onLeave });
  latest.current = { isWatched, onLeave };
  useEffect(() => {
    const listener = (event: Event) => {
      const { target } = event;
      if (target instanceof Element && latest.current.isWatched(target)) {
        latest.current.onLeave();
      }
    };
    document.addEventListener('mouseleave', listener, true);
    return () => document.removeEventListener('mouseleave', listener, true);
  }, []);
}
