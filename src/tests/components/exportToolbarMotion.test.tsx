import { afterEach, describe, expect, test, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import ExportPage from '../../components/export/ExportPage';
import { renderWithProviders } from '../setup/renderWithProviders';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';
import { replaceState } from '../../redux/slices/tabContainerDataStateSlice';

// jsdom holds each action's state; the motion is measured in
// e2e/export-toolbar-motion.spec.ts.

const SESSION = buildSession({
  tabGroupId: 'session-kyoto',
  title: 'Weekend in Kyoto',
});

const renderPage = () =>
  renderWithProviders(
    <ExportPage
      source={{ kind: 'saved', tabGroupId: 'session-kyoto' }}
      from="full"
    />,
    {
      seedStore: (store) => {
        store.dispatch(replaceState(buildContainer([SESSION])));
      },
    }
  );

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
    // Same action, so the name stays.
    expect(copy.getAttribute('aria-label')).toBe('Copy all links');
    await waitFor(
      () => expect(copy.getAttribute('data-second-face-shown')).toBe('false'),
      { timeout: 3000 }
    );
  });

  // KAN-401. The button says Copied where the click was; the toast says how
  // many, as the popup's does, and its live region announces it.
  test('a toast says how many links were copied, and the button says Copied', async () => {
    const user = userEvent.setup();
    stubClipboard();
    await renderPage();

    await user.click(screen.getByRole('button', { name: 'Copy all links' }));

    const message = await screen.findByText('1 link copied.');
    expect(message.closest('[data-toast]')).toBeTruthy();
    expect(message.closest('[role="status"]')).toBeTruthy();
    expect(
      screen
        .getByRole('button', { name: 'Copy all links' })
        .getAttribute('data-second-face-shown')
    ).toBe('true');
    // One announcement: no second status region repeats the count.
    expect(screen.getAllByText('1 link copied.')).toHaveLength(1);
  });
});

describe('Copy all links when the clipboard refuses (KAN-713)', () => {
  test('no toast, and the button does not say Copied', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('ClipboardItem', undefined);
    const writeText = vi.fn().mockRejectedValue(new Error('NotAllowedError'));
    vi.spyOn(navigator, 'clipboard', 'get').mockReturnValue({
      write: vi.fn(),
      writeText,
    } as unknown as Clipboard);
    const { store } = await renderPage();
    const copy = screen.getByRole('button', { name: 'Copy all links' });

    await user.click(copy);

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    await act(async () => {});
    expect(store.getState().globalState.toasts).toEqual([]);
    expect(copy.getAttribute('data-second-face-shown')).toBe('false');
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

  // aria-disabled, not disabled: a disabled button silently leaves the tab
  // order.
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
