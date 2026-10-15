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
import { copiedTabCount } from '../utils/functions/liveCopy';
import { newWindowPlacement } from '../components/home/rightpane/newWindowTarget';
import { revealSavedWindow } from '../components/home/rightpane/revealSavedWindow';

type Took = ThunkAction<boolean, RootState, unknown, UnknownAction>;

// Returns whether anything was saved. Every copy says so, wherever it lands (KAN-607), and copies everything,
// duplicates included (KAN-608); Show only when the target is not on screen after the drop.
const copyToSession =
  (copy: SessionCopy, live: LiveSnapshot): Took =>
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
    if (getState().tabContainerDataState === before) return false;
    const target = before.tabGroups.find(
      (g) => g.tabGroupId === copy.to.tabGroupId
    );
    if (target !== undefined) {
      // A window or group says how many tabs it copied (Justine, 2026-10-15); a tab, where it went.
      const several = copy.pick.kind !== 'tab';
      dispatch(
        showToast({
          toastText: several
            ? TOAST_MESSAGES.COPIED_TABS_TO_SESSION
            : TOAST_MESSAGES.COPIED_TO_SESSION,
          toastParams: several
            ? {
                title: target.title,
                count: copiedTabCount(snapshot, copy.pick),
              }
            : { title: target.title },
          announcesSavedChange: true,
          show: isSessionOnScreen(getState(), target.tabGroupId)
            ? undefined
            : { tabGroupId: target.tabGroupId },
        })
      );
    }
    return true;
  };

// S2 A on a session row: a tab or group becomes the session's first window, a window its first window.
export const copyOnSessionRow =
  (live: LiveSnapshot, tabGroupId: string): Took =>
  (dispatch, getState) => {
    const onScreen = isSessionOnScreen(getState(), tabGroupId);
    const { pick } = live;
    // The tab and group branches repeat `to` so each narrows its own pick.
    const copy: SessionCopy =
      pick.kind === 'window'
        ? { pick, to: { tabGroupId, toIndex: 0 } }
        : pick.kind === 'tab'
          ? { pick, to: intoNewWindow(tabGroupId, 'first') }
          : { pick, to: intoNewWindow(tabGroupId, 'first') };
    const copied = dispatch(copyToSession(copy, live));
    const landed = getState().tabContainerDataState.tabGroups.find(
      (g) => g.tabGroupId === tabGroupId
    )?.windows[0]?.windowId;
    // On screen, the detail may be scrolled away from where the copy lands first.
    if (copied && onScreen && landed !== undefined) revealSavedWindow(landed);
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
    return dispatch(copyToSession(copy, live));
  };

// A window let go between the windows of the session on screen.
export const copyWindowTo =
  (live: LiveSnapshot, spot: { tabGroupId: string; toIndex: number }): Took =>
  (dispatch) => {
    const { pick } = live;
    if (pick.kind !== 'window') return false;
    return dispatch(copyToSession({ pick, to: spot }, live));
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
