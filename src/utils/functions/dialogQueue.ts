// KAN-7 §8. The first-open dialogs: one ordered list per surface, at most one opened.

export type DialogId =
  | 'cloudConsent'
  | 'firstRun'
  | 'pinGuide'
  | 'setup'
  | 'rate'
  | 'tabGroups'
  | 'fullViewCallout';

// An entry's answer that this open shows nothing more: no dialog, and nothing after it decides.
export const STAND_DOWN = 'standDown';

type Decision = (() => void) | null | typeof STAND_DOWN;

export interface DialogEntry {
  id: DialogId;
  // The opener when this dialog should show on this open, null for no, or STAND_DOWN.
  decide(): Decision | Promise<Decision>;
}

// Decides in order and opens the first yes; a decide that throws counts as no,
// so one broken check cannot block the dialogs after it.
// KAN-413. Once a tour runs in this page, nothing more is decided or opened.
export async function openFirstDialog(
  entries: readonly DialogEntry[],
  standsDown: () => boolean = () => false
): Promise<DialogId | null> {
  for (const entry of entries) {
    if (standsDown()) return null;
    let open: Decision;
    try {
      open = await entry.decide();
    } catch (error) {
      console.warn(`Could not decide the ${entry.id} dialog:`, error);
      open = null;
    }
    if (open === STAND_DOWN) return null;
    if (open !== null) {
      // A tour started while this entry decided: nothing opens over it.
      if (standsDown()) return null;
      open();
      return entry.id;
    }
  }
  return null;
}
