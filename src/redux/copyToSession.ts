// KAN-280 Part F (spec O12c). A live item's copy into a saved session: through dropOnTop like every drop, then D4 A's toast.
import type { ThunkAction, UnknownAction } from '@reduxjs/toolkit';

import type { LiveSnapshot } from './carriedItem';
import type { CarriedSpot } from './dropCarried';
import { dropOnTop, dropOnTopMoved } from './dropOnTop';
import {
  intoNewWindow,
  newSessionCopyDrop,
  sessionCopyDrop,
} from './dropSpecs';
import { placedWindowOf } from './livePlacement';
import { isSessionOnScreen } from './sessionOnScreen';
import { showToast } from './slices/globalStateSlice';
import {
  copyToNewSessionInternal,
  type SessionCopy,
  type TabMasterContainer,
} from './slices/tabContainerDataStateSlice';
import { showSession } from './showSession';
import type { RootState } from './store';
import { TOAST_MESSAGES } from '../utils/constants/common';
import { addressesIn, copyOutcome } from '../utils/functions/liveCopy';
import { newWindowPlacement } from '../components/home/rightpane/newWindowTarget';
import { revealSavedWindow } from '../components/home/rightpane/revealSavedWindow';

type Took = ThunkAction<boolean, RootState, unknown, UnknownAction>;

// Returns whether anything was saved. `announce`: the target was not on screen at the drop (the Show rule): only
// then does a clean copy toast. A skip always does (KAN-607): on screen nothing shows what was left out.
const copyToSession =
  (copy: SessionCopy, live: LiveSnapshot, announce: boolean): Took =>
  (dispatch, getState) => {
    const snapshot = placedWindowOf(live);
    const drop = sessionCopyDrop(copy, snapshot);
    // The state the copy action is dispatched against: after dropOnTop applied what arrived while carried.
    const at: { state: TabMasterContainer | null } = { state: null };
    dispatch(
      dropOnTop({
        ...drop,
        move: (i) => {
          at.state = getState().tabContainerDataState;
          return drop.move(i);
        },
      })
    );
    const before = at.state;
    if (before === null) return false;
    const copied = getState().tabContainerDataState !== before;
    const target = before.tabGroups.find(
      (g) => g.tabGroupId === copy.to.tabGroupId
    );
    if (target === undefined) return copied;

    const { skipped, copiesAny } = copyOutcome(
      snapshot,
      copy.pick,
      addressesIn(target)
    );
    if (skipped === 0 && !announce) return copied;
    const show = isSessionOnScreen(getState(), target.tabGroupId)
      ? undefined
      : { tabGroupId: target.tabGroupId };
    if (copied) {
      dispatch(
        showToast({
          toastText:
            skipped === 0
              ? TOAST_MESSAGES.COPIED_TO_SESSION
              : TOAST_MESSAGES.COPIED_TO_SESSION_SKIPPED,
          toastParams:
            skipped === 0
              ? { title: target.title }
              : { title: target.title, count: skipped },
          announcesSavedChange: true,
          show,
        })
      );
    } else if (!copiesAny && skipped > 0) {
      // P10. Nothing was saved, so this takes nothing from a Reopen offer.
      dispatch(
        showToast({
          toastText: TOAST_MESSAGES.ALREADY_IN_SESSION,
          toastParams: { title: target.title },
          show,
        })
      );
    }
    return copied;
  };

// S2 A on a session row: a tab or group becomes the session's first window, a window its first window.
export const copyOnSessionRow =
  (live: LiveSnapshot, tabGroupId: string): Took =>
  (dispatch, getState) => {
    const announce = !isSessionOnScreen(getState(), tabGroupId);
    const { pick } = live;
    // The tab and group branches repeat `to` so each narrows its own pick.
    const copy: SessionCopy =
      pick.kind === 'window'
        ? { pick, to: { tabGroupId, toIndex: 0 } }
        : pick.kind === 'tab'
          ? { pick, to: intoNewWindow(tabGroupId, 'first') }
          : { pick, to: intoNewWindow(tabGroupId, 'first') };
    const copied = dispatch(copyToSession(copy, live, announce));
    const landed = getState().tabContainerDataState.tabGroups.find(
      (g) => g.tabGroupId === tabGroupId
    )?.windows[0]?.windowId;
    if (copied && !announce && landed !== undefined) revealSavedWindow(landed);
    return copied;
  };

// A tab or group let go in the session on screen: a spot, or a New window target.
export const copyToSpot =
  (
    live: LiveSnapshot,
    spot: CarriedSpot & { toChromeGroupId?: string }
  ): Took =>
  (dispatch) => {
    const { pick } = live;
    if (pick.kind === 'window') return false;
    const { tabGroupId, toWindowId, toIndex, toChromeGroupId } = spot;
    const at = newWindowPlacement(toWindowId);
    const copy: SessionCopy =
      pick.kind === 'tab'
        ? {
            pick,
            to:
              at === undefined
                ? {
                    tabGroupId,
                    windowId: toWindowId,
                    toIndex,
                    ...(toChromeGroupId === undefined
                      ? {}
                      : { toChromeGroupId }),
                  }
                : intoNewWindow(tabGroupId, at),
          }
        : {
            pick,
            to:
              at === undefined
                ? { tabGroupId, windowId: toWindowId, toIndex }
                : intoNewWindow(tabGroupId, at),
          };
    return dispatch(copyToSession(copy, live, false));
  };

// A window let go between the windows of the session on screen.
export const copyWindowTo =
  (live: LiveSnapshot, spot: { tabGroupId: string; toIndex: number }): Took =>
  (dispatch) => {
    const { pick } = live;
    if (pick.kind !== 'window') return false;
    return dispatch(copyToSession({ pick, to: spot }, live, false));
  };

// N1 A. The save row: a new session holding the copy, shown, no toast (KAN-394).
export const copyToNewSession =
  (live: LiveSnapshot, fallbackTitle: string, typedTitle: string = ''): Took =>
  (dispatch) => {
    const action = copyToNewSessionInternal(
      live.pick,
      placedWindowOf(live),
      fallbackTitle,
      typedTitle
    );
    if (!dispatch(dropOnTopMoved(newSessionCopyDrop(live.pick, action)))) {
      return false;
    }
    dispatch(showSession(action.payload.tabGroupId));
    return true;
  };
