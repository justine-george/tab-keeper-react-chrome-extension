import { afterEach, describe, expect, test, vi } from 'vitest';

import { installFakeAudio, uninstallFakeAudio } from '../../setup/audioFake';

// The shutter click on a fake Web Audio graph: what is scheduled, when, and through which filter.

// A fresh module per test: the context it creates is kept for the page's life.
const loadSound = async () => {
  vi.resetModules();
  return import('../../../utils/functions/uiSound');
};

afterEach(uninstallFakeAudio);

describe('playShutterClick', () => {
  test('two band-passed noise ticks: 3200 Hz for 50ms at t, then 5200 Hz for 35ms at t + 35ms, at half the level', async () => {
    const { sources, contexts } = installFakeAudio();
    const { playShutterClick } = await loadSound();
    playShutterClick();
    const ticks = sources.map((s) => ({
      type: s.output?.type,
      frequency: s.output?.frequency.value,
      q: s.output?.Q.value,
      startedAt: s.startedAt,
      stoppedAt: s.stoppedAt,
      gain: s.output?.output?.gain.log,
      toSpeakers: s.output?.output?.output === contexts[0].destination,
    }));
    expect(ticks).toEqual([
      {
        type: 'bandpass',
        frequency: 3200,
        q: 4,
        startedAt: 2,
        stoppedAt: expect.closeTo(2.05, 6),
        gain: [
          { method: 'set', value: 0, time: 2 },
          { method: 'linear', value: 0.3, time: expect.closeTo(2.002, 6) },
          {
            method: 'exponential',
            value: 0.0001,
            time: expect.closeTo(2.05, 6),
          },
        ],
        toSpeakers: true,
      },
      {
        type: 'bandpass',
        frequency: 5200,
        q: 4,
        startedAt: expect.closeTo(2.035, 6),
        stoppedAt: expect.closeTo(2.07, 6),
        gain: [
          { method: 'set', value: 0, time: expect.closeTo(2.035, 6) },
          { method: 'linear', value: 0.15, time: expect.closeTo(2.037, 6) },
          {
            method: 'exponential',
            value: 0.0001,
            time: expect.closeTo(2.07, 6),
          },
        ],
        toSpeakers: true,
      },
    ]);
  });

  test('one context for the page; a suspended one is resumed on each play', async () => {
    const { contexts, sources } = installFakeAudio('suspended');
    const { playShutterClick } = await loadSound();
    playShutterClick();
    playShutterClick();
    expect(contexts).toHaveLength(1);
    expect(contexts[0].resumed).toBe(2);
    expect(sources).toHaveLength(4);
  });

  test('no AudioContext: nothing plays and nothing throws', async () => {
    uninstallFakeAudio();
    const { playShutterClick } = await loadSound();
    expect(() => playShutterClick()).not.toThrow();
  });

  test('a context that refuses to start: nothing plays and nothing throws', async () => {
    Object.defineProperty(globalThis, 'AudioContext', {
      configurable: true,
      writable: true,
      value: class {
        constructor() {
          throw new Error('NotAllowedError');
        }
      },
    });
    const { playShutterClick } = await loadSound();
    expect(() => playShutterClick()).not.toThrow();
  });
});
