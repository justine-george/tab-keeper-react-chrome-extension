// One page-wide order for things that must be compared across slices: live
// undo steps and Reopen offers both take their number here.
let last = 0;

export function nextActionNumber(): number {
  last += 1;
  return last;
}
