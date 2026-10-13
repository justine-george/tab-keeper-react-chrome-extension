import { afterEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent, screen, within } from '@testing-library/react';

import TabGroupEntryContainer from '../../components/home/leftpane/TabGroupEntryContainer';
import { ROW_ACTIONS_DWELL_MS } from '../../components/home/leftpane/useRowActionReveal';
import { renderWithProviders } from '../setup/renderWithProviders';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';
import { replaceState } from '../../redux/slices/tabContainerDataStateSlice';

// KAN-582 (pick A + guarded reveal, 2s). Only the selected row shows its actions at once; another shows them after a dwell, and a button that appears under a resting pointer selects the row until the pointer leaves it.

const SHOWN = buildSession({
  tabGroupId: 'session-shown',
  title: 'Q4 product roadmap',
  isSelected: true,
});
const OTHER = buildSession({
  tabGroupId: 'session-kyoto',
  title: 'Weekend in Kyoto',
});

const renderList = async () => {
  const rendered = await renderWithProviders(<TabGroupEntryContainer />, {
    seedStore: (store) => {
      store.dispatch(
        replaceState({
          ...buildContainer([SHOWN, OTHER]),
          selectedTabGroupId: SHOWN.tabGroupId,
        })
      );
    },
  });
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  return rendered;
};

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
const enter = (title: string) => fireEvent.pointerOver(rowButton(title), AT);
const leave = (title: string) =>
  fireEvent.pointerOut(rowButton(title), { relatedTarget: document.body });
const wait = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });

const sessionIds = (store: Awaited<ReturnType<typeof renderList>>['store']) =>
  store.getState().tabContainerDataState.tabGroups.map((s) => s.tabGroupId);

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('a saved row’s actions (KAN-582)', () => {
  test('the selected row has its actions; another row has none', async () => {
    await renderList();

    expect(actionsOf('Q4 product roadmap')).not.toBeNull();
    expect(actionsOf('Weekend in Kyoto')).toBeNull();
  });

  test('another row shows its actions after 2s on it, not before, and hides them when the pointer leaves', async () => {
    await renderList();
    enter('Weekend in Kyoto');

    await wait(ROW_ACTIONS_DWELL_MS - 1);
    expect(actionsOf('Weekend in Kyoto')).toBeNull();
    await wait(1);
    expect(actionsOf('Weekend in Kyoto')).not.toBeNull();

    leave('Weekend in Kyoto');
    expect(actionsOf('Weekend in Kyoto')).toBeNull();
  });

  test('the dwell is time on the row: leaving early starts it over', async () => {
    await renderList();
    enter('Weekend in Kyoto');
    await wait(ROW_ACTIONS_DWELL_MS - 500);
    leave('Weekend in Kyoto');
    enter('Weekend in Kyoto');
    await wait(ROW_ACTIONS_DWELL_MS - 500);

    expect(actionsOf('Weekend in Kyoto')).toBeNull();
  });

  test('the dwell is 2 seconds', () => {
    expect(ROW_ACTIONS_DWELL_MS).toBe(2000);
  });

  test('revealed under a resting pointer: that button selects the row, until the pointer leaves it', async () => {
    const { store } = await renderList();
    pointerRestsOn('Weekend in Kyoto', 'Delete');
    enter('Weekend in Kyoto');
    await wait(ROW_ACTIONS_DWELL_MS);

    fireEvent.click(action('Weekend in Kyoto', 'Delete'));
    expect(sessionIds(store)).toContain(OTHER.tabGroupId);
    expect(store.getState().tabContainerDataState.selectedTabGroupId).toBe(
      OTHER.tabGroupId
    );

    fireEvent.pointerMove(action('Weekend in Kyoto', 'Open'), {
      clientX: 200,
      clientY: 20,
    });
    fireEvent.click(action('Weekend in Kyoto', 'Delete'));
    expect(sessionIds(store)).not.toContain(OTHER.tabGroupId);
  });

  test('revealed: a button the pointer is not on acts at once', async () => {
    const { store } = await renderList();
    pointerRestsOn('Weekend in Kyoto', 'Open');
    enter('Weekend in Kyoto');
    await wait(ROW_ACTIONS_DWELL_MS);

    fireEvent.click(action('Weekend in Kyoto', 'Delete'));
    expect(sessionIds(store)).not.toContain(OTHER.tabGroupId);
  });

  test('moving within the button it appeared under keeps it a select', async () => {
    const { store } = await renderList();
    pointerRestsOn('Weekend in Kyoto', 'Delete');
    enter('Weekend in Kyoto');
    await wait(ROW_ACTIONS_DWELL_MS);

    fireEvent.pointerMove(action('Weekend in Kyoto', 'Delete'), AT);
    fireEvent.click(action('Weekend in Kyoto', 'Delete'));
    expect(sessionIds(store)).toContain(OTHER.tabGroupId);
  });

  test('a click that selects a row: its actions appear, and the one under the pointer does not act (a double-click selects)', async () => {
    const { store } = await renderList();
    pointerRestsOn('Weekend in Kyoto', 'Delete');
    enter('Weekend in Kyoto');
    fireEvent.click(rowButton('Weekend in Kyoto'));
    expect(actionsOf('Weekend in Kyoto')).not.toBeNull();

    fireEvent.click(action('Weekend in Kyoto', 'Delete'));
    expect(sessionIds(store)).toContain(OTHER.tabGroupId);
  });

  test('the pointer arriving on the selected row: its buttons act at once', async () => {
    const { store } = await renderList();
    pointerRestsOn('Q4 product roadmap', 'Delete');
    enter('Q4 product roadmap');

    fireEvent.click(action('Q4 product roadmap', 'Delete'));
    expect(sessionIds(store)).not.toContain(SHOWN.tabGroupId);
  });
});
