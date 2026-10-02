import { describe, expect, test } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import ExportPage from '../../components/export/ExportPage';
import { renderWithProviders } from '../setup/renderWithProviders';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';
import { replaceState } from '../../redux/slices/tabContainerDataStateSlice';

// Dimming sits on a row's own content, never its container: a dimmed container
// takes the eye to 1.95:1 (light) / 2.40:1 (dark) and compounds in nested rows.
// Motion and rendered contrast are in e2e/export-eye-motion.spec.ts.

const SESSION = buildSession({
  tabGroupId: 'session-kyoto',
  title: 'Weekend in Kyoto',
  windowCount: 2,
  tabCount: 3,
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
          title: 'Fushimi Inari',
          url: 'https://inari.jp/en/',
        },
        {
          tabId: 't-2',
          favicon: '',
          title: 'Nozomi timetable',
          url: 'https://jr.example/nozomi',
          chromeGroupId: 'g-1',
        },
      ],
      chromeTabGroups: [{ groupId: 'g-1', title: 'Flights', color: 'blue' }],
    },
    {
      windowId: 'w-2',
      windowHeight: 1080,
      windowWidth: 1920,
      windowOffsetTop: 0,
      windowOffsetLeft: 0,
      tabCount: 1,
      title: 'Food',
      tabs: [
        {
          tabId: 't-3',
          favicon: '',
          title: 'Nishiki Market',
          url: 'https://nishiki.example/',
        },
      ],
    },
  ],
});

const openEditor = async () => {
  const user = userEvent.setup();
  await renderWithProviders(
    <ExportPage source={{ kind: 'saved', tabGroupId: 'session-kyoto' }} />,
    {
      seedStore: (store) => {
        store.dispatch(replaceState(buildContainer([SESSION])));
      },
    }
  );
  await user.click(screen.getByRole('button', { name: 'Edit' }));
  return user;
};

/** The opacity an element is drawn at: its own times every ancestor's. */
const drawnAt = (el: Element) => {
  let product = 1;
  for (let node: Element | null = el; node; node = node.parentElement) {
    const own = parseFloat(getComputedStyle(node).opacity);
    if (!Number.isNaN(own)) product *= own;
  }
  return Number(product.toFixed(4));
};

const eye = (name: string) =>
  screen.getByRole('button', { name: `Hide: ${name}` });
const field = (name: string) => screen.getByRole('textbox', { name });

describe('hiding dims the row, never its eye (KAN-222)', () => {
  test('a hidden tab: its title is dimmed, its eye is not', async () => {
    const user = await openEditor();

    await user.click(eye('Fushimi Inari'));

    expect(drawnAt(field('Rename tab: Fushimi Inari'))).toBe(0.45);
    expect(drawnAt(eye('Fushimi Inari'))).toBe(1);
    // CONTROL: its neighbour was not hidden and is not dimmed.
    expect(drawnAt(field('Rename tab: Nozomi timetable'))).toBe(1);
  });

  test('a hidden window: its rows dim once, and every eye in it stays whole', async () => {
    const user = await openEditor();

    await user.click(eye('Food'));

    expect(drawnAt(field('Rename window group: Food'))).toBe(0.45);
    expect(drawnAt(field('Rename tab: Nishiki Market'))).toBe(0.45);
    expect(drawnAt(eye('Food'))).toBe(1);
    expect(drawnAt(eye('Nishiki Market'))).toBe(1);
  });

  test('a hidden tab inside a hidden window is dimmed once, not twice', async () => {
    const user = await openEditor();

    await user.click(eye('Food'));
    await user.click(eye('Nishiki Market'));

    expect(drawnAt(field('Rename tab: Nishiki Market'))).toBe(0.45);
  });

  test("a hidden group: its title and colour band dim, its tabs' eyes do not", async () => {
    const user = await openEditor();

    await user.click(eye('Flights'));

    expect(drawnAt(field('Rename group: Flights'))).toBe(0.45);
    const band = eye('Flights')
      .closest('li')!
      .querySelector('[data-group-band]');
    expect(band, 'the group draws its band as its own layer').toBeTruthy();
    expect(drawnAt(band!)).toBe(0.45);
    expect(drawnAt(eye('Flights'))).toBe(1);
    expect(drawnAt(eye('Nozomi timetable'))).toBe(1);
  });
});

describe('the eye crossfades to its struck-through face (KAN-222)', () => {
  test('hidden shows the second face, shown again brings the first back', async () => {
    const user = await openEditor();
    const button = eye('Fushimi Inari');
    expect(button.getAttribute('data-second-face-shown')).toBe('false');

    await user.click(button);
    expect(button.getAttribute('data-second-face-shown')).toBe('true');
    expect(button.getAttribute('aria-pressed')).toBe('true');

    await user.click(button);
    expect(button.getAttribute('data-second-face-shown')).toBe('false');
  });
});
