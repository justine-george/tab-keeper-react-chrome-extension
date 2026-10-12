import { describe, expect, test } from 'vitest';
import { act, screen } from '@testing-library/react';

import MenuContainer from '../../components/home/leftpane/MenuContainer';
import { renderWithProviders } from '../setup/renderWithProviders';
import {
  setSignedIn,
  setSyncStatus,
} from '../../redux/slices/globalStateSlice';

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

describe('enabled controls are reachable by keyboard', () => {
  // The control for every assertion below. It proves these queries can still
  // OBSERVE tabindex="-1" when it is genuinely present -- without it, a suite
  // of "is not -1" assertions would pass just as happily against a harness
  // that had stopped rendering tabindex at all.
  //
  // A plain element with tabIndex={-1}, rendered through the same harness. It
  // used to be a presentational Icon, until KAN-318 took the Icon's tabindex
  // away altogether.
  test('CONTROL: the harness shows a tabindex of -1 that is really there', async () => {
    const { container } = await renderWithProviders(<div tabIndex={-1} />);

    const control = container.firstElementChild;
    expect(control).toBeInstanceOf(HTMLElement);
    expect(control?.getAttribute('tabindex')).toBe(TAB_ORDER_EXCLUDED);
  });

  // KAN-66. The fix ADDS aria-disabled rather than removing the control from
  // the tab order, against the ticket's stated direction. The sync icon
  // disables while you are operating it: press Enter, sync starts, `disable`
  // flips true. Taking it out of the tab order at that instant would drop
  // focus to <body> and lose the user's place -- the keyboard equivalent of
  // the re-entrancy KAN-63 closed. aria-disabled fixes the false "enabled"
  // announcement without the focus loss.
  test('a disabled Icon announces its state and keeps focus (KAN-66)', async () => {
    // Signed in so that `loading` is the ONLY reason this control is disabled.
    // Signed out disables it too (KAN-79), which would let this pass without
    // the status ever being consulted.
    const { store } = await renderWithProviders(<MenuContainer />, {
      seedStore: (store) => store.dispatch(setSignedIn()),
    });

    await act(async () => {
      store.dispatch(setSyncStatus('loading'));
    });

    // Dimmed, so named for why (KAN-342).
    const sync = screen.getByRole('button', { name: 'Syncing…' });
    expect(sync).toHaveAttribute('aria-disabled', 'true');
    expect(tabIndexOf(sync)).not.toBe(TAB_ORDER_EXCLUDED);
  });

  // Paired with the assertion above: the same icon must NOT claim to be
  // disabled when it is not. Without this, setting aria-disabled
  // unconditionally would pass the test above.
  test('an enabled Icon does not claim to be disabled (KAN-66)', async () => {
    // Signed in: with no account to sync to there is no enabled state to
    // assert, because the control is correctly disabled (KAN-79).
    await renderWithProviders(<MenuContainer />, {
      seedStore: (store) => store.dispatch(setSignedIn()),
    });

    const sync = screen.getByRole('button', { name: 'Sync now' });
    expect(sync).not.toHaveAttribute('aria-disabled');
  });
});
