import type { AppDispatch, RootState } from './store';
import { openTabGroupsPrompt } from './slices/globalStateSlice';
import { shouldOfferTabGroups } from '../utils/functions/tabGroupsOffer';

// KAN-565 (pick B). The full view is a long-lived tab, and coming back to it
// is not a page load, so the load's dialog queue never sees a group made
// since. So each return decides the offer again, until this page has shown it
// once, at the load or on a return. Never over a dialog, or once a tour ran
// here (KAN-413). Returns the stop, for the page's cleanup.
export function offerTabGroupsOnReturn(
  dispatch: AppDispatch,
  getState: () => RootState,
  offeredAtLoad: boolean
): () => void {
  if (offeredAtLoad) return () => undefined;
  let deciding = false;
  const onReturn = async () => {
    if (document.visibilityState !== 'visible' || deciding) return;
    deciding = true;
    try {
      const count = await shouldOfferTabGroups();
      const isClear =
        document.querySelector('dialog:modal') === null &&
        !getState().globalState.hasRunShownHere;
      if (count === null || !isClear) return;
      dispatch(openTabGroupsPrompt(count));
      stop();
    } catch (error) {
      console.warn('Could not decide the tab group offer:', error);
    } finally {
      deciding = false;
    }
  };
  const listener = () => void onReturn();
  const stop = () => document.removeEventListener('visibilitychange', listener);
  document.addEventListener('visibilitychange', listener);
  return stop;
}
