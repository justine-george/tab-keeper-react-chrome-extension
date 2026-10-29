// KAN-861. The version an update came from, kept until What's new is answered. Worker-safe: no list, no redux.
export const WHATS_NEW_SINCE_KEY = 'whatsNewSince';

// A value already waiting is kept, so several unopened updates show everything since the oldest.
async function record(previousVersion: string): Promise<void> {
  const items = await chrome.storage.local.get(WHATS_NEW_SINCE_KEY);
  if (items[WHATS_NEW_SINCE_KEY] !== undefined) return;
  await chrome.storage.local.set({ [WHATS_NEW_SINCE_KEY]: previousVersion });
}

export function recordWhatsNewSince(): void {
  chrome.runtime.onInstalled.addListener(({ reason, previousVersion }) => {
    if (reason !== 'update' || previousVersion === undefined) return;
    record(previousVersion).catch((error) => {
      console.warn("Could not record the version for What's new:", error);
    });
  });
}
