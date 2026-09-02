import { describe, expect, test } from 'vitest';
import { act, screen } from '@testing-library/react';

import Button from '../../components/common/Button';
import Icon from '../../components/common/Icon';
import MenuContainer from '../../components/home/leftpane/MenuContainer';
import TabGroupEntry from '../../components/home/leftpane/TabGroupEntry';
import { renderWithProviders } from '../setup/renderWithProviders';
import { setSyncStatus } from '../../redux/slices/globalStateSlice';
import { tabContainerData } from '../../redux/slices/tabContainerDataStateSlice';

// KAN-67 and KAN-68 are one defect wearing two prop names. Both `Button`'s
// `focusableButton` and `Icon`'s `focusable` computed a tabIndex that could
// only ever SUBTRACT the focusability the platform already grants, and both
// were driven by something that has nothing to do with the keyboard --
// `focusableButton` by nothing at all (it had no default, so 32 of 36 call
// sites silently opted out), `focusable` by mouse-hover state.
//
// jsdom is the right oracle for this file, unlike the accessible-name
// assertions in e2e/a11y-controls.spec.ts. `tabindex` is a plain DOM
// attribute that jsdom reflects faithfully; an accessible NAME is a computed
// property that dom-accessibility-api gets wrong. The distinction is why the
// name assertions live in Playwright and these do not.
//
// KAN-66 rides along: `disable` set no `aria-disabled`, so a disabled control
// announced as enabled. It is fixed here by adding the state rather than by
// removing focus -- see the comment on that test.

const TAB_ORDER_EXCLUDED = '-1';

const tabIndexOf = (el: HTMLElement) => el.getAttribute('tabindex');

const SESSION: tabContainerData = {
  tabGroupId: 'session-1',
  title: 'Research',
  createdTime: '01/01/2026, 10:00:00',
  createdAt: 1767261600000,
  windowCount: 1,
  tabCount: 2,
  isAutoSave: false,
  isSelected: false,
  windows: [],
};

const noop = () => {};

describe('enabled controls are reachable by keyboard', () => {
  // The control for every assertion below. It proves these queries can still
  // OBSERVE tabindex="-1" when it is genuinely present -- without it, a suite
  // of "is not -1" assertions would pass just as happily against a harness
  // that had stopped rendering tabindex at all.
  //
  // A presentational Icon is the right control because it is deliberately
  // outside the tab order both before and after this change: with no onClick
  // there is nothing to activate.
  test('CONTROL: a presentational Icon stays outside the tab order', async () => {
    const { container } = await renderWithProviders(<Icon type="web_asset" />);

    const icon = container.firstElementChild as HTMLElement;
    expect(tabIndexOf(icon)).toBe(TAB_ORDER_EXCLUDED);
  });

  test('a Button with an onClick is in the tab order (KAN-67)', async () => {
    await renderWithProviders(<Button text="Delete all data" onClick={noop} />);

    const button = screen.getByRole('button', { name: 'Delete all data' });
    expect(tabIndexOf(button)).not.toBe(TAB_ORDER_EXCLUDED);
  });

  // The eight controls of KAN-68 were gated on mouse-hover state. This
  // renders the row and never hovers it, which is exactly the situation a
  // keyboard user is in.
  test('session row actions are in the tab order without hover (KAN-68)', async () => {
    await renderWithProviders(
      <TabGroupEntry
        tabGroupData={SESSION}
        onTabGroupClick={noop}
        onOpenAllClick={noop}
        onFocusClick={noop}
        onDeleteClick={noop}
      />
    );

    for (const name of ['Open', 'Switch', 'Delete']) {
      const control = screen.getByRole('button', { name });
      expect(tabIndexOf(control), name).not.toBe(TAB_ORDER_EXCLUDED);
    }
  });

  // KAN-66. The fix ADDS aria-disabled rather than removing the control from
  // the tab order, against the ticket's stated direction. The sync icon
  // disables while you are operating it: press Enter, sync starts, `disable`
  // flips true. Taking it out of the tab order at that instant would drop
  // focus to <body> and lose the user's place -- the keyboard equivalent of
  // the re-entrancy KAN-63 closed. aria-disabled fixes the false "enabled"
  // announcement without the focus loss.
  test('a disabled Icon announces its state and keeps focus (KAN-66)', async () => {
    const { store } = await renderWithProviders(<MenuContainer />);

    await act(async () => {
      store.dispatch(setSyncStatus('loading'));
    });

    const sync = screen.getByRole('button', { name: 'Sync now' });
    expect(sync).toHaveAttribute('aria-disabled', 'true');
    expect(tabIndexOf(sync)).not.toBe(TAB_ORDER_EXCLUDED);
  });

  // Paired with the assertion above: the same icon must NOT claim to be
  // disabled when it is not. Without this, setting aria-disabled
  // unconditionally would pass the test above.
  test('an enabled Icon does not claim to be disabled (KAN-66)', async () => {
    await renderWithProviders(<MenuContainer />);

    const sync = screen.getByRole('button', { name: 'Sync now' });
    expect(sync).not.toHaveAttribute('aria-disabled');
  });
});
