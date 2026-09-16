import { describe, expect, test } from 'vitest';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import HeroContainerRight from '../../components/home/rightpane/HeroContainerRight';
import { renderWithProviders } from '../setup/renderWithProviders';
import { hoverRulesFor } from '../setup/hoverRules';
import { LIGHT_THEME } from '../../hooks/useThemeColors';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';
import {
  replaceState,
  selectTabContainer,
} from '../../redux/slices/tabContainerDataStateSlice';
import { undo } from '../../redux/slices/undoRedoSlice';

// KAN-193. The session header had four icons: Open, Switch, Export, Delete.
// The export icon was a download arrow, chosen when a click was going to
// download directly -- and then the flow changed to open a preview tab, so
// the icon promised something that no longer happened. Delete sat beside the
// two everyday actions, one mis-click away.
//
// Now: Open, Switch, and a More actions menu holding Export and Delete. A
// menu item carries words, so it cannot be misread the way a bare glyph was.
//
// The export item opens a tab and then does NOTHING, which is not a style
// choice. A tab taking focus destroys the popup, so work sequenced after
// `chrome.tabs.create` races a context Chrome has already torn down -- the
// KAN-122 class of bug, invisible here and to the e2e harness, which drives
// the popup as a tab that does not die.

const SESSION = buildSession({
  tabGroupId: 'session-kyoto',
  title: 'Weekend in Kyoto',
});

const renderHeader = () =>
  renderWithProviders(<HeroContainerRight />, {
    seedStore: (store) => {
      store.dispatch(replaceState(buildContainer([SESSION])));
      store.dispatch(selectTabContainer('session-kyoto'));
    },
  });

const openMenu = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('button', { name: 'More actions' }));
  return screen.getByRole('menu');
};

describe('the session header keeps two actions and a menu (KAN-193)', () => {
  test('the header offers Open, Switch and More actions, and no loose export or delete icon', async () => {
    await renderHeader();

    expect(screen.getByRole('button', { name: 'More actions' })).toBeTruthy();
    // The two actions that moved are gone from the header itself -- a copy
    // left behind would make the menu decoration.
    expect(
      screen.queryByRole('button', { name: 'Export as PDF / HTML file' })
    ).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete session' })).toBeNull();
  });

  test('the menu holds exactly Export, then Delete', async () => {
    const user = userEvent.setup();
    await renderHeader();

    const menu = await openMenu(user);

    // By accessible name, not textContent: each item's decorative glyph is a
    // ligature ("file_export"), so the raw text is not what anyone hears.
    // Found by name, then compared to the menu's own order.
    const items = within(menu).getAllByRole('menuitem');
    expect(items).toHaveLength(2);
    expect(items).toEqual([
      within(menu).getByRole('menuitem', { name: 'Export as PDF / HTML file' }),
      within(menu).getByRole('menuitem', { name: 'Delete session' }),
    ]);
  });

  test('Export opens the export page for THAT session', async () => {
    const user = userEvent.setup();
    const { chrome } = await renderHeader();

    await openMenu(user);
    await user.click(
      screen.getByRole('menuitem', { name: 'Export as PDF / HTML file' })
    );

    expect(chrome.createdTabs).toHaveLength(1);
    expect(chrome.createdTabs[0].url).toContain('export.html');
    expect(chrome.createdTabs[0].url).toContain('session=session-kyoto');
  });

  // CONTROL: the id in the URL is the SELECTED session, not the first one in
  // the list. With one session seeded, "the first" and "the selected" are the
  // same string and a hardcoded index would pass.
  test('Export is for the selected session, not the first one', async () => {
    const user = userEvent.setup();
    const { chrome } = await renderWithProviders(<HeroContainerRight />, {
      seedStore: (store) => {
        store.dispatch(
          replaceState(
            buildContainer([
              buildSession({ tabGroupId: 'session-first', title: 'First' }),
              SESSION,
            ])
          )
        );
        store.dispatch(selectTabContainer('session-kyoto'));
      },
    });

    await openMenu(user);
    await user.click(
      screen.getByRole('menuitem', { name: 'Export as PDF / HTML file' })
    );

    expect(chrome.createdTabs[0].url).toContain('session=session-kyoto');
    expect(chrome.createdTabs[0].url).not.toContain('session-first');
  });

  test('Delete removes the selected session', async () => {
    const user = userEvent.setup();
    const { store } = await renderHeader();

    await openMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'Delete session' }));

    expect(
      store
        .getState()
        .tabContainerDataState.tabGroups.map((group) => group.tabGroupId)
    ).not.toContain('session-kyoto');
  });

  // Moving Delete behind a menu is safe only because deleting is recoverable:
  // DELETE_TAB_CONTAINER_ACTION is one of the middleware's captured actions.
  // If that ever stopped being true, this is what would say so.
  test('a session deleted from the menu comes back with Undo', async () => {
    const user = userEvent.setup();
    const { store } = await renderHeader();

    await openMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'Delete session' }));
    const ids = () =>
      store
        .getState()
        .tabContainerDataState.tabGroups.map((group) => group.tabGroupId);
    expect(ids()).not.toContain('session-kyoto');

    act(() => {
      store.dispatch(undo());
    });

    expect(ids()).toContain('session-kyoto');
  });

  // Delete is the one destructive item, and it has to look like it. In this
  // menu that is a delete-coloured FILL on hover, the same as every other
  // danger item (overflowMenu.test.tsx holds the menu to that). What this
  // holds is the header's choice: Delete is marked danger, Export is not.
  //
  // The first version compared the glyphs' colour at rest -- both are the
  // text colour, because danger styling was never a resting colour. It failed
  // for the wrong reason, which is why it is asserted on the hover rule now.
  test('Delete is marked as the dangerous item, and Export is not', async () => {
    const user = userEvent.setup();
    await renderHeader();

    await openMenu(user);
    // Derived from the token, not pinned: KAN-204 changed this value in four
    // of the five themes, and the literal that used to sit here went stale
    // without failing until the theme moved under it. jsdom normalises the hex
    // emotion was given to rgb(), so both forms are accepted.
    const fill = LIGHT_THEME.DELETE_ICON_HOVER_COLOR;
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(fill.slice(i, i + 2), 16));
    const DELETE_FILL = new RegExp(
      `background-color:\\s*(${fill}|rgb\\(${r}, ?${g}, ?${b}\\))`,
      'i'
    );

    expect(
      hoverRulesFor(screen.getByRole('menuitem', { name: 'Delete session' }))
    ).toMatch(DELETE_FILL);
    expect(
      hoverRulesFor(
        screen.getByRole('menuitem', { name: 'Export as PDF / HTML file' })
      )
    ).not.toMatch(DELETE_FILL);
  });
});
