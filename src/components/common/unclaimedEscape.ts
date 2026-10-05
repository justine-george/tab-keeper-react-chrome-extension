import { isDragHeld } from '../../redux/dragHold';

// KAN-413. Esc for a non-modal overlay: unused by a field, no modal dialog open, no drag or carry held.
export function isUnclaimedEscape(event: KeyboardEvent): boolean {
  return (
    event.key === 'Escape' &&
    !event.defaultPrevented &&
    !isDragHeld() &&
    document.querySelector('dialog:modal') === null
  );
}
