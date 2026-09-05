import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';

import { RateAndReviewModal } from '../../components/modals/RateAndReviewModal';
import { TabGroupsPermissionModal } from '../../components/modals/TabGroupsPermissionModal';
import { FocusConfirmModal } from '../../components/modals/FocusConfirmModal';
import { renderWithProviders } from '../setup/renderWithProviders';
import {
  openRateAndReviewModal,
  openTabGroupsPrompt,
  openFocusModal,
} from '../../redux/slices/globalStateSlice';
import { saveToTabContainerInternal } from '../../redux/slices/tabContainerDataStateSlice';
import type { tabContainerData } from '../../redux/slices/tabContainerDataStateSlice';

// KAN-89. Two of the three modals were plain fixed-position divs: visible, but
// not modal. Measured in a live popup on RateAndReviewModal before the fix --
// focus stayed on <body>, five Tab presses walked the page behind it, Enter on
// the Settings control back there navigated the whole app, and Escape did
// nothing, while the overlay still swallowed every mouse click.
//
// WHAT THIS FILE CAN AND CANNOT PROVE. jsdom has no top layer, no focus trap
// and no inertness, and its <dialog> has no showModal() at all (stubbed in
// componentSetup.ts to toggle `open`). So these assert the things that are
// checkable here -- that each modal IS a dialog, is labelled by its own
// heading, and honours Escape -- and nothing about trapping. The trapping
// claim is browser-only and is verified there.
//
// All three are asserted together deliberately. The defect was that one
// component had the right pattern and two did not, so a per-component test
// would not have caught the divergence; this is the invariant that would.

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

const session = (): tabContainerData => ({
  tabGroupId: 'g1',
  title: 'Research',
  createdTime: '2026-08-31 00:00:00',
  windowCount: 1,
  tabCount: 1,
  isAutoSave: false,
  isSelected: true,
  windows: [
    {
      windowId: 'w1',
      windowHeight: 100,
      windowWidth: 100,
      windowOffsetTop: 0,
      windowOffsetLeft: 0,
      tabCount: 1,
      title: 'w',
      tabs: [{ tabId: 't1', favicon: '', title: 't', url: 'https://a.co' }],
    },
  ],
});

type Store = { dispatch: (a: unknown) => void };

const MODALS = [
  {
    name: 'RateAndReviewModal',
    render: () =>
      renderWithProviders(<RateAndReviewModal />, {
        seed: { tabs: [{ active: true, index: 0 }] },
        seedStore: (store: Store) => store.dispatch(openRateAndReviewModal()),
      }),
    expectedName: 'Enjoying Tab Keeper?',
  },
  {
    name: 'TabGroupsPermissionModal',
    render: () =>
      renderWithProviders(<TabGroupsPermissionModal />, {
        seedStore: (store: Store) => store.dispatch(openTabGroupsPrompt(2)),
      }),
    expectedName: 'Tab Keeper can save tab groups',
  },
  {
    name: 'FocusConfirmModal',
    render: () =>
      renderWithProviders(<FocusConfirmModal />, {
        seedStore: (store: Store) => {
          store.dispatch(saveToTabContainerInternal(session()));
          store.dispatch(
            openFocusModal({
              tabGroupId: 'g1',
              windowCount: 1,
              willSave: true,
            })
          );
        },
      }),
    expectedName: null, // interpolates the session title; asserted as non-empty
  },
] as const;

describe.each(MODALS)('$name is a real dialog (KAN-89)', (modal) => {
  test('renders as a <dialog>, not a div dressed as one', async () => {
    const { container } = await modal.render();

    const dialog = container.querySelector('dialog');
    expect(dialog).not.toBeNull();

    // The defect in one line: the old markup had zero of these in the whole
    // document, so nothing announced that a dialog had opened.
    expect(screen.getByRole('dialog')).toBe(dialog);
  });

  test('is open, because showModal() ran', async () => {
    const { container } = await modal.render();
    expect(container.querySelector('dialog')?.hasAttribute('open')).toBe(true);
  });

  test('is labelled by its own heading', async () => {
    const { container } = await modal.render();
    const dialog = container.querySelector('dialog')!;

    const labelledBy = dialog.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();

    // The id must actually resolve. An aria-labelledby pointing at nothing
    // leaves the dialog nameless while looking correct in the source.
    const heading = container.querySelector(`#${labelledBy}`);
    expect(heading).not.toBeNull();
    expect(heading!.textContent?.trim()).toBeTruthy();
    if (modal.expectedName) {
      expect(heading!.textContent?.trim()).toBe(modal.expectedName);
    }
  });

  test('is described by its own body copy', async () => {
    const { container } = await modal.render();
    const dialog = container.querySelector('dialog')!;

    const describedBy = dialog.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    const body = container.querySelector(`#${describedBy}`);
    expect(body).not.toBeNull();
    expect(body!.textContent?.trim()).toBeTruthy();
  });

  // Escape reaches a modal <dialog> as a `cancel` event. Without an onCancel
  // handler the browser closes the dialog in the DOM while the store still
  // believes it open -- so it would vanish and could never be reopened.
  test('Escape closes it through the store, not just in the DOM', async () => {
    const { container } = await modal.render();
    const dialog = container.querySelector('dialog')!;

    fireEvent(
      dialog,
      new Event('cancel', { bubbles: false, cancelable: true })
    );

    expect(container.querySelector('dialog')).toBeNull();
  });
});
