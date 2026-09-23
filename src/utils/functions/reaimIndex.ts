// KAN-279 D12. A drop's index is only valid in the list that produced it
// (KAN-131). When another change landed first, keep the row beside the SAME
// neighbour it was aimed at: the one above it if that still exists, else the
// one below, else the old index clamped.
export function reaimIndex(
  before: string[],
  after: string[],
  rowId: string,
  toIndex: number
): number {
  const oldFinal = before.filter((id) => id !== rowId);
  const target = after.filter((id) => id !== rowId);
  // An edge drop means "first" or "last", not "beside a neighbour": a row that
  // arrived at that edge meanwhile does not push the drop inward (Justine,
  // 2026-09-22).
  if (toIndex <= 0) return 0;
  if (toIndex >= oldFinal.length) return target.length;
  oldFinal.splice(toIndex, 0, rowId);
  const above = oldFinal[toIndex - 1];
  const below = oldFinal[toIndex + 1];
  if (above !== undefined && target.includes(above))
    return target.indexOf(above) + 1;
  if (below !== undefined && target.includes(below))
    return target.indexOf(below);
  return Math.min(Math.max(0, toIndex), target.length);
}
