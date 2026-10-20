import { afterEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent, screen, within } from '@testing-library/react';

import { useRowContextMenu } from '../../components/common/rowMenu/useRowContextMenu';
import { getRowMenu } from '../../components/common/rowMenu/rowMenuStore';
import type { OverflowMenuItem } from '../../components/common/MenuPanel';
import { renderWithProviders } from '../setup/renderWithProviders';
import { recordFirstRun } from '../../redux/slices/settingsDataStateSlice';
import { runShownHere } from '../../redux/slices/globalStateSlice';
import { endRun } from '../../redux/firstRun';
import { newRun } from '../../utils/functions/firstRun';

// KAN-708. A right-click (or Shift+F10, or the Menu key) on a row opens that row's ⋮ items at the pointer.

const ROWS = ['a', 'b'];

type Calls = {
  onCopy: (id: string) => void;
  onDelete: (id: string) => void;
  onRowClick: (id: string) => void;
  onInnerItem: () => void;
};

function Harness({
  hidden,
  calls,
  extra = false,
}: {
  hidden: string[];
  calls: Calls;
  extra?: boolean;
}) {
  const { rowProps, heldId, menu } = useRowContextMenu({
    kind: 'session',
    ariaLabel: (id) => `Actions for ${id}`,
    itemsFor: (id): OverflowMenuItem[] | null =>
      hidden.includes(id)
        ? null
        : [
            {
              key: 'copy',
              label: 'Copy',
              icon: 'link',
              onSelect: () => calls.onCopy(id),
            },
            {
              key: 'delete',
              label: 'Delete',
              icon: 'delete',
              danger: true,
              shortcut: {
                hint: '⌫',
                ariaKeyShortcuts: 'Backspace',
                matches: (e) => e.key === 'Backspace',
              },
              onSelect: () => calls.onDelete(id),
            },
            // An item that appears while the menu is open, as Remove duplicates can after a sync.
            ...(extra
              ? [
                  {
                    key: 'extra',
                    label: 'Extra',
                    icon: 'link' as const,
                    onSelect: () => undefined,
                  },
                ]
              : []),
          ],
  });
  return (
    <>
      {ROWS.map((id) => (
        <div
          key={id}
          data-testid={`row-${id}`}
          {...rowProps(id)}
          onClick={() => calls.onRowClick(id)}
        >
          <button type="button">{`Title ${id}`}</button>
          <input aria-label={`Name ${id}`} />
          {/* Stands in for a ⋮ menu drawn inside the row (R1). */}
          {id === 'b' && (
            <div role="menu" aria-label="Inner menu b">
              <button
                type="button"
                role="menuitem"
                onClick={() => calls.onInnerItem()}
              >
                Inner item
              </button>
            </div>
          )}
        </div>
      ))}
      <output data-testid="held">{heldId ?? ''}</output>
      {menu}
    </>
  );
}

const makeCalls = () => ({
  onCopy: vi.fn<(id: string) => void>(),
  onDelete: vi.fn<(id: string) => void>(),
  onRowClick: vi.fn<(id: string) => void>(),
  onInnerItem: vi.fn<() => void>(),
});

type Os = chrome.runtime.PlatformInfo['os'];

async function renderRows({
  hidden = [],
  platformOs,
}: { hidden?: string[]; platformOs?: Os } = {}) {
  const calls = makeCalls();
  const r = await renderWithProviders(
    <Harness hidden={hidden} calls={calls} />,
    { seed: platformOs === undefined ? undefined : { platformOs } }
  );
  const rerenderHidden = (next: string[]) =>
    r.rerender(<Harness hidden={next} calls={calls} />);
  const rerenderExtra = () =>
    r.rerender(<Harness hidden={hidden} calls={calls} extra />);
  return { ...r, calls, rerenderHidden, rerenderExtra };
}

const row = (id: string) => screen.getByTestId(`row-${id}`);
const title = (id: string) =>
  screen.getByRole('button', { name: `Title ${id}` });
const field = (id: string) =>
  screen.getByRole('textbox', { name: `Name ${id}` });
const rowMenus = () => [
  ...document.querySelectorAll<HTMLElement>('[data-row-menu]'),
];
const rowMenu = () => {
  const menus = rowMenus();
  expect(menus).toHaveLength(1);
  return menus[0];
};
const itemsOf = (menu: HTMLElement) => within(menu).getAllByRole('menuitem');

