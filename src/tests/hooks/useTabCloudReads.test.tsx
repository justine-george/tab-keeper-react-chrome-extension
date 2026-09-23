import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { Provider } from 'react-redux';

// KAN-279 D11. useTabCloudReads() is a thin wrapper around startCloudReads
// (cloudReadScheduler.test.ts covers that scheduler's own behaviour in
// detail, with fake timers and a fake doc). This file only has to prove the
// WIRING: the effect starts the scheduler exactly when isTabView() is true,
// and stops it on unmount -- so the real scheduler is mocked out rather than
// driven through real visibility, which jsdom/Playwright cannot fake anyway
// (see global-constraints.md).
const { startCloudReads, stopSpy } = vi.hoisted(() => {
  const stopSpy = vi.fn();
  const startCloudReads = vi.fn(() => stopSpy);
  return { startCloudReads, stopSpy };
});

vi.mock('../../utils/functions/cloudReadScheduler', () => ({
  startCloudReads,
}));

import { useTabCloudReads } from '../../hooks/useTabCloudReads';
import { makeTestStore } from '../setup/makeStore';

function Harness() {
  useTabCloudReads();
  return null;
}

function renderHarness() {
  const { store } = makeTestStore();
  return render(
    <Provider store={store}>
      <Harness />
    </Provider>
  );
}

afterEach(() => {
  cleanup();
  startCloudReads.mockClear();
  stopSpy.mockClear();
  // isTabView() reads the live URL; jsdom keeps one document for the whole
  // file, so a test that moves it must put it back (same reason as
  // viewMode.test.tsx).
  window.history.replaceState(null, '', '/index.html');
});

describe('useTabCloudReads', () => {
  test('starts the scheduler in the tab view', () => {
    window.history.replaceState(null, '', '/index.html?view=tab');

    renderHarness();

    expect(startCloudReads).toHaveBeenCalledTimes(1);
    expect(startCloudReads).toHaveBeenCalledWith(
      document,
      expect.any(Function),
      expect.any(Function)
    );
  });

  // The mutation this guards against: running the effect in the popup too.
  test('does not start the scheduler in the popup', () => {
    window.history.replaceState(null, '', '/index.html');

    renderHarness();

    expect(startCloudReads).not.toHaveBeenCalled();
  });

  test('stops the scheduler on unmount', () => {
    window.history.replaceState(null, '', '/index.html?view=tab');
    const { unmount } = renderHarness();
    expect(stopSpy).not.toHaveBeenCalled();

    unmount();

    expect(stopSpy).toHaveBeenCalledTimes(1);
  });
});
