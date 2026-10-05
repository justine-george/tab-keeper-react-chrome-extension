import { afterEach, describe, expect, test } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';

import MainContainer from '../../components/MainContainer';
import {
  renderWithProviders,
  type RenderWithProvidersResult,
} from '../setup/renderWithProviders';
import type { ChromeSeed } from '../setup/chrome.fake';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';
import {
  askToReplaceSessions,
  openCloudConsentModal,
  openDeleteCloudDataModal,
  openFocusModal,
  openFullViewOffer,
  openPinGuide,
  openRateAndReviewModal,
  openSetup,
  openTabGroupsPrompt,
} from '../../redux/slices/globalStateSlice';
import {
  beginSetup,
  declineCloudConsent,
  initialState as settingsInitial,
  settingsDataStateSlice,
} from '../../redux/slices/settingsDataStateSlice';
import { replaceState } from '../../redux/slices/tabContainerDataStateSlice';
import { beginDragHold, endDragHold } from '../../redux/dragHold';

// KAN-426. Chrome closes the popup on an Esc keydown the page leaves unprevented, so every modal's Esc is claimed.

type Store = RenderWithProvidersResult['store'];

const HERE = buildContainer([
  buildSession({ tabGroupId: 'h1', title: 'Here one' }),
  buildSession({ tabGroupId: 'h2', title: 'Here two' }),
]);

interface Case {
  name: string;
  dialog: string | RegExp;
  seed?: ChromeSeed;
  open: (store: Store) => void;
  outcome: (r: RenderWithProvidersResult) => Promise<void> | void;
}

