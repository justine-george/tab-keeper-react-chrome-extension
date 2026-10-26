// KAN-820. The drawer's carry state as pure rules: sprung, it stays unless it went away or Esc ended the carry; user-opened, it stays.

export interface DrawerCarry {
  // The drawer opened under this carry (it was not opened by the user).
  readonly sprung: boolean;
  // The carry has been over the drawer at least once.
  readonly beenIn: boolean;
  // The carry went back out after being in; it stays away.
  readonly away: boolean;
}

// A user-opened drawer at a carry's start.
export const DRAWER_CARRY_START: DrawerCarry = {
  sprung: false,
  beenIn: false,
  away: false,
};

// A drawer the spring has opened: the pointer is on the rail, under it, so in.
export const DRAWER_SPRUNG: DrawerCarry = {
  sprung: true,
  beenIn: true,
  away: false,
};

// The carry's pointer moved: `inside` is over the drawer or past the window edge.
export function drawerAfterMove(s: DrawerCarry, inside: boolean): DrawerCarry {
  if (inside) return { ...s, beenIn: true };
  return s.beenIn ? { ...s, away: true } : s;
}

// Whether the drawer stays open once the carry ends.
export function drawerStaysAfterCarry(
  s: DrawerCarry,
  endedByEscape: boolean
): boolean {
  return !s.sprung || (!s.away && !endedByEscape);
}

// Past the box's right edge counts, so the rail's column takes in the window's edge.
export function inRightColumn(
  box: Pick<DOMRect, 'left' | 'top' | 'bottom'>,
  x: number,
  y: number
): boolean {
  return x >= box.left && y >= box.top && y < box.bottom;
}

// KAN-820 F1. Where a fixed element rests, its slide ignored: its offsets ignore transforms and are already the viewport's.
export function restingBox(el: HTMLElement): DOMRect {
  return DOMRect.fromRect({
    x: el.offsetLeft,
    y: el.offsetTop,
    width: el.offsetWidth,
    height: el.offsetHeight,
  });
}

// What lies over the rail: nothing (closed, or away), a drawer still moving in, or a settled one.
export type DrawerOverRail = 'none' | 'settling' | 'settled';
