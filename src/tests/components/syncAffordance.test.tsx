import { describe, expect, test } from 'vitest';
import { screen } from '@testing-library/react';

import MenuContainer from '../../components/home/leftpane/MenuContainer';
import { renderWithProviders } from '../setup/renderWithProviders';
import {
  setLoggedOut,
  setSignedIn,
  setSyncStatus,
} from '../../redux/slices/globalStateSlice';

// KAN-79. The header's sync control is both a button and a status, and the
// rule it has to keep is: offer "sync now" only when syncing is possible AND
// something is out of sync. Every other case shows what is true instead.
//
// Asserted on the Material Symbols LIGATURE, which is the icon's rendered text
// content -- the same reason golden-path.spec.ts has to pass `exact: true` to
// stop "arrow_back" substring-matching "Back".

const renderMenu = (
  seed: (store: { dispatch: (a: unknown) => void }) => void
) => renderWithProviders(<MenuContainer />, { seedStore: seed });

const syncControl = () => screen.getByRole('button', { name: 'Sync now' });

describe('the header sync affordance', () => {
  // CONTROL for every assertion below: this is the one case that SHOULD offer
  // the action, so a wrong icon elsewhere cannot be explained by the harness
  // failing to render the control at all.
  test('CONTROL: offers "sync now" when signed in with nothing yet confirmed', async () => {
    await renderMenu((store) => {
      store.dispatch(setSignedIn());
      store.dispatch(setSyncStatus('idle'));
    });

    expect(syncControl().textContent).toBe('sync');
    expect(syncControl().getAttribute('aria-disabled')).toBeNull();
  });

  test('reports agreement once a sync has confirmed it', async () => {
    await renderMenu((store) => {
      store.dispatch(setSignedIn());
      store.dispatch(setSyncStatus('success'));
    });

    expect(syncControl().textContent).toBe('cloud_done');
  });

  test('shows the sync is under way, and takes the action away while it is', async () => {
    await renderMenu((store) => {
      store.dispatch(setSignedIn());
      store.dispatch(setSyncStatus('loading'));
    });

    expect(syncControl().textContent).toBe('cloud_sync');
    expect(syncControl().getAttribute('aria-disabled')).toBe('true');
  });

  test('reports a problem rather than inviting another attempt', async () => {
    await renderMenu((store) => {
      store.dispatch(setSignedIn());
      store.dispatch(setSyncStatus('error'));
    });

    expect(syncControl().textContent).toBe('sync_problem');
  });

  // The defect this file adds. Signed out is not a transient startup flash --
  // App.tsx dispatches setLoggedOut on a failed chrome.storage.sync write, a
  // read-back that does not match, and an unusable token (which also raises
  // UNREADABLE_ACCOUNT_TOKEN). In every one of those the control offered "sync
  // now" and clicking it called loadFromFirestore(userId!) with no userId.
  test('does not offer "sync now" when there is nothing to sync to', async () => {
    await renderMenu((store) => {
      store.dispatch(setLoggedOut());
      store.dispatch(setSyncStatus('idle'));
    });

    expect(syncControl().textContent).toBe('cloud_off');
    expect(syncControl().getAttribute('aria-disabled')).toBe('true');
  });

  // Signed out must win over a stale status. setLoggedOut already resets
  // syncStatus to 'idle', so this pins that the icon cannot claim agreement
  // with a cloud it can no longer reach.
  test('a lost token stops the control claiming everything is in sync', async () => {
    await renderMenu((store) => {
      store.dispatch(setSignedIn());
      store.dispatch(setSyncStatus('success'));
      store.dispatch(setLoggedOut());
    });

    expect(syncControl().textContent).toBe('cloud_off');
  });
});
