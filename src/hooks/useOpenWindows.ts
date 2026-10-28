import { useEffect, useState } from 'react';

import { isDragHeld, whenDragReleases } from '../redux/dragHold';
import { onTabMovesEnded } from '../redux/undoHistory';
import { copyLooks, forgetCopyLooks } from '../utils/functions/copyLooks';
import { toOpenWindows } from '../utils/functions/openNow';
import type { OpenWindow } from '../utils/functions/openNow';

// A page load fires a run of tabs.onUpdated events; every event inside this
// window shares one re-read (KAN-280).
export const OPEN_NOW_REFRESH_COALESCE_MS = 50;

// What this hook needs from a chrome event. The listener ignores the event's
// arguments (any event means "read again"), and a listener that takes no
// arguments fits every event's callback type, so no cast is needed.
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
 * Events are coalesced (OPEN_NOW_REFRESH_COALESCE_MS), but the end of Tab
 * Keeper's own moves (whileMovingTabs) is read at once. Any read that comes
 * due while a row is held, the first one included, waits for the drop
 * (KAN-279 D12): the drag engine measures rows once, so a list that moves
 * under the pointer breaks it.
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
    // Reads can overlap. A read applies only if it started after the last
    // one applied: an older one settling last would put back a list already
    // gone. Counted by what was APPLIED, not started, because a newer read
    // that failed wrote nothing and must not cost an older success its turn.
    let readSeq = 0;
    let appliedSeq = 0;

    const read = async (): Promise<void> => {
      const mine = ++readSeq;
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
        if (!live || mine <= appliedSeq) return;
        appliedSeq = mine;
        forgetCopyLooks(all);
        setOpenWindows(
          toOpenWindows(all, groups, self?.windowId ?? null, copyLooks())
        );
      } catch (error) {
        // A window closed between calls, say. Keep the last good snapshot;
        // the next event reads again.
        console.warn('Tab Keeper could not read the open windows: ', error);
      }
    };

    // Every read this hook starts goes through here, the first one of an
    // effect run included: any of them can move the list under a held row.
    // Checked at the moment of reading, not when a timer was set: a drop
    // flushes the held queue before it ends the hold, so a queued refresh can
    // arrive here with the row still held.
    const readUnlessHeld = (): void => {
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
    };

    function schedule(): void {
      if (timer !== null) return;
      timer = setTimeout(() => {
        timer = null;
        readUnlessHeld();
      }, OPEN_NOW_REFRESH_COALESCE_MS);
    }

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

    // KAN-835. Tab Keeper's own moves are read at once, not after the
    // coalesce: a drop's rows hold where it put them until the list shows it.
    const stopReadingMoves = onTabMovesEnded(() => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      readUnlessHeld();
    });

    readUnlessHeld();

    return () => {
      live = false;
      if (timer !== null) clearTimeout(timer);
      for (const event of events) event.removeListener(schedule);
      stopReadingMoves();
    };
  }, [showGroups]);

  return openWindows;
}
