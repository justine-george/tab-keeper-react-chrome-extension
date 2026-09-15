import type {
  tabContainerData,
  windowGroupData,
} from '../../redux/slices/tabContainerDataStateSlice';

/**
 * What the user changed on the export page, for one export (KAN-194).
 *
 * Never written to the store: the export page edits the DOCUMENT, not the
 * session. Keyed by `exportRowKey`.
 */
export interface ExportEdits {
  /** Replacement titles, by row key. */
  titles: Readonly<Record<string, string>>;
  /** Rows left out of the file, by row key. */
  hidden: ReadonlySet<string>;
}

export const NO_EXPORT_EDITS: ExportEdits = {
  titles: {},
  hidden: new Set(),
};

export const exportRowKey = {
  session: (): string => 'session',
  window: (window: windowGroupData): string => `window:${window.windowId}`,
  group: (window: windowGroupData, groupId: string): string =>
    `group:${window.windowId}:${groupId}`,
  tab: (window: windowGroupData, tabId: string): string =>
    `tab:${window.windowId}:${tabId}`,
};

/**
 * The session as the file should show it: renamed, with hidden rows left out
 * and every count recomputed from what is left.
 *
 * Returns a copy; the session passed in is never modified. An edit naming a
 * row that is not there -- the session changed while the page was open -- is
 * ignored.
 */
export function applyExportEdits(
  session: tabContainerData,
  edits: ExportEdits
): tabContainerData {
  return walk(session, edits).session;
}

/**
 * The tally shown while editing. It describes the FILE: a rename counts only
 * if the row is still in it and its title actually differs, and `hiddenTabs`
 * counts every tab left out, whether hidden alone or with its group or window.
 */
export function countExportEdits(
  session: tabContainerData,
  edits: ExportEdits
): { renamed: number; hiddenTabs: number } {
  const { session: edited, renamed } = walk(session, edits);
  return { renamed, hiddenTabs: totalTabs(session) - totalTabs(edited) };
}

function totalTabs(session: tabContainerData): number {
  return session.windows.reduce((sum, window) => sum + window.tabs.length, 0);
}

// One walk builds the copy and counts the renames in it, so the tally cannot
// describe a different document from the one that gets saved.
function walk(
  session: tabContainerData,
  edits: ExportEdits
): { session: tabContainerData; renamed: number } {
  let renamed = 0;

  // A session or window always has a name (KAN-84 refuses a blank rename in
  // the popup), so clearing its field keeps the name. A tab or a Chrome group
  // may be blank: the generators name a titleless tab by its URL, and an
  // unnamed group is a real Chrome state.
  const titleFor = (
    key: string,
    original: string,
    blankAllowed: boolean
  ): string => {
    const typed = edits.titles[key];
    const next =
      typed === undefined || (!blankAllowed && typed.trim() === '')
        ? original
        : typed;
    if (next !== original) renamed++;
    return next;
  };

  const windows = session.windows.flatMap((window): windowGroupData[] => {
    if (edits.hidden.has(exportRowKey.window(window))) return [];

    const hiddenGroups = new Set(
      (window.chromeTabGroups ?? [])
        .map((group) => group.groupId)
        .filter((groupId) =>
          edits.hidden.has(exportRowKey.group(window, groupId))
        )
    );
    const kept = window.tabs.filter(
      (tab) =>
        !edits.hidden.has(exportRowKey.tab(window, tab.tabId)) &&
        !(
          tab.chromeGroupId !== undefined && hiddenGroups.has(tab.chromeGroupId)
        )
    );
    // Nothing left to show: no heading over an empty list.
    if (kept.length === 0) return [];

    const tabs = kept.map((tab) => {
      const title = titleFor(
        exportRowKey.tab(window, tab.tabId),
        tab.title,
        true
      );
      return title === tab.title ? tab : { ...tab, title };
    });

    // A group with no tab left is dropped too, so its rename is not counted
    // for a band the file never draws.
    const groups = window.chromeTabGroups
      ?.filter(
        (group) =>
          !hiddenGroups.has(group.groupId) &&
          tabs.some((tab) => tab.chromeGroupId === group.groupId)
      )
      .map((group) => {
        const title = titleFor(
          exportRowKey.group(window, group.groupId),
          group.title,
          true
        );
        return title === group.title ? group : { ...group, title };
      });

    return [
      {
        ...window,
        title: titleFor(exportRowKey.window(window), window.title, false),
        tabs,
        tabCount: tabs.length,
        ...(groups === undefined ? {} : { chromeTabGroups: groups }),
      },
    ];
  });

  return {
    session: {
      ...session,
      title: titleFor(exportRowKey.session(), session.title, false),
      windows,
      windowCount: windows.length,
      tabCount: windows.reduce((sum, window) => sum + window.tabs.length, 0),
    },
    renamed,
  };
}
