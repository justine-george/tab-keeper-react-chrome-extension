import { afterEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent, screen, within } from '@testing-library/react';

import TabGroupEntry from '../../components/home/leftpane/TabGroupEntry';
import TabGroupEntryContainer from '../../components/home/leftpane/TabGroupEntryContainer';
import { renderWithProviders } from '../setup/renderWithProviders';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';
import { replaceState } from '../../redux/slices/tabContainerDataStateSlice';

// KAN-582 (picks: A without the reveal; Delete only in the header's ⋮). Only the session shown has row
// actions, Open, Switch and Replace. KAN-698: a double-click's second click presses none of them, so one that
// draws the strip under the pointer does nothing more (KAN-839); a click of its own presses (KAN-779).

const SHOWN = buildSession({
  tabGroupId: 'session-shown',
  title: 'Q4 product roadmap',
  isSelected: true,
});
const OTHER = buildSession({
  tabGroupId: 'session-kyoto',
  title: 'Weekend in Kyoto',
});

const rowButton = (title: string) =>
  screen.getByRole('button', { name: title });
const actionsOf = (title: string) =>
  rowButton(title).parentElement?.querySelector<HTMLElement>(
    '[data-row-actions]'
  ) ?? null;
const action = (title: string, name: string) => {
  const actions = actionsOf(title);
  if (actions === null) throw new Error(`no actions on ${title}`);
  return within(actions).getByRole('button', { name });
};
// What the browser would report under the pointer once the strip is drawn.
const pointerRestsOn = (title: string, name: string) =>
  vi
    .spyOn(document, 'elementFromPoint')
    .mockImplementation(() =>
      actionsOf(title) === null ? rowButton(title) : action(title, name)
    );
const AT = { clientX: 300, clientY: 20 };

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('which rows have actions (KAN-582)', () => {
  const renderList = () =>
    renderWithProviders(<TabGroupEntryContainer />, {
      seedStore: (store) => {
        store.dispatch(
          replaceState({
            ...buildContainer([SHOWN, OTHER]),
            selectedTabGroupId: SHOWN.tabGroupId,
          })
        );
      },
    });

  test('the session shown has Open, Switch and Replace, and no Delete; another row has none', async () => {
    await renderList();

    expect(
      within(actionsOf('Q4 product roadmap') ?? document.body)
        .getAllByRole('button')
        .map((b) => b.getAttribute('aria-label'))
    ).toEqual(['Open', 'Switch', 'Replace']);
    expect(actionsOf('Weekend in Kyoto')).toBeNull();
  });

  test('the session shown draws its actions at rest, with no hover or focus', async () => {
    await renderList();

    for (const name of ['Open', 'Switch', 'Replace'])
      expect(getComputedStyle(action('Q4 product roadmap', name)).opacity).toBe(
        '1'
      );
  });

  test('another row shows none however long the pointer stays on it', async () => {
    await renderList();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    fireEvent.pointerOver(rowButton('Weekend in Kyoto'), AT);
    act(() => {
      vi.advanceTimersByTime(10_000);
    });

    expect(actionsOf('Weekend in Kyoto')).toBeNull();
  });
});

describe('a strip that appears under the pointer (KAN-582)', () => {
  const handlers = () => ({
    onTabGroupClick: vi.fn(),
    onOpenAllClick: vi.fn(),
    onFocusClick: vi.fn(),
    onReplaceClick: vi.fn(),
    onDeleteKey: vi.fn(),
    deleteKeyShortcuts: 'Delete Backspace',
  });
  const row = (isSelected: boolean, h: ReturnType<typeof handlers>) => (
    <TabGroupEntry tabGroupData={{ ...OTHER, isSelected }} {...h} />
  );

  // The pointer rests on the row; a click selects it, and its strip is drawn under the pointer.
  async function selectUnderPointer(name: string) {
    const h = handlers();
    const r = await renderWithProviders(row(false, h));
    pointerRestsOn('Weekend in Kyoto', name);
    fireEvent.pointerOver(rowButton('Weekend in Kyoto'), AT);
    fireEvent.click(rowButton('Weekend in Kyoto'));
    r.rerender(row(true, h));
    expect(actionsOf('Weekend in Kyoto')).not.toBeNull();
    h.onTabGroupClick.mockClear();
    return h;
  }

  // The second click of the double-click that selected the row.
  const SECOND_CLICK = { detail: 2 };

  // KAN-839. The first click already selected the row, so there is nothing left to do.
  test.each([
    ['Open', 'onOpenAllClick'],
    ['Switch', 'onFocusClick'],
    ['Replace', 'onReplaceClick'],
  ] as const)(
    'the second click, on the %s drawn under it, presses nothing and selects nothing',
    async (name, handler) => {
      const h = await selectUnderPointer(name);

      fireEvent.pointerMove(action('Weekend in Kyoto', name), AT);
      fireEvent.click(action('Weekend in Kyoto', name), SECOND_CLICK);
      expect(h[handler]).not.toHaveBeenCalled();
      expect(h.onTabGroupClick).not.toHaveBeenCalled();
    }
  );

  test.each([
    ['a click of its own', 1],
    ['a key', 0],
  ])(
    'KAN-779: %s presses that button at once, the pointer unmoved',
    async (_, detail) => {
      const h = await selectUnderPointer('Replace');

      fireEvent.click(action('Weekend in Kyoto', 'Replace'), { detail });
      expect(h.onReplaceClick).toHaveBeenCalledTimes(1);
      expect(h.onTabGroupClick).not.toHaveBeenCalled();
    }
  );

  // KAN-698. A double-click on a shown row's Open, Switch or Replace presses once.
  test.each([
    ['Open', 'onOpenAllClick'],
    ['Switch', 'onFocusClick'],
    ['Replace', 'onReplaceClick'],
  ] as const)('a double-click on %s presses once', async (name, handler) => {
    const h = handlers();
    await renderWithProviders(row(true, h));

    fireEvent.click(action('Weekend in Kyoto', name), { detail: 1 });
    fireEvent.click(action('Weekend in Kyoto', name), SECOND_CLICK);
    expect(h[handler]).toHaveBeenCalledTimes(1);
  });
});
