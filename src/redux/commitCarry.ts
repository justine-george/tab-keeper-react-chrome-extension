// KAN-280 Part F (spec O12c). Where a receiver sends a carry: a saved item to KAN-350's move, a live one to its copy.
import type { ThunkAction, UnknownAction } from '@reduxjs/toolkit';

import type { CarriedItem } from './carriedItem';
import {
  dropCarriedGroup,
  dropCarriedTab,
  dropCarriedWindow,
  type CarriedSpot,
} from './dropCarried';
import { dropOnSessionRow } from './dropOnSessionRow';
import { moveToNewSession } from './moveToNewSession';
import {
  copyOnSessionRow,
  copyToNewSession,
  copyToSpot,
  copyWindowTo,
} from './copyToSession';
import type { RootState } from './store';

// Whether the receiver took the carry.
type Took = ThunkAction<boolean, RootState, unknown, UnknownAction>;

export const carryToSessionRow =
  (item: CarriedItem, tabGroupId: string): Took =>
  (dispatch) =>
    item.source === 'saved'
      ? dispatch(dropOnSessionRow(item.ref, tabGroupId))
      : dispatch(copyOnSessionRow(item.live, tabGroupId));

export const carryToNewSession =
  (item: CarriedItem, fallbackTitle: string, typedTitle: string = ''): Took =>
  (dispatch) =>
    item.source === 'saved'
      ? dispatch(moveToNewSession(item.ref, fallbackTitle, typedTitle))
      : dispatch(copyToNewSession(item.live, fallbackTitle, typedTitle));

// A tab or group let go inside a window; a window never lands there.
export const carryToSpot =
  (item: CarriedItem, spot: CarriedSpot & { toChromeGroupId?: string }): Took =>
  (dispatch) => {
    if (item.source === 'live') return dispatch(copyToSpot(item.live, spot));
    const { ref } = item;
    switch (ref.kind) {
      case 'tab':
        return dispatch(dropCarriedTab(ref, spot));
      case 'group':
        return dispatch(dropCarriedGroup(ref, spot));
      case 'window':
        return false;
    }
  };

// A window let go between windows; a tab or group never lands there.
export const carryWindowTo =
  (item: CarriedItem, spot: { tabGroupId: string; toIndex: number }): Took =>
  (dispatch) => {
    if (item.source === 'live') {
      return dispatch(copyWindowTo(item.live, spot));
    }
    const { ref } = item;
    return ref.kind === 'window'
      ? dispatch(dropCarriedWindow(ref, spot))
      : false;
  };
