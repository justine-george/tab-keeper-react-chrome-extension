import { afterEach, describe, expect, test } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';

import UserInputContainer from '../../components/home/leftpane/UserInputContainer';
import { renderWithProviders } from '../setup/renderWithProviders';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';
import { installFakeLocks, type FakeLocks } from '../setup/fakeLocks';
import { replaceState } from '../../redux/slices/tabContainerDataStateSlice';
import { setSearchInputText } from '../../redux/slices/globalStateSlice';
import { startRun } from '../../redux/firstRun';
import { newRun } from '../../utils/functions/firstRun';

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

  test('comes back after the last session is deleted', async () => {
    const { store } = await renderWithProviders(<UserInputContainer />, {
      seedStore: (s) => {
        s.dispatch(replaceState(buildContainer([buildSession()])));
      },
    });
    expect(invite()).toBeNull();
    act(() => {
      store.dispatch(replaceState(buildContainer([])));
    });
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

  test('after a save and a delete, it pulses again', async () => {
    const { store } = await renderWithProviders(<UserInputContainer />);
    fireEvent.pointerEnter(saveButton());
    act(() => {
      store.dispatch(replaceState(buildContainer([buildSession()])));
    });
    act(() => {
      store.dispatch(replaceState(buildContainer([])));
    });
    expect(invite()).not.toBeNull();
    expect(invite()).not.toHaveAttribute('data-still');
  });

  test('sits right after the save button', async () => {
    await renderWithProviders(<UserInputContainer />);
    expect(invite()?.previousElementSibling).toBe(saveButton());
  });
});
