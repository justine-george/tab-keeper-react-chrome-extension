// KAN-689. Rings and keyboard reveals draw only while the user navigates by
// keyboard. Chrome's :focus-visible also matches a scripted focus after ANY
// key (a click, then Delete, moves focus to the next row) and every focused
// text field. A navigation key sets this; any pointer press clears it; other
// keys (Delete, Enter, Esc, typing) leave it as it was. In a text field the
// arrows, Home and End move the caret: they set it only if focus moves on
// them (KAN-685).
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

// The input types whose arrows, Home and End move a caret. A radio's move focus.
const CARET_INPUT_TYPES = new Set([
  'text',
  'search',
  'url',
  'tel',
  'email',
  'password',
]);

function holdsCaret(target: EventTarget | null): boolean {
  if (target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLInputElement)
    return CARET_INPUT_TYPES.has(target.type);
  return target instanceof HTMLElement && target.isContentEditable;
}

// On the window, capturing, so a handler that stops a key or press can't
// hide it. Returns the undo.
export function trackKeyNav(win: Window): () => void {
  const root = win.document.documentElement;
  const start = () => root.setAttribute(KEY_NAV_ATTRIBUTE, '');
  // A caret key's handlers run after this listener: a focus they move (the
  // search field's ArrowDown to a result) arrives as a focusin before paint.
  let caretKeyInFlight = false;
  const onKeyDown = (event: KeyboardEvent) => {
    if (!NAVIGATION_KEYS.has(event.key)) return;
    if (event.key === 'Tab' || !holdsCaret(event.target)) {
      start();
      return;
    }
    caretKeyInFlight = true;
    win.setTimeout(() => (caretKeyInFlight = false));
  };
  const onFocusIn = () => {
    if (caretKeyInFlight) start();
  };
  const onPointerDown = () => root.removeAttribute(KEY_NAV_ATTRIBUTE);
  win.addEventListener('keydown', onKeyDown, true);
  win.addEventListener('focusin', onFocusIn, true);
  win.addEventListener('pointerdown', onPointerDown, true);
  return () => {
    win.removeEventListener('keydown', onKeyDown, true);
    win.removeEventListener('focusin', onFocusIn, true);
    win.removeEventListener('pointerdown', onPointerDown, true);
  };
}
