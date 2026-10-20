import { afterEach, describe, expect, test } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import WindowEntryContainer from '../../components/home/rightpane/WindowEntryContainer';
import RightPane from '../../components/home/rightpane/RightPane';
import { renderWithProviders } from '../setup/renderWithProviders';
import {
  setHasTabGroupsPermission,
  setSearchInputText,
} from '../../redux/slices/globalStateSlice';
import {
  saveToTabContainerInternal,
  selectTabContainer,
  type tabData,
} from '../../redux/slices/tabContainerDataStateSlice';
import { buildSession } from '../fixtures/sessionFixture';
import { classRulesFor } from '../setup/hoverRules';

// KAN-720. The saved pane's window and group rows say how many tabs they draw.
afterEach(() => localStorage.clear());

const tab = (
  tabId: string,
  title: string,
  chromeGroupId?: string
): tabData => ({
  tabId,
  favicon: '',
  title,
  url: `https://${tabId}.test`,
  ...(chromeGroupId ? { chromeGroupId } : {}),
});

const GROUPED = [
  tab('t1', 'Loose'),
  tab('t2', 'Paper', 'g1'),
  tab('t3', 'Notes', 'g1'),
];

async function renderWindow(
  tabs: tabData[],
  { hasTabGroupsPermission = true }: { hasTabGroupsPermission?: boolean } = {}
) {
  return renderWithProviders(
    <WindowEntryContainer
      number={1}
      title="Window 1"
      tabGroupId="tg1"
      windowId="w1"
      tabs={tabs}
      chromeTabGroups={[{ groupId: 'g1', title: 'Research', color: 'blue' }]}
      onOpenWindow={() => undefined}
      onUpdateWindowGroupTitle={() => undefined}
      onAddCurrTabToWindowClick={() => undefined}
      onDeleteClick={() => undefined}
    />,
    {
      seedStore: (store) => {
        store.dispatch(setHasTabGroupsPermission(hasTabGroupsPermission));
      },
    }
  );
}

const tagsIn = (el: Element) =>
  Array.from(el.querySelectorAll('[data-row-tag]')).map((n) => n.textContent);

async function renderSearch(term: string) {
  const session = buildSession({
    isSelected: true,
    windows: [
      {
        windowId: 'win-1',
        windowHeight: 1080,
        windowWidth: 1920,
        windowOffsetTop: 0,
        windowOffsetLeft: 0,
        tabCount: 5,
        title: 'Morning reading',
        tabs: [
          tab('a1', 'Kagi Search'),
          tab('a2', 'Loose page'),
          tab('a3', 'Other page', 'g1'),
          tab('a4', 'Another page', 'g1'),
          tab('a5', 'Third item', 'g1'),
        ],
        chromeTabGroups: [{ groupId: 'g1', title: 'Research', color: 'blue' }],
      },
    ],
  });
  return renderWithProviders(<RightPane />, {
    seedStore: (store) => {
      store.dispatch(setHasTabGroupsPermission(true));
      store.dispatch(saveToTabContainerInternal(session));
      store.dispatch(selectTabContainer(session.tabGroupId));
      store.dispatch(setSearchInputText(term));
    },
  });
}

describe('saved window and group rows tag their tab count', () => {
  test('a window row tags its tab count after the title', async () => {
    const { container } = await renderWindow([
      tab('t1', 'One'),
      tab('t2', 'Two'),
      tab('t3', 'Three'),
    ]);
    const tags = container.querySelectorAll('[data-row-tag]');
    expect(tags).toHaveLength(1);
    expect(tags[0]).toHaveTextContent('3 Tabs');
    const titleButton = screen.getByRole('button', { name: /Rename window/ });
    expect(titleButton.contains(tags[0])).toBe(false);
    expect(tags[0].closest('button')).toBeNull();
  });

  test('a group row tags the tabs in its group; the window counts them all', async () => {
    const { container } = await renderWindow(GROUPED);
    const group = screen.getByRole('group', { name: 'Research' });
    expect(tagsIn(group)).toEqual(['2 Tabs']);
    expect(tagsIn(container)).toEqual(['3 Tabs', '2 Tabs']);
  });

  test('each tag keeps 9px clear of the row edge, and the title gives it only the 8px gap', async () => {
    const { container } = await renderWindow(GROUPED);
    const tags = container.querySelectorAll('[data-row-tag]');
    expect(tags).toHaveLength(2);
    tags.forEach((tag) => {
      expect(getComputedStyle(tag.parentElement!).paddingRight).toBe('9px');
      expect(getComputedStyle(tag).marginLeft).toBe('8px');
    });
    const windowTitle = screen.getByRole('button', {
      name: 'Rename window: Window 1',
    });
    expect(getComputedStyle(windowTitle).paddingRight).toBe('0px');
  });

  test('the window title, only as wide as its text, draws its ring outside and its ghost past the text', async () => {
    await renderWindow(GROUPED);
    const rules = classRulesFor(
      screen.getByRole('button', { name: 'Rename window: Window 1' })
    );
    // The default inset ring is in the sheet too; the last rule is the one that wins.
    const offsets = [...rules.matchAll(/outline-offset:\s*(-?\d+px)/g)];
    expect(offsets[offsets.length - 1]?.[1]).toBe('2px');
    expect(rules).toMatch(/::before[^}]*right:\s*-4px/);
  });

  test('a one-tab window says "1 Tab"', async () => {
    const { container } = await renderWindow([tab('t1', 'Only')]);
    expect(tagsIn(container)).toEqual(['1 Tab']);
  });

  test('a group row hides its tag while the group is being renamed, and shows it again after', async () => {
    const user = userEvent.setup();
    const { container } = await renderWindow(GROUPED);
    expect(tagsIn(container)).toEqual(['3 Tabs', '2 Tabs']);
    await user.click(
      screen.getByRole('button', { name: 'Rename group: Research' })
    );
    await screen.findByRole('textbox', { name: 'Rename group: Research' });
    expect(tagsIn(container)).toEqual(['3 Tabs']);
    await user.keyboard('{Escape}');
    expect(tagsIn(container)).toEqual(['3 Tabs', '2 Tabs']);
  });

  test('without the tab-groups permission there is no group tag, and the window still counts every tab', async () => {
    const { container } = await renderWindow(GROUPED, {
      hasTabGroupsPermission: false,
    });
    expect(tagsIn(container)).toEqual(['3 Tabs']);
  });

  test('during a search a window counts only its matching tabs', async () => {
    const { container } = await renderSearch('kagi');
    await screen.findByText('Kagi Search');
    expect(tagsIn(container)).toEqual(['1 Tab']);
  });

  test('a window whose title matches the search counts all its tabs', async () => {
    const { container } = await renderSearch('morning');
    await screen.findByText('Kagi Search');
    expect(tagsIn(container)).toEqual(['5 Tabs', '3 Tabs']);
  });

  test('during a search a group counts only its matching tabs', async () => {
    const { container } = await renderSearch('page');
    await screen.findByText('Other page');
    expect(tagsIn(container)).toEqual(['3 Tabs', '2 Tabs']);
  });
});
