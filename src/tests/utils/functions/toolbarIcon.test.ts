import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  applyToolbarIcon,
  asToolbarIcon,
  reapplyToolbarIcon,
  toolbarIconPath,
  type ToolbarIconApi,
} from '../../../utils/functions/toolbarIcon';

// KAN-932. The worker-side half of the toolbar icon, against recording fakes.

const action = (rejects = false) => {
  const paths: unknown[] = [];
  const api: ToolbarIconApi = {
    setIcon: async ({ path }) => {
      paths.push(path);
      if (rejects) throw new Error('refused');
    },
  };
  return { api, paths };
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('asToolbarIcon', () => {
  test.each(['colour', 'light', 'dark'])('keeps %s', (icon) => {
    expect(asToolbarIcon(icon)).toBe(icon);
  });

  test.each([undefined, null, '', 'neon', 3, {}])(
    'gives Colour for %s, a value no build wrote',
    (value) => {
      expect(asToolbarIcon(value)).toBe('colour');
    }
  );
});

describe('toolbarIconPath', () => {
  test('Colour is the manifest default, so nothing changes for anyone who keeps it', () => {
    expect(toolbarIconPath('colour')).toBe('icons/icon128.png');
  });

  test.each(['light', 'dark'] as const)('%s has a 16 and a 32', (icon) => {
    expect(toolbarIconPath(icon)).toEqual({
      16: `icons/toolbar-${icon}-16.png`,
      32: `icons/toolbar-${icon}-32.png`,
    });
  });
});

describe('applyToolbarIcon', () => {
  test('sets the icon', async () => {
    const { api, paths } = action();
    await applyToolbarIcon(api, 'dark');
    expect(paths).toEqual([toolbarIconPath('dark')]);
  });

  test('never rejects: a refusal is logged', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { api } = action(true);
    await expect(applyToolbarIcon(api, 'light')).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledOnce();
  });
});

describe('reapplyToolbarIcon', () => {
  test('applies what the page last chose', async () => {
    const { api, paths } = action();
    await reapplyToolbarIcon({ read: async () => 'light' }, api);
    expect(paths).toEqual([toolbarIconPath('light')]);
  });

  test('nothing stored applies Colour', async () => {
    const { api, paths } = action();
    await reapplyToolbarIcon({ read: async () => undefined }, api);
    expect(paths).toEqual([toolbarIconPath('colour')]);
  });

  test('a store that will not read falls back to Colour, logged', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { api, paths } = action();
    await reapplyToolbarIcon(
      {
        read: async () => {
          throw new Error('storage gone');
        },
      },
      api
    );
    expect(paths).toEqual([toolbarIconPath('colour')]);
    expect(warn).toHaveBeenCalledOnce();
  });
});