// A long press on a touch screen fires contextmenu as a PointerEvent.
const touchContextMenu = (el: Element) =>
  fireEvent(
    el,
    new PointerEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      pointerType: 'touch',
    })
  );

// Lets useMacKeys' getPlatformInfo answer land.
const settlePlatform = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

afterEach(() => {
  document.documentElement.removeAttribute('data-dragging');
  document.documentElement.removeAttribute('data-carrying');
});

describe('right-click on a row', () => {
  test('right-click opens the items at the pointer as a menu, default prevented', async () => {
    await renderRows();
    expect(fireEvent.contextMenu(row('a'), { clientX: 50, clientY: 60 })).toBe(
      false
    );
    const menu = screen.getByRole('menu', { name: 'Actions for a' });
    const items = itemsOf(menu);
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveAccessibleName('Copy');
    expect(items[1]).toHaveAccessibleName('Delete');
    expect(items[1]).toHaveAttribute('aria-keyshortcuts', 'Backspace');
    expect(items[0]).toHaveFocus();
    expect(menu).toHaveStyle({
      position: 'fixed',
      left: '50px',
      top: '60px',
      zIndex: '1000',
      visibility: 'visible',
    });
  });

  test('it is placed by its measured size, flipping back across the point at the edges', async () => {
    const rect = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function (this: HTMLElement) {
        return this.hasAttribute('data-row-menu')
          ? new DOMRect(0, 0, 200, 100)
          : new DOMRect();
      });
    try {
      await renderRows();
      // jsdom's window is 1024 x 768.
      fireEvent.contextMenu(row('a'), { clientX: 950, clientY: 700 });
      expect(rowMenu()).toHaveStyle({ left: '750px', top: '600px' });
    } finally {
      rect.mockRestore();
    }
  });

  test('an item appearing while it is open near the bottom edge places it again, inside the gutter', async () => {
    // 50px per item, so the stub follows the live item count.
    const rect = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function (this: HTMLElement) {
        return this.hasAttribute('data-row-menu')
          ? new DOMRect(
              0,
              0,
              200,
              50 * this.querySelectorAll('[role="menuitem"]').length
            )
          : new DOMRect();
      });
    try {
      const { rerenderExtra } = await renderRows();
      // 640 + 100 fits in 768 - 4.
      fireEvent.contextMenu(row('a'), { clientX: 50, clientY: 640 });
      expect(rowMenu()).toHaveStyle({ left: '50px', top: '640px' });
      // 640 + 150 does not: it flips to end at the point.
      rerenderExtra();
      expect(itemsOf(rowMenu())).toHaveLength(3);
      expect(rowMenu()).toHaveStyle({ left: '50px', top: '490px' });
    } finally {
      rect.mockRestore();
    }
  });

  test('the menu is portalled outside the row and carries data-row-menu', async () => {
    const { container } = await renderRows();
    fireEvent.contextMenu(row('a'));
    const menu = screen.getByRole('menu', { name: 'Actions for a' });
    expect(menu).toHaveAttribute('data-row-menu');
    expect(menu.parentElement).toBe(document.body);
    expect(container.contains(menu)).toBe(false);
  });

  test('choosing an item calls it for the right-clicked id and closes', async () => {
    const { calls } = await renderRows();
    fireEvent.contextMenu(row('b'));
    fireEvent.click(itemsOf(rowMenu())[0]);
    expect(calls.onCopy).toHaveBeenCalledExactlyOnceWith('b');
    expect(rowMenus()).toHaveLength(0);
    expect(getRowMenu()).toBeNull();
    // The click on the item never reached the row.
    expect(calls.onRowClick).not.toHaveBeenCalled();
  });

  test('an item’s shortcut key runs it for the right-clicked id', async () => {
    const { calls } = await renderRows();
    fireEvent.contextMenu(row('a'));
    fireEvent.keyDown(itemsOf(rowMenu())[0], { key: 'Backspace' });
    expect(calls.onDelete).toHaveBeenCalledExactlyOnceWith('a');
    expect(rowMenus()).toHaveLength(0);
  });

  test('Esc closes, is prevented and stopped, and returns focus to the element focused before', async () => {
    await renderRows();
    act(() => title('a').focus());
    fireEvent.contextMenu(title('a'));
    const item = itemsOf(rowMenu())[0];
    expect(item).toHaveFocus();

    const reachedDocument = vi.fn();
    document.addEventListener('keydown', reachedDocument);
    const focus = vi.spyOn(HTMLElement.prototype, 'focus');
    try {
      expect(fireEvent.keyDown(item, { key: 'Escape' })).toBe(false);
      expect(reachedDocument).not.toHaveBeenCalled();
      expect(rowMenus()).toHaveLength(0);
      expect(title('a')).toHaveFocus();
      expect(focus).toHaveBeenCalledExactlyOnceWith({ focusVisible: false });
    } finally {
      focus.mockRestore();
      document.removeEventListener('keydown', reachedDocument);
    }
  });

  test('mousedown outside closes; right-press on row b while a’s menu is open opens b’s', async () => {
    const { calls } = await renderRows();
    fireEvent.contextMenu(row('a'));
    fireEvent.mouseDown(document.body);
    expect(rowMenus()).toHaveLength(0);

    fireEvent.contextMenu(row('a'));
    fireEvent.mouseDown(row('b'), { button: 2 });
    expect(rowMenus()).toHaveLength(0);
    fireEvent.contextMenu(row('b'), { clientX: 70, clientY: 80 });
    const menu = screen.getByRole('menu', { name: 'Actions for b' });
    expect(menu).toHaveStyle({ left: '70px', top: '80px' });
    expect(itemsOf(menu)[0]).toHaveFocus();
    fireEvent.click(itemsOf(menu)[1]);
    expect(calls.onDelete).toHaveBeenCalledExactlyOnceWith('b');
  });

  test('a press inside the menu does not close it', async () => {
    await renderRows();
    fireEvent.contextMenu(row('a'));
    fireEvent.mouseDown(itemsOf(rowMenu())[1]);
    expect(rowMenus()).toHaveLength(1);
  });

  test.each([
    ['a scroll of any pane', () => fireEvent.scroll(row('b'))],
    ['a window resize', () => fireEvent(window, new Event('resize'))],
    ['the window losing focus', () => fireEvent.blur(window)],
  ])('%s closes it', async (_name, away) => {
    await renderRows();
    act(() => title('a').focus());
    fireEvent.contextMenu(title('a'));
    expect(rowMenus()).toHaveLength(1);
    away();
    expect(rowMenus()).toHaveLength(0);
    expect(getRowMenu()).toBeNull();
    // Only Esc returns focus.
    expect(title('a')).not.toHaveFocus();
  });

  test('a text field keeps Chrome’s menu', async () => {
    await renderRows();
    expect(fireEvent.contextMenu(field('a'))).toBe(true);
    expect(fireEvent.keyDown(field('a'), { key: 'F10', shiftKey: true })).toBe(
      true
    );
    expect(rowMenus()).toHaveLength(0);
  });

  test('touch keeps Chrome’s menu', async () => {
    await renderRows();
    expect(touchContextMenu(row('a'))).toBe(true);
    expect(rowMenus()).toHaveLength(0);
    // CONTROL: a mouse right-click as a PointerEvent does open it.
    expect(
      fireEvent(
        row('a'),
        new PointerEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          pointerType: 'mouse',
        })
      )
    ).toBe(false);
    expect(rowMenus()).toHaveLength(1);
  });

  test('items null: Chrome’s menu, nothing opens', async () => {
    await renderRows({ hidden: ['a'] });
    expect(fireEvent.contextMenu(row('a'))).toBe(true);
    expect(fireEvent.keyDown(title('a'), { key: 'ContextMenu' })).toBe(true);
    expect(rowMenus()).toHaveLength(0);
    // CONTROL: b still answers.
    expect(fireEvent.contextMenu(row('b'))).toBe(false);
    expect(rowMenus()).toHaveLength(1);
  });

  test('while the tour runs: nothing opens and Chrome’s menu is suppressed', async () => {
    const { store } = await renderRows();
    act(() => {
      store.dispatch(recordFirstRun({ ...newRun('popup', 1), sessionId: 'x' }));
      store.dispatch(runShownHere());
    });
    const reachedDocument = vi.fn();
    document.addEventListener('contextmenu', reachedDocument);
    try {
      expect(fireEvent.contextMenu(row('a'))).toBe(false);
      expect(reachedDocument).not.toHaveBeenCalled();
      expect(
        fireEvent.keyDown(title('a'), { key: 'F10', shiftKey: true })
      ).toBe(false);
      expect(rowMenus()).toHaveLength(0);
    } finally {
      document.removeEventListener('contextmenu', reachedDocument);
    }

    act(() => {
      store.dispatch(endRun('finished'));
    });
    expect(fireEvent.contextMenu(row('a'))).toBe(false);
    expect(rowMenus()).toHaveLength(1);
  });

  test.each(['data-dragging', 'data-carrying'])(
    'during a drag or carry (%s): nothing opens, Chrome’s menu suppressed',
    async (flag) => {
      await renderRows();
      document.documentElement.setAttribute(flag, '');
      expect(fireEvent.contextMenu(row('a'))).toBe(false);
      expect(rowMenus()).toHaveLength(0);
      document.documentElement.removeAttribute(flag);
      expect(fireEvent.contextMenu(row('a'))).toBe(false);
      expect(rowMenus()).toHaveLength(1);
    }
  );

  test.each([
    ['Shift+F10', { key: 'F10', shiftKey: true }],
    ['the Menu key', { key: 'ContextMenu' }],
  ])(
    '%s opens the focused row’s menu once, anchored under the focused element',
    async (_name, keys) => {
      await renderRows();
      title('a').getBoundingClientRect = () => new DOMRect(10, 20, 100, 24);
      act(() => title('a').focus());
      expect(fireEvent.keyDown(title('a'), keys)).toBe(false);
      const menu = rowMenu();
      expect(menu).toHaveStyle({ left: '10px', top: '44px' });
      expect(itemsOf(menu)[0]).toHaveFocus();

      // The contextmenu Chrome may send after the same key press: prevented, and no second open.
      expect(
        fireEvent.contextMenu(title('a'), { clientX: 300, clientY: 300 })
      ).toBe(false);
      expect(rowMenu()).toBe(menu);
      expect(menu).toHaveStyle({ left: '10px', top: '44px' });
      expect(itemsOf(menu)[0]).toHaveFocus();
      expect(getRowMenu()?.byPointer).toBe(false);

      // Opened by the keyboard, Esc returns focus with the ring.
      const focus = vi.spyOn(HTMLElement.prototype, 'focus');
      try {
        fireEvent.keyDown(itemsOf(menu)[0], { key: 'Escape' });
        expect(title('a')).toHaveFocus();
        expect(focus).toHaveBeenCalledOnce();
        expect(focus.mock.calls[0][0]?.focusVisible).toBeUndefined();
      } finally {
        focus.mockRestore();
      }
    }
  );

  test.each([
    ['Shift+F10', { key: 'F10', shiftKey: true }],
    ['the Menu key', { key: 'ContextMenu' }],
  ])(
    'Shift+Tab out of a keyboard-opened menu back to its row, then %s again: it opens again, focused on its first item',
    async (_name, keys) => {
      await renderRows();
      title('a').getBoundingClientRect = () => new DOMRect(10, 20, 100, 24);
      act(() => title('a').focus());
      fireEvent.keyDown(title('a'), keys);
      act(() => itemsOf(rowMenu())[1].focus());
      // Tab moves focus out without a press, so nothing closes the menu.
      act(() => title('a').focus());

      expect(fireEvent.keyDown(title('a'), keys)).toBe(false);
      const menu = screen.getByRole('menu', { name: 'Actions for a' });
      expect(rowMenus()).toEqual([menu]);
      expect(menu).toHaveStyle({ left: '10px', top: '44px' });
      expect(itemsOf(menu)[0]).toHaveFocus();
    }
  );

  test('Tab out of an open menu, then Shift+F10 on another row: that row’s menu, focused and anchored there', async () => {
    await renderRows();
    title('b').getBoundingClientRect = () => new DOMRect(30, 100, 100, 24);
    fireEvent.contextMenu(row('a'), { clientX: 50, clientY: 60 });
    // Tab moves focus out without a press, so nothing closes a's menu.
    act(() => title('b').focus());
    fireEvent.keyDown(title('b'), { key: 'F10', shiftKey: true });
    const menu = screen.getByRole('menu', { name: 'Actions for b' });
    expect(rowMenus()).toEqual([menu]);
    expect(menu).toHaveStyle({ left: '30px', top: '124px' });
    expect(itemsOf(menu)[0]).toHaveFocus();
  });

  test('other keys on a row open nothing and are not prevented', async () => {
    await renderRows();
    expect(fireEvent.keyDown(title('a'), { key: 'F10' })).toBe(true);
    expect(fireEvent.keyDown(title('a'), { key: 'Enter' })).toBe(true);
    expect(rowMenus()).toHaveLength(0);
  });

  test('items going null while open closes the menu (row removed by sync)', async () => {
    const { rerenderHidden } = await renderRows();
    fireEvent.contextMenu(row('a'));
    expect(rowMenus()).toHaveLength(1);
    rerenderHidden(['a']);
    expect(rowMenus()).toHaveLength(0);
    expect(getRowMenu()).toBeNull();
    expect(screen.getByTestId('held')).toHaveTextContent('');
  });

  test('unmounting the rows while their menu is open closes it', async () => {
    const { unmount } = await renderRows();
    fireEvent.contextMenu(row('a'));
    expect(getRowMenu()).not.toBeNull();
    unmount();
    expect(getRowMenu()).toBeNull();
    expect(rowMenus()).toHaveLength(0);
  });

  test('heldId names the open row and data-row-menu-held is on its props only', async () => {
    await renderRows();
    expect(screen.getByTestId('held')).toHaveTextContent('');
    expect(row('a')).not.toHaveAttribute('data-row-menu-held');
    fireEvent.contextMenu(row('a'));
    expect(screen.getByTestId('held')).toHaveTextContent('a');
    expect(row('a')).toHaveAttribute('data-row-menu-held', '');
    expect(row('b')).not.toHaveAttribute('data-row-menu-held');
    fireEvent.mouseDown(document.body);
    expect(row('a')).not.toHaveAttribute('data-row-menu-held');
  });

  test('a right-click never reaches the row’s click', async () => {
    const { calls } = await renderRows();
    fireEvent.mouseDown(row('a'), { button: 2 });
    fireEvent.contextMenu(row('a'));
    expect(calls.onRowClick).not.toHaveBeenCalled();
  });

  describe('Ctrl+click', () => {
    const ctrlClick = (el: Element) => {
      fireEvent.mouseDown(el, { button: 0, ctrlKey: true });
      fireEvent.click(el, { button: 0, ctrlKey: true });
    };

    test('on a Mac it does not reach the row’s click', async () => {
      const { calls } = await renderRows({ platformOs: 'mac' });
      await settlePlatform();
      ctrlClick(title('a'));
      expect(calls.onRowClick).not.toHaveBeenCalled();
      // The next plain click is the row's again.
      fireEvent.mouseDown(title('a'), { button: 0 });
      fireEvent.click(title('a'), { button: 0 });
      expect(calls.onRowClick).toHaveBeenCalledExactlyOnceWith('a');
    });

    test('CONTROL: elsewhere it does reach the row’s click', async () => {
      const { calls } = await renderRows({ platformOs: 'win' });
      await settlePlatform();
      ctrlClick(title('a'));
      expect(calls.onRowClick).toHaveBeenCalledExactlyOnceWith('a');
    });

    test('on a Mac, a press with no click after it does not swallow a later keyboard click', async () => {
      const { calls } = await renderRows({ platformOs: 'mac' });
      await settlePlatform();
      fireEvent.mouseDown(title('a'), { button: 0, ctrlKey: true });
      fireEvent.keyDown(title('a'), { key: 'Enter' });
      fireEvent.click(title('a'));
      expect(calls.onRowClick).toHaveBeenCalledExactlyOnceWith('a');
    });

    test('on a Mac it cannot swallow a click on a menu item inside the row', async () => {
      const { calls } = await renderRows({ platformOs: 'mac' });
      await settlePlatform();
      ctrlClick(screen.getByRole('menuitem', { name: 'Inner item' }));
      expect(calls.onInnerItem).toHaveBeenCalledOnce();
    });
  });

  describe('menus answer for themselves (R1)', () => {
    test('a right-click on the open menu itself is suppressed and does not reopen or re-anchor it', async () => {
      await renderRows();
      fireEvent.contextMenu(row('a'), { clientX: 50, clientY: 60 });
      const menu = rowMenu();
      const second = itemsOf(menu)[1];
      act(() => second.focus());

      expect(
        fireEvent.contextMenu(second, { clientX: 200, clientY: 200 })
      ).toBe(false);
      expect(fireEvent.keyDown(second, { key: 'F10', shiftKey: true })).toBe(
        true
      );
      expect(fireEvent.keyDown(second, { key: 'ContextMenu' })).toBe(true);
      expect(rowMenu()).toBe(menu);
      expect(menu).toHaveStyle({ left: '50px', top: '60px' });
      expect(second).toHaveFocus();
      expect(getRowMenu()?.ids).toEqual(['a']);
    });

    test('a ⋮ menu drawn inside a row spawns no row menu', async () => {
      await renderRows();
      const inner = screen.getByRole('menuitem', { name: 'Inner item' });
      expect(fireEvent.contextMenu(inner)).toBe(true);
      expect(fireEvent.keyDown(inner, { key: 'F10', shiftKey: true })).toBe(
        true
      );
      expect(fireEvent.keyDown(inner, { key: 'ContextMenu' })).toBe(true);
      expect(rowMenus()).toHaveLength(0);
      // CONTROL: the same row answers from its title.
      expect(fireEvent.contextMenu(title('b'))).toBe(false);
      expect(rowMenus()).toHaveLength(1);
    });
  });
});

