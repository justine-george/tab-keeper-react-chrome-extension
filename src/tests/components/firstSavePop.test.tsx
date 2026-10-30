import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup } from '@testing-library/react';

import FirstSavePop from '../../components/home/leftpane/FirstSavePop';
import { renderWithProviders } from '../setup/renderWithProviders';
import { FakeMediaQueryList } from '../setup/mediaQueryFake';
import { noteFirstSave } from '../../redux/slices/globalStateSlice';

// KAN-875. The first save's pop: 24 pieces while it plays, and the review card held until they finish.

const pieces = () => document.querySelectorAll('[data-pop-piece]');
const pop = () => document.querySelector('[data-first-save-pop]');

// jsdom has no Web Animations. Each call hands back an animation whose end the test decides.
let ends: Array<() => void> = [];
let cancels = 0;
beforeEach(() => {
  ends = [];
  cancels = 0;
  Element.prototype.animate = vi.fn(() => {
    let end = () => {};
    const finished = new Promise<void>((resolve) => {
      end = resolve;
    });
    ends.push(end);
    return {
      finished,
      cancel: () => {
        cancels += 1;
      },
    } as unknown as Animation;
  });
});

afterEach(() => {
  cleanup();
  // @ts-expect-error -- jsdom's Element has no animate; put that back.
  delete Element.prototype.animate;
  vi.restoreAllMocks();
});

const popping = (
  store: Awaited<ReturnType<typeof renderWithProviders>>['store']
) => store.getState().globalState.isFirstSavePopping;

describe('the first-save pop', () => {
  test('nothing before the first save', async () => {
    await renderWithProviders(<FirstSavePop />);
    expect(pieces()).toHaveLength(0);
    expect(pop()).toBeNull();
  });

  test('a first save mounts 24 pieces and holds the card', async () => {
    const { store } = await renderWithProviders(<FirstSavePop />);
    act(() => {
      store.dispatch(noteFirstSave());
    });
    expect(pieces()).toHaveLength(24);
    expect(pop()).toHaveAttribute('aria-hidden', 'true');
    expect(popping(store)).toBe(true);
  });

  test('when the pieces finish, it clears and lets the card go', async () => {
    const { store } = await renderWithProviders(<FirstSavePop />);
    act(() => {
      store.dispatch(noteFirstSave());
    });
    expect(ends.length).toBeGreaterThan(0);
    await act(async () => {
      ends.forEach((end) => end());
    });
    expect(pop()).toBeNull();
    expect(popping(store)).toBe(false);
  });

  test('one piece still running keeps it on screen', async () => {
    const { store } = await renderWithProviders(<FirstSavePop />);
    act(() => {
      store.dispatch(noteFirstSave());
    });
    await act(async () => {
      ends.slice(1).forEach((end) => end());
    });
    expect(pieces()).toHaveLength(24);
    expect(popping(store)).toBe(true);
  });

  test('reduced motion: no pieces and nothing held', async () => {
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) => new FakeMediaQueryList(query, query.includes('reduce'))
    );
    const { store } = await renderWithProviders(<FirstSavePop />);
    act(() => {
      store.dispatch(noteFirstSave());
    });
    expect(pieces()).toHaveLength(0);
    expect(popping(store)).toBe(false);
  });

  test('no Web Animations: no pieces and nothing held', async () => {
    // @ts-expect-error -- as jsdom ships it.
    delete Element.prototype.animate;
    const { store } = await renderWithProviders(<FirstSavePop />);
    act(() => {
      store.dispatch(noteFirstSave());
    });
    expect(pieces()).toHaveLength(0);
    expect(popping(store)).toBe(false);
  });

  test('unmounting mid-pop lets the card go', async () => {
    const { store, unmount } = await renderWithProviders(<FirstSavePop />);
    act(() => {
      store.dispatch(noteFirstSave());
    });
    expect(popping(store)).toBe(true);
    unmount();
    expect(popping(store)).toBe(false);
    expect(cancels).toBeGreaterThan(0);
  });

  test('a page that mounts after the first save plays nothing', async () => {
    const { store } = await renderWithProviders(<FirstSavePop />, {
      seedStore: (s) => {
        s.dispatch(noteFirstSave());
      },
    });
    expect(pieces()).toHaveLength(0);
    expect(popping(store)).toBe(false);
  });
});