const CASES: Case[] = [
  {
    name: 'sync question, existing user: Turn off sync',
    dialog: 'Your sessions are currently synced',
    open: (s) => s.dispatch(openCloudConsentModal({ variant: 'existing' })),
    outcome: ({ store }) => {
      expect(store.getState().settingsDataState.cloudConsent).toBe('declined');
      expect(store.getState().settingsDataState.isAutoSync).toBe(false);
    },
  },
  {
    name: 'sync question, enable: nothing granted',
    dialog: /./,
    open: (s) => {
      s.dispatch(declineCloudConsent());
      s.dispatch(openCloudConsentModal({ variant: 'enable', then: 'syncNow' }));
    },
    outcome: ({ store }) => {
      expect(store.getState().settingsDataState.cloudConsent).toBe('declined');
      expect(store.getState().globalState.isCloudConsentModalOpen).toBe(false);
    },
  },
  {
    name: 'welcome: Get started without the moment',
    dialog: 'Welcome to Tab Keeper',
    open: (s) => {
      s.dispatch(beginSetup());
      s.dispatch(openCloudConsentModal({ variant: 'welcome' }));
    },
    outcome: async ({ store }) => {
      expect(store.getState().globalState.isCloudConsentModalOpen).toBe(false);
      await waitFor(() =>
        expect(store.getState().globalState.isFullViewOfferOpen).toBe(true)
      );
      expect(store.getState().globalState.fullViewOfferEnters).toBe(false);
    },
  },
  {
    name: 'full view offer: Not now',
    dialog: 'Try the full view',
    seed: { windows: [{ id: 7 }] },
    open: (s) => s.dispatch(openFullViewOffer()),
    outcome: ({ store, chrome }) => {
      expect(store.getState().settingsDataState.isFullViewOfferAnswered).toBe(
        true
      );
      expect(store.getState().globalState.isFullViewOfferOpen).toBe(false);
      expect(chrome.sentMessages).toEqual([]);
    },
  },
  {
    name: 'rate prompt: Remind me later',
    dialog: 'Enjoying Tab Keeper?',
    seed: { tabs: [{ active: true, index: 0 }] },
    open: (s) => s.dispatch(openRateAndReviewModal()),
    outcome: ({ store }) => {
      expect(store.getState().settingsDataState.isSkippedUserReviewOnce).toBe(
        true
      );
      expect(store.getState().globalState.isRateAndReviewModalOpen).toBe(false);
    },
  },
  {
    name: 'tab groups permission: Not now',
    dialog: 'Tab Keeper can save tab groups',
    open: (s) => s.dispatch(openTabGroupsPrompt(2)),
    outcome: ({ store }) => {
      expect(
        store.getState().settingsDataState.isTabGroupsPromptAnsweredOnce
      ).toBe(true);
      expect(store.getState().globalState.tabGroupsPromptCount).toBeNull();
    },
  },
  {
    name: 'focus confirm: Cancel',
    dialog: /Research/,
    open: (s) => {
      s.dispatch(
        replaceState(
          buildContainer([
            buildSession({ tabGroupId: 'g1', title: 'Research' }),
          ])
        )
      );
      s.dispatch(
        openFocusModal({ tabGroupId: 'g1', windowCount: 1, willSave: true })
      );
    },
    outcome: ({ store, seen }) => {
      expect(store.getState().globalState.focusRequest).toBeNull();
      expect(seen.filter((type) => /focus/i.test(type))).toEqual([
        'globalState/openFocusModal',
        'globalState/closeFocusModal',
      ]);
    },
  },
  {
    name: 'delete cloud data: Cancel',
    dialog: 'Delete your cloud data?',
    open: (s) => s.dispatch(openDeleteCloudDataModal()),
    outcome: ({ store, seen }) => {
      expect(store.getState().globalState.isDeleteCloudDataModalOpen).toBe(
        false
      );
      expect(seen.filter((type) => /deleteCloudData\//.test(type))).toEqual([]);
    },
  },
  {
    name: 'load backup: Cancel',
    dialog: /^Load .* from this backup\?$/,
    open: (s) => {
      s.dispatch(replaceState(HERE));
      s.dispatch(
        askToReplaceSessions({
          container: buildContainer([
            buildSession({ tabGroupId: 'f1', title: 'From the file' }),
          ]),
          fileName: 'backup.json',
        })
      );
    },
    outcome: ({ store }) => {
      expect(store.getState().globalState.pendingImport).toBeNull();
      expect(
        store.getState().tabContainerDataState.tabGroups.map((g) => g.title)
      ).toEqual(['Here one', 'Here two']);
    },
  },
  {
    name: 'pin guide: dismissed for good',
    dialog: 'Pin Tab Keeper to your toolbar',
    seed: { action: { isOnToolbar: false } },
    open: (s) => s.dispatch(openPinGuide()),
    outcome: ({ store }) => {
      expect(store.getState().settingsDataState.isPinGuideDismissed).toBe(true);
      expect(store.getState().globalState.isPinGuideOpen).toBe(false);
    },
  },
  {
    name: 'setup: ended for good',
    dialog: 'Make Tab Keeper yours',
    seed: {
      action: {},
      windows: [{ id: 1, tabs: [] }],
      commands: [
        { name: '_execute_action', shortcut: 'Alt+Shift+K', description: '' },
      ],
    },
    open: (s) => {
      s.dispatch(
        settingsDataStateSlice.actions.replaceState({
          ...settingsInitial,
          setupState: 'pending',
        })
      );
      s.dispatch(openSetup());
    },
    outcome: ({ store }) => {
      expect(store.getState().settingsDataState.setupState).toBe('done');
      expect(store.getState().globalState.isSetupOpen).toBe(false);
    },
  },
];

const pressEscape = (target: Element) => {
  const event = new KeyboardEvent('keydown', {
    key: 'Escape',
    bubbles: true,
    cancelable: true,
  });
  fireEvent(target, event);
  return event;
};

afterEach(() => localStorage.clear());

describe.each(CASES)('Esc on the $name dialog (KAN-426)', (c) => {
  test('is consumed, so the popup stays, and does what its cancel does', async () => {
    const r = await renderWithProviders(<MainContainer />, {
      seed: c.seed,
      seedStore: c.open,
    });
    const dialog = screen.getByRole('dialog', { name: c.dialog });
    // The stub showModal moves no focus, so a dialog that leaves it to the browser takes the key itself.
    const focused = document.activeElement;
    const target = focused && dialog.contains(focused) ? focused : dialog;

    expect(pressEscape(target).defaultPrevented).toBe(true);

    expect(screen.queryByRole('dialog', { name: c.dialog })).toBeNull();
    await c.outcome(r);
  });
});

describe('the shared Esc claim (KAN-426)', () => {
  test('with no modal open, Esc is left to the browser', async () => {
    await renderWithProviders(<MainContainer />);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(pressEscape(document.body).defaultPrevented).toBe(false);
  });

  test('an Esc a control in the dialog already took is not also a cancel', async () => {
    await renderWithProviders(<MainContainer />, {
      seedStore: (s) => s.dispatch(openDeleteCloudDataModal()),
    });
    const dialog = screen.getByRole('dialog', {
      name: 'Delete your cloud data?',
    });
    let cancels = 0;
    dialog.addEventListener('cancel', () => (cancels += 1));
    dialog.addEventListener('keydown', (e) => e.preventDefault());

    pressEscape(dialog);

    expect(cancels).toBe(0);
    expect(screen.getByRole('dialog')).toBe(dialog);
  });

  test('a cancel nobody prevents closes the dialog, as the browser does', async () => {
    await renderWithProviders(<MainContainer />);
    const bare = document.createElement('dialog');
    document.body.append(bare);
    bare.showModal();
    let cancel: Event | null = null;
    bare.addEventListener('cancel', (e) => (cancel = e));

    expect(pressEscape(bare).defaultPrevented).toBe(true);

    expect(cancel).not.toBeNull();
    expect(bare.open).toBe(false);
    bare.remove();
  });

  test('a cancel the dialog prevents leaves it open', async () => {
    await renderWithProviders(<MainContainer />);
    const bare = document.createElement('dialog');
    document.body.append(bare);
    bare.showModal();
    bare.addEventListener('cancel', (e) => e.preventDefault());

    expect(pressEscape(bare).defaultPrevented).toBe(true);

    expect(bare.open).toBe(true);
    bare.remove();
  });
});

describe('which Esc the claim takes (KAN-426)', () => {
  const openBare = () => {
    const dialog = document.createElement('dialog');
    const field = document.createElement('input');
    dialog.append(field);
    document.body.append(dialog);
    dialog.showModal();
    return { dialog, field };
  };

  test('with two modals open, Esc cancels the one that holds focus', async () => {
    await renderWithProviders(<MainContainer />);
    const first = openBare();
    const second = openBare();
    const cancelled: string[] = [];
    first.dialog.addEventListener('cancel', () => cancelled.push('first'));
    second.dialog.addEventListener('cancel', () => cancelled.push('second'));

    pressEscape(second.field);

    expect(cancelled).toEqual(['second']);
    expect(first.dialog.open).toBe(true);
    expect(second.dialog.open).toBe(false);
    first.dialog.remove();
    second.dialog.remove();
  });

  test('a drag held leaves Esc to the drag', async () => {
    await renderWithProviders(<MainContainer />);
    const { dialog } = openBare();
    let cancels = 0;
    dialog.addEventListener('cancel', () => (cancels += 1));
    beginDragHold();
    try {
      expect(pressEscape(dialog).defaultPrevented).toBe(false);
    } finally {
      endDragHold();
    }
    expect(cancels).toBe(0);
    expect(dialog.open).toBe(true);
    dialog.remove();
  });

  test('an Esc that ends IME composition is left alone', async () => {
    await renderWithProviders(<MainContainer />);
    const { dialog, field } = openBare();
    let cancels = 0;
    dialog.addEventListener('cancel', () => (cancels += 1));
    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      isComposing: true,
      bubbles: true,
      cancelable: true,
    });
    fireEvent(field, event);

    expect(event.defaultPrevented).toBe(false);
    expect(cancels).toBe(0);
    expect(dialog.open).toBe(true);
    dialog.remove();
  });
});
