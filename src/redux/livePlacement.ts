// KAN-280 Part F (P6, KAN-476's rule). A live window's place and state as Chrome has them when its carry starts.
import type { LiveSnapshot } from './carriedItem';
import type { windowGroupData } from './slices/tabContainerDataStateSlice';
import { savedWindowState } from '../utils/functions/capture';
import { toOpenWindowBounds } from '../utils/functions/openNow';

type Placement = Pick<
  windowGroupData,
  | 'windowHeight'
  | 'windowWidth'
  | 'windowOffsetTop'
  | 'windowOffsetLeft'
  | 'state'
>;

// By snapshot, which is one object for the whole carry; weak, so a carry long over is not kept.
const placed = new WeakMap<LiveSnapshot, Placement>();

export async function readLivePlacement(live: LiveSnapshot): Promise<void> {
  try {
    const w = await chrome.windows.get(live.chromeWindowId);
    const bounds = toOpenWindowBounds(w);
    if (bounds === null) return;
    placed.set(live, {
      windowHeight: bounds.height,
      windowWidth: bounds.width,
      windowOffsetTop: bounds.top,
      windowOffsetLeft: bounds.left,
      ...savedWindowState(w.state),
    });
  } catch {
    // Closed since: the list's place stands (Q1 A).
  }
}

export function placedWindowOf(live: LiveSnapshot): windowGroupData {
  const p = placed.get(live);
  if (p === undefined) return live.window;
  const w: windowGroupData = { ...live.window, ...p };
  // A 'normal' read stores no state (KAN-460 D2), so the list's goes too.
  if (p.state === undefined) delete w.state;
  return w;
}
