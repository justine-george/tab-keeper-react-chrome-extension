// KAN-280 Part F (spec O12c). Where a receiver sends a carry; a saved item goes to KAN-350's move.
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
import type { RootState } from './store';

// Whether the receiver took the carry.
type Took = ThunkAction<boolean, RootState, unknown, UnknownAction>;

export const carryToSessionRow =
  (item: CarriedItem, tabGroupId: string): Took =>
  (dispatch) =>
    dispatch(dropOnSessionRow(item.ref, tabGroupId));

export const carryToNewSession =
  (item: CarriedItem, fallbackTitle: string, typedTitle: string = ''): Took =>
  (dispatch) =>
    dispatch(moveToNewSession(item.ref, fallbackTitle, typedTitle));

// A tab or group let go inside a window; a window never lands there.
export const carryToSpot =
  (item: CarriedItem, spot: CarriedSpot & { toChromeGroupId?: string }): Took =>
  (dispatch) => {
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
    const { ref } = item;
    return ref.kind === 'window'
      ? dispatch(dropCarriedWindow(ref, spot))
      : false;
  };
