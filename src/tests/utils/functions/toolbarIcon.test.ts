import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  applyToolbarIcon,
  asToolbarIcon,
  asToolbarMode,
  reapplyToolbarIcon,
  toolbarIconPath,
  type ToolbarIconApi,
} from '../../../utils/functions/toolbarIcon';

// KAN-932, KAN-933. The worker-side half of the toolbar icon, against recording fakes.

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

const LIGHT_ICON = {
  16: 'icons/toolbar-light-16.png',
  32: 'icons/toolbar-light-32.png',
};
const DARK_ICON = {
  16: 'icons/toolbar-dark-16.png',
  32: 'icons/toolbar-dark-32.png',
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('asToolbarIcon', () => {
  test.each(['colour', 'monochrome'])('keeps %s', (icon) => {
    expect(asToolbarIcon(icon)).toBe(icon);
  });

  test.each([undefined, null, '', 'neon', 'auto', 'light', 'dark', 3, {}])(
    'gives Colour for %s, a value this build never writes',
    (value) => {
      expect(asToolbarIcon(value)).toBe('colour');
    }
  );
});

describe('asToolbarMode', () => {
  test.each(['light', 'dark'])('keeps %s', (mode) => {
    expect(asToolbarMode(mode)).toBe(mode);
  });

  test.each([undefined, null, 'dusk', 1])(
    'gives light for %s: Chrome starts light',
    (value) => {
      expect(asToolbarMode(value)).toBe('light');
    }
  );
});

describe('toolbarIconPath', () => {
  test('Colour is the manifest default in either mode, so nothing changes for anyone who keeps it', () => {
    expect(toolbarIconPath('colour', 'light')).toBe('icons/icon128.png');
    expect(toolbarIconPath('colour', 'dark')).toBe('icons/icon128.png');
  });

  test('Monochrome draws light on a dark toolbar', () => {
    expect(toolbarIconPath('monochrome', 'dark')).toEqual(LIGHT_ICON);
  });

  test('Monochrome draws dark on a light toolbar', () => {
    expect(toolbarIconPath('monochrome', 'light')).toEqual(DARK_ICON);
  });
});

describe('applyToolbarIcon', () => {
  test('sets the icon', async () => {
    const { api, paths } = action();
    await applyToolbarIcon(api, 'monochrome', 'dark');
    expect(paths).toEqual([LIGHT_ICON]);
  });

  test('never rejects: a refusal is logged', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { api } = action(true);
    await expect(
      applyToolbarIcon(api, 'monochrome', 'light')
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledOnce();
  });
});

describe('reapplyToolbarIcon', () => {
  test('applies Monochrome in the last mode a page saw', async () => {
    const { api, paths } = action();
    await reapplyToolbarIcon(
      { read: async () => ({ icon: 'monochrome', mode: 'dark' }) },
      api
    );
    expect(paths).toEqual([LIGHT_ICON]);
  });

  test('Monochrome with no mode seen yet assumes light', async () => {
    const { api, paths } = action();
    await reapplyToolbarIcon(
      { read: async () => ({ icon: 'monochrome', mode: undefined }) },
      api
    );
    expect(paths).toEqual([DARK_ICON]);
  });

  test('nothing stored applies Colour', async () => {
    const { api, paths } = action();
    await reapplyToolbarIcon(
      { read: async () => ({ icon: undefined, mode: undefined }) },
      api
    );
    expect(paths).toEqual(['icons/icon128.png']);
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
    expect(paths).toEqual(['icons/icon128.png']);
    expect(warn).toHaveBeenCalledOnce();
  });
});
