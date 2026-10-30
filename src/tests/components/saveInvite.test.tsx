import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';

import UserInputContainer from '../../components/home/leftpane/UserInputContainer';
import { renderWithProviders } from '../setup/renderWithProviders';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';
import { installFakeLocks, type FakeLocks } from '../setup/fakeLocks';
import { replaceState } from '../../redux/slices/tabContainerDataStateSlice';
import { setSearchInputText } from '../../redux/slices/globalStateSlice';
import { startRun } from '../../redux/firstRun';
import { newRun } from '../../utils/functions/firstRun';
import { markHadSavedSession } from '../../redux/slices/settingsDataStateSlice';
import { SAMPLE_ID_PREFIX } from '../../utils/functions/sampleSession';

// KAN-828. The mint ring on the save button shows exactly while the saved list's empty line does.

const invite = () => document.querySelector('[data-save-invite]');
const saveButton = () =>
  screen.getByLabelText('Save all open windows as a session');

let locks: FakeLocks | undefined;
afterEach(() => {
  locks?.uninstall();
  locks = undefined;
  localStorage.clear();
});

describe('the save invite', () => {
  test('shows on an empty, settled list', async () => {
    await renderWithProviders(<UserInputContainer />);
    expect(invite()).not.toBeNull();
    expect(invite()).toHaveAttribute('aria-hidden', 'true');
  });

  test('not while searching', async () => {
    await renderWithProviders(<UserInputContainer />, {
      seedStore: (store) => {
        store.dispatch(setSearchInputText('trip'));
      },
    });
    expect(invite()).toBeNull();
  });

  test('not with a session', async () => {
    await renderWithProviders(<UserInputContainer />, {
      seedStore: (store) => {
        store.dispatch(replaceState(buildContainer([buildSession()])));
      },
    });
    expect(invite()).toBeNull();
  });

  test('drops off after a session arrives', async () => {
    const { store } = await renderWithProviders(<UserInputContainer />);
    expect(invite()).not.toBeNull();
    act(() => {
      store.dispatch(replaceState(buildContainer([buildSession()])));
    });
    expect(invite()).toBeNull();
  });

  test('not while the tour is here', async () => {
    locks = installFakeLocks();
    const { store } = await renderWithProviders(<UserInputContainer />);
    expect(invite()).not.toBeNull();
    await act(async () => {
      await store.dispatch(startRun(newRun('popup', 1)));
    });
    expect(store.getState().globalState.isRunHere).toBe(true);
    expect(invite()).toBeNull();
  });

  // His call, 02:26: once a session of the user's has been in the list, the ring is done on this device.
  test('after the last session is deleted, it stays away', async () => {
    const { store } = await renderWithProviders(<UserInputContainer />, {
      seedStore: (s) => {
        s.dispatch(replaceState(buildContainer([buildSession()])));
      },
    });
    act(() => {
      store.dispatch(replaceState(buildContainer([])));
    });
    expect(invite()).toBeNull();
    expect(store.getState().settingsDataState.hasHadSavedSession).toBe(true);
    expect(
      JSON.parse(localStorage.getItem('settingsData') ?? '{}')
    ).toMatchObject({ hasHadSavedSession: true });
  });

  test('a device that has held a session shows no ring on an empty list', async () => {
    await renderWithProviders(<UserInputContainer />, {
      seedStore: (s) => {
        s.dispatch(markHadSavedSession());
      },
    });
    expect(invite()).toBeNull();
  });

  // The tour saves the sample (KAN-7), which is no session of the user's.
  test('the tour’s sample does not retire it', async () => {
    const { store } = await renderWithProviders(<UserInputContainer />, {
      seedStore: (s) => {
        s.dispatch(
          replaceState(
            buildContainer([
              buildSession({ tabGroupId: `${SAMPLE_ID_PREFIX}tour` }),
            ])
          )
        );
      },
    });
    act(() => {
      store.dispatch(replaceState(buildContainer([])));
    });
    expect(store.getState().settingsDataState.hasHadSavedSession).toBe(false);
    expect(invite()).not.toBeNull();
  });

  // The CSS stop alone would restart all three pulses when the hover or focus ends.
  test('a hover on the button stills it for good', async () => {
    await renderWithProviders(<UserInputContainer />);
    expect(invite()).not.toHaveAttribute('data-still');
    fireEvent.pointerEnter(saveButton());
    expect(invite()).toHaveAttribute('data-still');
    fireEvent.pointerLeave(saveButton());
    expect(invite()).toHaveAttribute('data-still');
  });

  test('focus on the button stills it for good', async () => {
    await renderWithProviders(<UserInputContainer />);
    act(() => saveButton().focus());
    act(() => saveButton().blur());
    expect(invite()).toHaveAttribute('data-still');
  });

  test('after a search hides it, it comes back pulsing', async () => {
    const { store } = await renderWithProviders(<UserInputContainer />);
    fireEvent.pointerEnter(saveButton());
    act(() => {
      store.dispatch(setSearchInputText('trip'));
    });
    expect(invite()).toBeNull();
    act(() => {
      store.dispatch(setSearchInputText(''));
    });
    expect(invite()).not.toBeNull();
    expect(invite()).not.toHaveAttribute('data-still');
  });

  describe('a tab out of view', () => {
    let visibility: DocumentVisibilityState = 'visible';
    const setVisibility = (state: DocumentVisibilityState) =>
      act(() => {
        visibility = state;
        document.dispatchEvent(new Event('visibilitychange'));
      });
    beforeEach(() => {
      visibility = 'visible';
      vi.spyOn(document, 'visibilityState', 'get').mockImplementation(
        () => visibility
      );
    });
    afterEach(() => vi.restoreAllMocks());

    // KAN-875. The ring loops, so a tab opened in the background needs no replay when seen.
    test('a tab loaded hidden still has its ring', async () => {
      visibility = 'hidden';
      await renderWithProviders(<UserInputContainer />);
      expect(invite()).not.toBeNull();
      expect(invite()).not.toHaveAttribute('data-unseen');
    });

    test('once stilled on this page, coming back stays still', async () => {
      await renderWithProviders(<UserInputContainer />);
      fireEvent.pointerEnter(saveButton());
      setVisibility('hidden');
      setVisibility('visible');
      expect(invite()).toHaveAttribute('data-still');
    });
  });

  test('sits right after the save button', async () => {
    await renderWithProviders(<UserInputContainer />);
    expect(invite()?.previousElementSibling).toBe(saveButton());
  });
});
