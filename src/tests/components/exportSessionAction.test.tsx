import { describe, expect, test } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import HeroContainerRight from '../../components/home/rightpane/HeroContainerRight';
import { renderWithProviders } from '../setup/renderWithProviders';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';
import {
  replaceState,
  selectTabContainer,
} from '../../redux/slices/tabContainerDataStateSlice';

// KAN-190. The control that starts an export: one icon in the session header,
// beside the other whole-session actions.
//
// It opens a tab and then does NOTHING, which is not a style choice. A tab
// taking focus destroys the popup, so any work sequenced after
// `chrome.tabs.create` is racing a context Chrome has already torn down --
// the KAN-122 class of bug, invisible to this test and to the e2e harness
// (which drives the popup as a tab that does not die). Asserting the tab is
// created with the whole address, rather than assembled afterwards, is what
// keeps that shape.

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

describe('exporting the selected session (KAN-190)', () => {
  test('the header offers an export control, named in the user language', async () => {
    await renderHeader();

    expect(
      screen.getByRole('button', { name: 'Save this session as a web page' })
    ).toBeTruthy();
  });

  test('clicking it opens the export page for THAT session', async () => {
    const user = userEvent.setup();
    const { chrome } = await renderHeader();

    await user.click(
      screen.getByRole('button', { name: 'Save this session as a web page' })
    );

    expect(chrome.createdTabs).toHaveLength(1);
    expect(chrome.createdTabs[0].url).toContain('export.html');
    expect(chrome.createdTabs[0].url).toContain('session=session-kyoto');
  });

  // CONTROL: the id in the URL is the SELECTED session, not the first one in
  // the list. With one session seeded, "the first" and "the selected" are the
  // same string and a hardcoded index would pass.
  test('the page is opened for the selected session, not the first one', async () => {
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

    await user.click(
      screen.getByRole('button', { name: 'Save this session as a web page' })
    );

    expect(chrome.createdTabs[0].url).toContain('session=session-kyoto');
    expect(chrome.createdTabs[0].url).not.toContain('session-first');
  });
});
