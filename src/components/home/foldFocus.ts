// KAN-999. The saved session's two fold controls live in different places: its
// card (folded) and Currently open's fold button (unfolded). A press on
// either removes it, so focus would fall to <body>; the press hands focus to
// the other, which takes it once it is drawn.
export type FoldFocusTarget = 'savedCard' | 'openNowFold';

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
