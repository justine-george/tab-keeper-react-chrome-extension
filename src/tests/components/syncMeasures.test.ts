import { describe, expect, test } from 'vitest';

import {
  syncMeasuresLanded,
  trackSyncMeasure,
} from '../../components/settings/rightpane/Account/syncMeasures';

// KAN-990. What the sync space bar's tests wait on instead of a guessed 150 ms.

const after = <T>(ms: number, value: T) =>
  new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));

describe('syncMeasuresLanded', () => {
  test('waits for a measure that takes longer than any fixed wait did', async () => {
    let landed = false;
    void trackSyncMeasure(after(300, 1)).then(() => {
      landed = true;
    });
    await syncMeasuresLanded();
    expect(landed).toBe(true);
  });

  test('also waits for one started while it waited', async () => {
    let second = false;
    void trackSyncMeasure(after(20, 1)).then(() => {
      void trackSyncMeasure(after(200, 2)).then(() => {
        second = true;
      });
    });
    await syncMeasuresLanded();
    expect(second).toBe(true);
  });

  test('a measure that fails still lands, and the caller still hears the failure', async () => {
    const failing = trackSyncMeasure(Promise.reject(new Error('gzip')));
    await syncMeasuresLanded();
    await expect(failing).rejects.toThrow('gzip');
  });

  test('with nothing running it resolves at once', async () => {
    await expect(syncMeasuresLanded()).resolves.toBeUndefined();
  });
});
