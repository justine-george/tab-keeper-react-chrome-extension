import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, screen } from '@testing-library/react';

import Button from '../../components/common/Button';
import MainContainer from '../../components/MainContainer';
import ExportPage from '../../components/export/ExportPage';
import { TooltipLayer } from '../../components/common/TooltipLayer';
import { placeTooltip } from '../../components/common/tooltipRules';
import { renderWithProviders } from '../setup/renderWithProviders';
import { replaceState } from '../../redux/slices/tabContainerDataStateSlice';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';

// KAN-695. The app-drawn tooltip: when it shows, what it says, when it hides.
// jsdom has no layout, so where it sits is Task 5's (e2e); here only that the
// layer hands its boxes to placeTooltip and draws where that says.

vi.mock('../../components/common/tooltipRules', async (importOriginal) => {
  const real =
    await importOriginal<
      typeof import('../../components/common/tooltipRules')
    >();
  return { ...real, placeTooltip: vi.fn(real.placeTooltip) };
});

const chip = () => document.querySelector<HTMLElement>('[data-tooltip-chip]');
const byTip = (text: string) => {
  const el = document.querySelector<HTMLElement>(`[data-tooltip="${text}"]`);
  if (el === null) throw new Error(`no anchor "${text}"`);
  return el;
};

// Each move is one pointer leaving where it was for the next element, as Chrome dispatches it.
let under: Element | null = null;
const pointerTo = (to: Element | null, pointerType = 'mouse') => {
  act(() => {
    under?.dispatchEvent(
      new PointerEvent('pointerout', {
        bubbles: true,
        pointerType,
        relatedTarget: to,
      })
    );
    to?.dispatchEvent(
      new PointerEvent('pointerover', {
        bubbles: true,
        pointerType,
        relatedTarget: under,
      })
    );
  });
  under = to;
};
const moveOn = (el: Element) =>
  act(() => {
    el.dispatchEvent(
      new PointerEvent('pointermove', { bubbles: true, pointerType: 'mouse' })
    );
  });
const press = (el: Element) =>
  act(() => {
    el.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' })
    );
  });
const release = (el: Element) =>
  act(() => {
    el.dispatchEvent(
      new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse' })
    );
  });
const key = (
  type: 'keydown' | 'keyup',
  k: string,
  on: Element = document.body
) => {
  const e = new KeyboardEvent(type, {
    key: k,
    bubbles: true,
    cancelable: true,
  });
  act(() => {
    on.dispatchEvent(e);
  });
  return e;
};
const wait = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });
// MutationObserver callbacks run in a microtask.
const settle = () => act(async () => {});

function Fixture({ withB = true }: { withB?: boolean }) {
  return (
    <div>
      <button data-tooltip="Save session">A</button>
      {withB && <button data-tooltip="Delete">B</button>}
      <span data-testid="plain">nothing here</span>
      <div data-tooltip="Outer" data-testid="outer">
        <span data-testid="outer-text">outer text</span>
        <button data-tooltip="Inner">i</button>
      </div>
      <button data-tooltip="Weekend in Kyoto">
        <span data-testid="repeat">Weekend in Kyoto</span>
      </button>
      <Button text="Replace" tooltipText="Replace with open windows" />
      <div data-testid="pane" tabIndex={0} style={{ overflow: 'auto' }} />
      <dialog open>
        <button data-tooltip="In dialog">d</button>
      </dialog>
      <TooltipLayer />
    </div>
  );
}

async function setup() {
  const r = await renderWithProviders(<Fixture />);
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  return r;
}

beforeEach(() => {
  under = null;
});
afterEach(() => {
  pointerTo(null);
  vi.useRealTimers();
  document.documentElement.removeAttribute('data-dragging');
  document.documentElement.removeAttribute('data-carrying');
  vi.mocked(placeTooltip).mockClear();
});

// Shown by resting on A for the first delay.
const showA = () => {
  pointerTo(byTip('Save session'));
  wait(300);
  expect(chip()).toHaveTextContent('Save session');
};

