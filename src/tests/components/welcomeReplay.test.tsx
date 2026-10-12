import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';

import { CloudConsentModal } from '../../components/modals/CloudConsentModal';
import { openCloudConsentModal } from '../../redux/slices/globalStateSlice';
import { renderWithProviders } from '../setup/renderWithProviders';

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

describe('the popup welcome', () => {
  const renderWelcome = () =>
    renderWithProviders(<CloudConsentModal />, {
      seedStore: (store) =>
        store.dispatch(openCloudConsentModal({ variant: 'welcome' })),
    });

  test('Get started finishes the loop and Play again never appears', async () => {
    await renderWelcome();
    fireEvent.click(screen.getByRole('button', { name: 'Get started' }));
    await endLoop();
    expect(playAgain()).toBeNull();
  });
});
