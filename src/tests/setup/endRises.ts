import { fireEvent } from '@testing-library/react';

// KAN-654. jsdom runs no CSS animation, so a dialog that rises never lands on its own: this lands every open one.
export function endRises(): void {
  document
    .querySelectorAll('dialog[open]')
    .forEach((dialog) => fireEvent.animationEnd(dialog));
}
