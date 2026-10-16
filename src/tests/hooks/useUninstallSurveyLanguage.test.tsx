import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import type { ReactNode } from 'react';

import { useUninstallSurveyLanguage } from '../../hooks/useUninstallSurveyLanguage';
import { makeTestStore } from '../setup/makeStore';
import { setupChromeFake } from '../setup/chrome.fake';
import {
  Language,
  setLanguage,
} from '../../redux/slices/settingsDataStateSlice';
import { UNINSTALL_SURVEY_LANGUAGE_KEY } from '../../utils/functions/uninstallSurvey';

// KAN-642. The page copies its language for the worker, which cannot read localStorage.

let handle: ReturnType<typeof setupChromeFake> | undefined;

beforeEach(() => localStorage.clear());

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  handle?.restore();
  handle = undefined;
});

const mount = () => {
  const { store } = makeTestStore();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Provider store={store}>{children}</Provider>
  );
  renderHook(() => useUninstallSurveyLanguage(), { wrapper });
  return store;
};

describe('useUninstallSurveyLanguage', () => {
  test('on mount, and again when the language changes', async () => {
    handle = setupChromeFake();
    const store = mount();
    const start = store.getState().settingsDataState.language;
    // Otherwise the change below changes nothing and proves nothing.
    expect(start).not.toBe(Language.FR);
    const mirrored = () => handle?.localArea()[UNINSTALL_SURVEY_LANGUAGE_KEY];
    await waitFor(() => expect(mirrored()).toBe(start));
    act(() => {
      store.dispatch(setLanguage(Language.FR));
    });
    await waitFor(() => expect(mirrored()).toBe('fr'));
  });

  test('with no chrome.storage it does nothing and does not throw', () => {
    vi.stubGlobal('chrome', undefined);
    expect(() => mount()).not.toThrow();
  });
});
