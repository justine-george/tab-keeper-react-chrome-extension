import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';

import CoachMark from '../../components/tour/CoachMark';
import {
  placeBeside,
  type Box,
  type Size,
} from '../../components/tour/coachMarkPlacement';
import { renderWithProviders } from '../setup/renderWithProviders';
import { FakeMediaQueryList } from '../setup/mediaQueryFake';
import { beginDragHold, endDragHold } from '../../redux/dragHold';
import { LIGHT_THEME } from '../../hooks/useThemeColors';

// KAN-413. Not modal, takes no focus; Esc is the card's own (§6).

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
const place = (anchor: Box, mark: Size, viewport: Size, bright: Box) =>
  placeBeside(anchor, mark, viewport, ['below', 'right', 'left'], bright);

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

const line = () => screen.getByRole('progressbar');
const animations: {
  el: Element;
  keyframes: Keyframe[];
  cancel: ReturnType<typeof vi.fn>;
  events: EventTarget;
}[] = [];
beforeEach(() => {
  animations.length = 0;
  Object.defineProperty(Element.prototype, 'animate', {
    configurable: true,
    value(this: Element, keyframes: Keyframe[]) {
      const cancel = vi.fn();
      const events = new EventTarget();
      animations.push({ el: this, keyframes, cancel, events });
      return Object.assign(events, { cancel, finished: Promise.resolve() });
    },
  });
});
afterEach(() => {
  Reflect.deleteProperty(Element.prototype, 'animate');
});

