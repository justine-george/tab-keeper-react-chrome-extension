// KAN-932, KAN-933. Which icon sits in Chrome's toolbar. Worker-safe, like
// defaultView.ts: no window, no redux, chrome types only.

export type ToolbarIcon = 'colour' | 'monochrome';
// Chrome's mode, as a page reads it. The worker cannot: it has no matchMedia.
export type ToolbarMode = 'light' | 'dark';

// The worker's copies, in chrome.storage.local: it cannot read the page's localStorage.
export const TOOLBAR_ICON_KEY = 'toolbarIcon';
export const TOOLBAR_MODE_KEY = 'toolbarMode';

export function asToolbarIcon(value: unknown): ToolbarIcon {
  return value === 'monochrome' ? 'monochrome' : 'colour';
}

export function asToolbarMode(value: unknown): ToolbarMode {
  return value === 'dark' ? 'dark' : 'light';
}

// Colour is the manifest's default_icon, so keeping it changes nothing on screen.
// Monochrome draws the light icon on a dark toolbar, and the dark one on a light toolbar.
export function toolbarIconPath(
  icon: ToolbarIcon,
  mode: ToolbarMode
): string | { 16: string; 32: string } {
  if (icon === 'colour') return 'icons/icon128.png';
  const shade = mode === 'dark' ? 'light' : 'dark';
  return {
    16: `icons/toolbar-${shade}-16.png`,
    32: `icons/toolbar-${shade}-32.png`,
  };
}

export interface ToolbarIconApi {
  setIcon(details: { path: string | Record<number, string> }): Promise<void>;
}

// Never rejects: a refusal is logged, and the next browser start applies it again.
export async function applyToolbarIcon(
  api: ToolbarIconApi,
  icon: ToolbarIcon,
  mode: ToolbarMode
): Promise<void> {
  try {
    await api.setIcon({ path: toolbarIconPath(icon, mode) });
  } catch (error) {
    console.warn('Could not apply the toolbar icon:', error);
  }
}

export interface ToolbarIconStore {
  read(): Promise<{ icon: unknown; mode: unknown }>;
}

// The worker at every start: what the page last chose, in the last mode a page saw.
export async function reapplyToolbarIcon(
  store: ToolbarIconStore,
  api: ToolbarIconApi
): Promise<void> {
  let stored: { icon: unknown; mode: unknown } = {
    icon: undefined,
    mode: undefined,
  };
  try {
    stored = await store.read();
  } catch (error) {
    console.warn('Could not read the toolbar icon:', error);
  }
  await applyToolbarIcon(
    api,
    asToolbarIcon(stored.icon),
    asToolbarMode(stored.mode)
  );
}
