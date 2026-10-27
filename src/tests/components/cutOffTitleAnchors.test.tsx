import { describe, expect, test } from 'vitest';
import { screen } from '@testing-library/react';

import WindowEntryContainer from '../../components/home/rightpane/WindowEntryContainer';
import HeroContainerRight from '../../components/home/rightpane/HeroContainerRight';
import TabGroupEntry from '../../components/home/leftpane/TabGroupEntry';
import OpenNowColumn from '../../components/home/opennow/OpenNowColumn';
import {
  renderWithProviders,
  type RenderWithProvidersResult,
} from '../setup/renderWithProviders';
import {
  runShownHere,
  setHasTabGroupsPermission,
} from '../../redux/slices/globalStateSlice';
import { recordFirstRun } from '../../redux/slices/settingsDataStateSlice';
import { newRun } from '../../utils/functions/firstRun';
import {
  replaceState,
  type chromeTabGroupData,
  type tabData,
} from '../../redux/slices/tabContainerDataStateSlice';
import { buildSession } from '../fixtures/sessionFixture';

// KAN-825. Which controls carry a title as their tooltip, so the layer can show
// it when the title is cut off. Whether it shows is the layer's (tooltipLayer,
// textCutOff) and the real layout's (e2e cut-off-titles).

const TABS: tabData[] = [
  {
    tabId: 'plain',
    favicon: '',
    title: 'Kagi Search',
    url: 'https://kagi.com/',
  },
  {
    tabId: 'renamed',
    favicon: '',
    title: 'Example Domain',
    customTitle: 'Reading list',
    url: 'https://example.com/',
  },
  {
    tabId: 'grouped',
    favicon: '',
    title: 'Docs',
    url: 'https://docs.test/',
    chromeGroupId: 'g1',
  },
  {
    tabId: 'unnamed',
    favicon: '',
    title: 'Loose',
    url: 'https://loose.test/',
    chromeGroupId: 'g2',
  },
];
const GROUPS: chromeTabGroupData[] = [
  { groupId: 'g1', title: 'Papers for the reading group', color: 'blue' },
  { groupId: 'g2', title: '', color: 'red' },
];

const tourHere = (store: RenderWithProvidersResult['store']) => {
  store.dispatch(
    recordFirstRun({ ...newRun('popup', 6), sessionId: 'sample:x' })
  );
  store.dispatch(runShownHere());
};

async function renderWindow({ tabGroupId = 'tg1', tour = false } = {}) {
  return renderWithProviders(
    <WindowEntryContainer
      number={1}
      title="Weekend trip to Bergen"
      tabGroupId={tabGroupId}
      windowId="w1"
      tabs={TABS}
      chromeTabGroups={GROUPS}
      onOpenWindow={() => undefined}
      onUpdateWindowGroupTitle={() => undefined}
      onAddCurrTabToWindowClick={() => undefined}
      onDeleteClick={() => undefined}
    />,
    {
      seedStore: (store) => {
        store.dispatch(setHasTabGroupsPermission(true));
        if (tour) tourHere(store);
      },
    }
  );
}

