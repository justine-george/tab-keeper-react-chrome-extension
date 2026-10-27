// KAN-339 B. Where Currently open's list goes when its search term changes:
// to the top for every new term, so the first match (Enter's tab) is in view,
// and back to the place it held before the search once the search is cleared.

export interface SearchScroll {
  // Where to put the list after this change; null leaves it alone.
  scrollTo: number | null;
  // The list's place before the search began, kept until the search ends.
  before: number | null;
}

export function searchScrollAfter(
  fromTerm: string | null,
  toTerm: string | null,
  scrollTop: number,
  before: number | null
): SearchScroll {
  if (toTerm === fromTerm) return { scrollTo: null, before };
  if (toTerm === null) return { scrollTo: before, before: null };
  return { scrollTo: 0, before: fromTerm === null ? scrollTop : before };
}
