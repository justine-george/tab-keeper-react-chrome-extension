import { describe, expect, test } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';

import MenuContainer from '../../components/home/leftpane/MenuContainer';
import { renderWithProviders } from '../setup/renderWithProviders';
import type { RenderWithProvidersResult } from '../setup/renderWithProviders';
import {
  saveToTabContainerInternal,
  moveSessionInternal,
  updateTabGroupTitle,
} from '../../redux/slices/tabContainerDataStateSlice';

// KAN-136. The sort menu in the header, which replaced the strip KAN-130 put
// inside the list box.
//
// The strip rendered as a list item -- same width, same borders, directly above
// the first session row -- shifted the list when it appeared, and only existed
// once the user had already found the drag gesture. A header control is present
// before that and costs no vertical space in a pane that scrolls.
//
// THE TICK EXISTS BECAUSE OF A QUESTION. Looking at the built menu, Justine
// asked: "if I change sort to sort by name, how do I go back?" The answer was
// already "Date saved" -- it deletes every rank -- but three items read as
// three equal choices and nothing said which order was active. Having to ask
// is the defect; the tick is the fix.

const HOUR = 3600_000;
const T0 = Date.UTC(2026, 8, 9, 12, 0, 0);

const session = (
  id: string,
  title: string,
  createdAt: number,
  tabCount = 1
) => ({
  tabGroupId: id,
  title,
  createdTime: '2026-09-09 12:00:00',
  createdAt,
  windowCount: 1,
  tabCount,
  isAutoSave: false,
  isSelected: false,
  windows: [
    {
      windowId: `${id}-w`,
      windowHeight: 100,
      windowWidth: 100,
      windowOffsetTop: 0,
      windowOffsetLeft: 0,
      tabCount,
      title: 'Window',
      tabs: Array.from({ length: tabCount }, (_, i) => ({
        tabId: `${id}-t${i}`,
        favicon: '',
        title: 'Tab',
        url: 'https://a.co',
      })),
    },
  ],
});

const render = () =>
  renderWithProviders(<MenuContainer />, {
    seedStore: (store) => {
      store.dispatch(
        saveToTabContainerInternal(session('c', 'Cherry', T0 - 2 * HOUR, 9))
      );
      store.dispatch(
        saveToTabContainerInternal(session('a', 'apple', T0 - HOUR, 2))
      );
      store.dispatch(saveToTabContainerInternal(session('b', 'Banana', T0, 5)));
    },
  });

// Addressed by ROLE, not by label alone: the open menu carries the same
// "Sort sessions" name as its trigger (that is what lets the items be one word
// each), so getByLabelText matches two elements and throws the moment this is
// called while the menu is open.
const openMenu = () =>
  fireEvent.click(screen.getByRole('button', { name: 'Sort sessions' }));

const item = (label: string) =>
  screen.getByRole('menuitemradio', { name: label });

const titles = (store: RenderWithProvidersResult['store']) =>
  store.getState().tabContainerDataState.tabGroups.map((g) => g.title);

describe('the sort menu', () => {
  test('offers the four orders', async () => {
    await render();
    openMenu();

    // `item` resolves by ACCESSIBLE NAME, which is the assertion worth making:
    // each row also holds two aria-hidden ligature spans (the leading icon and
    // the tick), so its textContent is "scheduleDate savedcheck" and a
    // substring match on that would pass for a label the tree never exposed.
    expect(screen.getAllByRole('menuitemradio')).toHaveLength(4);
    ['Date saved', 'Name', 'Tab count', 'Date modified'].forEach((label) => {
      expect(item(label)).toBeInTheDocument();
    });
  });

  // What licenses the one-word items. "Name" and "Tab count" say nothing on
  // their own; they are only unambiguous because the menu containing them
  // announces what is being sorted. Drop this name and the labels become a
  // riddle for anyone who cannot see the trigger they came from.
  test('the menu carries the name the terse items borrow', async () => {
    await render();
    openMenu();

    expect(
      screen.getByRole('menu', { name: 'Sort sessions' })
    ).toBeInTheDocument();
  });

  test('sorting by name reorders the list', async () => {
    const { store } = await render();
    expect(titles(store)).toEqual(['Banana', 'apple', 'Cherry']);

    openMenu();
    fireEvent.click(item('Name'));

    expect(titles(store)).toEqual(['apple', 'Banana', 'Cherry']);
  });

  test('sorting by tab count puts the largest first', async () => {
    const { store } = await render();

    openMenu();
    fireEvent.click(item('Tab count'));

    expect(titles(store)).toEqual(['Cherry', 'Banana', 'apple']);
  });

  // Distinguished from "date saved" by EDITING the oldest session: it stays
  // oldest by creation and becomes newest by content, so the two orders
  // disagree and only one of them puts Cherry first. Wiring this item to any
  // other key leaves Cherry last, where the seeded order already had it.
  //
  // Only the first position is asserted. The other two are saved in the same
  // tick, so their contentModified values may be equal and their relative
  // order is a tie the reducer is not being asked to break.
  test('sorting by date modified puts the recently edited session first', async () => {
    const { store } = await render();
    store.dispatch(
      updateTabGroupTitle({ tabGroupId: 'c', editableTitle: 'Cherry' })
    );
    expect(titles(store)[2]).toBe('Cherry');

    openMenu();
    fireEvent.click(item('Date modified'));

    expect(titles(store)[0]).toBe('Cherry');
  });

  // The way back, which is the whole question that produced the tick.
  test('sorting by date saved returns to the default order', async () => {
    const { store } = await render();
    openMenu();
    fireEvent.click(item('Name'));
    expect(titles(store)).toEqual(['apple', 'Banana', 'Cherry']);

    openMenu();
    fireEvent.click(item('Date saved'));

    expect(titles(store)).toEqual(['Banana', 'apple', 'Cherry']);
  });
});

describe('the tick says which order you are in', () => {
  // Asserted through aria-checked, not the glyph. The tick is decorative and
  // aria-hidden, so a screen reader learns the state from the role -- and a
  // test reading the glyph would pass against a menu that never announced it
  // (KAN-56).
  test('the default order is checked when nothing has been rearranged', async () => {
    await render();
    openMenu();

    expect(item('Date saved')).toHaveAttribute('aria-checked', 'true');
    expect(item('Name')).toHaveAttribute('aria-checked', 'false');
  });

  test('nothing is checked once the list is rearranged', async () => {
    const { store } = await render();
    store.dispatch(moveSessionInternal({ tabGroupId: 'c', toIndex: 0 }));

    openMenu();

    expect(item('Date saved')).toHaveAttribute('aria-checked', 'false');
    screen.getAllByRole('menuitemradio').forEach((el) => {
      expect(el).toHaveAttribute('aria-checked', 'false');
    });
  });

  test('and it comes back after sorting by date saved', async () => {
    const { store } = await render();
    store.dispatch(moveSessionInternal({ tabGroupId: 'c', toIndex: 0 }));

    openMenu();
    fireEvent.click(item('Date saved'));
    openMenu();

    expect(item('Date saved')).toHaveAttribute('aria-checked', 'true');
  });

  // The control for the radio semantics -- a menu of plain commands must NOT
  // claim to report a selection -- is not here. It is overflowMenu.test.tsx,
  // which drives the row action menu and asserts `menuitem` throughout;
  // hard-coding isRadioGroup to true fails 11 of its tests. Repeating it
  // against this menu would prove nothing, because this menu is a radio group.
});
