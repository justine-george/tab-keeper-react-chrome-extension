import { describe, expect, test } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';

import MenuContainer from '../../components/home/leftpane/MenuContainer';
import { renderWithProviders } from '../setup/renderWithProviders';
import { setSyncStatus } from '../../redux/slices/globalStateSlice';

// KAN-63 changed how an Icon turns a keypress into its onClick: it used to
// call onClick(e as any) directly, and now forwards to the element's own
// click() so React dispatches a real MouseEvent.
//
// The sync icon is the one that matters. It is the entry point to
// syncStateWithFirestore, and it is the only Icon whose `disable` flips at
// runtime -- so it is where a change to the activation path could either stop
// sync working or let it fire when it must not.
//
// jsdom is the right oracle here, unlike the accessible-name assertions in
// e2e/a11y-controls.spec.ts: this is about which actions reach the store, not
// about what a real accessibility tree exposes.

const SYNC_PENDING = 'global/syncStateWithFirestore/pending';

const syncIcon = () => screen.getByRole('button', { name: 'Sync now' });

describe('Icon keyboard activation reaches the same handler as a click', () => {
  // The control. If the sync thunk stopped being dispatched by a plain mouse
  // click, every keyboard assertion below would fail for a reason that has
  // nothing to do with the keyboard.
  test('CONTROL: clicking the sync icon dispatches the sync thunk', async () => {
    const { seen } = await renderWithProviders(<MenuContainer />);
    seen.length = 0;

    await act(async () => {
      fireEvent.click(syncIcon());
    });

    expect(seen).toContain(SYNC_PENDING);
  });

  for (const key of [
    { key: 'Enter', name: 'Enter' },
    { key: ' ', name: 'Space' },
  ]) {
    test(`${key.name} on the sync icon dispatches the sync thunk`, async () => {
      const { seen } = await renderWithProviders(<MenuContainer />);
      seen.length = 0;

      await act(async () => {
        fireEvent.keyDown(syncIcon(), { key: key.key });
      });

      expect(seen).toContain(SYNC_PENDING);
    });
  }

  // The behaviour that changed, and the reason this file exists.
  //
  // Icon only wires onClick onto the element when `disable` is false, but the
  // old key handler called the onClick PROP directly and so never consulted
  // that guard. Pressing Enter on the sync icon mid-sync therefore started a
  // second sync -- the re-entrancy this codebase has fixed before. Routing
  // through click() means the guard applies to the keyboard too.
  test('a disabled sync icon does not dispatch on Enter', async () => {
    const { store, seen } = await renderWithProviders(<MenuContainer />);

    await act(async () => {
      store.dispatch(setSyncStatus('loading'));
    });
    seen.length = 0;

    await act(async () => {
      fireEvent.keyDown(syncIcon(), { key: 'Enter' });
    });

    expect(seen).not.toContain(SYNC_PENDING);
  });

  // Paired with the negative above: the very same icon, in the very same
  // render, still syncs once it is enabled again. Without this, the assertion
  // above would pass against an Icon that had stopped responding to the
  // keyboard entirely.
  test('the same icon syncs again once it is re-enabled', async () => {
    const { store, seen } = await renderWithProviders(<MenuContainer />);

    await act(async () => {
      store.dispatch(setSyncStatus('loading'));
    });
    await act(async () => {
      fireEvent.keyDown(syncIcon(), { key: 'Enter' });
    });
    await act(async () => {
      store.dispatch(setSyncStatus('idle'));
    });
    seen.length = 0;

    await act(async () => {
      fireEvent.keyDown(syncIcon(), { key: 'Enter' });
    });

    expect(seen).toContain(SYNC_PENDING);
  });
});
