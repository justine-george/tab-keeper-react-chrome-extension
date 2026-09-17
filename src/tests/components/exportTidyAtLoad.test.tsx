import { describe, expect, test, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import ExportPage from '../../components/export/ExportPage';
import { renderWithProviders } from '../setup/renderWithProviders';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';
import { replaceState } from '../../redux/slices/tabContainerDataStateSlice';

// KAN-202. The clean-ups ran on the clipboard only, so the document people
// share still said "(3) Rive on X" and carried the suspender extension's
// wrapper instead of the address it stands for. They now run once, where the
// page loads the session, so the editor and every output agree.

const SUSPENDED =
  'chrome-extension://laameccjpleogmfhilmffpdbiibgbekf/suspended.html?title=Extensions&url=chrome%3A%2F%2Fextensions%2F&time=1';

const SESSION = buildSession({
  tabGroupId: 'session-kyoto',
  title: 'Weekend in Kyoto',
  windowCount: 1,
  tabCount: 2,
  windows: [
    {
      windowId: 'w-1',
      windowHeight: 1080,
      windowWidth: 1920,
      windowOffsetTop: 0,
      windowOffsetLeft: 0,
      tabCount: 2,
      title: 'Trip planning',
      tabs: [
        {
          tabId: 't-1',
          favicon: '',
          title: '(3) Rive on X: "GPU Canvas"',
          url: 'https://x.example/rive/status/1',
        },
        { tabId: 't-2', favicon: '', title: 'Extensions', url: SUSPENDED },
      ],
    },
  ],
});

const renderPage = () =>
  renderWithProviders(
    <ExportPage source={{ kind: 'saved', tabGroupId: 'session-kyoto' }} />,
    {
      seedStore: (store) => {
        store.dispatch(replaceState(buildContainer([SESSION])));
      },
    }
  );

const preview = () => {
  const frame = document.querySelector('iframe');
  if (!frame) throw new Error('the page shows no file preview');
  return frame.srcdoc;
};

describe('the session is tidied where the page loads it (KAN-202)', () => {
  test('the file carries the tidy title and the real address', async () => {
    await renderPage();

    await waitFor(() => expect(preview()).toContain('Rive on X'));
    expect(preview()).not.toContain('(3) Rive');
    expect(preview()).toContain('chrome://extensions/');
    expect(preview()).not.toContain('chrome-extension://');
  });

  test('Edit mode opens on the same text the file shows', async () => {
    const user = userEvent.setup();
    await renderPage();

    await user.click(screen.getByRole('button', { name: 'Edit' }));

    const field = screen.getByRole('textbox', {
      name: 'Rename tab: Rive on X: "GPU Canvas"',
    }) as HTMLInputElement;
    expect(field.value).toBe('Rive on X: "GPU Canvas"');
    expect(
      screen.queryByRole('textbox', {
        name: 'Rename tab: (3) Rive on X: "GPU Canvas"',
      })
    ).toBeNull();
  });

  test('a rename still wins over the tidy text', async () => {
    const user = userEvent.setup();
    await renderPage();

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const field = screen.getByRole('textbox', {
      name: 'Rename tab: Rive on X: "GPU Canvas"',
    });
    await user.clear(field);
    await user.type(field, 'Rive GPU Canvas launch');
    await user.click(screen.getByRole('button', { name: 'Done' }));

    expect(preview()).toContain('Rive GPU Canvas launch');
    expect(preview()).not.toContain('Rive on X');
  });

  test('the clipboard gets the same text', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(navigator, 'clipboard', 'get').mockReturnValue({
      writeText,
      write: vi.fn().mockRejectedValue(new Error('no rich write')),
    } as unknown as Clipboard);
    await renderPage();

    await user.click(screen.getByRole('button', { name: 'Copy all links' }));

    const text = writeText.mock.calls[0][0] as string;
    expect(text).toContain('- Rive on X: "GPU Canvas"');
    expect(text).toContain('chrome://extensions/');
    expect(text).not.toContain('(3)');
    expect(text).not.toContain('chrome-extension://');
  });
});
