// KAN-350. A row drop into the session on screen lands as that session's
// first window, at the TOP of the detail -- which may be scrolled far from
// it, and nothing the drop touched is in the detail to follow it there
// (KAN-155 follows only a row the detail's own engine dropped). So the drop
// asks, and the detail, which owns its rows, brings that window into view.
//
// One detail is mounted at a time, so one handler: the latest to register.
// Nothing registered (no detail on screen) means nothing to bring into view.
type Reveal = (windowId: string) => void;

let reveal: Reveal | null = null;

export function onRevealSavedWindow(fn: Reveal): () => void {
  reveal = fn;
  return () => {
    if (reveal === fn) reveal = null;
  };
}

export function revealSavedWindow(windowId: string): void {
  reveal?.(windowId);
}
