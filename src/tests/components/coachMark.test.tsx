import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';

import CoachMark from '../../components/tour/CoachMark';
import {
  placeBeside,
  type Box,
  type Size,
} from '../../components/tour/coachMarkPlacement';
import { renderWithProviders } from '../setup/renderWithProviders';
import { beginDragHold, endDragHold } from '../../redux/dragHold';

// KAN-413. Not modal, takes no focus, and Esc is Skip.

const TEXT = 'A session keeps windows and tabs together.';
const RECT: DOMRect = {
  x: 400,
  y: 100,
  left: 400,
  top: 100,
  right: 600,
  bottom: 140,
  width: 200,
  height: 40,
  toJSON: () => ({}),
};
const place = (anchor: Box, mark: Size, viewport: Size) =>
  placeBeside(anchor, mark, viewport, ['below', 'right', 'left']);

let anchor: HTMLElement;
beforeEach(() => {
  anchor = document.createElement('div');
  anchor.setAttribute('data-test-anchor', '');
  anchor.getBoundingClientRect = () => RECT;
  document.body.append(anchor);
});
afterEach(() => {
  anchor.remove();
  endDragHold();
  vi.restoreAllMocks();
});

type Props = Parameters<typeof CoachMark>[0];
async function render(props: Partial<Props> = {}) {
  const onNext = vi.fn();
  const onEnd = vi.fn();
  await renderWithProviders(
    <CoachMark
      step={1}
      text={TEXT}
      anchors={['[data-test-anchor]']}
      width={300}
      place={place}
      onNext={onNext}
      onEnd={onEnd}
      {...props}
    />
  );
  return { onNext, onEnd };
}
const mark = () => document.querySelector<HTMLElement>('[data-coach-mark]');
const placed = () =>
  waitFor(() => expect(mark()).not.toHaveAttribute('aria-hidden'));
const escape = () => {
  const event = new KeyboardEvent('keydown', {
    key: 'Escape',
    bubbles: true,
    cancelable: true,
  });
  return event;
};

describe('the coach mark', () => {
  test('steps 1 to 4: the step, the text, Skip tutorial and Next', async () => {
    const { onNext, onEnd } = await render({ step: 2 });
    await placed();
    expect(screen.getByRole('dialog', { name: TEXT })).toHaveTextContent(
      'Step 2 of 5'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(onNext).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Skip tutorial' }));
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Finish' })).toBeNull();
  });

  test('step 5: Finish only, and it ends the tour', async () => {
    const { onNext, onEnd } = await render({ step: 5 });
    await placed();
    expect(screen.queryByRole('button', { name: 'Next' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Skip tutorial' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(onNext).not.toHaveBeenCalled();
  });

  test('appearing leaves the focus where it was', async () => {
    const elsewhere = document.createElement('button');
    document.body.append(elsewhere);
    elsewhere.focus();
    await render();
    await placed();
    expect(document.activeElement).toBe(elsewhere);
    elsewhere.remove();
  });

  test('Esc ends the tour, and is prevented so Chrome keeps the popup open (KAN-403)', async () => {
    const { onEnd } = await render();
    await placed();
    const event = escape();
    act(() => {
      document.dispatchEvent(event);
    });
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  test('an Esc a field already used is left alone', async () => {
    const { onEnd } = await render();
    await placed();
    const event = escape();
    event.preventDefault();
    act(() => {
      document.dispatchEvent(event);
    });
    expect(onEnd).not.toHaveBeenCalled();
  });

  test('an Esc while a modal dialog is open is the dialog’s', async () => {
    const { onEnd } = await render();
    await placed();
    const modal = document.createElement('dialog');
    vi.spyOn(document, 'querySelector').mockImplementation(
      (selector: string) =>
        selector === 'dialog:modal'
          ? modal
          : selector === '[data-test-anchor]'
            ? anchor
            : null
    );
    const event = escape();
    act(() => {
      document.dispatchEvent(event);
    });
    expect(onEnd).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  test('an Esc during a held drag or carry is the drag’s', async () => {
    const { onEnd } = await render();
    await placed();
    beginDragHold();
    const event = escape();
    act(() => {
      document.dispatchEvent(event);
    });
    expect(onEnd).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  test('with no anchor on screen it draws nothing and takes no Esc', async () => {
    const { onEnd } = await render({ anchors: ['[data-missing]'] });
    await act(
      () => new Promise<void>((done) => requestAnimationFrame(() => done()))
    );
    expect(mark()).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByRole('button', { name: 'Next' })).toBeNull();
    expect(document.querySelector('[data-coach-ring]')).toBeNull();
    const event = escape();
    act(() => {
      document.dispatchEvent(event);
    });
    expect(onEnd).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  // an anchor scrolled out of view is brought in, once, as the step starts.
  test('brings its anchor into view once, when the step starts', async () => {
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView');
    await render();
    await placed();
    await act(
      () =>
        new Promise<void>((done) =>
          requestAnimationFrame(() => requestAnimationFrame(() => done()))
        )
    );
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scroll.mock.contexts[0]).toBe(anchor);
    expect(scroll).toHaveBeenCalledWith({
      block: 'nearest',
      inline: 'nearest',
    });
  });

  test('the ring and the mark follow the anchor, and the notch faces it', async () => {
    await render();
    await placed();
    const ring = () => document.querySelector<HTMLElement>('[data-coach-ring]');
    expect(ring()?.style.top).toBe('96px');
    expect(mark()?.style.top).toBe('154px');
    expect(mark()).toHaveAttribute('data-coach-side', 'below');
    anchor.getBoundingClientRect = () => ({
      ...RECT,
      y: 300,
      top: 300,
      bottom: 340,
    });
    await waitFor(() => expect(ring()?.style.top).toBe('296px'));
    expect(mark()?.style.top).toBe('354px');
  });

  // step 1 rings what rowsBox measures, not the element.
  test('with a boxOf, the ring wraps the box it measures, not the element', async () => {
    await render({
      boxOf: () => ({ left: 400, top: 100, width: 200, height: 120 }),
    });
    await placed();
    const ring = document.querySelector<HTMLElement>('[data-coach-ring]');
    expect(ring?.style.height).toBe('128px');
    expect(mark()?.style.top).toBe('234px');
  });
});
