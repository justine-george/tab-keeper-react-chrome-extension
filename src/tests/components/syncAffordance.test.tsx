import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';

import MenuContainer from '../../components/home/leftpane/MenuContainer';
import { renderWithProviders } from '../setup/renderWithProviders';
import { syncPressedAt } from '../../components/common/useShownSyncStatus';
import { grantCloudConsent } from '../../redux/slices/settingsDataStateSlice';
import {
  setCloudConfigured,
  setLoggedOut,
  setSignedIn,
  setSyncStatus,
  syncStateWithFirestore,
} from '../../redux/slices/globalStateSlice';

// KAN-79. The header's sync control is both a button and a status, and the
// rule it has to keep is: offer "sync now" only when syncing is possible AND
// something is out of sync. Every other case shows what is true instead.
//
// Asserted on the glyph's data-glyph / data-turning (KAN-750), not on text: the
// sync glyph is drawn as an outline, and only some states are a ligature.

const renderMenu = (
  seed: (store: { dispatch: (a: unknown) => void }) => void
) => renderWithProviders(<MenuContainer />, { seedStore: seed });

// A dimmed control is named for why it is dimmed (KAN-342), so the dimmed
// cases below name it that way.
const syncControl = (name = 'Sync now') => screen.getByRole('button', { name });

// What the button draws, and whether the drawing turns.
const glyphOf = (button: HTMLElement) => {
  const root = button.querySelector('[data-glyph]');
  return {
    glyph: root?.getAttribute('data-glyph'),
    turning: root?.getAttribute('data-turning'),
  };
};

