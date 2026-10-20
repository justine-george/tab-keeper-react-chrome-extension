import { describe, expect, test, vi } from 'vitest';
import { act } from '@testing-library/react';

import { useIsMac, useMacKeys } from '../../hooks/useIsMac';
import { renderWithProviders } from '../setup/renderWithProviders';

// KAN-708. Every row reads the platform, so it is asked once per page and remembered.

type Seen = { isMac: boolean | null; macKeys: boolean }[];

function Probe({ seen }: { seen: Seen }) {
  const isMac = useIsMac();
  const macKeys = useMacKeys();
  seen.push({ isMac, macKeys });
  return null;
}

const ROWS = 20;

function Rows({ seen }: { seen: Seen }) {
  return (
    <>
      {Array.from({ length: ROWS }, (_, i) => (
        <Probe key={i} seen={seen} />
      ))}
    </>
  );
}

const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

describe('the platform, read once per page', () => {
  test('twenty rows ask Chrome once, and all of them hear the answer', async () => {
    const seen: Seen = [];
    const r = await renderWithProviders(<></>, { seed: { platformOs: 'mac' } });
    const read = vi.spyOn(chrome.runtime, 'getPlatformInfo');
    r.rerender(<Rows seen={seen} />);
    await settle();
    expect(read).toHaveBeenCalledOnce();
    expect(seen.slice(-ROWS)).toEqual(
      Array.from({ length: ROWS }, () => ({ isMac: true, macKeys: true }))
    );
  });

  test('a row mounted after the answer reads it on its first render, and renders once', async () => {
    const first: Seen = [];
    const later: Seen = [];
    const r = await renderWithProviders(<Probe seen={first} />, {
      seed: { platformOs: 'mac' },
    });
    await settle();
    expect(first[first.length - 1]).toEqual({ isMac: true, macKeys: true });
    const read = vi.spyOn(chrome.runtime, 'getPlatformInfo');

    r.rerender(
      <>
        <Probe seen={first} />
        <Probe seen={later} />
      </>
    );
    await settle();
    expect(later).toEqual([{ isMac: true, macKeys: true }]);
    expect(read).not.toHaveBeenCalled();
  });

  test('CONTROL: before the answer, a row renders unknown, then once more with it', async () => {
    const seen: Seen = [];
    await renderWithProviders(<Probe seen={seen} />, {
      seed: { platformOs: 'mac' },
    });
    await settle();
    expect(seen).toEqual([
      { isMac: null, macKeys: false },
      { isMac: true, macKeys: true },
    ]);
  });

  test('a PC: the platform reads false and Mac keys stay false', async () => {
    const seen: Seen = [];
    await renderWithProviders(<Probe seen={seen} />, {
      seed: { platformOs: 'win' },
    });
    await settle();
    expect(seen[seen.length - 1]).toEqual({ isMac: false, macKeys: false });
  });

  test('worst path: the read fails for twenty rows: one warning, and every row reads not a Mac', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const failed = Promise.reject(new Error('no platform'));
    failed.catch(() => {});
    const seen: Seen = [];
    await renderWithProviders(<Rows seen={seen} />, {
      seed: { platformAnswer: failed },
    });
    await settle();
    expect(warn).toHaveBeenCalledOnce();
    expect(seen.slice(-ROWS)).toEqual(
      Array.from({ length: ROWS }, () => ({ isMac: false, macKeys: false }))
    );
    warn.mockRestore();
  });

  test('a held answer: every row waits unknown, then hears it', async () => {
    let answer: (info: chrome.runtime.PlatformInfo) => void = () => {};
    const held = new Promise<chrome.runtime.PlatformInfo>((resolve) => {
      answer = resolve;
    });
    const seen: Seen = [];
    await renderWithProviders(<Rows seen={seen} />, {
      seed: { platformAnswer: held },
    });
    await settle();
    expect(seen.slice(-ROWS).every((s) => s.isMac === null)).toBe(true);
    await act(async () => {
      answer({ os: 'mac', arch: 'arm' });
      await held;
    });
    expect(seen.slice(-ROWS)).toEqual(
      Array.from({ length: ROWS }, () => ({ isMac: true, macKeys: true }))
    );
  });
});
