import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import {
  saveJsonToLocalStorage,
  saveToLocalStorage,
} from '../../../utils/functions/local';
import { saveLocalSessions } from '../../../utils/functions/localSessions';
import { saveLocalSettings } from '../../../utils/functions/localSettings';
import { initialState as settingsInitial } from '../../../redux/slices/settingsDataStateSlice';
import { buildContainer } from '../../fixtures/sessionFixture';

// KAN-925. What another page hears on the channel when this one writes. The
// wiring that takes a post in is tested in otherPageChanges.test.tsx.

let other: BroadcastChannel;
let heard: unknown[];

beforeEach(() => {
  localStorage.clear();
  heard = [];
  other = new BroadcastChannel('tab-keeper-stored');
  other.onmessage = (e: MessageEvent<unknown>) => heard.push(e.data);
});
afterEach(() => {
  other.close();
  vi.restoreAllMocks();
});

// Posts from one channel arrive in order, so once this marker is heard every
// post made before it has been too.
const heardBeforeMarker = async (): Promise<unknown[]> => {
  saveJsonToLocalStorage('tabContainerData', '{"marker":true}');
  await vi.waitFor(() =>
    expect(heard[heard.length - 1]).toBe('tabContainerData')
  );
  return heard.slice(0, -1);
};

describe('a landed write of a shared key tells the other pages (KAN-925)', () => {
  test('a settings save posts settingsData', async () => {
    saveLocalSettings(settingsInitial);
    expect(await heardBeforeMarker()).toEqual(['settingsData']);
  });

  test('a sessions save posts tabContainerData', async () => {
    saveLocalSessions(buildContainer([]));
    expect(await heardBeforeMarker()).toEqual(['tabContainerData']);
  });

  test('the plain save posts too: the startup write of moved settings', async () => {
    saveToLocalStorage('settingsData', {});
    expect(await heardBeforeMarker()).toEqual(['settingsData']);
  });

  test('a key the pages do not share posts nothing', async () => {
    saveToLocalStorage('deviceId', 'abc');
    saveJsonToLocalStorage('deviceId', '"abc"');
    expect(await heardBeforeMarker()).toEqual([]);
  });

  test('a refused write posts nothing: there is nothing new to read', async () => {
    const setItem = vi
      .spyOn(localStorage, 'setItem')
      .mockImplementationOnce(() => {
        throw new DOMException('full', 'QuotaExceededError');
      })
      .mockImplementationOnce(() => {
        throw new DOMException('full', 'QuotaExceededError');
      });
    vi.spyOn(console, 'error').mockImplementation(() => {});

    saveJsonToLocalStorage('settingsData', '{}');
    saveToLocalStorage('tabContainerData', {});
    expect(localStorage.getItem('settingsData')).toBeNull();
    expect(localStorage.getItem('tabContainerData')).toBeNull();

    setItem.mockRestore();
    expect(await heardBeforeMarker()).toEqual([]);
  });
});
