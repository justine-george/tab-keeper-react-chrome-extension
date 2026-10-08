import type { TabMasterContainer } from '../../redux/slices/tabContainerDataStateSlice';

// Keeps `preferredId` if it names a session, else the first (the top row); isSelected follows.
export const withASelection = (
  container: TabMasterContainer,
  preferredId: string | null = container.selectedTabGroupId
): TabMasterContainer => {
  const selectedTabGroupId = container.tabGroups.some(
    (g) => g.tabGroupId === preferredId
  )
    ? preferredId
    : (container.tabGroups[0]?.tabGroupId ?? null);
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

// Selection is per page: keep this page's own over `incoming`'s, else the first session.
export const withOwnSelection = (
  incoming: TabMasterContainer,
  ownSelectedId: string | null
): TabMasterContainer =>
  withASelection({ ...incoming, selectedTabGroupId: null }, ownSelectedId);
