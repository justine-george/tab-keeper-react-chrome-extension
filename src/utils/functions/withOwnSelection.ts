import type { TabMasterContainer } from '../../redux/slices/tabContainerDataStateSlice';

// Where selection is decided for a container taken in whole. While the list
// has a session, one is selected: `preferredId` if it names a session here,
// else the first, which is the top row (the stored array is the display
// order). Every `isSelected` flag is recomputed to agree. Returns `container`
// itself when it already agrees, so a no-op keeps its identity.
export const withASelection = (
  container: TabMasterContainer,
  preferredId: string | null = container.selectedTabGroupId
): TabMasterContainer => {
  const selectedTabGroupId = container.tabGroups.some(
    (g) => g.tabGroupId === preferredId
  )
    ? preferredId
    : container.tabGroups[0]?.tabGroupId ?? null;
  const agrees =
    container.selectedTabGroupId === selectedTabGroupId &&
    container.tabGroups.every(
      (g) => g.isSelected === (g.tabGroupId === selectedTabGroupId)
    );
  if (agrees) return container;
  return {
    ...container,
    selectedTabGroupId,
    tabGroups: container.tabGroups.map((g) => ({
      ...g,
      isSelected: g.tabGroupId === selectedTabGroupId,
    })),
  };
};

// Selection is per-page view state (KAN-279 D9). `incoming` is a container
// this page is about to take in -- another page's write, or a sync's result --
// and whatever selection it carries is someone else's. This page's own stays
// if its session survived; otherwise the first session. Never the incoming
// one.
export const withOwnSelection = (
  incoming: TabMasterContainer,
  ownSelectedId: string | null
): TabMasterContainer =>
  withASelection({ ...incoming, selectedTabGroupId: null }, ownSelectedId);
