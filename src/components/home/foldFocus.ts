// KAN-999. A press on the saved session's card (folded) removes it, so focus
// would fall to <body>; the press hands focus to Currently open's fold
// button, which takes it once it is drawn. That button stays as it flips
// (KAN-1000), so it keeps its own focus and hands none.
export type FoldFocusTarget = 'openNowFold';

let pending: FoldFocusTarget | null = null;

export function handFoldFocusTo(target: FoldFocusTarget): void {
  pending = target;
}

/** True once for the target handed focus, then cleared. */
export function takeFoldFocus(target: FoldFocusTarget): boolean {
  if (pending !== target) return false;
  pending = null;
  return true;
}
