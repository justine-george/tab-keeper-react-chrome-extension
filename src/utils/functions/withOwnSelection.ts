import type { TabMasterContainer } from '../../redux/slices/tabContainerDataStateSlice';

// Selection is per-page view state (KAN-279 D9). `incoming` is a container
// this page is about to take in -- another page's write, or a sync's result --
// and whatever selection it carries is someone else's. This page's own stays
// if its session survived; otherwise null, the fallback deleting the selected
// session uses (deleteTabContainerInternal). Never the incoming one. Every
// `isSelected` flag is recomputed to agree.
export const withOwnSelection = (
  incoming: TabMasterContainer,
  ownSelectedId: string | null
): TabMasterContainer => {
  const selectedTabGroupId = incoming.tabGroups.some(
    (g) => g.tabGroupId === ownSelectedId
  )
    ? ownSelectedId
    : null;
  return {
    ...incoming,
    selectedTabGroupId,
    tabGroups: incoming.tabGroups.map((g) => ({
      ...g,
      isSelected: g.tabGroupId === selectedTabGroupId,
    })),
  };
};
