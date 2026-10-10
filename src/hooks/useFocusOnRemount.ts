import { useCallback, useEffect, useRef } from 'react';

// KAN-389, KAN-400. Focus for a control the next render mounts again, such as the title button a rename field replaced.
// `ask(key)` before the update; `refFor(key)` on the control. The ask lasts one commit, so a control that does not come back takes nothing later.
export function useFocusOnRemount(): {
  ask: (key: string) => void;
  refFor: (key: string) => (element: HTMLElement | null) => void;
} {
  const asked = useRef<string | null>(null);
  // After every commit: refs attach before passive effects, so a control mounted in this commit has already taken its focus.
  useEffect(() => {
    asked.current = null;
  });
  const ask = useCallback((key: string) => {
    asked.current = key;
  }, []);
  const refFor = useCallback(
    (key: string) => (element: HTMLElement | null) => {
      if (element === null || asked.current !== key) return;
      asked.current = null;
      element.focus();
    },
    []
  );
  return { ask, refFor };
}