// The shown status waits for an unpressed sync; fake timers let a test pass it.
beforeEach(() => {
  syncPressedAt.current = -Infinity;
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('the header sync affordance', () => {
  // CONTROL for every assertion below: this is the one case that SHOULD offer
  // the action, so a wrong icon elsewhere cannot be explained by the harness
  // failing to render the control at all.
  test('CONTROL: offers "sync now" when signed in with nothing yet confirmed', async () => {
    await renderMenu((store) => {
      store.dispatch(setSignedIn());
      store.dispatch(setSyncStatus('idle'));
    });

    expect(glyphOf(syncControl()).glyph).toBe('sync');
    expect(glyphOf(syncControl()).turning).toBe('false');
    expect(syncControl().getAttribute('aria-disabled')).toBeNull();
  });

  test('reports agreement once a sync has confirmed it', async () => {
    await renderMenu((store) => {
      store.dispatch(setSignedIn());
      store.dispatch(setSyncStatus('success'));
    });

    expect(glyphOf(syncControl()).glyph).toBe('cloud_done');
  });

  test('shows the sync is under way, and takes the action away while it is', async () => {
    await renderMenu((store) => {
      store.dispatch(setSignedIn());
      store.dispatch(setSyncStatus('loading'));
    });

    // Unpressed: the drawing turns once the shown status catches up.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });
    expect(glyphOf(syncControl('Syncing…'))).toEqual({
      glyph: 'sync',
      turning: 'true',
    });
    expect(syncControl('Syncing…').getAttribute('aria-disabled')).toBe('true');
  });

  // KAN-263. The test above seeds 'loading' by hand; this one gets there the
  // way a real sync does. Only the WRITE's pending was wired, so through the
  // cloud read the control still read 'sync' and was clickable -- a click
  // there started a second sync on top of the running one.
  test('takes the action away from the moment a sync STARTS, not only once it writes', async () => {
    await renderMenu((store) => {
      store.dispatch(setSignedIn());
      store.dispatch(setSyncStatus('idle'));
      store.dispatch(syncStateWithFirestore.pending('read-phase', undefined));
    });

    // Unpressed: the drawing turns once the shown status catches up.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });
    expect(glyphOf(syncControl('Syncing…'))).toEqual({
      glyph: 'sync',
      turning: 'true',
    });
    expect(syncControl('Syncing…').getAttribute('aria-disabled')).toBe('true');
  });

  test('reports a problem rather than inviting another attempt', async () => {
    await renderMenu((store) => {
      store.dispatch(setSignedIn());
      store.dispatch(setSyncStatus('error'));
    });

    expect(glyphOf(syncControl()).glyph).toBe('sync_problem');
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

    expect(glyphOf(syncControl('Sync unavailable')).glyph).toBe('cloud_off');
    expect(syncControl('Sync unavailable').getAttribute('aria-disabled')).toBe(
      'true'
    );
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

    expect(glyphOf(syncControl('Sync unavailable')).glyph).toBe('cloud_off');
  });

  // KAN-750. The words are the real status; the drawing is the shown one.
  test('the name says Syncing… on the click while the drawing follows the shown status', async () => {
    const { store } = await renderMenu((s) => {
      s.dispatch(setSignedIn());
      s.dispatch(grantCloudConsent());
      s.dispatch(setSyncStatus('idle'));
    });
    // One synchronous act: the click's thunk has not finished when loading lands.
    act(() => {
      fireEvent.click(syncControl());
      store.dispatch(setSyncStatus('loading'));
    });
    // No timers advanced: the press shows the sync at once.
    expect(glyphOf(syncControl('Syncing…'))).toEqual({
      glyph: 'sync',
      turning: 'true',
    });
  });

  test('a short unpressed sync never turns the drawing while the name says Syncing… at once', async () => {
    const { store } = await renderMenu((s) => {
      s.dispatch(setSignedIn());
      s.dispatch(setSyncStatus('idle'));
    });
    await act(async () => {
      store.dispatch(setSyncStatus('loading'));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(glyphOf(syncControl('Syncing…'))).toEqual({
      glyph: 'sync',
      turning: 'false',
    });
    await act(async () => {
      store.dispatch(setSyncStatus('success'));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(glyphOf(syncControl())).toEqual({
      glyph: 'cloud_done',
      turning: 'false',
    });
  });

  // KAN-750 R8. Signed in, cloud on, consent and Auto Sync, nothing started:
  // the boot sync is coming, so the DRAWING turns while the words stay real
  // (KAN-342): "Sync now", enabled.
  describe('while the boot sync waits for sign-in', () => {
    const renderBootWait = async () => {
      // Page time starts at 0 only on the fully faked clock.
      vi.useRealTimers();
      vi.useFakeTimers();
      return renderMenu((s) => {
        s.dispatch(setSignedIn());
        s.dispatch(setCloudConfigured(true));
        s.dispatch(grantCloudConsent());
        s.dispatch(setSyncStatus('idle'));
      });
    };
    const advance = (ms: number) =>
      act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
      });

    test('the drawing turns from 150 ms while the name stays Sync now and enabled', async () => {
      await renderBootWait();
      await advance(149);
      expect(glyphOf(syncControl()).turning).toBe('false');
      await advance(1);
      expect(glyphOf(syncControl())).toEqual({
        glyph: 'sync',
        turning: 'true',
      });
      expect(syncControl().getAttribute('aria-disabled')).toBeNull();
    });

    test('once the sync starts and lands, the drawing settles per the normal rules', async () => {
      const { store } = await renderBootWait();
      await advance(150);
      expect(glyphOf(syncControl()).turning).toBe('true');
      await act(async () => {
        store.dispatch(syncStateWithFirestore.pending('boot', undefined));
      });
      expect(glyphOf(syncControl('Syncing…')).turning).toBe('true');
      await act(async () => {
        store.dispatch(setSyncStatus('success'));
      });
      // Shown for its hold, then it morphs to done.
      await advance(400);
      expect(glyphOf(syncControl())).toEqual({
        glyph: 'cloud_done',
        turning: 'false',
      });
    });

    test('a wait that never ends stops turning at 8 s of page time', async () => {
      await renderBootWait();
      await advance(7999);
      expect(glyphOf(syncControl()).turning).toBe('true');
      await advance(1);
      expect(glyphOf(syncControl())).toEqual({
        glyph: 'sync',
        turning: 'false',
      });
      expect(syncControl().getAttribute('aria-disabled')).toBeNull();
    });
  });
});
