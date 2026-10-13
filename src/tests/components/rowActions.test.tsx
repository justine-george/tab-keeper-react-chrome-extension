import { afterEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent, screen, within } from '@testing-library/react';

import TabGroupEntry from '../../components/home/leftpane/TabGroupEntry';
import TabGroupEntryContainer from '../../components/home/leftpane/TabGroupEntryContainer';
import { renderWithProviders } from '../setup/renderWithProviders';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';
import { replaceState } from '../../redux/slices/tabContainerDataStateSlice';

// KAN-582 (picks: A without the reveal; Delete only in the header's ⋮). Only the session shown has row
// actions, Open, Switch and Replace; a button that appears under a resting pointer selects the row until the pointer leaves it.

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

  test('the button under the pointer selects the row instead (a double-click selects), until the pointer leaves it', async () => {
    const h = await selectUnderPointer('Replace');

    fireEvent.click(action('Weekend in Kyoto', 'Replace'));
    expect(h.onReplaceClick).not.toHaveBeenCalled();
    expect(h.onTabGroupClick).toHaveBeenCalledTimes(1);

    fireEvent.pointerMove(action('Weekend in Kyoto', 'Open'), {
      clientX: 200,
      clientY: 20,
    });
    fireEvent.click(action('Weekend in Kyoto', 'Replace'));
    expect(h.onReplaceClick).toHaveBeenCalledTimes(1);
  });

  test('moving within that button keeps it a select', async () => {
    const h = await selectUnderPointer('Replace');

    fireEvent.pointerMove(action('Weekend in Kyoto', 'Replace'), AT);
    fireEvent.click(action('Weekend in Kyoto', 'Replace'));
    expect(h.onReplaceClick).not.toHaveBeenCalled();
  });

  test('a button the pointer is not on acts at once', async () => {
    const h = await selectUnderPointer('Switch');

    fireEvent.click(action('Weekend in Kyoto', 'Replace'));
    expect(h.onReplaceClick).toHaveBeenCalledTimes(1);
  });

  test('leaving the row lifts it', async () => {
    const h = await selectUnderPointer('Replace');

    fireEvent.pointerOut(rowButton('Weekend in Kyoto'), {
      relatedTarget: document.body,
    });
    fireEvent.click(action('Weekend in Kyoto', 'Replace'));
    expect(h.onReplaceClick).toHaveBeenCalledTimes(1);
  });

  test('the pointer arriving on the shown row: its buttons act at once', async () => {
    const h = handlers();
    await renderWithProviders(row(true, h));
    pointerRestsOn('Weekend in Kyoto', 'Replace');
    fireEvent.pointerOver(action('Weekend in Kyoto', 'Replace'), AT);

    fireEvent.click(action('Weekend in Kyoto', 'Replace'));
    expect(h.onReplaceClick).toHaveBeenCalledTimes(1);
  });
});