describe('timing', () => {
  test('a pointer resting 299 ms shows nothing; at 300 ms the chip shows the text', async () => {
    await setup();
    pointerTo(byTip('Save session'));
    wait(299);
    expect(chip()).toBeNull();
    wait(1);
    expect(chip()).toHaveTextContent('Save session');
  });

  test('within 400 ms of a hide the next shows at 100 ms, not 99', async () => {
    await setup();
    showA();
    pointerTo(screen.getByTestId('plain'));
    expect(chip()).toBeNull();
    wait(399);
    pointerTo(byTip('Delete'));
    wait(99);
    expect(chip()).toBeNull();
    wait(1);
    expect(chip()).toHaveTextContent('Delete');
  });

  test('501 ms after a hide the next waits the full 300 ms again', async () => {
    await setup();
    showA();
    pointerTo(screen.getByTestId('plain'));
    wait(501);
    pointerTo(byTip('Delete'));
    wait(299);
    expect(chip()).toBeNull();
    wait(1);
    expect(chip()).toHaveTextContent('Delete');
  });

  test('a move within the anchor restarts the wait: it shows only once the pointer rests', async () => {
    await setup();
    const a = byTip('Save session');
    pointerTo(a);
    wait(200);
    moveOn(a);
    wait(200);
    expect(chip()).toBeNull();
    wait(100);
    expect(chip()).toHaveTextContent('Save session');
  });

  test('sweeping across anchors faster than the wait leaves no chip', async () => {
    await setup();
    pointerTo(byTip('Save session'));
    wait(250);
    pointerTo(byTip('Delete'));
    wait(250);
    pointerTo(byTip('Replace with open windows'));
    wait(250);
    pointerTo(screen.getByTestId('plain'));
    wait(1000);
    expect(chip()).toBeNull();
  });

  test('a touch pointer never shows a chip', async () => {
    await setup();
    pointerTo(byTip('Save session'), 'touch');
    wait(1000);
    expect(chip()).toBeNull();
  });

  test('moving onto a child of the anchor keeps the chip', async () => {
    await setup();
    pointerTo(screen.getByTestId('outer-text'));
    wait(300);
    expect(chip()).toHaveTextContent('Outer');
    pointerTo(screen.getByTestId('outer'));
    expect(chip()).toHaveTextContent('Outer');
    wait(1000);
    expect(chip()).toHaveTextContent('Outer');
  });

  test('a move keeps the delay set on arrival, even past the warm window', async () => {
    await setup();
    showA();
    pointerTo(screen.getByTestId('plain'));
    wait(450);
    const b = byTip('Delete');
    pointerTo(b);
    wait(50);
    moveOn(b);
    wait(100);
    expect(chip()).toHaveTextContent('Delete');
  });
});

describe('keyboard', () => {
  test('Tab onto a control shows its chip at once', async () => {
    await setup();
    key('keydown', 'Tab');
    act(() => byTip('Save session').focus());
    expect(chip()).toHaveTextContent('Save session');
  });

  test('focus moved by script, with no key down, shows nothing', async () => {
    await setup();
    act(() => byTip('Save session').focus());
    wait(1000);
    expect(chip()).toBeNull();
  });

  test('a key let go ends its turn: a later script focus shows nothing', async () => {
    await setup();
    key('keydown', 'Tab');
    key('keyup', 'Tab');
    act(() => byTip('Save session').focus());
    expect(chip()).toBeNull();
  });

  test('a press after the key, then focus, shows nothing', async () => {
    await setup();
    key('keydown', 'Tab');
    press(byTip('Save session'));
    act(() => byTip('Save session').focus());
    expect(chip()).toBeNull();
  });

  test('Escape, then focus put back on the trigger, shows nothing', async () => {
    await setup();
    key('keydown', 'Tab');
    key('keydown', 'Escape');
    act(() => byTip('Save session').focus());
    expect(chip()).toBeNull();
  });

  test('Tab on to the next control moves the chip; Tab to a plain element hides it', async () => {
    await setup();
    key('keydown', 'Tab');
    act(() => byTip('Save session').focus());
    key('keyup', 'Tab');
    key('keydown', 'Tab');
    act(() => byTip('Delete').focus());
    expect(chip()).toHaveTextContent('Delete');
    key('keyup', 'Tab');
    key('keydown', 'Tab');
    act(() => screen.getByTestId('pane').focus());
    expect(chip()).toBeNull();
  });

  test('Escape while shown hides the chip and is not claimed', async () => {
    await setup();
    const later = vi.fn();
    window.addEventListener('keydown', later);
    try {
      showA();
      const e = key('keydown', 'Escape', byTip('Save session'));
      expect(chip()).toBeNull();
      expect(e.defaultPrevented).toBe(false);
      expect(later).toHaveBeenCalledWith(e);
    } finally {
      window.removeEventListener('keydown', later);
    }
  });

  test.each(['Enter', ' '])(
    'pressing %j on the control hides the chip and is not claimed',
    async (k) => {
      await setup();
      const later = vi.fn();
      window.addEventListener('keydown', later);
      try {
        key('keydown', 'Tab');
        act(() => byTip('Save session').focus());
        key('keyup', 'Tab');
        expect(chip()).toHaveTextContent('Save session');
        const e = key('keydown', k, byTip('Save session'));
        expect(chip()).toBeNull();
        expect(e.defaultPrevented).toBe(false);
        expect(later).toHaveBeenCalledWith(e);
      } finally {
        window.removeEventListener('keydown', later);
      }
    }
  );
});