type Props = Parameters<typeof CoachMark>[0];
async function render(overrides: Partial<Props> = {}) {
  const onNext = vi.fn();
  const onSkip = vi.fn();
  const onBack = vi.fn();
  const onEscape = vi.fn();
  const propsFor = (more: Partial<Props>): Props => ({
    step: 1,
    total: 8,
    text: TEXT,
    anchors: ['[data-test-anchor]'],
    isLive: true,
    width: 300,
    place,
    primary: { label: 'Next', onPress: onNext },
    onSkip,
    onBack,
    onEscape,
    ...overrides,
    ...more,
  });
  const result = await renderWithProviders(<CoachMark {...propsFor({})} />);
  const rerenderAt = (more: Partial<Props>) =>
    result.rerender(<CoachMark {...propsFor(more)} />);
  return { onNext, onSkip, onBack, onEscape, rerenderAt };
}
const mark = () => document.querySelector<HTMLElement>('[data-coach-mark]');
const ring = () => document.querySelector<HTMLElement>('[data-coach-ring]');
const dim = () => document.querySelector<HTMLElement>('[data-coach-dim]');
// The dim's clip-path: the viewport, less a hole at left, top, width, height.
const hole = (left: number, top: number, width: number, height: number) => {
  const [right, bottom] = [left + width, top + height];
  return (
    'polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ' +
    `${left}px ${top}px, ${right}px ${top}px, ${right}px ${bottom}px, ` +
    `${left}px ${bottom}px, ${left}px ${top}px)`
  );
};
const twoFrames = () =>
  act(
    () =>
      new Promise<void>((done) =>
        requestAnimationFrame(() => requestAnimationFrame(() => done()))
      )
  );
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
  test('appearing leaves the focus where it was', async () => {
    const elsewhere = document.createElement('button');
    document.body.append(elsewhere);
    elsewhere.focus();
    await render();
    await placed();
    expect(document.activeElement).toBe(elsewhere);
    elsewhere.remove();
  });

  test('Esc is the card’s, and is prevented so Chrome keeps the popup open (KAN-403)', async () => {
    const { onEscape } = await render();
    await placed();
    const event = escape();
    act(() => {
      document.dispatchEvent(event);
    });
    expect(onEscape).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  test('an Esc a field already used is left alone', async () => {
    const { onEscape } = await render();
    await placed();
    const event = escape();
    event.preventDefault();
    act(() => {
      document.dispatchEvent(event);
    });
    expect(onEscape).not.toHaveBeenCalled();
  });

  test('an Esc while a modal dialog is open is the dialog’s', async () => {
    const { onEscape } = await render();
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
    expect(onEscape).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  test('an Esc during a held drag or carry is the drag’s', async () => {
    const { onEscape } = await render();
    await placed();
    beginDragHold();
    const event = escape();
    act(() => {
      document.dispatchEvent(event);
    });
    expect(onEscape).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  test('with no anchor on screen it draws nothing and takes no Esc', async () => {
    const { onEscape } = await render({ anchors: ['[data-missing]'] });
    await act(
      () => new Promise<void>((done) => requestAnimationFrame(() => done()))
    );
    expect(mark()).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByRole('button', { name: 'Next' })).toBeNull();
    expect(ring()).toBeNull();
    expect(dim()).toBeNull();
    const event = escape();
    act(() => {
      document.dispatchEvent(event);
    });
    expect(onEscape).not.toHaveBeenCalled();
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
    expect(ring()?.style.height).toBe('128px');
    expect(mark()?.style.top).toBe('234px');
  });

  // KAN-421. The page is dimmed and takes no press outside the bright box.
  test('placed, the dim covers the page, takes the pointer, and leaves exactly the anchor’s box bright', async () => {
    await render();
    await placed();
    expect(ring()?.style).toMatchObject({
      left: '396px',
      top: '96px',
      width: '208px',
      height: '48px',
    });
    expect(dim()?.style.clipPath).toBe(hole(400, 100, 200, 40));
    expect(dim()).toHaveAttribute('aria-hidden', 'true');
    const dimEl = dim();
    if (!(dimEl instanceof HTMLElement)) throw new Error('no dim');
    const style = getComputedStyle(dimEl);
    expect({
      position: style.position,
      inset: style.getPropertyValue('inset'),
      background: style.backgroundColor,
      cursor: style.cursor,
      pointerEvents: style.pointerEvents,
    }).toEqual({
      position: 'fixed',
      inset: '0px',
      background: LIGHT_THEME.TOUR_SCRIM,
      cursor: 'not-allowed',
      pointerEvents: 'auto',
    });
    expect(dim()?.tabIndex).toBe(-1);
  });

  test('a press on the dim is default-prevented and reaches no listener outside it', async () => {
    await render();
    await placed();
    const outside = vi.fn();
    document.addEventListener('mousedown', outside);
    const press = new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      dim()?.dispatchEvent(press);
    });
    document.removeEventListener('mousedown', outside);
    expect(press.defaultPrevented).toBe(true);
    expect(outside).not.toHaveBeenCalled();
  });

  test('the dim’s hole follows the anchor', async () => {
    await render();
    await placed();
    anchor.getBoundingClientRect = () => ({
      ...RECT,
      y: 300,
      top: 300,
      bottom: 340,
    });
    await waitFor(() => expect(ring()?.style.top).toBe('296px'));
    expect(dim()?.style.clipPath).toBe(hole(400, 300, 200, 40));
  });

  test('a spotlight lights its own box while the ring stays on the anchor, and follows it', async () => {
    const lit = document.createElement('div');
    lit.setAttribute('data-test-lit', '');
    let litTop = 60;
    lit.getBoundingClientRect = () => ({
      ...RECT,
      x: 380,
      y: litTop,
      left: 380,
      top: litTop,
      width: 300,
      height: 200,
    });
    document.body.append(lit);
    await render({
      spotlight: {
        anchors: ['[data-missing]', '[data-test-lit]'],
        boxOf: (element) => {
          const r = element.getBoundingClientRect();
          return { left: r.left, top: r.top, width: r.width, height: r.height };
        },
      },
    });
    await placed();
    await waitFor(() =>
      expect(dim()?.style.clipPath).toBe(hole(380, 60, 300, 200))
    );
    expect(ring()?.style.top).toBe('96px');
    expect(ring()?.style.height).toBe('48px');
    litTop = 80;
    await waitFor(() =>
      expect(dim()?.style.clipPath).toBe(hole(380, 80, 300, 200))
    );
    lit.remove();
  });

  test('a spotlight with nothing drawn lights the anchor’s box', async () => {
    await render({
      spotlight: { anchors: ['[data-missing]'], boxOf: () => null },
    });
    await placed();
    await twoFrames();
    expect(dim()?.style.clipPath).toBe(hole(400, 100, 200, 40));
  });

  test('unplaced again, the dim goes with the mark', async () => {
    await render();
    await placed();
    expect(dim()).not.toBeNull();
    anchor.remove();
    await waitFor(() => expect(mark()).toHaveAttribute('aria-hidden', 'true'));
    expect(dim()).toBeNull();
    expect(ring()).toBeNull();
  });

  test('the mark floats: it casts the theme’s floating shadow', async () => {
    await render();
    await placed();
    // jsdom drops the space after each comma.
    const plain = (shadow: string) => shadow.replace(/,\s*/g, ',');
    const markEl = mark();
    if (!(markEl instanceof HTMLElement)) throw new Error('no mark');
    expect(plain(getComputedStyle(markEl).boxShadow)).toBe(
      plain(LIGHT_THEME.FLOATING_SHADOW)
    );
  });
});

describe('the card’s footer and line (§6)', () => {
  test('a middle step: the line says where, no number on screen; Skip, Back and a filled Next', async () => {
    const { onNext, onSkip, onBack } = await render({ step: 2 });
    await placed();
    expect(line()).toHaveAttribute('aria-valuenow', '2');
    expect(line()).toHaveAttribute('aria-valuemax', '8');
    expect(line()).toHaveAttribute('aria-valuetext', 'Step 2 of 8');
    expect(mark()).not.toHaveTextContent('Step 2 of 8');
    expect(
      document.querySelector<HTMLElement>('[data-progress-fill]')?.style
        .transform
    ).toBe('scaleX(0.25)');
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    fireEvent.click(screen.getByRole('button', { name: 'Skip tutorial' }));
    expect([onNext, onBack, onSkip].map((f) => f.mock.calls.length)).toEqual([
      1, 1, 1,
    ]);
  });

  test('step 1: no Back', async () => {
    await render({ step: 1, onBack: undefined });
    await placed();
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
  });

  test('the last step: no Skip; Back, the secondary, then the primary', async () => {
    const onNotNow = vi.fn();
    const onPin = vi.fn();
    await render({
      step: 8,
      onSkip: undefined,
      secondary: { label: 'Not now', onPress: onNotNow },
      primary: { label: 'Pin this tab', onPress: onPin },
    });
    await placed();
    expect(screen.queryByRole('button', { name: 'Skip tutorial' })).toBeNull();
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Back',
      'Not now',
      'Pin this tab',
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Pin this tab' }));
    expect(onPin).toHaveBeenCalledTimes(1);
    expect(onNotNow).not.toHaveBeenCalled();
  });

  test('a fine line under the text', async () => {
    await render({ fine: 'Saving keeps them safe even after you close them.' });
    await placed();
    expect(mark()).toHaveTextContent(
      'Saving keeps them safe even after you close them.'
    );
  });

  test('the filled Next carries the filled style: TEXT_COLOR ground, PRIMARY_COLOR letters', async () => {
    await render();
    await placed();
    const next = screen.getByRole('button', { name: 'Next' });
    // Paper's TEXT_COLOR #3B3D40 and PRIMARY_COLOR #F5F7FA.
    expect(getComputedStyle(next).backgroundColor).toBe('rgb(59, 61, 64)');
    expect(getComputedStyle(next).color).toBe('rgb(245, 247, 250)');
  });
});

describe('IME and Esc (D1)', () => {
  test('an Esc that ends IME composition is not the card’s', async () => {
    const { onEscape } = await render();
    await placed();
    const composing = new KeyboardEvent('keydown', {
      key: 'Escape',
      isComposing: true,
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      document.dispatchEvent(composing);
    });
    expect(onEscape).not.toHaveBeenCalled();
    expect(composing.defaultPrevented).toBe(false);
    act(() => {
      document.dispatchEvent(escape());
    });
    expect(onEscape).toHaveBeenCalledTimes(1);
  });

  test('a keyCode 229 Esc (a browser that does not set isComposing) is not the card’s either', async () => {
    const { onEscape } = await render();
    await placed();
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Escape',
          keyCode: 229,
          bubbles: true,
          cancelable: true,
        })
      );
    });
    expect(onEscape).not.toHaveBeenCalled();
  });
});

