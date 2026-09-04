import type { tabData } from '../../redux/slices/tabContainerDataStateSlice';
import { generatePlaceholderURL, resolveTabUrl } from './local';
import { sanitizeTabGroupColor } from './tabGroups';

// This module is imported by the service worker, so it must stay free of
// anything a worker does not have. In particular it must never reach for
// `window` -- utils/constants/common.ts derives its default window geometry
// from `window.screen`, which is why bounds arrive here already resolved
// rather than being defaulted in place.

// Where a restored window should be put. Null means "let Chrome decide",
// which is what a retry falls back to: if the first attempt failed, the
// bounds it was handed are the likeliest reason.
export interface WindowBounds {
  height: number;
  width: number;
  top: number;
  left: number;
}

// A group to recreate in a restored window. `groupId` is the saved uuid, used
// only to match tabs to their group; Chrome mints its own numeric id.
export interface TabGroupSpec {
  groupId: string;
  title: string;
  color: string;
}

export interface WindowSpec {
  tabs: tabData[];
  focused: boolean;
  bounds: WindowBounds | null;
  // Absent, or empty, means there is nothing to group.
  groups?: TabGroupSpec[];
}

export const RESTORE_SESSION_MESSAGE = 'restore-session';

// What the popup hands the worker for ANY restore.
//
// Every restore runs here, not only focus mode's. The popup cannot do it
// itself for two reasons that compound: chrome.windows.create({focused: true})
// destroys the popup, and restoring tab groups needs the tab ids that arrive
// in chrome.tabs.create callbacks -- which is the first restore step that
// needs an answer back rather than fire-and-forget IPC.
//
// closeOtherWindows is the ONLY difference between focus mode and an ordinary
// open. Keeping it to one flag is what stops this collapsing back into two
// restore paths that drift.
export interface RestoreSessionRequest {
  type: typeof RESTORE_SESSION_MESSAGE;
  specs: WindowSpec[];
  goToURLText: string;
  isLazyLoad: boolean;
  closeOtherWindows: boolean;
}

export function isRestoreSessionRequest(
  message: unknown
): message is RestoreSessionRequest {
  if (typeof message !== 'object' || message === null) return false;
  const candidate = message as Record<string, unknown>;
  return (
    candidate.type === RESTORE_SESSION_MESSAGE &&
    Array.isArray(candidate.specs) &&
    typeof candidate.goToURLText === 'string' &&
    typeof candidate.isLazyLoad === 'boolean' &&
    typeof candidate.closeOtherWindows === 'boolean'
  );
}

// Recreate the saved groups in a window whose tabs now exist.
//
// Never throws, and never reports failure to the caller. Two reasons: the tabs
// are already open by the time this runs, so a restore that lost its groups is
// still a successful restore; and focus mode decides whether to close the
// user's windows from createWindowWithRetries' result, so letting a grouping
// error travel up that path could close windows whose replacements are fine.
async function applyTabGroups(
  windowId: number,
  groups: TabGroupSpec[],
  tabIdsByGroupId: Map<string, number[]>
): Promise<void> {
  // The namespace is undefined -- not throwing -- while the tabGroups
  // permission is ungranted, so this is feature detection, not try/catch.
  if (typeof chrome === 'undefined' || !chrome.tabGroups) return;

  for (const group of groups) {
    const tabIds = tabIdsByGroupId.get(group.groupId);
    if (!tabIds || tabIds.length === 0) continue;

    try {
      // Chrome's type declares tabIds as a non-empty tuple, not a plain
      // array; the length check above is what makes this destructure safe.
      const [firstTabId, ...restTabIds] = tabIds;
      const groupId = await chrome.tabs.group({
        createProperties: { windowId },
        tabIds: [firstTabId, ...restTabIds],
      });
      await chrome.tabGroups.update(groupId, {
        title: group.title,
        // An unrecognised colour costs this one group its colour, never the
        // restore. Chrome rejects a colour outside its enum.
        color: sanitizeTabGroupColor(group.color),
      });
    } catch (error) {
      console.warn('Could not restore a tab group:', error);
    }
  }
}

