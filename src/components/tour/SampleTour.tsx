import { useCallback, useEffect, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';

import CoachMark from './CoachMark';
import {
  placeBeside,
  placeInPopupPane,
  type Box,
  type Size,
} from './coachMarkPlacement';
import { COACH_WIDTH, TOUR_ANCHORS, TOUR_BOX, TOUR_SIDES } from './tourSteps';
import type { AppDispatch, RootState } from '../../redux/store';
import {
  advanceSampleTour,
  endSampleTour,
  reconcileTourHere,
  selectIsTourSampleShown,
  selectTourHere,
  selectTourSample,
  unfoldStepFourWindow,
} from '../../redux/sampleTour';
import { collapsedWindowIdsOf } from '../../redux/slices/globalStateSlice';
import {
  stepWasDone,
  tourSnapshot,
  type TourSnapshot,
  type TourStep,
} from '../../utils/functions/sampleTour';
import { isTabView } from '../../utils/functions/viewMode';

// KAN-413. The tour in the page that started it: each step's mark, its advance, its end.
export default function SampleTour() {
  const dispatch: AppDispatch = useDispatch();
  const { t } = useTranslation();
  const here = useSelector((s: RootState) => s.globalState.tourSampleIdHere);
  const record = useSelector((s: RootState) => s.settingsDataState.sampleTour);
  const sessions = useSelector(
    (s: RootState) => s.tabContainerDataState.tabGroups
  );
  const tour = useSelector(selectTourHere);
  const sample = useSelector(selectTourSample);
  const isShown = useSelector(selectIsTourSampleShown);
  const collapsed = useSelector(
    (s: RootState) => s.globalState.collapsedWindows
  );
  const stepStart = useRef<{ step: TourStep; at: TourSnapshot } | null>(null);

  // Its sample gone another way, or the record replaced from another page.
  useEffect(() => {
    if (here !== null) dispatch(reconcileTourHere());
  }, [here, record, sessions, dispatch]);

  const step = tour?.step;
  useEffect(() => {
    if (step !== undefined) dispatch(unfoldStepFourWindow());
  }, [step, dispatch]);

  // The step's own action moves on, measured from where the step began.
  useEffect(() => {
    if (tour === null || sample === undefined) {
      stepStart.current = null;
      return;
    }
    const now = tourSnapshot(
      sample,
      collapsedWindowIdsOf(collapsed, sample.tabGroupId)
    );
    if (stepStart.current?.step !== tour.step) {
      stepStart.current = { step: tour.step, at: now };
      return;
    }
    if (stepWasDone(tour.step, stepStart.current.at, now)) {
      dispatch(advanceSampleTour());
    }
  }, [tour, sample, collapsed, dispatch]);

  const next = useCallback(() => dispatch(advanceSampleTour()), [dispatch]);
  const end = useCallback(() => dispatch(endSampleTour()), [dispatch]);

  // Not on the sample (another selected, any search, the fold): nothing drawn.
  if (tour === null || !isShown) return null;

  const texts: Record<TourStep, string> = {
    1: t(
      'A session keeps windows and tabs together. This one has 2 windows and 5 tabs. Fold a window with its arrow.'
    ),
    2: t(
      'Open brings every window and tab back, just as they were. Use it any time. For now, press Next.'
    ),
    3: t(
      'Click the title to rename the session. Try something like "Lisbon in May".'
    ),
    4: t('Drag a tab to reorder it, or drop it into the other window.'),
    5: t(
      "That's the tour. Delete the example from this menu, or press Finish and it's removed for you."
    ),
  };
  const isFull = isTabView();
  const sides = TOUR_SIDES[tour.step];
  const place = isFull
    ? (anchor: Box, mark: Size, viewport: Size) =>
        placeBeside(anchor, mark, viewport, sides)
    : placeInPopupPane;

  return (
    <CoachMark
      step={tour.step}
      text={texts[tour.step]}
      anchors={TOUR_ANCHORS[tour.step]}
      boxOf={TOUR_BOX[tour.step]}
      width={isFull ? COACH_WIDTH.full : COACH_WIDTH.popup}
      place={place}
      onNext={next}
      onEnd={end}
    />
  );
}