describe('it hides', () => {
  test('when the pointer leaves', async () => {
    await setup();
    showA();
    pointerTo(null);
    expect(chip()).toBeNull();
  });

  test('when the control is pressed, and stays hidden while the pointer stays on it', async () => {
    await setup();
    showA();
    press(byTip('Save session'));
    expect(chip()).toBeNull();
    moveOn(byTip('Save session'));
    wait(1000);
    expect(chip()).toBeNull();
  });

  test('a pressed anchor stays hidden while the pointer moves onto its child', async () => {
    await setup();
    pointerTo(screen.getByTestId('outer'));
    wait(300);
    press(screen.getByTestId('outer'));
    pointerTo(screen.getByTestId('outer-text'));
    wait(1000);
    expect(chip()).toBeNull();
  });

  test('a press that slides onto another control shows nothing until let go; a rest after shows at the usual wait', async () => {
    await setup();
    pointerTo(byTip('Save session'));
    press(byTip('Save session'));
    pointerTo(byTip('Delete'));
    wait(1000);
    expect(chip()).toBeNull();
    release(byTip('Delete'));
    pointerTo(byTip('Save session'));
    wait(299);
    expect(chip()).toBeNull();
    wait(1);
    expect(chip()).toHaveTextContent('Save session');
  });

  test('a press whose release is lost to another window ends with the blur', async () => {
    await setup();
    press(byTip('Save session'));
    act(() => {
      window.dispatchEvent(new FocusEvent('blur'));
    });
    pointerTo(byTip('Delete'));
    wait(300);
    expect(chip()).toHaveTextContent('Delete');
  });

  test('when any element scrolls', async () => {
    await setup();
    showA();
    act(() => {
      screen.getByTestId('pane').dispatchEvent(new Event('scroll'));
    });
    expect(chip()).toBeNull();
  });

  // R9. A scroll inside a key's turn is the focus move scrolling its row into view.
  const scrollPane = () =>
    act(() => {
      screen.getByTestId('pane').dispatchEvent(new Event('scroll'));
    });
  const tabToA = () => {
    key('keydown', 'Tab');
    act(() => byTip('Save session').focus());
    expect(chip()).toHaveTextContent('Save session');
  };

  test('not when a Tab scrolls its control into view: the chip is placed again', async () => {
    await setup();
    tabToA();
    const place = vi.mocked(placeTooltip);
    const calls = place.mock.calls.length;
    byTip('Save session').getBoundingClientRect = () =>
      new DOMRect(100, 20, 40, 20);
    scrollPane();
    expect(chip()).toHaveTextContent('Save session');
    expect(place.mock.calls.length).toBe(calls + 1);
    expect(place).toHaveBeenLastCalledWith(
      expect.objectContaining({ left: 100, top: 20 }),
      expect.anything(),
      expect.anything()
    );
  });

  test('a scroll with no key down hides a keyboard-shown chip', async () => {
    await setup();
    tabToA();
    key('keyup', 'Tab');
    key('keydown', 'Shift');
    key('keyup', 'Shift');
    scrollPane();
    expect(chip()).toBeNull();
  });

  test("a scroll after the Tab's keyup hides the chip", async () => {
    await setup();
    tabToA();
    key('keyup', 'Tab');
    scrollPane();
    expect(chip()).toBeNull();
  });

  test('when the window loses focus', async () => {
    await setup();
    showA();
    act(() => {
      window.dispatchEvent(new FocusEvent('blur'));
    });
    expect(chip()).toBeNull();
  });

  test.each(['data-dragging', 'data-carrying'])(
    'when %s is set on the document',
    async (attr) => {
      await setup();
      showA();
      document.documentElement.setAttribute(attr, '');
      await settle();
      expect(chip()).toBeNull();
    }
  );

  test('a drag never shows one, even one waiting when the drag starts', async () => {
    await setup();
    pointerTo(byTip('Save session'));
    wait(200);
    document.documentElement.setAttribute('data-dragging', 'tab');
    await settle();
    wait(1000);
    expect(chip()).toBeNull();
    pointerTo(byTip('Delete'));
    wait(1000);
    expect(chip()).toBeNull();
  });
});

