import type { TabMasterContainer } from '../../redux/slices/tabContainerDataStateSlice';

// KAN-279 D9. "Did the other page change the DATA?" Selection is persisted
// (selectTabContainer writes localStorage) but is per-page view state, and the
// sync's merge rebuilds every object, so neither bytes nor identity can answer.
const canonical = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(canonical)
    : value !== null && typeof value === 'object'
      ? Object.fromEntries(
          Object.keys(value as object)
            .sort()
            .map((k) => [k, canonical((value as Record<string, unknown>)[k])])
        )
      : value;

const dataOf = (c: TabMasterContainer) => ({
  lastModified: c.lastModified,
  deletedTabGroups: c.deletedTabGroups ?? [],
  // A session with no lastModified means the container's, exactly as the
  // merge reads it (sessionTimestamp). Otherwise legacy data compares unequal
  // the one time a merge stamps it (Justine, 2026-09-23).
  //
  // isSelected is destructured out on purpose, to drop it from `...rest`; this
  // project's eslint config has no `ignoreRestSiblings` for that idiom.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  tabGroups: c.tabGroups.map(({ isSelected: _s, ...rest }) => ({
    ...rest,
    lastModified: rest.lastModified ?? c.lastModified,
  })),
});

export function sameContainerData(
  a: TabMasterContainer,
  b: TabMasterContainer
): boolean {
  return (
    JSON.stringify(canonical(dataOf(a))) ===
    JSON.stringify(canonical(dataOf(b)))
  );
}