describe('the free step and the still box', () => {
  test('no anchors: the card sits at the top left, the whole page dimmed, no ring, no notch', async () => {
    await render({ anchors: [] });
    await placed();
    expect(mark()).toHaveAttribute('data-coach-side', 'free');
    expect(mark()?.style.left).toBe('40px');
    expect(mark()?.style.top).toBe('20px');
    expect(dim()).not.toBeNull();
    expect(dim()?.style.clipPath).toBe('');
    expect(ring()).toBeNull();
    expect(document.querySelector('[data-coach-notch]')).toBeNull();
  });

  test('a look-only step draws a still box exactly over the bright box', async () => {
    await render({ isLive: false });
    await placed();
    const still = document.querySelector<HTMLElement>('[data-coach-still]');
    expect(still).not.toBeNull();
    expect(still?.style).toMatchObject({
      left: '400px',
      top: '100px',
      width: '200px',
      height: '40px',
    });
    expect(still).toHaveAttribute('aria-hidden', 'true');
  });

  test('CONTROL: a live step draws no still box', async () => {
    await render({ isLive: true });
    await placed();
    expect(document.querySelector('[data-coach-still]')).toBeNull();
  });
});

describe('motion (§10)', () => {
  test('the first appearance fades and grows from the side facing the anchor', async () => {
    await render({ step: 2 });
    await placed();
    const appear = animations.find((a) => a.el === mark());
    expect(appear?.keyframes[0]).toMatchObject({
      opacity: 0,
      transform: 'scale(0.97)',
      transformOrigin: 'center top',
    });
  });

  test('a new step glides the card and the ring from where they were', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      function (this: HTMLElement) {
        const left = parseFloat(this.style.left) || 0;
        const top = parseFloat(this.style.top) || 0;
        return {
          ...RECT,
          left,
          top,
          x: left,
          y: top,
          right: left + 300,
          bottom: top + 100,
        };
      }
    );
    const { rerenderAt } = await render({ step: 2 });
    await placed();
    animations.length = 0;
    anchor.getBoundingClientRect = () => ({
      ...RECT,
      top: 300,
      y: 300,
      bottom: 340,
    });
    rerenderAt({ step: 3 });
    await waitFor(() =>
      expect(animations.some((a) => a.el === mark())).toBe(true)
    );
    const glide = animations.find((a) => a.el === mark());
    expect(glide?.keyframes[0].transform).toBe('translate(0px, -200px)');
    const ringGlide = animations.find((a) => a.el === ring());
    expect(ringGlide?.keyframes[0].transform).toBe('translate(0px, -200px)');
    expect(mark()?.style.pointerEvents).toBe('none');
    expect(ring()?.style.pointerEvents).toBe('none');
    // The card takes the pointer back only once both glides have ended, one finished and one cancelled.
    glide?.events.dispatchEvent(new Event('finish'));
    expect(mark()?.style.pointerEvents).toBe('none');
    ringGlide?.events.dispatchEvent(new Event('cancel'));
    expect(mark()?.style.pointerEvents).toBe('');
    expect(ring()?.style.pointerEvents).toBe('');
  });

  test('a re-placement mid-glide leaves the running glide alone', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      function (this: HTMLElement) {
        const left = parseFloat(this.style.left) || 0;
        const top = parseFloat(this.style.top) || 0;
        return { ...RECT, left, top, x: left, y: top };
      }
    );
    const { rerenderAt } = await render({ step: 2 });
    await placed();
    animations.length = 0;
    anchor.getBoundingClientRect = () => ({ ...RECT, top: 300, y: 300 });
    rerenderAt({ step: 3 });
    await waitFor(() => expect(animations.length).toBeGreaterThan(0));
    const started = [...animations];
    anchor.getBoundingClientRect = () => ({ ...RECT, top: 500, y: 500 });
    await waitFor(() => expect(ring()?.style.top).toBe('496px'));
    expect(started.map((a) => a.cancel.mock.calls.length)).toEqual(
      started.map(() => 0)
    );
    expect(animations).toEqual(started);
  });

  test('a re-placement during the first appearance leaves it running', async () => {
    await render({ step: 2 });
    await placed();
    const appear = animations.find((a) => a.el === mark());
    anchor.getBoundingClientRect = () => ({ ...RECT, top: 300, y: 300 });
    await waitFor(() => expect(ring()?.style.top).toBe('296px'));
    expect(appear?.cancel).not.toHaveBeenCalled();
    expect(animations).toHaveLength(1);
  });

  test('reduced motion: nothing animates', async () => {
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) => new FakeMediaQueryList(query, true)
    );
    await render({ step: 2 });
    await placed();
    expect(animations).toEqual([]);
    expect(mark()?.style.pointerEvents).toBe('');
  });
});
