import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';

import { RunHelloDialog } from '../../components/modals/RunHelloDialog';
import { CloudConsentModal } from '../../components/modals/CloudConsentModal';
import { openCloudConsentModal } from '../../redux/slices/globalStateSlice';
import { renderWithProviders } from '../setup/renderWithProviders';
import { FakeMediaQueryList } from '../setup/mediaQueryFake';

// KAN-464: Play again shows once the loop rests, hides while it plays, and replays it.

interface Run {
  target: Element;
  settle: () => void;
}
let runs: Run[] = [];

// As Web Animations does: finish() and a natural end resolve `finished`, cancel() rejects it.
beforeEach(() => {
  runs = [];
  Object.defineProperty(Element.prototype, 'animate', {
    configurable: true,
    value(this: Element) {
      let settle: () => void = () => undefined;
      let fail: () => void = () => undefined;
      const finished = new Promise<unknown>((resolve, reject) => {
        settle = () => resolve(undefined);
        fail = () => reject(new Error('cancelled'));
      });
      finished.catch(() => undefined);
      runs.push({ target: this, settle });
      return { finished, finish: settle, cancel: fail };
    },
  });
});
afterEach(() => {
  Reflect.deleteProperty(Element.prototype, 'animate');
  vi.restoreAllMocks();
});

const heroRuns = () =>
  runs.filter((r) => r.target.closest('[data-hero-frame]'));
const playAgain = () => screen.queryByRole('button', { name: 'Play again' });
async function endLoop() {
  await act(async () => {
    heroRuns().forEach((r) => r.settle());
    await Promise.resolve();
  });
}

describe('Hello', () => {
  const renderHello = () =>
    renderWithProviders(
      <RunHelloDialog hello="whatsNew" onStart={vi.fn()} onSkip={vi.fn()} />
    );

  test('no Play again while the loop plays; it appears when the loop rests', async () => {
    await renderHello();
    expect(heroRuns()).toHaveLength(21);
    expect(playAgain()).toBeNull();
    await endLoop();
    expect(playAgain()).not.toBeNull();
  });

  test('Play again plays the loop once more and hides until it rests again', async () => {
    await renderHello();
    await endLoop();
    fireEvent.click(playAgain()!);
    expect(heroRuns()).toHaveLength(42);
    expect(playAgain()).toBeNull();
    await endLoop();
    expect(playAgain()).not.toBeNull();
  });

  test('a loop that is cancelled never shows Play again', async () => {
    const { unmount } = await renderHello();
    unmount();
    await endLoop();
    expect(playAgain()).toBeNull();
  });

  test('reduced motion: a still end frame and no Play again', async () => {
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) =>
        new FakeMediaQueryList(
          query,
          query === '(prefers-reduced-motion: reduce)'
        )
    );
    await renderHello();
    expect(document.querySelector('[data-hero-frame="end"]')).not.toBeNull();
    expect(document.querySelectorAll('[data-hero-frame] button')).toHaveLength(
      0
    );
  });
});

describe('the popup welcome', () => {
  const renderWelcome = () =>
    renderWithProviders(<CloudConsentModal />, {
      seedStore: (store) =>
        store.dispatch(openCloudConsentModal({ variant: 'welcome' })),
    });

  test('Play again appears when the loop rests and replays it', async () => {
    await renderWelcome();
    expect(playAgain()).toBeNull();
    await endLoop();
    fireEvent.click(playAgain()!);
    expect(heroRuns()).toHaveLength(42);
  });

  test('Get started finishes the loop and Play again never appears', async () => {
    await renderWelcome();
    fireEvent.click(screen.getByRole('button', { name: 'Get started' }));
    await endLoop();
    expect(playAgain()).toBeNull();
  });
});
