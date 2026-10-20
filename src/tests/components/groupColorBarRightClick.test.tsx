import { afterEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';

import GroupColorPicker from '../../components/common/GroupColorPicker';
import type { OverflowMenuItem } from '../../components/common/MenuPanel';
import { useRowContextMenu } from '../../components/common/rowMenu/useRowContextMenu';
import { renderWithProviders } from '../setup/renderWithProviders';
import { recordFirstRun } from '../../redux/slices/settingsDataStateSlice';
import { runShownHere } from '../../redux/slices/globalStateSlice';
import { endRun } from '../../redux/firstRun';
import { newRun } from '../../utils/functions/firstRun';

// KAN-708. A right-click on a group's colour bar opens its picker, as a left click does.

const items: OverflowMenuItem[] = [
  { key: 'x', label: 'Delete', icon: 'delete', onSelect: () => undefined },
];

// The bar sits inside a row that has its own right-click menu...
function Row({ beside = false }: { beside?: boolean }) {
  const m = useRowContextMenu({
    kind: 'savedWindow',
    ariaLabel: () => 'Row menu',
    itemsFor: () => items,
  });
  const bar = (
    <GroupColorPicker
      color="blue"
      ariaLabel="Change group color"
      onSelect={() => undefined}
    />
  );
  return (
    <>
      <div data-testid="row" {...m.rowProps('w1')}>
        <span>Title</span>
        {!beside && bar}
      </div>
      {/* ...or beside it, as a saved group's bar is beside its header. */}
      {beside && bar}
      {m.menu}
    </>
  );
}

type Os = chrome.runtime.PlatformInfo['os'];

const render = (platformOs?: Os, beside = false) =>
  renderWithProviders(<Row beside={beside} />, {
    seed: platformOs === undefined ? undefined : { platformOs },
  });

const band = () => screen.getByRole('button', { name: 'Change group color' });
const swatches = () => screen.queryAllByRole('menuitemradio');
const rowMenus = () => document.querySelectorAll('[data-row-menu]');

const settlePlatform = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

afterEach(() => {
  document.documentElement.removeAttribute('data-dragging');
  document.documentElement.removeAttribute('data-carrying');
});

describe('right-click on a group colour bar', () => {
  test('opens the picker, first swatch focused, no focus ring, Chrome menu prevented, no row menu', async () => {
    await render();
    expect(fireEvent.contextMenu(band(), { clientX: 5, clientY: 5 })).toBe(
      false
    );
    expect(swatches()).toHaveLength(9);
    expect(band()).toHaveAttribute('aria-expanded', 'true');
    expect(swatches()[0]).toHaveFocus();
    expect(rowMenus()).toHaveLength(0);

    // Esc is a pointer open's: focus returns to the bar without the ring.
    const focus = vi.spyOn(HTMLElement.prototype, 'focus');
    fireEvent.keyDown(swatches()[0], { key: 'Escape' });
    expect(swatches()).toHaveLength(0);
    expect(focus).toHaveBeenLastCalledWith({ focusVisible: false });
    focus.mockRestore();
  });

  test('while it is open, a right-click keeps it open', async () => {
    await render();
    fireEvent.contextMenu(band());
    expect(fireEvent.contextMenu(band())).toBe(false);
    expect(swatches()).toHaveLength(9);
    expect(band()).toHaveAttribute('aria-expanded', 'true');
  });

  test('while the tour runs: nothing opens and Chrome’s menu is suppressed; after it, it opens', async () => {
    const { store } = await render();
    act(() => {
      store.dispatch(recordFirstRun({ ...newRun('popup', 1), sessionId: 'x' }));
      store.dispatch(runShownHere());
    });
    const reachedDocument = vi.fn();
    document.addEventListener('contextmenu', reachedDocument);
    try {
      expect(fireEvent.contextMenu(band())).toBe(false);
      expect(reachedDocument).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener('contextmenu', reachedDocument);
    }
    expect(swatches()).toHaveLength(0);
    expect(rowMenus()).toHaveLength(0);

    act(() => {
      store.dispatch(endRun('finished'));
    });
    expect(fireEvent.contextMenu(band())).toBe(false);
    expect(swatches()).toHaveLength(9);
  });

  test.each(['data-dragging', 'data-carrying'])(
    'during a drag or carry (%s): nothing opens, Chrome’s menu suppressed',
    async (flag) => {
      await render();
      document.documentElement.setAttribute(flag, '');
      expect(fireEvent.contextMenu(band())).toBe(false);
      expect(swatches()).toHaveLength(0);
      expect(rowMenus()).toHaveLength(0);
      document.documentElement.removeAttribute(flag);
      expect(fireEvent.contextMenu(band())).toBe(false);
      expect(swatches()).toHaveLength(9);
    }
  );

  test('touch: Chrome keeps its handling and nothing opens', async () => {
    await render();
    const notPrevented = fireEvent(
      band(),
      new PointerEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        pointerType: 'touch',
      })
    );
    expect(notPrevented).toBe(true);
    expect(swatches()).toHaveLength(0);
  });

  test('a row menu open, then a right-click on the bar: only the picker is open', async () => {
    await render();
    fireEvent.contextMenu(screen.getByText('Title'));
    expect(rowMenus()).toHaveLength(1);
    fireEvent.contextMenu(band());
    expect(rowMenus()).toHaveLength(0);
    expect(swatches()).toHaveLength(9);
  });

  test('Shift+F10 and the Menu key on the focused bar open it, prevented, keyboard-opened', async () => {
    await render();
    act(() => band().focus());
    expect(fireEvent.keyDown(band(), { key: 'F10', shiftKey: true })).toBe(
      false
    );
    expect(swatches()).toHaveLength(9);
    expect(rowMenus()).toHaveLength(0);
    expect(swatches()[0]).toHaveFocus();

    // Esc is a keyboard open's: focus returns to the bar with the ring.
    const focus = vi.spyOn(HTMLElement.prototype, 'focus');
    fireEvent.keyDown(swatches()[0], { key: 'Escape' });
    expect(swatches()).toHaveLength(0);
    expect(focus).toHaveBeenLastCalledWith(undefined);
    focus.mockRestore();

    expect(fireEvent.keyDown(band(), { key: 'ContextMenu' })).toBe(false);
    expect(swatches()).toHaveLength(9);
  });

  test('Shift+F10 during a drag opens nothing, and is prevented', async () => {
    await render();
    document.documentElement.setAttribute('data-dragging', '');
    expect(fireEvent.keyDown(band(), { key: 'F10', shiftKey: true })).toBe(
      false
    );
    expect(swatches()).toHaveLength(0);
  });

  test('whatever a left click, Enter and Space did is unchanged', async () => {
    await render();
    fireEvent.click(band());
    expect(swatches()).toHaveLength(9);
    fireEvent.click(band());
    expect(swatches()).toHaveLength(0);
    fireEvent.keyDown(band(), { key: 'Enter' });
    expect(swatches()).toHaveLength(9);
    fireEvent.keyDown(band(), { key: ' ' });
    expect(swatches()).toHaveLength(0);
  });

  describe('Ctrl+click', () => {
    test('on a Mac the contextmenu opens the picker and the click after it does not close it', async () => {
      await render('mac', true);
      await settlePlatform();
      fireEvent.mouseDown(band(), { button: 0, ctrlKey: true });
      fireEvent.contextMenu(band(), { ctrlKey: true });
      fireEvent.click(band(), { button: 0, ctrlKey: true });
      expect(swatches()).toHaveLength(9);
      // The next plain click is the bar's again.
      fireEvent.mouseDown(band(), { button: 0 });
      fireEvent.click(band(), { button: 0 });
      expect(swatches()).toHaveLength(0);
    });

    test('CONTROL: elsewhere a Ctrl+click just toggles, as a click does', async () => {
      await render('win', true);
      await settlePlatform();
      fireEvent.mouseDown(band(), { button: 0, ctrlKey: true });
      fireEvent.click(band(), { button: 0, ctrlKey: true });
      expect(swatches()).toHaveLength(9);
      fireEvent.mouseDown(band(), { button: 0, ctrlKey: true });
      fireEvent.click(band(), { button: 0, ctrlKey: true });
      expect(swatches()).toHaveLength(0);
    });
  });
});
