// KAN-7 §8. The first-open dialogs: one ordered list per surface, at most one opened.

export type DialogId =
  | 'cloudConsent'
  | 'firstRun'
  | 'fullViewOffer'
  | 'pinGuide'
  | 'setup'
  | 'rate'
  | 'tabGroups'
  | 'fullViewCallout';

export interface DialogEntry {
  id: DialogId;
  // The opener when this dialog should show on this open, else null.
  decide(): (() => void) | null | Promise<(() => void) | null>;
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
    let open: (() => void) | null;
    try {
      open = await entry.decide();
    } catch (error) {
      console.warn(`Could not decide the ${entry.id} dialog:`, error);
      open = null;
    }
    if (open !== null) {
      // A tour started while this entry decided: nothing opens over it.
      if (standsDown()) return null;
      open();
      return entry.id;
    }
  }
  return null;
}
