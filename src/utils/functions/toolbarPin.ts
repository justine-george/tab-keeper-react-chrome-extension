// KAN-7 §4. Whether Tab Keeper is on Chrome's toolbar, as this page can tell.

export type ToolbarPin = 'pinned' | 'unpinned' | 'unknown';

const actionApi = (): Partial<typeof chrome.action> | undefined =>
  typeof chrome === 'undefined' ? undefined : chrome.action;

// getUserSettings is Chrome 91+; missing or throwing is 'unknown', and the guide never shows.
export async function readToolbarPin(): Promise<ToolbarPin> {
  const action = actionApi();
  if (typeof action?.getUserSettings !== 'function') return 'unknown';
  try {
    const settings = await action.getUserSettings();
    return settings.isOnToolbar ? 'pinned' : 'unpinned';
  } catch (error) {
    console.warn('Could not read whether Tab Keeper is pinned:', error);
    return 'unknown';
  }
}

// Calls onPinned when Chrome reports the pin: onUserSettingsChanged (130+),
// else a re-read whenever the window gets focus back. Returns the unsubscribe.
export function watchToolbarPin(onPinned: () => void): () => void {
  const event = actionApi()?.onUserSettingsChanged;
  if (typeof event?.addListener === 'function') {
    const listener = (change: chrome.action.UserSettingsChange) => {
      if (change.isOnToolbar === true) onPinned();
    };
    event.addListener(listener);
    return () => event.removeListener(listener);
  }
  const onFocus = () => {
    void readToolbarPin().then((pin) => {
      if (pin === 'pinned') onPinned();
    });
  };
  window.addEventListener('focus', onFocus);
  return () => window.removeEventListener('focus', onFocus);
}

// What Chrome's puzzle menu names the extension, as the step-2 drawing shows it.
export function toolbarAppName(): string {
  const name =
    typeof chrome === 'undefined' ? '' : chrome.i18n?.getMessage('appName');
  return name || 'Tab Keeper';
}
