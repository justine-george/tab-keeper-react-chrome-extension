import { isBlankTitle } from './local';

export function isUnnamedWindow(title: string): boolean {
  return isBlankTitle(title);
}

// windowWord is the caller's t('Window'): t() needs a literal key at its call site.
export function windowLabel(
  title: string,
  number: number,
  windowWord: string
): { text: string; named: boolean } {
  return isUnnamedWindow(title)
    ? { text: `${windowWord} ${number}`, named: false }
    : { text: title, named: true };
}

// A left-out window takes the number the next counted window will also take.
export function windowNumbers(
  windows: readonly { windowId: string }[],
  leaveOut: ReadonlySet<string>
): ReadonlyMap<string, number> {
  const numbers = new Map<string, number>();
  let counted = 0;
  for (const { windowId } of windows) {
    if (leaveOut.has(windowId)) {
      numbers.set(windowId, counted + 1);
      continue;
    }
    counted += 1;
    numbers.set(windowId, counted);
  }
  return numbers;
}
