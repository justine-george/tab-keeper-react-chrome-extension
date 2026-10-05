import { afterEach, describe, expect, test, vi } from 'vitest';
import { waitFor } from '@testing-library/react';

import {
  readToolbarPin,
  watchToolbarPin,
} from '../../utils/functions/toolbarPin';
import { setupChromeFake, type ChromeFakeHandle } from '../setup/chrome.fake';

// KAN-7 §4. One wrapper for Chrome's toolbar state: absent or throwing reads
// as unknown, which never shows the guide.

let handle: ChromeFakeHandle | undefined;
afterEach(() => {
  handle?.restore();
  vi.restoreAllMocks();
});

describe('readToolbarPin', () => {
  test('no chrome.action at all: unknown', async () => {
    handle = setupChromeFake({});
    expect(await readToolbarPin()).toBe('unknown');
  });

  test('no getUserSettings (before Chrome 91): unknown', async () => {
    handle = setupChromeFake({ action: {} });
    expect(await readToolbarPin()).toBe('unknown');
  });

  test('a throwing getUserSettings: unknown, and a warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    handle = setupChromeFake({
      action: { isOnToolbar: false, getUserSettingsThrows: true },
    });
    expect(await readToolbarPin()).toBe('unknown');
    expect(warn).toHaveBeenCalledTimes(1);
  });

  test.each([
    [true, 'pinned'],
    [false, 'unpinned'],
  ])('isOnToolbar %p reads %p', async (isOnToolbar, expected) => {
    handle = setupChromeFake({ action: { isOnToolbar } });
    expect(await readToolbarPin()).toBe(expected);
  });
});

describe('watchToolbarPin', () => {
  test('Chrome 130+: the event reports the pin, until unsubscribed', () => {
    handle = setupChromeFake({ action: { isOnToolbar: false } });
    const onPinned = vi.fn();
    const stop = watchToolbarPin(onPinned);

    handle.setToolbarPin(true);
    expect(onPinned).toHaveBeenCalledTimes(1);

    stop();
    handle.setToolbarPin(false);
    handle.setToolbarPin(true);
    expect(onPinned).toHaveBeenCalledTimes(1);
  });

  test('an unpin is not a pin', () => {
    handle = setupChromeFake({ action: { isOnToolbar: true } });
    const onPinned = vi.fn();
    watchToolbarPin(onPinned);
    handle.setToolbarPin(false);
    expect(onPinned).not.toHaveBeenCalled();
  });

  test('without the event, coming back to the window re-reads', async () => {
    handle = setupChromeFake({
      action: { isOnToolbar: false, hasUserSettingsEvent: false },
    });
    const onPinned = vi.fn();
    const stop = watchToolbarPin(onPinned);

    window.dispatchEvent(new Event('focus'));
    await Promise.resolve();
    expect(onPinned).not.toHaveBeenCalled();

    handle.setToolbarPin(true);
    window.dispatchEvent(new Event('focus'));
    await waitFor(() => expect(onPinned).toHaveBeenCalledTimes(1));

    stop();
    window.dispatchEvent(new Event('focus'));
    await Promise.resolve();
    expect(onPinned).toHaveBeenCalledTimes(1);
  });
});
