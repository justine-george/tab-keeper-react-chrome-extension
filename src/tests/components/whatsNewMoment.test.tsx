import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';

import { RunHelloDialog } from '../../components/modals/RunHelloDialog';
import { renderWithProviders } from '../setup/renderWithProviders';
import {
  installFakeAudio,
  startedTicks,
  uninstallFakeAudio,
} from '../setup/audioFake';
import { FakeMediaQueryList } from '../setup/mediaQueryFake';

// KAN-626. The popup's What's new Start opens the full view, so it plays Get started's moment:
// press, the shutter shuts with the click, a hold, the dialog leaves; then Start goes on.

// jsdom has no Web Animations: a fake records each run and the test finishes it.
interface Run {
  target: Element;
  release: () => void;
  isFinished: () => boolean;
}
let runs: Run[] = [];

function installAnimate(): void {
  Object.defineProperty(Element.prototype, 'animate', {
    configurable: true,
    value(this: Element) {
      let release: () => void = () => undefined;
      let fail: () => void = () => undefined;
      let isFinished = false;
      const finished = new Promise<unknown>((resolve, reject) => {
        release = () => resolve(undefined);
        fail = () => reject(new Error('cancelled'));
      });
      finished.catch(() => undefined);
      runs.push({ target: this, release, isFinished: () => isFinished });
      return {
        finished,
        cancel: () => fail(),
        finish: () => {
          isFinished = true;
        },
      };
    },
  });
}

const microtasks = () =>
  act(async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  });

async function renderHello(startOpensFullView: boolean) {
  const onStart = vi.fn();
  const onSkip = vi.fn();
  const r = await renderWithProviders(
    <RunHelloDialog
      hello="whatsNew"
      startOpensFullView={startOpensFullView}
      onStart={onStart}
      onSkip={onSkip}
    />
  );
  return { ...r, onStart, onSkip };
}
const start = () => screen.getByRole('button', { name: 'Start' });
const dialog = () => document.querySelector('dialog[data-run-hello]');
// The loop plays on open; the moment's runs are the ones started by the press.
function pressStart(): { moment: () => Run[]; loop: Run[] } {
  const loop = [...runs];
  fireEvent.click(start());
  return { moment: () => runs.slice(loop.length), loop };
}

beforeEach(() => {
  runs = [];
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.setAttribute('open', '');
    },
  });
});
afterEach(() => {
  Reflect.deleteProperty(Element.prototype, 'animate');
  uninstallFakeAudio();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('the popup What’s new Start (KAN-626)', () => {
  test('the loop ends, then press, the shutter with its click, the hold, the dialog leaves; then Start goes on', async () => {
    installAnimate();
    installFakeAudio();
    const { onStart, onSkip } = await renderHello(true);
    const { moment, loop } = pressStart();
    // The hero's loop, not the dialog's entrance, which is drawn before it.
    const heroLoop = loop.filter(
      (r) => r.target.closest('[data-hero-frame]') !== null
    );
    expect(heroLoop.length).toBeGreaterThan(0);
    expect(heroLoop.every((r) => r.isFinished())).toBe(true);
    expect(moment().map((r) => r.target)).toEqual([start()]);

    moment()[0].release();
    await waitFor(() => expect(moment()).toHaveLength(2));
    expect(moment()[1].target).toHaveAttribute('data-hero-part', 'shutter');
    expect(startedTicks()).toEqual([]);

    moment()[1].release();
    await waitFor(() => expect(moment()).toHaveLength(3));
    // The click as the shutter shuts: two ticks.
    expect(startedTicks()).toHaveLength(2);
    expect(moment()[2].target).toBe(dialog());
    moment()[2].release();
    await waitFor(() => expect(moment()).toHaveLength(4));
    expect(onStart).not.toHaveBeenCalled();

    moment()[3].release();
    await waitFor(() => expect(onStart).toHaveBeenCalledTimes(1));
    expect(onSkip).not.toHaveBeenCalled();
  });

  test('a second press while it plays does nothing', async () => {
    installAnimate();
    await renderHello(true);
    const { moment } = pressStart();
    fireEvent.click(start());
    expect(moment()).toHaveLength(1);
  });

  test.each([
    [
      'Skip tutorial',
      () =>
        fireEvent.click(screen.getByRole('button', { name: 'Skip tutorial' })),
    ],
    [
      'Esc',
      () => {
        const d = dialog();
        if (d === null) throw new Error('no dialog');
        fireEvent(d, new Event('cancel', { bubbles: false, cancelable: true }));
      },
    ],
  ])(
    '%s while it plays cuts it short, with no click, and Start goes on',
    async (_name, press) => {
      installAnimate();
      installFakeAudio();
      const { onStart, onSkip } = await renderHello(true);
      const { moment } = pressStart();
      press();
      await waitFor(() => expect(onStart).toHaveBeenCalledTimes(1));
      expect(onSkip).not.toHaveBeenCalled();
      // The press it cancelled finishing late starts nothing after it.
      moment()[0].release();
      await microtasks();
      expect(moment()).toHaveLength(1);
      expect(startedTicks()).toEqual([]);
    }
  );

  test('reduced motion: no moment; the click plays on the press and Start goes on at once', async () => {
    installAnimate();
    installFakeAudio();
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) => new FakeMediaQueryList(query, query.includes('reduce'))
    );
    const { onStart } = await renderHello(true);
    const { moment } = pressStart();
    expect(moment()).toEqual([]);
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(startedTicks()).toHaveLength(2);
  });

  test('the full view’s own Start opens no tab: no moment, no click, straight on', async () => {
    installAnimate();
    installFakeAudio();
    const { onStart } = await renderHello(false);
    const { moment } = pressStart();
    expect(moment()).toEqual([]);
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(startedTicks()).toEqual([]);
  });
});