describe('the anchor changes while shown', () => {
  test('Review Focus 1: a new data-tooltip shows in the chip', async () => {
    await setup();
    showA();
    byTip('Save session').setAttribute('data-tooltip', 'Saved');
    await settle();
    expect(chip()).toHaveTextContent('Saved');
  });

  test('data-tooltip removed while shown hides the chip', async () => {
    await setup();
    showA();
    byTip('Save session').removeAttribute('data-tooltip');
    await settle();
    expect(chip()).toBeNull();
  });

  test('Review Focus 2: the anchor removed while shown takes the chip with it', async () => {
    const { rerender } = await setup();
    pointerTo(byTip('Delete'));
    wait(300);
    expect(chip()).toHaveTextContent('Delete');
    rerender(<Fixture withB={false} />);
    await settle();
    expect(chip()).toBeNull();
  });

  test('an anchor removed during the wait shows no chip when the wait ends', async () => {
    const { rerender } = await setup();
    pointerTo(byTip('Delete'));
    wait(200);
    rerender(<Fixture withB={false} />);
    await settle();
    wait(300);
    expect(chip()).toBeNull();
  });

  test('Review Focus 3: nested anchors show the innermost text', async () => {
    await setup();
    pointerTo(byTip('Inner'));
    wait(300);
    expect(chip()).toHaveTextContent(/^Inner$/);
  });

  test('Review Focus 3: from outer to inner the chip hands over at 100 ms', async () => {
    await setup();
    pointerTo(screen.getByTestId('outer-text'));
    wait(300);
    expect(chip()).toHaveTextContent('Outer');
    pointerTo(byTip('Inner'));
    wait(99);
    expect(chip()).toBeNull();
    wait(1);
    expect(chip()).toHaveTextContent(/^Inner$/);
  });
});

describe('the repeat rule', () => {
  test('a tooltip that repeats visible text in full shows nothing', async () => {
    await setup();
    pointerTo(byTip('Weekend in Kyoto'));
    wait(1000);
    expect(chip()).toBeNull();
  });

  test('the same tooltip shows while that text is cut off', async () => {
    await setup();
    const text = screen.getByTestId('repeat');
    Object.defineProperty(text, 'scrollWidth', {
      value: 120,
      configurable: true,
    });
    Object.defineProperty(text, 'clientWidth', {
      value: 80,
      configurable: true,
    });
    pointerTo(byTip('Weekend in Kyoto'));
    wait(300);
    expect(chip()).toHaveTextContent('Weekend in Kyoto');
  });
});

