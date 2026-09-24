import { vi } from 'vitest';

import '@testing-library/jest-dom/vitest';

import { FakeMediaQueryList } from './mediaQueryFake';

// Every component test needs this stubbed: utils/functions/external reaches
// out to Firestore and chrome.notifications, none of which exist in jsdom.
// Centralized here (rather than copy-pasted per test file) so a new
// component test file cannot forget it -- on CI, where no .env exists, an
// unmocked import of this module throws at module-load time, so the hazard
// is invisible on a machine that has one.
vi.mock('../../utils/functions/external', () => ({
  loadFromFirestore: vi.fn(),
  saveToFirestore: vi.fn(),
  // Signed in at once. Absent, the sync thunk would call undefined, and its
  // failed-sign-in catch (KAN-289) would turn the TypeError into a plausible
  // 'error' status: a test of that path would pass for the wrong reason.
  // A file testing the wait itself mocks this module with its own.
  ensureCloudSessionReady: vi.fn(async () => undefined),
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
// KAN-143. jsdom implements no layout and therefore no scrolling: every element
// box is 0x0 and `Element.prototype.scrollIntoView` is not merely inert, it is
// UNDEFINED, so any component that calls it throws on mount.
//
// WHAT THIS STUB DOES AND DOES NOT DO. It is a no-op, and the only thing a test
// can learn from it is WHICH ELEMENT was asked to scroll and WHEN -- by spying
// over it. It cannot tell you whether the row actually came into view, whether
// `block: 'nearest'` scrolled the minimum, or whether it no-ops for an
// already-visible row, because none of those exist here. Those are real-browser
// claims and are checked there instead.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() {};
}

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

// KAN-280 O2. jsdom declares window.matchMedia but leaves it undefined
// (measured: `'matchMedia' in window` is true). Every query answers false, a
// wide window, so a component test sees the layout it saw before the narrow
// rail existed. A test of the narrow layout replaces this with its own list.
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = (query: string) => new FakeMediaQueryList(query, false);
}