// Resolves to the created window, or to null once the retries are spent.
// Returning a promise is the whole point: a callback that has not fired yet
// is indistinguishable from one that never will, so a caller that needs to
// know whether the restore actually happened -- as focus mode does, before it
// closes anything -- cannot be built on the callback form.
export function createWindowWithRetries(
  spec: WindowSpec,
  goToURLText: string,
  isLazyLoad: boolean,
  retryCount: number
): Promise<chrome.windows.Window | null> {
  if (retryCount <= 0 || spec.tabs.length === 0) {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    chrome.windows.create(
      {
        url: resolveTabUrl(spec.tabs[0].url),
        focused: spec.focused,
        ...(spec.bounds ?? {}),
      },
      (newWindow) => {
        if (!newWindow) {
          resolve(
            createWindowWithRetries(
              { ...spec, bounds: null },
              goToURLText,
              isLazyLoad,
              retryCount - 1
            )
          );
          return;
        }

        // Group membership by saved group id. Built as tabs are created,
        // because chrome.tabs.group needs ids and ids only exist afterwards --
        // which is the whole reason restore had to leave the popup.
        const tabIdsByGroupId = new Map<string, number[]>();
        const remember = (tabInfo: tabData, tabId: number | undefined) => {
          if (tabId === undefined || tabInfo.chromeGroupId === undefined)
            return;
          const existing = tabIdsByGroupId.get(tabInfo.chromeGroupId) ?? [];
          existing.push(tabId);
          tabIdsByGroupId.set(tabInfo.chromeGroupId, existing);
        };

        remember(spec.tabs[0], newWindow.tabs?.[0]?.id);

        // No record of what was opened is kept beyond the ids: the placeholder
        // carries its own page, and the background worker reads it back when
        // the user activates the tab. See placeholderTarget in
        // utils/functions/local.
        const rest = spec.tabs.slice(1).map(
          (tabInfo) =>
            new Promise<void>((done) => {
              const decodedUrl = resolveTabUrl(tabInfo.url);
              chrome.tabs.create(
                {
                  windowId: newWindow.id,
                  url: isLazyLoad
                    ? generatePlaceholderURL(
                        tabInfo.title,
                        tabInfo.favicon || '/images/favicon.ico',
                        decodedUrl,
                        goToURLText
                      )
                    : decodedUrl,
                  active: false,
                },
                (created) => {
                  remember(tabInfo, created?.id);
                  done();
                }
              );
            })
        );

        void Promise.all(rest)
          .then(async () => {
            if (
              spec.groups &&
              spec.groups.length > 0 &&
              newWindow.id !== undefined
            ) {
              await applyTabGroups(newWindow.id, spec.groups, tabIdsByGroupId);
            }
          })
          .finally(() => resolve(newWindow));
      }
    );
  });
}

// Decides which windows focus mode may close, given the windows that were
// open before the restore and the outcome of every window it tried to create.
//
// Returns null to mean "close nothing". That is the answer whenever any
// window failed, because the alternative is the one outcome focus mode must
// never produce: the originals gone and the replacements missing. Chrome
// reopens closed windows one at a time, so a wrong answer here is not
// something the user can undo.
export function planWindowClosure(
  snapshotIds: number[],
  createdWindows: (chrome.windows.Window | null)[]
): number[] | null {
  if (createdWindows.length === 0) return null;

  const createdIds = new Set<number>();
  for (const created of createdWindows) {
    if (!created || created.id === undefined) return null;
    createdIds.add(created.id);
  }

  // The snapshot is taken before any window is created, so it cannot already
  // contain one of these ids. Filtering anyway makes that an enforced
  // invariant rather than an assumption about the caller.
  return snapshotIds.filter((id) => !createdIds.has(id));
}
