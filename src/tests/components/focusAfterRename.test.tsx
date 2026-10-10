import { describe, expect, test } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import HeroContainerRight from '../../components/home/rightpane/HeroContainerRight';
import TabGroupDetailsContainer from '../../components/home/rightpane/TabGroupDetailsContainer';
import { renderWithProviders } from '../setup/renderWithProviders';
import { setHasTabGroupsPermission } from '../../redux/slices/globalStateSlice';
import {
  saveToTabContainerInternal,
  selectTabContainer,
} from '../../redux/slices/tabContainerDataStateSlice';

// KAN-389, KAN-400. Enter or Esc ends a rename on the title button it replaced, not on the page.
async function renderSession() {
  const user = userEvent.setup();
  await renderWithProviders(
    <>
      <HeroContainerRight />
      <TabGroupDetailsContainer />
      <button type="button">Elsewhere</button>
    </>,
    {
      seedStore: (store) => {
        store.dispatch(setHasTabGroupsPermission(true));
        store.dispatch(
          saveToTabContainerInternal({
            tabGroupId: 's1',
            title: 'Research',
            createdTime: '2026-10-10 09:00:00',
            createdAt: Date.UTC(2026, 9, 10, 9),
            windowCount: 1,
            tabCount: 2,
            isAutoSave: false,
            isSelected: false,
            windows: [
              {
                windowId: 'w1',
                windowHeight: 1080,
                windowWidth: 1920,
                windowOffsetTop: 0,
                windowOffsetLeft: 0,
                tabCount: 2,
                title: 'Morning',
                tabs: [
                  {
                    tabId: 't1',
                    favicon: '',
                    title: 'Inbox',
                    url: 'https://a.test/',
                    chromeGroupId: 'g1',
                  },
                  {
                    tabId: 't2',
                    favicon: '',
                    title: 'Maps',
                    url: 'https://b.test/',
                  },
                ],
                chromeTabGroups: [
                  { groupId: 'g1', title: 'Mail', color: 'blue' },
                ],
              },
            ],
          })
        );
        store.dispatch(selectTabContainer('s1'));
      },
    }
  );
  return user;
}

const titleButton = (name: string) => screen.findByRole('button', { name });

const RENAMES = [
  ['session', 'Rename session: Research', 'Rename session: '],
  ['window', 'Rename window: Morning', 'Rename window: '],
  ['group', 'Rename group: Mail', 'Rename group: '],
] as const;

describe.each(RENAMES)('a %s rename', (_kind, opener, renamed) => {
  test('Enter commits and leaves focus on the renamed title', async () => {
    const user = await renderSession();
    await user.click(await titleButton(opener));
    await user.keyboard('{Control>}a{/Control}Renamed{Enter}');

    expect(document.activeElement).toBe(await titleButton(renamed + 'Renamed'));
  });

  test('Esc cancels and leaves focus on the title', async () => {
    const user = await renderSession();
    await user.click(await titleButton(opener));
    await user.keyboard('Draft{Escape}');

    expect(document.activeElement).toBe(await titleButton(opener));
  });

  test('the tick saves and leaves focus on the renamed title', async () => {
    const user = await renderSession();
    await user.click(await titleButton(opener));
    await user.keyboard('{Control>}a{/Control}Renamed');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(document.activeElement).toBe(await titleButton(renamed + 'Renamed'));
  });

  test('a click elsewhere commits and leaves focus where it went', async () => {
    const user = await renderSession();
    await user.click(await titleButton(opener));
    const elsewhere = await titleButton('Elsewhere');
    await user.click(elsewhere);

    expect(document.activeElement).toBe(elsewhere);
  });
});

test('the pencil opens a session rename that Enter ends on the title', async () => {
  const user = await renderSession();
  await user.click(
    await screen.findByRole('button', { name: 'Rename session' })
  );
  await user.keyboard('{Enter}');

  expect(document.activeElement).toBe(
    await titleButton('Rename session: Research')
  );
});
