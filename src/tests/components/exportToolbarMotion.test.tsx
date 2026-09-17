import { afterEach, describe, expect, test, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import ExportPage from '../../components/export/ExportPage';
import { renderWithProviders } from '../setup/renderWithProviders';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';
import { replaceState } from '../../redux/slices/tabContainerDataStateSlice';

// KAN-221. The export toolbar's actions, reviewed against Emil Kowalski's
// animation guidance and picked from mocks by Justine. What jsdom can hold is
// the STATE each one is in; the motion itself -- the press dip, the fades,
// hover on touch -- is measured in e2e/export-toolbar-motion.spec.ts.

const SESSION = buildSession({
  tabGroupId: 'session-kyoto',
  title: 'Weekend in Kyoto',
});

const renderPage = () =>
  renderWithProviders(<ExportPage tabGroupId="session-kyoto" />, {
    seedStore: (store) => {
      store.dispatch(replaceState(buildContainer([SESSION])));
    },
  });

const stubClipboard = () => {
  vi.stubGlobal('ClipboardItem', undefined);
  vi.spyOn(navigator, 'clipboard', 'get').mockReturnValue({
    write: vi.fn(),
    writeText: vi.fn().mockResolvedValue(undefined),
  } as unknown as Clipboard);
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Copy all links confirms in the button itself (KAN-221)', () => {
  test('the button says Copied, then goes back', async () => {
    const user = userEvent.setup();
    stubClipboard();
    await renderPage();
    const copy = screen.getByRole('button', { name: 'Copy all links' });
    expect(copy.getAttribute('data-second-face-shown')).toBe('false');

    await user.click(copy);

    await waitFor(() =>
      expect(copy.getAttribute('data-second-face-shown')).toBe('true')
    );
    expect(within(copy).getByText('Copied')).toBeTruthy();
    // The name does not change with the picture: it is still the same action.
    expect(copy.getAttribute('aria-label')).toBe('Copy all links');
    await waitFor(
      () => expect(copy.getAttribute('data-second-face-shown')).toBe('false'),
      { timeout: 3000 }
    );
  });

  // A screen reader cannot see the swap, so the words are still announced --
  // from a status region, no longer from a floating toast.
  test('the confirmation is announced, and no toast floats over the page', async () => {
    const user = userEvent.setup();
    stubClipboard();
    await renderPage();

    await user.click(screen.getByRole('button', { name: 'Copy all links' }));

    const status = await screen.findByText('Links copied');
    expect(status.closest('[role="status"]')).toBeTruthy();
    expect(
      getComputedStyle(status.closest('[role="status"]')!).position
    ).not.toBe('fixed');
  });
});

describe('Reset looks unavailable while there is nothing to reset (KAN-221)', () => {
  test('unavailable with no edits, available after one', async () => {
    const user = userEvent.setup();
    await renderPage();
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const reset = () => screen.getByRole('button', { name: 'Reset' });

    expect(reset().getAttribute('aria-disabled')).toBe('true');

    await user.click(
      screen.getByRole('button', { name: 'Hide: Example Domain' })
    );

    expect(reset().getAttribute('aria-disabled')).toBeNull();
  });

  // aria-disabled, not disabled: it stays in the tab order and is announced as
  // unavailable, where a disabled button silently vanishes from Tab.
  test('it stays focusable', async () => {
    const user = userEvent.setup();
    await renderPage();
    await user.click(screen.getByRole('button', { name: 'Edit' }));

    expect(
      (screen.getByRole('button', { name: 'Reset' }) as HTMLButtonElement)
        .disabled
    ).toBe(false);
  });
});

describe('the Edit and Done rows fade in, but not on arrival (KAN-221)', () => {
  const row = () =>
    screen
      .getByRole('button', { name: /^(Edit|Done)$/ })
      .closest('[data-toolbar-row]');

  test('the row opening the page carries no fade', async () => {
    await renderPage();

    expect(row()).toBeTruthy();
    expect(row()!.getAttribute('data-swapped')).toBe('false');
  });

  test('pressing Edit, then Done, fades each row in', async () => {
    const user = userEvent.setup();
    await renderPage();

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    expect(row()!.getAttribute('data-swapped')).toBe('true');

    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(row()!.getAttribute('data-swapped')).toBe('true');
  });
});
