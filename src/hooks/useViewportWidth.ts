import { useSyncExternalStore } from 'react';

// The window's CSS width, re-rendering when it changes. innerWidth, not the
// body's: the tab view has no page scrollbar (each pane scrolls itself), so
// the two agree, and innerWidth is what a resize event reports.
const subscribe = (onChange: () => void) => {
  window.addEventListener('resize', onChange);
  return () => window.removeEventListener('resize', onChange);
};

export function useViewportWidth(): number {
  return useSyncExternalStore(subscribe, () => window.innerWidth);
}
