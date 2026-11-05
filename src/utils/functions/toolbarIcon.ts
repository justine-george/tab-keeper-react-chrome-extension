// KAN-932. Which icon sits in Chrome's toolbar. Worker-safe, like defaultView.ts:
// no window, no redux, chrome types only.

export type ToolbarIcon = 'colour' | 'light' | 'dark';

// The worker's copy, in chrome.storage.local: it cannot read the page's localStorage.
export const TOOLBAR_ICON_KEY = 'toolbarIcon';

export function asToolbarIcon(value: unknown): ToolbarIcon {
  return value === 'light' || value === 'dark' ? value : 'colour';
}

// Colour is the manifest's default_icon, so keeping it changes nothing on screen.
export function toolbarIconPath(
  icon: ToolbarIcon
): string | { 16: string; 32: string } {
  if (icon === 'colour') return 'icons/icon128.png';
  return {
    16: `icons/toolbar-${icon}-16.png`,
    32: `icons/toolbar-${icon}-32.png`,
  };
}

export interface ToolbarIconApi {
  setIcon(details: { path: string | Record<number, string> }): Promise<void>;
}

// Never rejects: a refusal is logged, and the next browser start applies it again.
export async function applyToolbarIcon(
  api: ToolbarIconApi,
  icon: ToolbarIcon
): Promise<void> {
  try {
    await api.setIcon({ path: toolbarIconPath(icon) });
  } catch (error) {
    console.warn('Could not apply the toolbar icon:', error);
  }
}

export interface ToolbarIconStore {
  read(): Promise<unknown>;
}

// The worker at every start: what the page last chose, else Colour.
export async function reapplyToolbarIcon(
  store: ToolbarIconStore,
  api: ToolbarIconApi
): Promise<void> {
  let stored: unknown;
  try {
    stored = await store.read();
  } catch (error) {
    console.warn('Could not read the toolbar icon:', error);
  }
  await applyToolbarIcon(api, asToolbarIcon(stored));
}
