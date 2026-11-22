import { useState } from 'react';
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import {
  DIALOG_LEAVE,
  MENU_LEAVE,
  MENU_IN_MS,
  cutLeaving,
  growMenuIn,
  leaveCopy,
  useLeaveRef,
} from '../../components/common/popoverMotion';
import { trackLastInput } from '../../utils/functions/lastInput';

// KAN-982. jsdom has no Web Animations: each animation is a stub whose end the test controls.
let ends: Array<() => void> = [];
let animate: ReturnType<typeof vi.fn>;
let undoInput: () => void = () => {};

beforeEach(() => {
  ends = [];
  animate = vi.fn(() => {
    let end: () => void = () => {};
    const finished = new Promise<void>((resolve) => (end = resolve));
    ends.push(end);
    return { finished, playState: 'running' };
  });
  Object.assign(Element.prototype, { animate, getAnimations: () => [] });
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(
    DOMRect.fromRect({ x: 70, y: 274, width: 296, height: 265 })
  );
  undoInput = trackLastInput(window);
  window.dispatchEvent(new Event('pointerdown'));
});

afterEach(() => {
  cutLeaving();
  undoInput();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(Element.prototype, 'animate');
  Reflect.deleteProperty(Element.prototype, 'getAnimations');
  document.body.innerHTML = '';
});

const copies = () => document.querySelectorAll('[data-leaving-copy]');

function menu(): HTMLElement {
  const el = document.createElement('div');
  el.id = 'm';
  el.setAttribute('role', 'menu');
  el.setAttribute('aria-label', 'Session actions');
  el.setAttribute('data-row-menu', '');
  el.innerHTML =
    '<div data-menu-action-row><button role="menuitem" tabindex="-1" aria-label="Open">Open</button></div>' +
    '<button role="menuitem" tabindex="0">Delete session<span data-key-hint>⌫</span></button>';
  document.body.append(el);
  return el;
}

describe('a menu or dialog fading out (KAN-982)', () => {
  test('a copy stands where it was: inert, hidden, and with no role, id, aria or data hook left', () => {
    const el = menu();
    leaveCopy(el, MENU_LEAVE);
    el.remove();

    const [copy] = copies();
    expect(copy.tagName).toBe('DIV');
    expect((copy as HTMLElement).inert).toBe(true);
    expect(copy.getAttribute('aria-hidden')).toBe('true');
    expect((copy as HTMLElement).style.position).toBe('fixed');
    expect((copy as HTMLElement).style.left).toBe('70px');
    expect((copy as HTMLElement).style.top).toBe('274px');
    expect((copy as HTMLElement).style.pointerEvents).toBe('none');
    expect(copy.textContent).toBe('OpenDelete session⌫');
    const hooks = document.querySelectorAll(
      '[role], [id], [aria-label], [tabindex], [data-row-menu], [data-menu-action-row]'
    );
    expect(hooks).toHaveLength(0);
    // Styling only: the key hint keeps its colour while it fades.
    expect(copy.querySelector('[data-key-hint]')).not.toBeNull();
  });

  test('the copy fades to 0.98 at the menu timing, then goes', async () => {
    const el = menu();
    leaveCopy(el, MENU_LEAVE);
    expect(animate).toHaveBeenCalledWith(
      [{ opacity: 1, scale: '1' }, { opacity: 0, scale: '0.98' }],
      expect.objectContaining({ duration: 110 })
    );
    expect(copies()).toHaveLength(1);
    await act(async () => ends.forEach((end) => end()));
    expect(copies()).toHaveLength(0);
  });

  test('none after a key, under reduced motion, or while it is still growing in', () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(leaveCopy(menu(), MENU_LEAVE)).toBeNull();

    window.dispatchEvent(new Event('pointerdown'));
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce') }));
    expect(leaveCopy(menu(), MENU_LEAVE)).toBeNull();
    vi.unstubAllGlobals();

    const growing = menu();
    Object.assign(growing, { getAnimations: () => [{ playState: 'running' }] });
    expect(leaveCopy(growing, MENU_LEAVE)).toBeNull();

    expect(copies()).toHaveLength(0);
    // The press case, for contrast: the same menu does leave a copy.
    expect(leaveCopy(menu(), MENU_LEAVE)).not.toBeNull();
  });

  test('a new menu cuts the last one short', () => {
    leaveCopy(menu(), MENU_LEAVE);
    expect(copies()).toHaveLength(1);
    growMenuIn(menu(), '0 0');
    expect(copies()).toHaveLength(0);
  });
});

describe('a menu growing in (KAN-982)', () => {
  test('from its origin, at 160 ms', () => {
    const el = menu();
    growMenuIn(el, '12px 0px');
    expect(el.style.transformOrigin).toBe('12px 0px');
    expect(animate).toHaveBeenCalledWith(
      [{ opacity: 0, scale: '0.96' }, { opacity: 1, scale: '1' }],
      expect.objectContaining({ duration: MENU_IN_MS })
    );
  });

  test('not when a key opened it', () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    growMenuIn(menu(), '0 0');
    expect(animate).not.toHaveBeenCalled();
  });
});

describe('useLeaveRef (KAN-982)', () => {
  function Host({ dialogOpen = true }: { dialogOpen?: boolean }) {
    const [shown, setShown] = useState(true);
    const ref = useLeaveRef<HTMLDialogElement>(DIALOG_LEAVE);
    return (
      <>
        <button onClick={() => setShown(false)}>hide</button>
        {shown && (
          <dialog ref={ref} open={dialogOpen} role="alertdialog">
            Switch?
          </dialog>
        )}
      </>
    );
  }

  test('a dialog leaving the page leaves a copy behind it', () => {
    const { getByText } = render(<Host />);
    act(() => getByText('hide').click());
    expect(document.querySelector('dialog')).toBeNull();
    // The dim, then the dialog's copy over it.
    expect([...copies()].map((c) => c.textContent)).toEqual(['', 'Switch?']);
  });

  test('a dialog already closed by hand leaves none', () => {
    const { getByText } = render(<Host dialogOpen={false} />);
    act(() => getByText('hide').click());
    expect(copies()).toHaveLength(0);
  });

  test('a ref let go of an element that stays leaves none', async () => {
    const el = menu();
    let call: (e: HTMLElement | null) => void = () => {};
    function Grab() {
      call = useLeaveRef<HTMLElement>(MENU_LEAVE);
      return null;
    }
    render(<Grab />);
    call(el);
    call(null);
    expect(copies()).toHaveLength(1);
    await act(async () => {});
    expect(copies()).toHaveLength(0);
  });
});
