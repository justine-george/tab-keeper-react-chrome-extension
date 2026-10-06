import { isDragHeld } from '../../redux/dragHold';

// Esc for a non-modal overlay: unused by a field, not ending IME composition, no modal dialog, no drag or carry.
export function isUnclaimedEscape(event: KeyboardEvent): boolean {
  return (
    event.key === 'Escape' &&
    !event.defaultPrevented &&
    !event.isComposing &&
    event.keyCode !== 229 &&
    !isDragHeld() &&
    document.querySelector('dialog:modal') === null
  );
}
