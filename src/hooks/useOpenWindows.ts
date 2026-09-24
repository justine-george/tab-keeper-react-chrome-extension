import { useEffect, useState } from 'react';

import { isDragHeld, whenDragReleases } from '../redux/dragHold';
import { toOpenWindows } from '../utils/functions/openNow';
import type { OpenWindow } from '../utils/functions/openNow';

// A page load fires a run of tabs.onUpdated events; every event inside this
// window shares one re-read (KAN-280).
export const OPEN_NOW_REFRESH_COALESCE_MS = 50;

// What this hook needs from a chrome event. The listener ignores the event's
// arguments (any event means "read again"), and method-parameter bivariance
// lets every chrome.events.Event satisfy this without a cast.
interface ChromeEvent {
  addListener(cb: () => void): void;
  removeListener(cb: () => void): void;
}

/**
 * KAN-280. The browser's open windows for the Open now pane, kept live: one
 * read on mount, then a re-read after any tab, window or group event. `null`
 * until the first read settles, then the latest good snapshot.
 *
 * Nothing read here is stored or synced: the snapshot lives in this hook's
 * state and nowhere else.
 *
 * Events are coalesced (OPEN_NOW_REFRESH_COALESCE_MS), and a refresh that
 * comes due while a row is held waits for the drop (KAN-279 D12): the drag
 * engine measures rows once, so a list that moves under the pointer breaks it.
 *
 * `showGroups` is whether the tabGroups permission is held. Chrome removes
 * `chrome.tabGroups` when it is revoked, so both are checked before the
 * namespace is touched.
 */
export function useOpenWindows(showGroups: boolean): OpenWindow[] | null {
  const [openWindows, setOpenWindows] = useState<OpenWindow[] | null>(null);

  useEffect(() => {
    // False once this effect is torn down (unmount, or showGroups changed):
    // a read still in flight then lands on nothing.
    let live = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let queuedForRelease = false;

    const read = async (): Promise<void> => {
      try {
        const [all, groups, self] = await Promise.all([
          chrome.windows.getAll({ populate: true, windowTypes: ['normal'] }),
          showGroups && chrome.tabGroups
            ? chrome.tabGroups.query({})
            : Promise.resolve(null),
          // Re-read every time: the tab view can be dragged into another
          // window, and "This window" must follow it.
          chrome.tabs.getCurrent(),
        ]);
        if (!live) return;
        setOpenWindows(toOpenWindows(all, groups, self?.windowId ?? null));
      } catch (error) {
        // A window closed between calls, say. Keep the last good snapshot;
        // the next event reads again.
        console.warn('Open now could not read the open windows: ', error);
      }
    };

    const schedule = (): void => {
      if (timer !== null) return;
      timer = setTimeout(() => {
        timer = null;
        // Checked when the timer fires, not when it was set: a drop flushes
        // the held queue before it ends the hold, so a queued refresh can
        // arrive here with the row still held.
        if (isDragHeld()) {
          if (queuedForRelease) return;
          queuedForRelease = true;
          whenDragReleases(() => {
            queuedForRelease = false;
            if (live) schedule();
          });
          return;
        }
        void read();
      }, OPEN_NOW_REFRESH_COALESCE_MS);
    };

    const events: ChromeEvent[] = [
      chrome.tabs.onCreated,
      chrome.tabs.onRemoved,
      chrome.tabs.onUpdated,
      chrome.tabs.onMoved,
      chrome.tabs.onAttached,
      chrome.tabs.onDetached,
      chrome.tabs.onActivated,
      chrome.windows.onCreated,
      chrome.windows.onRemoved,
    ];
    if (showGroups && chrome.tabGroups) {
      events.push(
        chrome.tabGroups.onCreated,
        chrome.tabGroups.onUpdated,
        chrome.tabGroups.onRemoved,
        chrome.tabGroups.onMoved
      );
    }
    for (const event of events) event.addListener(schedule);

    void read();

    return () => {
      live = false;
      if (timer !== null) clearTimeout(timer);
      for (const event of events) event.removeListener(schedule);
    };
  }, [showGroups]);

  return openWindows;
}