describe('saved window rows', () => {
  test('the saved window title button carries the window name, unannounced', async () => {
    await renderWindow();
    const button = screen.getByRole('button', {
      name: 'Rename window: Weekend trip to Bergen',
    });
    expect(button).toHaveAttribute('data-tooltip', 'Weekend trip to Bergen');
    expect(button).toHaveAccessibleDescription('');
  });

  test('a saved group title button carries the group name, unannounced', async () => {
    await renderWindow();
    const button = screen.getByRole('button', {
      name: 'Rename group: Papers for the reading group',
    });
    expect(button).toHaveAttribute(
      'data-tooltip',
      'Papers for the reading group'
    );
    expect(button).toHaveAccessibleDescription('');
  });

  test("an unnamed group's title button carries the placeholder", async () => {
    await renderWindow();
    const button = screen.getByRole('button', {
      name: /^Rename group: (?!Papers)/,
    });
    const drawn = button.textContent?.trim();
    expect(drawn).toBeTruthy();
    expect(button).toHaveAttribute('data-tooltip', drawn);
  });

  test('a saved tab row leads with its shown title', async () => {
    await renderWindow();
    const plain = screen.getByRole('button', {
      name: 'Open in new tab: Kagi Search',
    });
    expect(plain).toHaveAttribute('data-tooltip-lead', 'Kagi Search');
    expect(plain).toHaveAttribute('data-tooltip', 'https://kagi.com/');

    const renamed = screen.getByRole('button', {
      name: 'Open in new tab: Reading list',
    });
    expect(renamed).toHaveAttribute('data-tooltip-lead', 'Reading list');
    expect(renamed).toHaveAttribute(
      'data-tooltip',
      'Example Domain\nhttps://example.com/'
    );
  });

  test('a tour-blocked tab has no lead', async () => {
    await renderWindow({ tabGroupId: 'sample:x', tour: true });
    const tab = screen.getByRole('button', {
      name: 'Open in new tab: Kagi Search',
    });
    expect(tab).toHaveAttribute('aria-disabled', 'true');
    expect(tab).not.toHaveAttribute('data-tooltip-lead');
  });
});

describe('Currently open rows', () => {
  async function renderOpenNow() {
    await renderWithProviders(<OpenNowColumn folded={true} />, {
      seed: {
        grantedPermissions: ['tabGroups'],
        windows: [
          {
            id: 1,
            focused: true,
            tabs: [
              {
                id: 11,
                title: 'Kagi Search',
                url: 'https://kagi.com/',
                active: true,
              },
              {
                id: 12,
                title: 'Docs',
                url: 'https://docs.test/',
                groupId: 50,
              },
            ],
          },
        ],
        tabGroups: [
          {
            id: 50,
            windowId: 1,
            title: 'Papers for the reading group',
            color: 'blue',
          },
        ],
      },
      seedStore: (store) => {
        store.dispatch(setHasTabGroupsPermission(true));
      },
    });
    await screen.findAllByRole('button', { name: /^Switch to tab: / });
  }

  test('an Open now group title button carries the group name, unannounced', async () => {
    await renderOpenNow();
    const button = await screen.findByRole('button', {
      name: 'Rename group: Papers for the reading group',
    });
    expect(button).toHaveAttribute(
      'data-tooltip',
      'Papers for the reading group'
    );
    expect(button).toHaveAccessibleDescription('');
  });

  test('an Open now tab row leads with its title', async () => {
    await renderOpenNow();
    const tab = screen.getByRole('button', {
      name: 'Switch to tab: Kagi Search',
    });
    expect(tab).toHaveAttribute('data-tooltip-lead', 'Kagi Search');
    expect(tab).toHaveAttribute('data-tooltip', 'https://kagi.com/');
  });
});

describe('session titles', () => {
  test("the session title's rename button carries the title; the label inside does not", async () => {
    await renderWithProviders(<HeroContainerRight />, {
      seedStore: (store) => {
        store.dispatch(
          replaceState({
            lastModified: 1,
            selectedTabGroupId: 'session-1',
            tabGroups: [buildSession({ isSelected: true })],
          })
        );
      },
    });
    const button = await screen.findByRole('button', {
      name: 'Rename session: Research',
    });
    expect(button).toHaveAttribute('data-tooltip', 'Research');
    expect(button).toHaveAccessibleDescription('');
    expect(button.querySelectorAll('[data-tooltip]')).toHaveLength(0);
  });

  test('the session list row keeps its title tooltip on the label', async () => {
    await renderWithProviders(
      <TabGroupEntry
        tabGroupData={buildSession()}
        onTabGroupClick={() => undefined}
        onOpenAllClick={() => undefined}
        onFocusClick={() => undefined}
        onReplaceClick={() => undefined}
        onDeleteKey={() => undefined}
        deleteKeyShortcuts="Delete Backspace"
      />
    );
    const labels = document.querySelectorAll('[data-tooltip="Research"]');
    expect(labels).toHaveLength(1);
    expect(labels[0].tagName).not.toBe('BUTTON');
  });
});