describe('what it draws, and where', () => {
  test('the chip is hidden from screen readers and the anchor keeps every attribute', async () => {
    await setup();
    const attrs = (el: Element) =>
      el.getAttributeNames().map((n) => [n, el.getAttribute(n)]);
    const replace = screen.getByRole('button', { name: 'Replace' });
    const before = attrs(replace);
    pointerTo(replace);
    wait(300);
    expect(chip()).toHaveAttribute('aria-hidden', 'true');
    expect(replace).toHaveAccessibleDescription('Replace with open windows');
    expect(attrs(replace)).toEqual(before);

    const a = byTip('Save session');
    const plainBefore = attrs(a);
    pointerTo(a);
    wait(100);
    expect(chip()).toHaveTextContent('Save session');
    expect(attrs(a)).toEqual(plainBefore);
  });

  test('outside a dialog the chip is drawn in body', async () => {
    await setup();
    showA();
    expect(chip()?.parentElement).toBe(document.body);
  });

  test('inside an open dialog the chip is drawn in that dialog', async () => {
    await setup();
    const anchor = byTip('In dialog');
    pointerTo(anchor);
    wait(300);
    expect(chip()?.closest('dialog')).toBe(anchor.closest('dialog'));
  });

  test("the anchor's box goes to placeTooltip, and the chip sits where it says", async () => {
    await setup();
    const a = byTip('Save session');
    a.getBoundingClientRect = () => new DOMRect(100, 50, 40, 20);
    pointerTo(a);
    wait(300);
    const place = vi.mocked(placeTooltip);
    expect(place).toHaveBeenCalledWith(
      expect.objectContaining({ left: 100, top: 50, width: 40, height: 20 }),
      expect.objectContaining({
        width: expect.any(Number),
        height: expect.any(Number),
      }),
      expect.objectContaining({
        width: expect.any(Number),
        height: expect.any(Number),
      })
    );
    const last = place.mock.results[place.mock.results.length - 1];
    if (last?.type !== 'return') throw new Error('placeTooltip did not return');
    const at = last.value;
    expect(chip()).toHaveStyle({ left: `${at.left}px`, top: `${at.top}px` });
  });

  // A dialog clips what it holds (overflow: auto) and its transform makes it the
  // chip's containing block: placed in the viewport, a chip near its edge was cut
  // off and gave the dialog a scrollbar (measured in the Setup dialog).
  test('inside a dialog the chip is placed within the dialog, not the viewport', async () => {
    await setup();
    const anchor = byTip('In dialog');
    const dialog = anchor.closest('dialog');
    if (dialog === null) throw new Error('no dialog');
    dialog.getBoundingClientRect = () => new DOMRect(300, 200, 402, 302);
    Object.defineProperty(dialog, 'clientLeft', { value: 1 });
    Object.defineProperty(dialog, 'clientTop', { value: 1 });
    Object.defineProperty(dialog, 'clientWidth', { value: 400 });
    Object.defineProperty(dialog, 'clientHeight', { value: 300 });
    anchor.getBoundingClientRect = () => new DOMRect(650, 220, 32, 32);
    pointerTo(anchor);
    wait(300);
    const place = vi.mocked(placeTooltip);
    expect(place).toHaveBeenLastCalledWith(
      expect.objectContaining({ left: 349, top: 19, width: 32, height: 32 }),
      expect.anything(),
      { width: 400, height: 300 }
    );
    const last = place.mock.results[place.mock.results.length - 1];
    if (last?.type !== 'return') throw new Error('placeTooltip did not return');
    const at = last.value;
    expect(chip()).toHaveStyle({
      left: `${301 + at.left}px`,
      top: `${201 + at.top}px`,
    });
  });
});

describe('mounted on every page', () => {
  const SESSION = buildSession({ tabGroupId: 'session-kyoto', title: 'Kyoto' });
  // An anchor whose tooltip says more than its visible text, so the repeat rule lets it show.
  const firstShowable = () => {
    const el = [...document.querySelectorAll('[data-tooltip]')].find(
      (e) => e.textContent?.trim() !== e.getAttribute('data-tooltip')
    );
    if (!el) throw new Error('no showable anchor');
    return el;
  };

  test('the popup', async () => {
    await renderWithProviders(<MainContainer />);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const anchor = firstShowable();
    pointerTo(anchor);
    wait(300);
    expect(chip()).toHaveTextContent(anchor.getAttribute('data-tooltip') ?? '');
  });

  test('the export page', async () => {
    await renderWithProviders(
      <ExportPage source={{ kind: 'saved', tabGroupId: 'session-kyoto' }} />,
      {
        seedStore: (store) =>
          store.dispatch(replaceState(buildContainer([SESSION]))),
      }
    );
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const anchor = firstShowable();
    pointerTo(anchor);
    wait(300);
    expect(chip()).toHaveTextContent(anchor.getAttribute('data-tooltip') ?? '');
  });
});
