import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  openFirstDialog,
  STAND_DOWN,
  type DialogEntry,
} from '../../../utils/functions/dialogQueue';

// KAN-7 §8. One list per surface, decided in order, at most one opened.

type Answer = 'yes' | 'no' | 'throws';

const entry = (
  id: DialogEntry['id'],
  answer: Answer,
  log: string[],
  delayMs = 0
): DialogEntry => ({
  id,
  decide: async () => {
    log.push(`decide ${id}`);
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    if (answer === 'throws') throw new Error(`${id} broke`);
    return answer === 'yes' ? () => void log.push(`open ${id}`) : null;
  },
});

afterEach(() => vi.restoreAllMocks());

describe('openFirstDialog', () => {
  test('opens the first yes, and decides nothing after it', async () => {
    const log: string[] = [];
    const opened = await openFirstDialog([
      entry('cloudConsent', 'no', log),
      entry('rate', 'yes', log),
      entry('tabGroups', 'yes', log),
    ]);
    expect(opened).toBe('rate');
    expect(log).toEqual(['decide cloudConsent', 'decide rate', 'open rate']);
  });

  test('order wins over speed: a slow yes first beats a fast yes after it', async () => {
    const log: string[] = [];
    const opened = await openFirstDialog([
      entry('cloudConsent', 'yes', log, 20),
      entry('rate', 'yes', log),
    ]);
    expect(opened).toBe('cloudConsent');
    expect(log).toEqual(['decide cloudConsent', 'open cloudConsent']);
  });

  test('a check that throws counts as no, and the next one still decides', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const log: string[] = [];
    const opened = await openFirstDialog([
      entry('cloudConsent', 'throws', log),
      entry('rate', 'yes', log),
    ]);
    expect(opened).toBe('rate');
    expect(log).toEqual(['decide cloudConsent', 'decide rate', 'open rate']);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  test('a check that throws before it returns counts as no, and the queue still settles', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const log: string[] = [];
    const opened = openFirstDialog([
      {
        id: 'cloudConsent',
        decide: () => {
          throw new Error('cloudConsent broke');
        },
      },
      { id: 'rate', decide: () => () => void log.push('open rate') },
    ]);
    await expect(opened).resolves.toBe('rate');
    expect(log).toEqual(['open rate']);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  test('a synchronous decide is taken as it is', async () => {
    const log: string[] = [];
    const opened = await openFirstDialog([
      { id: 'cloudConsent', decide: () => null },
      { id: 'rate', decide: () => () => void log.push('open rate') },
    ]);
    expect(opened).toBe('rate');
    expect(log).toEqual(['open rate']);
  });

  test('all no opens nothing', async () => {
    const log: string[] = [];
    expect(
      await openFirstDialog([
        entry('cloudConsent', 'no', log),
        entry('rate', 'no', log),
      ])
    ).toBeNull();
    expect(log).toEqual(['decide cloudConsent', 'decide rate']);
  });
});

describe('standing down for a tour (KAN-413)', () => {
  test('a tour started while an entry decides: nothing opens, and the list stops', async () => {
    const log: string[] = [];
    let tour = false;
    const opened = await openFirstDialog(
      [
        {
          id: 'tabGroups',
          decide: async () => {
            log.push('decide tabGroups');
            tour = true;
            return () => void log.push('open tabGroups');
          },
        },
        entry('fullViewCallout', 'yes', log),
      ],
      () => tour
    );
    expect(opened).toBeNull();
    expect(log).toEqual(['decide tabGroups']);
  });

  test('an entry that stands down: nothing opens, and nothing after it is decided', async () => {
    const log: string[] = [];
    const opened = await openFirstDialog([
      entry('cloudConsent', 'no', log),
      {
        id: 'firstRun',
        decide: () => {
          log.push('decide firstRun');
          return STAND_DOWN;
        },
      },
      entry('setup', 'yes', log),
    ]);
    expect(opened).toBeNull();
    expect(log).toEqual(['decide cloudConsent', 'decide firstRun']);
  });

  test('a tour already running: nothing is decided', async () => {
    const log: string[] = [];
    expect(
      await openFirstDialog([entry('rate', 'yes', log)], () => true)
    ).toBeNull();
    expect(log).toEqual([]);
  });
});
