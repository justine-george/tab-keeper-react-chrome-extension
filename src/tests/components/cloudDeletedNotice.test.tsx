import { afterEach, describe, expect, test } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';

import { CloudDeletedNoticeModal } from '../../components/modals/CloudDeletedNoticeModal';
import {
  openCloudDeletedNotice,
  setSignedIn,
} from '../../redux/slices/globalStateSlice';
import {
  declineCloudConsent,
  markCloudDeletedElsewhere,
} from '../../redux/slices/settingsDataStateSlice';
import { renderWithProviders } from '../setup/renderWithProviders';
import type { makeTestStore } from '../setup/makeStore';

type Store = ReturnType<typeof makeTestStore>['store'];

// KAN-759. The notice in the page whose sync found the cloud copy gone: it
// asks the one question the stop leaves open, keep sync off or upload again.

const TITLE = 'Your cloud copy was deleted';

// The state a sync leaves behind when it stops (stopForCloudDeletedElsewhere).
const stopped = (store: Store, wasAutoSync = true) => {
  store.dispatch(setSignedIn());
  store.dispatch(markCloudDeletedElsewhere({ wasAutoSync }));
  store.dispatch(declineCloudConsent());
  store.dispatch(openCloudDeletedNotice());
};

const notice = () => screen.getByRole('dialog', { name: TITLE });

afterEach(() => {
  document.querySelectorAll('dialog[data-other]').forEach((d) => d.remove());
});

describe('the cloud deleted notice', () => {
  test('says what happened and offers keep off first, then turn on', async () => {
    await renderWithProviders(<CloudDeletedNoticeModal />, {
      seedStore: (s) => stopped(s),
    });
    expect(notice()).toHaveProperty('open', true);
    expect(notice().textContent).toContain(
      'It was deleted on another device, so sync is off here. The sessions on this device are unchanged. Turn sync on again to upload them as the new cloud copy.'
    );
    const buttons = [...notice().querySelectorAll('button')].map(
      (b) => b.textContent
    );
    // The way out first, so the first focus changes nothing.
    expect(buttons).toEqual(['Keep sync off', 'Turn sync on']);
  });

  test('Keep sync off closes it and leaves sync off', async () => {
    const { store } = await renderWithProviders(<CloudDeletedNoticeModal />, {
      seedStore: (s) => stopped(s),
    });
    fireEvent.click(screen.getByRole('button', { name: 'Keep sync off' }));
    expect(screen.queryByRole('dialog', { name: TITLE })).toBeNull();
    const { settingsDataState, globalState } = store.getState();
    expect(globalState.isCloudDeletedNoticeOpen).toBe(false);
    expect(settingsDataState.cloudConsent).toBe('declined');
    // The card keeps the reason.
    expect(settingsDataState.cloudDeletedElsewhere).toEqual({
      wasAutoSync: true,
    });
  });

  test('Escape is Keep sync off', async () => {
    const { store } = await renderWithProviders(<CloudDeletedNoticeModal />, {
      seedStore: (s) => stopped(s),
    });
    fireEvent(notice(), new Event('cancel', { cancelable: true }));
    expect(store.getState().globalState.isCloudDeletedNoticeOpen).toBe(false);
    expect(store.getState().settingsDataState.cloudConsent).toBe('declined');
  });

  test('Turn sync on gives the yes and puts Auto sync back as it was', async () => {
    const { store } = await renderWithProviders(<CloudDeletedNoticeModal />, {
      seedStore: (s) => stopped(s, false),
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Turn sync on' }));
    });
    expect(screen.queryByRole('dialog', { name: TITLE })).toBeNull();
    const { settingsDataState } = store.getState();
    expect(settingsDataState.cloudConsent).toBe('granted');
    expect(settingsDataState.isAutoSync).toBe(false);
    expect(settingsDataState.cloudDeletedElsewhere).toBeNull();
  });

  // The sync that finds it runs after the open's dialogs decided, so it can
  // arrive while one of them is up: it waits rather than stacking on top.
  test('waits while another dialog is open, and opens when it closes', async () => {
    const other = document.createElement('dialog');
    other.dataset.other = '';
    document.body.append(other);
    other.showModal();

    await renderWithProviders(<CloudDeletedNoticeModal />, {
      seedStore: (s) => stopped(s),
    });
    expect(screen.queryByRole('dialog', { name: TITLE })).toBeNull();

    await act(async () => {
      other.close();
      // The observer reports on a microtask.
      await Promise.resolve();
    });
    expect(notice()).toHaveProperty('open', true);
  });
});
