import type {
  deletedTabGroup,
  TabMasterContainer,
} from '../../redux/slices/tabContainerDataStateSlice';

// KAN-279 D9. "Did the other page change the DATA?" Selection is persisted
// (selectTabContainer writes localStorage) but is per-page view state, and the
// sync's merge rebuilds every object, so neither bytes nor identity can answer.
const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value === null || typeof value !== 'object') return value;
  // `value` is `object` here, which has no index signature, so
  // `Object.entries` resolves through the `entries(o: {}): [string, any][]`
  // overload rather than the generic indexed one. This annotation is what
  // turns that `any` back into a real type, not a cast: it states what the
  // array already IS (string keys, unknown-typed values) rather than
  // asserting past a mismatch.
  const entries: [string, unknown][] = Object.entries(value);
  return Object.fromEntries(
    entries
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => [k, canonical(v)])
  );
};

// A tombstone's order carries no meaning -- pruneTombstones (mergeTabData.ts)
// sorts by deletedAt descending with ties broken by insertion order, so the
// same set of tombstones can legitimately arrive in a different order from
// two devices. Sorted by id first (deterministic even for same-instant
// deletes), then by deletedAt so a genuine change in when an id was deleted
// still registers. Copies before sorting: the caller's array is never mutated.
// Unlike this, tabGroups keeps array order significant, because that order
// IS data -- it's what the list displays.
const sortedTombstones = (
  tombstones: deletedTabGroup[] | undefined
): deletedTabGroup[] =>
  [...(tombstones ?? [])].sort(
    (a, b) =>
      (a.tabGroupId < b.tabGroupId
        ? -1
        : a.tabGroupId > b.tabGroupId
          ? 1
          : 0) || a.deletedAt - b.deletedAt
  );

const dataOf = (c: TabMasterContainer) => ({
  lastModified: c.lastModified,
  deletedTabGroups: sortedTombstones(c.deletedTabGroups),
  // A session with no lastModified means the container's, exactly as the
  // merge reads it (sessionTimestamp). Otherwise legacy data compares unequal
  // the one time a merge stamps it (Justine, 2026-09-23).
  tabGroups: c.tabGroups.map((g) => {
    const { isSelected, ...rest } = g;
    void isSelected; // View state, not data (KAN-279 D9): dropped here.
    return {
      ...rest,
      lastModified: rest.lastModified ?? c.lastModified,
    };
  }),
});

// Equal as JSON once every object's keys are sorted: key order is how a value
// was built, not what it holds. The settings compare uses it directly
// (otherPageChanges); settings have no view state to strip.
export const sameIgnoringKeyOrder = (a: unknown, b: unknown): boolean =>
  JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

export function sameContainerData(
  a: TabMasterContainer,
  b: TabMasterContainer
): boolean {
  return sameIgnoringKeyOrder(dataOf(a), dataOf(b));
}
