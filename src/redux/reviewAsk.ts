import type { ThunkAction, UnknownAction } from '@reduxjs/toolkit';
import {
  markTimeAskDone,
  setPendingReviewAsk,
  updateLastReviewRequestTime,
  type SettingsData,
} from './slices/settingsDataStateSlice';
import { openReviewCard } from './slices/globalStateSlice';
import {
  asPartialSettings,
  loadFromLocalStorage,
} from '../utils/functions/local';
import {
  canAskForReview,
  type ReviewMoment,
} from '../utils/functions/reviewAsk';

// KAN-653. Every ask goes through one pending ask in settings: a moment notes
// it, and the page shows it once nothing covers the page
// (useReviewAskRelease). Both read the gate from localStorage rather than this
// page's store. The popup and the full view are separate pages, and another
// page's ask reaches this store only when its storage event does.

// No getState: both read localStorage instead. So the state type is unknown,
// which also lets createAsyncThunk's untyped thunkAPI.dispatch take them.
type Thunk<R> = ThunkAction<R, unknown, unknown, UnknownAction>;

const storedSettings = (): Partial<SettingsData> =>
  asPartialSettings<SettingsData>(loadFromLocalStorage('settingsData'));

// The `at` of every ask this page noted. Such an ask is shown whenever the
// page is next clear, however long that takes (isPendingAskFresh).
const notedHere = new Set<number>();

export const wasNotedHere = (at: number): boolean => notedHere.has(at);

export const noteReviewMoment =
  (moment: ReviewMoment): Thunk<void> =>
  (dispatch) => {
    const now = Date.now();
    if (!canAskForReview(storedSettings(), now)) return;
    notedHere.add(now);
    dispatch(setPendingReviewAsk({ moment, at: now }));
  };

export const showReviewCard =
  (moment: ReviewMoment): Thunk<void> =>
  (dispatch) => {
    const stored = storedSettings();
    // Refused: another page asked, or the user rated or said never. Nothing
    // is written. This store may not yet hold that page's settings, and a
    // write from it would put back the ones it loaded with -- the empty
    // lastReviewRequestTime among them, which reopens the gate.
    if (!canAskForReview(stored, Date.now())) return;
    dispatch(updateLastReviewRequestTime());
    if (moment.kind === 'time') dispatch(markTimeAskDone());
    dispatch(setPendingReviewAsk(null));
    dispatch(
      openReviewCard({
        moment,
        offersNever: stored.isSkippedUserReviewOnce === true,
      })
    );
  };
