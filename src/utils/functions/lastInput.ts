// KAN-982. Whether the user's last input was a key or a press, for motion
// that plays only for the pointer: a menu opened or closed from the keyboard
// appears and goes at once. Unlike keyNav (KAN-689), every key counts.
let lastWasKey = false;

// On the window, capturing, so a handler that stops an event can't hide it. Returns the undo.
export function trackLastInput(win: Window): () => void {
  const onKey = () => (lastWasKey = true);
  const onPress = () => (lastWasKey = false);
  win.addEventListener('keydown', onKey, true);
  win.addEventListener('pointerdown', onPress, true);
  return () => {
    win.removeEventListener('keydown', onKey, true);
    win.removeEventListener('pointerdown', onPress, true);
    lastWasKey = false;
  };
}

export const lastInputWasKey = (): boolean => lastWasKey;
