import { hasTabsToSave } from '../../utils/functions/capture';
import { openBesideActiveTab } from '../../utils/functions/openBesideActiveTab';
import { TOAST_MESSAGES } from '../../utils/constants/common';
import { showToast } from '../../redux/slices/globalStateSlice';
import type { AppDispatch } from '../../redux/store';

// Save open windows as PDF, from the save row's ⋮ and Open now's header (KAN-774).
export async function exportOpenWindows(dispatch: AppDispatch): Promise<void> {
  // KAN-522. Checked first: with only Tab Keeper open the page would have nothing to export.
  if (!(await hasTabsToSave('all-windows'))) {
    void dispatch(showToast({ toastText: TOAST_MESSAGES.NOTHING_TO_SAVE }));
    return;
  }
  // Opening a tab takes focus, which destroys the popup.
  // Nothing may be sequenced after this call -- the page
  // captures the windows for itself when it loads, which is
  // also why no snapshot is handed over here.
  void openBesideActiveTab(
    chrome.runtime.getURL('export.html?source=open-windows')
  );
}
