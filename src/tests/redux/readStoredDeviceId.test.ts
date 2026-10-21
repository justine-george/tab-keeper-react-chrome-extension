import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.hoisted(() => {
  const g = globalThis as unknown as { window?: unknown };
  g.window = g.window ?? globalThis;
  (g.window as { screen?: unknown }).screen = { height: 1080, width: 1920 };
});

import { readStoredDeviceId } from '../../redux/deviceId';
import { setSignedIn, setUserId } from '../../redux/slices/globalStateSlice';
import { setupChromeFake } from '../setup/chrome.fake';
import { makeTestStore } from '../setup/makeStore';

// KAN-719. Delete cloud data needs the stored id without minting one or toasting.
describe('readStoredDeviceId', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('a loaded id is used without reading storage', async () => {
    setupChromeFake();
    const { store } = makeTestStore();
    store.dispatch(setUserId('uuid-1'));
    const get = vi.spyOn(chrome.storage.sync, 'get');
    expect(await store.dispatch(readStoredDeviceId())).toEqual({
      kind: 'id',
      id: 'uuid-1',
    });
    expect(get).not.toHaveBeenCalled();
  });

  it('null userId, usable stored token: adopts it', async () => {
    setupChromeFake({ storage: { tokenValue: 'uuid-9' } });
    const { store } = makeTestStore();
    expect(await store.dispatch(readStoredDeviceId())).toEqual({
      kind: 'id',
      id: 'uuid-9',
    });
    expect(store.getState().globalState.userId).toBe('uuid-9');
  });

  it('nothing stored: none, and nothing is written', async () => {
    setupChromeFake();
    const { store } = makeTestStore();
    const set = vi.spyOn(chrome.storage.sync, 'set');
    expect(await store.dispatch(readStoredDeviceId())).toEqual({
      kind: 'none',
    });
    expect(set).not.toHaveBeenCalled();
    expect(store.getState().globalState.userId).toBeNull();
  });

  it('a stored non-string: unusable, and the store is untouched', async () => {
    setupChromeFake({ storage: { tokenValue: 42 } });
    const { store } = makeTestStore();
    const before = store.getState().globalState;
    expect(await store.dispatch(readStoredDeviceId())).toEqual({
      kind: 'unusable',
    });
    const after = store.getState().globalState;
    expect(after.userId).toBeNull();
    expect(after.isSignedIn).toBe(before.isSignedIn);
    expect(after).toEqual(before);
  });

  it('storage that throws: unreadable', async () => {
    setupChromeFake();
    const { store } = makeTestStore();
    store.dispatch(setSignedIn());
    const before = store.getState().globalState;
    vi.spyOn(chrome.storage.sync, 'get').mockRejectedValue(new Error('boom'));
    expect(await store.dispatch(readStoredDeviceId())).toEqual({
      kind: 'unreadable',
    });
    // The toast and sign-out are the caller's call, not this read's.
    expect(store.getState().globalState).toEqual(before);
  });
});
