import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { StrictMode } from 'react';

import {
  syncBusyEndedAt,
  useShownSyncStatus,
} from '../../components/common/useShownSyncStatus';
import type { SyncStatus } from '../../redux/slices/globalStateSlice';

// KAN-750. When the glyph SHOWS syncing: unpressed syncs wait 150 ms, a shown
// sync holds 400 ms, a press shows at once, the boot sync shows while sign-in
// is pending but only for 8 s.
type Props = { raw: SyncStatus; awaitsBootSync: boolean };
const NEVER = -Infinity;

function setup(initial: Partial<Props> = {}) {
  const pressed = { current: NEVER };
  let latest: Props = { raw: 'idle', awaitsBootSync: false, ...initial };
  const view = renderHook(
    (p: Props) => useShownSyncStatus(p.raw, { ...p, pressedAt: pressed }),
    { initialProps: latest }
  );
  const update = (p: Partial<Props>) => {
    latest = { ...latest, ...p };
    act(() => view.rerender(latest));
  };
  const wait = (ms: number) => act(() => void vi.advanceTimersByTime(ms));
  return { view, pressed, update, wait };
}

describe('useShownSyncStatus', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
    syncBusyEndedAt.current = -Infinity;
  });
  afterEach(() => vi.useRealTimers());

  test('a sync under 150 ms is never shown', () => {
    const { view, update, wait } = setup();
    update({ raw: 'loading' });
    expect(view.result.current).not.toBe('loading');
    wait(120);
    expect(view.result.current).not.toBe('loading');
    update({ raw: 'success' });
    expect(view.result.current).toBe('success');
    wait(1000);
    expect(view.result.current).toBe('success');
  });

  test('a slower sync shows after 150 ms and holds 400 ms', () => {
    const { view, update, wait } = setup();
    update({ raw: 'loading' });
    wait(149);
    expect(view.result.current).not.toBe('loading');
    wait(1);
    expect(view.result.current).toBe('loading');
    wait(50);
    update({ raw: 'success' }); // t = 200
    wait(349); // t = 549
    expect(view.result.current).toBe('loading');
    wait(1);
    expect(view.result.current).toBe('success');
  });

  test('a press shows at once', () => {
    const { view, pressed, update, wait } = setup();
    wait(1);
    pressed.current = performance.now();
    update({ raw: 'loading' });
    expect(view.result.current).toBe('loading');
  });

  test('a press before the last busy period ended does not count', () => {
    const { view, pressed, update, wait } = setup();
    pressed.current = performance.now(); // before the sync that ends below
    wait(1);
    update({ raw: 'loading' });
    wait(500);
    update({ raw: 'success' });
    wait(1000);
    update({ raw: 'loading' }); // an unpressed sync, later
    expect(view.result.current).not.toBe('loading');
    wait(150);
    expect(view.result.current).toBe('loading');
  });

  test('a press after the last busy period ended counts', () => {
    const { view, pressed, update, wait } = setup();
    update({ raw: 'loading' });
    wait(500);
    update({ raw: 'success' });
    wait(1000);
    pressed.current = performance.now();
    update({ raw: 'loading' });
    expect(view.result.current).toBe('loading');
  });

  test('a press while a boot wait is already busy shows at once', () => {
    const { view, pressed, update, wait } = setup({ awaitsBootSync: true });
    wait(50);
    expect(view.result.current).toBe('idle');
    pressed.current = performance.now();
    update({ raw: 'loading' }); // the press starts a real sync
    expect(view.result.current).toBe('loading');
  });

  test('two instances on one press ref agree at every step', () => {
    const shared = { current: -Infinity };
    const mk = () =>
      renderHook(
        (raw: SyncStatus) =>
          useShownSyncStatus(raw, { awaitsBootSync: false, pressedAt: shared }),
        { initialProps: 'idle' as SyncStatus }
      );
    const a = mk();
    const b = mk();
    const step = (raw: SyncStatus) => {
      act(() => {
        a.rerender(raw);
        b.rerender(raw);
      });
      expect(a.result.current).toBe(b.result.current);
      return a.result.current;
    };
    vi.advanceTimersByTime(1);
    shared.current = performance.now();
    expect(step('loading')).toBe('loading');
    act(() => void vi.advanceTimersByTime(100));
    expect(step('success')).toBe('loading'); // held
    act(() => void vi.advanceTimersByTime(400));
    expect(a.result.current).toBe('success');
    expect(b.result.current).toBe('success');
  });

  // The toolbar button remounts on Home <-> Settings; the card mounts with Settings.
  test('an instance mounted mid-sync after a press shows at once', () => {
    const shared = { current: -Infinity };
    const mk = (raw: SyncStatus) =>
      renderHook(
        (r: SyncStatus) =>
          useShownSyncStatus(r, { awaitsBootSync: false, pressedAt: shared }),
        { initialProps: raw }
      );
    const first = mk('idle');
    vi.advanceTimersByTime(1);
    shared.current = performance.now();
    act(() => first.rerender('loading'));
    expect(first.result.current).toBe('loading');
    act(() => void vi.advanceTimersByTime(50));
    first.unmount();

    const remounted = mk('loading');
    expect(remounted.result.current).toBe('loading');
  });

  test('CONTROL: mounted mid-sync nobody pressed, it waits the delay', () => {
    const view = renderHook(
      (r: SyncStatus) =>
        useShownSyncStatus(r, {
          awaitsBootSync: false,
          pressedAt: { current: -Infinity },
        }),
      { initialProps: 'loading' as SyncStatus }
    );
    expect(view.result.current).toBe('idle');
    act(() => void vi.advanceTimersByTime(150));
    expect(view.result.current).toBe('loading');
  });

  test('a press before a later mount while idle does not count', () => {
    const shared = { current: -Infinity };
    vi.advanceTimersByTime(1);
    shared.current = performance.now(); // a press whose sync ended unseen
    vi.advanceTimersByTime(1);
    const view = renderHook(
      (r: SyncStatus) =>
        useShownSyncStatus(r, { awaitsBootSync: false, pressedAt: shared }),
      { initialProps: 'idle' as SyncStatus }
    );
    act(() => view.rerender('loading'));
    expect(view.result.current).not.toBe('loading');
  });

  // Dev builds render under StrictMode, which unmounts and remounts once.
  test('under StrictMode a busy mount still shows after the delay', () => {
    const view = renderHook(
      () =>
        useShownSyncStatus('idle', {
          awaitsBootSync: true,
          pressedAt: { current: -Infinity },
        }),
      { wrapper: StrictMode }
    );
    act(() => void vi.advanceTimersByTime(150));
    expect(view.result.current).toBe('loading');
  });

  test('the boot sync shows while signing in', () => {
    const { view, wait } = setup({ awaitsBootSync: true });
    expect(view.result.current).toBe('idle');
    wait(150);
    expect(view.result.current).toBe('loading');
  });

  test('mounted after the limit, the boot sync never shows', () => {
    vi.advanceTimersByTime(8000);
    const { view, wait } = setup({ awaitsBootSync: true });
    wait(1000);
    expect(view.result.current).toBe('idle');
  });

  test('mounted at 5 s, the boot sync stops at 8 s of page time', () => {
    vi.advanceTimersByTime(5000);
    const { view, wait } = setup({ awaitsBootSync: true });
    wait(150);
    expect(view.result.current).toBe('loading');
    wait(2849); // page time 7999
    expect(view.result.current).toBe('loading');
    wait(1);
    expect(view.result.current).toBe('idle');
  });

  test('stops showing the boot sync after the limit', () => {
    const { view, wait } = setup({ awaitsBootSync: true });
    wait(7999);
    expect(view.result.current).toBe('loading');
    wait(1);
    expect(view.result.current).toBe('idle');
  });

  test('a real loading still shows after the boot limit', () => {
    const { view, update, wait } = setup({ awaitsBootSync: true });
    wait(8000);
    update({ raw: 'loading', awaitsBootSync: false });
    wait(150);
    expect(view.result.current).toBe('loading');
    update({ raw: 'success' });
    wait(400);
    expect(view.result.current).toBe('success');
  });

  test('a failure after a shown sync waits out the hold', () => {
    const { view, update, wait } = setup();
    update({ raw: 'loading' });
    wait(150);
    wait(10);
    update({ raw: 'error' }); // t = 160
    expect(view.result.current).toBe('loading');
    wait(389);
    expect(view.result.current).toBe('loading');
    wait(1);
    expect(view.result.current).toBe('error');
  });

  test('nothing is shown when not busy', () => {
    const { view } = setup({ raw: 'success' });
    expect(view.result.current).toBe('success');
  });

  test('loading, success, loading inside the hold stays shown, then ends by the same hold', () => {
    const { view, update, wait } = setup();
    update({ raw: 'loading' });
    wait(150);
    wait(100);
    update({ raw: 'success' }); // t = 250
    wait(100);
    update({ raw: 'loading' }); // t = 350, back inside the hold
    expect(view.result.current).toBe('loading');
    wait(300);
    update({ raw: 'success' }); // t = 650, hold from 150 already over
    expect(view.result.current).toBe('success');
  });

  test('a flip back to loading cancels the pending hide', () => {
    const { view, update, wait } = setup();
    update({ raw: 'loading' });
    wait(150);
    update({ raw: 'success' }); // t = 150, hide due at 550
    wait(100);
    update({ raw: 'loading' });
    wait(1000);
    expect(view.result.current).toBe('loading');
  });

  test('unmounting mid-hold leaves no timer and no warning', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { view, update, wait } = setup();
    update({ raw: 'loading' });
    wait(150);
    update({ raw: 'success' });
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
    wait(10_000);
    expect(err).not.toHaveBeenCalled();
    err.mockRestore();
  });

  test('unmounting before the delay clears the pending show', () => {
    const { view, update } = setup();
    update({ raw: 'loading' });
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