describe('only the owning container re-renders', () => {
  function Container({ name, renders }: { name: string; renders: string[] }) {
    const { rowProps, menu } = useRowContextMenu({
      kind: 'savedWindow',
      ariaLabel: (id) => `Window ${id}`,
      itemsFor: () => [
        { key: 'copy', label: 'Copy', icon: 'link', onSelect: () => undefined },
      ],
    });
    renders.push(name);
    return (
      <>
        <div {...rowProps(name)}>{`Row ${name}`}</div>
        {menu}
      </>
    );
  }

  test('opening and closing one container’s menu does not re-render the other', async () => {
    const renders: string[] = [];
    await renderWithProviders(
      <>
        <Container name="one" renders={renders} />
        <Container name="two" renders={renders} />
      </>
    );
    renders.length = 0;
    fireEvent.contextMenu(screen.getByText('Row one'));
    expect(screen.getByRole('menu', { name: 'Window one' })).toBeVisible();
    fireEvent.mouseDown(document.body);
    expect(rowMenus()).toHaveLength(0);
    expect(renders).not.toContain('two');
    // CONTROL: the owner did re-render, to open and to close.
    expect(renders.filter((name) => name === 'one').length).toBeGreaterThan(1);
  });
});

describe('nested rows', () => {
  // An inner row (a group mid-rename, say) inside an outer row (its window), each with its own hook.
  function Nested() {
    const outer = useRowContextMenu({
      kind: 'savedWindow',
      ariaLabel: (id) => `Window ${id}`,
      itemsFor: () => [
        { key: 'copy', label: 'Copy', icon: 'link', onSelect: () => undefined },
      ],
    });
    const inner = useRowContextMenu({
      kind: 'savedGroup',
      ariaLabel: (id) => `Group ${id}`,
      itemsFor: () => null,
    });
    return (
      <>
        <div data-testid="outer" {...outer.rowProps('w')}>
          <span>Window w</span>
          <div {...inner.rowProps('g')}>
            <button type="button">Group g</button>
          </div>
        </div>
        {outer.menu}
        {inner.menu}
      </>
    );
  }

  test('an inner row with no items keeps Chrome’s menu and does not open the outer row’s', async () => {
    await renderWithProviders(<Nested />);
    const group = screen.getByRole('button', { name: 'Group g' });
    expect(fireEvent.contextMenu(group)).toBe(true);
    act(() => group.focus());
    expect(fireEvent.keyDown(group, { key: 'F10', shiftKey: true })).toBe(true);
    expect(fireEvent.keyDown(group, { key: 'ContextMenu' })).toBe(true);
    expect(rowMenus()).toHaveLength(0);
    // CONTROL: the outer row answers on its own part.
    expect(fireEvent.contextMenu(screen.getByText('Window w'))).toBe(false);
    expect(screen.getByRole('menu', { name: 'Window w' })).toBeInTheDocument();
  });
});
