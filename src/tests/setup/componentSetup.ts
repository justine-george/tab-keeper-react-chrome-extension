import { vi } from 'vitest';

import '@testing-library/jest-dom/vitest';

// Every component test needs this stubbed: utils/functions/external reaches
// out to Firestore and chrome.notifications, none of which exist in jsdom.
// Centralized here (rather than copy-pasted per test file) so a new
// component test file cannot forget it -- on CI, where no .env exists, an
// unmocked import of this module throws at module-load time, so the hazard
// is invisible on a machine that has one.
vi.mock('../../utils/functions/external', () => ({
  loadFromFirestore: vi.fn(),
  saveToFirestore: vi.fn(),
  displayToast: vi.fn(),
}));

// KAN-89. jsdom implements <dialog> as an element but not its modal methods:
// showModal() and close() are simply absent, so any component that calls them
// throws "dialog.showModal is not a function" on mount.
//
// This went unnoticed because FocusConfirmModal -- the one component that
// already used showModal() -- is covered only at the redux level, so no
// component test had ever rendered a dialog. Converting the other two modals
// is what surfaced it.
//
// WHAT THIS STUB DOES AND DOES NOT DO. It toggles the `open` property and
// nothing else. It does NOT emulate the top layer, the focus trap, inertness
// of the rest of the page, or Escape firing `cancel` -- jsdom has none of
// those, and no stub here can conjure them. So a green component test proves
// the dialog RENDERS and is wired up (role, labelling, handlers); it is not
// evidence that the modal actually traps focus. That claim can only be made
// against a real browser, and is checked there instead.
if (typeof HTMLDialogElement !== 'undefined') {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function showModal(
      this: HTMLDialogElement
    ) {
      this.open = true;
    };
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function close(
      this: HTMLDialogElement
    ) {
      this.open = false;
    };
  }
}
