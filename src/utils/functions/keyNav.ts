// KAN-689. Rings and keyboard reveals draw only while the user navigates by
// keyboard. Chrome's :focus-visible also matches a scripted focus after ANY
// key (a click, then Delete, moves focus to the next row) and every focused
// text field. A navigation key sets this; any pointer press clears it; other
// keys (Delete, Enter, Esc, typing) leave it as it was.
export const KEY_NAV_ATTRIBUTE = 'data-key-nav';

const NAVIGATION_KEYS = new Set([
  'Tab',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
]);

// On the window, capturing, so a handler that stops a key or press can't
// hide it. Returns the undo.
export function trackKeyNav(win: Window): () => void {
  const root = win.document.documentElement;
  const onKeyDown = (event: KeyboardEvent) => {
    if (NAVIGATION_KEYS.has(event.key))
      root.setAttribute(KEY_NAV_ATTRIBUTE, '');
  };
  const onPointerDown = () => root.removeAttribute(KEY_NAV_ATTRIBUTE);
  win.addEventListener('keydown', onKeyDown, true);
  win.addEventListener('pointerdown', onPointerDown, true);
  return () => {
    win.removeEventListener('keydown', onKeyDown, true);
    win.removeEventListener('pointerdown', onPointerDown, true);
  };
}
