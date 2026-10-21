import type { ThunkAction, UnknownAction } from '@reduxjs/toolkit';
import { v4 as uuidv4 } from 'uuid';

import type { AppDispatch, RootState } from './store';
import {
  removeUserId,
  setAwaitsDeviceId,
  setLoggedOut,
  setSignedIn,
  setUserId,
  showToast,
} from './slices/globalStateSlice';
import { TOAST_MESSAGES } from '../utils/constants/common';
import { classifyStoredToken, isUsableToken } from '../utils/functions/local';

// KAN-599. The device id: the Firestore doc id, a uuid in chrome.storage.sync
// (tokenValue) that Chrome Sync carries to the user's other machines.

type Thunk<R> = ThunkAction<R, RootState, unknown, UnknownAction>;

const adopt =
  (id: string): Thunk<void> =>
  (dispatch) => {
    dispatch(setSignedIn());
    dispatch(setUserId(id));
    dispatch(setAwaitsDeviceId(false));
  };

const unavailable = (): Thunk<void> => (dispatch) => {
  dispatch(setLoggedOut());
  dispatch(removeUserId());
  dispatch(setAwaitsDeviceId(false));
};

const storedToken = async (): Promise<unknown> =>
  (await chrome.storage.sync.get(['tokenValue'])).tokenValue;

// At the open. None stored: nothing is minted before the yes, so Chrome Sync has until then to bring another machine's.
export const readDeviceId =
  (): Thunk<Promise<void>> => async (dispatch, getState) => {
    let token: unknown;
    try {
      token = await storedToken();
    } catch {
      dispatch(unavailable());
      return;
    }
    if (isUsableToken(token)) {
      dispatch(adopt(token));
    } else if (classifyStoredToken(token) === 'mint') {
      // An id that arrived while the read was out has been followed already.
      if (getState().globalState.userId === null) {
        dispatch(setAwaitsDeviceId(true));
      }
    } else {
      // Present but unusable: a replacement would strand the data stored under it.
      dispatch(unavailable());
      dispatch(
        showToast({ toastText: TOAST_MESSAGES.UNREADABLE_ACCOUNT_TOKEN })
      );
    }
  };

// KAN-719. What a read of the stored id found, for a caller that must not mint.
export type StoredDeviceId =
  | { kind: 'id'; id: string }
  | { kind: 'none' }
  | { kind: 'unusable' }
  | { kind: 'unreadable' };

// KAN-719. The id as stored, adopting a usable one. Never mints, writes, or toasts: the caller says what each miss means.
export const readStoredDeviceId =
  (): Thunk<Promise<StoredDeviceId>> => async (dispatch, getState) => {
    const loaded = getState().globalState.userId;
    if (loaded !== null) return { kind: 'id', id: loaded };
    let token: unknown;
    try {
      token = await storedToken();
    } catch {
      return { kind: 'unreadable' };
    }
    if (isUsableToken(token)) {
      dispatch(adopt(token));
      return { kind: 'id', id: token };
    }
    return classifyStoredToken(token) === 'reject'
      ? { kind: 'unusable' }
      : { kind: 'none' };
  };

// One mint at a time per page: the yes and its sync-once both ask.
const mints = new WeakMap<() => RootState, Promise<void>>();

// After the yes. Re-reads first, so an id Chrome Sync brought since the open wins over a new one.
export const mintDeviceIdIfNone =
  (): Thunk<Promise<void>> => (dispatch, getState) => {
    if (getState().globalState.userId !== null) return Promise.resolve();
    const inFlight = mints.get(getState);
    if (inFlight !== undefined) return inFlight;
    const mint = (async () => {
      try {
        const token = await storedToken();
        if (isUsableToken(token)) {
          dispatch(adopt(token));
          return;
        }
        if (classifyStoredToken(token) === 'reject') {
          dispatch(unavailable());
          return;
        }
        await chrome.storage.sync.set({ tokenValue: uuidv4() });
        // Read back: what is stored is the id, whoever wrote it.
        const written = await storedToken();
        dispatch(isUsableToken(written) ? adopt(written) : unavailable());
      } catch {
        dispatch(unavailable());
      } finally {
        mints.delete(getState);
      }
    })();
    mints.set(getState, mint);
    return mint;
  };

// Every open page follows the stored id. Chrome Sync can bring another machine's after this page has one, and keeps one id for all of them.
export function followDeviceId(
  dispatch: AppDispatch,
  getState: () => RootState
): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>) => {
    const next: unknown = changes.tokenValue?.newValue;
    if (!isUsableToken(next) || next === getState().globalState.userId) return;
    dispatch(adopt(next));
  };
  chrome.storage.sync.onChanged.addListener(listener);
  return () => chrome.storage.sync.onChanged.removeListener(listener);
}
