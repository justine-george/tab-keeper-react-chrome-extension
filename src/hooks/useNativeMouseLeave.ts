import { useEffect, useRef } from 'react';

// KAN-724, KAN-927. React's onMouseLeave is built from mouseout, and a field
// removed from under the pointer sends none; the native mouseleave still comes.
// It does not bubble, so one capturing listener hears every element's. It comes
// after React's onMouseEnter for whatever the pointer moved onto.
export function useNativeMouseLeave(
  isWatched: (element: Element) => boolean,
  onLeave: (element: Element) => void
): void {
  const latest = useRef({ isWatched, onLeave });
  useEffect(() => {
    latest.current = { isWatched, onLeave };
  });
  useEffect(() => {
    const listener = (event: Event) => {
      const { target } = event;
      if (target instanceof Element && latest.current.isWatched(target)) {
        latest.current.onLeave(target);
      }
    };
    document.addEventListener('mouseleave', listener, true);
    return () => document.removeEventListener('mouseleave', listener, true);
  }, []);
}
