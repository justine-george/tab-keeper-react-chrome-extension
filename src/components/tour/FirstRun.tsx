import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';

import CoachMark from './CoachMark';
import GlyphSentence from './GlyphSentence';
import { GLYPH_SLOT } from './glyphSlot';
import { CARD_WIDTH, runStepPlan } from './runSteps';
import {
  placeBeside,
  placeInPopupPane,
  type AnchoredPlacement,
  type Box,
  type CoachAction,
  type Size,
} from './coachMarkPlacement';
import { RunHelloDialog } from '../modals/RunHelloDialog';
import { FOLD_ICON } from '../home/opennow/foldIcon';
import type { AppDispatch, RootState } from '../../redux/store';
import {
  advanceRun,
  beginSaveStep,
  endRun,
  finishRunHere,
  goToRunStep,
  pinThisTab,
  reconcileRunHere,
  selectIsRunCardShown,
  selectRunHere,
  stepRunBack,
  takeExampleForRun,
} from '../../redux/firstRun';
import { setRunSaveEcho } from '../../redux/slices/globalStateSlice';
import { prefersReducedMotion } from '../modals/getStartedMotion';
import { playSaveEcho } from './saveEcho';
import { showSession } from '../../redux/showSession';
import { selectIsSavedSessionFolded } from '../../redux/savedSessionFold';
import { isSampleSession } from '../../utils/functions/sampleSession';
import { useSampleNames } from '../../hooks/useSampleNames';
import { useSessionListSettled } from '../../hooks/useSessionListSettled';
import {
  needsSession,
  RUN_STEPS,
  runStepKind,
  type RunStepKind,
} from '../../utils/functions/firstRun';

interface Card {
  text: ReactNode;
  fine?: string;
  primary: CoachAction;
  secondary?: CoachAction;
}

// The run in the page that shows it: Hello at full-view step 0, then one card per step.
export default function FirstRun() {
  const dispatch: AppDispatch = useDispatch();
  const { t } = useTranslation();
  const names = useSampleNames();
  const isSettled = useSessionListSettled();
  const run = useSelector(selectRunHere);
  const isShown = useSelector(selectIsRunCardShown);
  const saveCard = useSelector((s: RootState) => s.globalState.runSaveCard);
  const isHere = useSelector((s: RootState) => s.globalState.isRunHere);
  const holdsPlaceholder = useSelector(
    (s: RootState) => s.globalState.holdsPlaceholderSessions
  );
  const record = useSelector((s: RootState) => s.settingsDataState.firstRun);
  const sessions = useSelector(
    (s: RootState) => s.tabContainerDataState.tabGroups
  );
  const echo = useSelector((s: RootState) => s.globalState.runSaveEcho);
  const isFolded = useSelector(selectIsSavedSessionFolded);
  const shownSession = useRef<string | null>(null);

  // R2, and a record ended or replaced from another page.
  useEffect(() => {
    if (isHere) dispatch(reconcileRunHere());
  }, [isHere, record, sessions, dispatch]);

  const kind: RunStepKind | null =
    run === null ? null : runStepKind(run.view, run.step);
  // Again once the load lands: sessions written to disk after this page opened hold the step until then.
  useEffect(() => {
    if (kind === 'save' && isSettled) void dispatch(beginSaveStep());
  }, [kind, isSettled, holdsPlaceholder, dispatch]);

  // A6: the run's session is shown once per page, the first time a step needs it.
  const sessionId = run?.sessionId ?? null;
  const wantsSession = kind !== null && needsSession(kind) && isSettled;
  useEffect(() => {
    if (!wantsSession || sessionId === null) return;
    if (shownSession.current === sessionId) return;
    shownSession.current = sessionId;
    dispatch(showSession(sessionId));
  }, [wantsSession, sessionId, dispatch]);

  // The run's first save: the new session's dots echo once, after it is drawn.
  useEffect(() => {
    if (echo === null) return;
    const frame = requestAnimationFrame(() => {
      const dots = [
        ...document.querySelectorAll(
          '[data-pane="detail"] [data-tour-anchor="tab-dot"]'
        ),
      ];
      if (!prefersReducedMotion() && dots.every((d) => 'animate' in d)) {
        playSaveEcho(dots);
      }
      dispatch(setRunSaveEcho(null));
    });
    return () => cancelAnimationFrame(frame);
  }, [echo, dispatch]);

  const start = useCallback(() => dispatch(goToRunStep(1)), [dispatch]);
  const goNext = useCallback(() => void dispatch(advanceRun()), [dispatch]);
  const goBack = useCallback(() => void dispatch(stepRunBack()), [dispatch]);
  const skip = useCallback(() => dispatch(endRun('skipped')), [dispatch]);
  const finish = useCallback(() => void dispatch(finishRunHere()), [dispatch]);
  const pin = useCallback(() => void dispatch(pinThisTab()), [dispatch]);
  const example = useCallback(
    () => dispatch(takeExampleForRun(names)),
    [dispatch, names]
  );

  if (run === null || kind === null) return null;
  if (kind === 'hello') {
    return <RunHelloDialog hello={run.hello} onStart={start} onSkip={skip} />;
  }
  if (kind === 'welcome' || !isSettled || !isShown) return null;
  const plan = runStepPlan(run.view, kind, saveCard, run.sessionId);
  if (plan === null || (kind === 'save' && saveCard === null)) return null;

  const next: CoachAction = { label: t('Next'), onPress: goNext };
  const useExample: CoachAction = {
    label: t('Use an example'),
    onPress: example,
  };
  const saveGlyph = {
    icon: 'library_add',
    label: t('Save every open window as a session'),
  } as const;

  const cardFor = (): Card => {
    switch (kind) {
      case 'openNow':
        return {
          text: t(
            'This is Open now: every window and tab you have open. It updates as you browse.'
          ),
          primary: next,
        };
      // Folded, Open now has the whole view and no edge to drag; the fold button shows the saved session.
      case 'findAndFit':
        return {
          text: isFolded ? (
            <GlyphSentence
              sentence={t(
                'Search here to find an open tab fast. Press {{icon}} to show the saved session beside it.',
                { icon: GLYPH_SLOT }
              )}
              icon={FOLD_ICON.folded}
              label={t('Show the saved session')}
            />
          ) : (
            <GlyphSentence
              sentence={t(
                'Search here to find an open tab fast. Drag the edge to make this wider, or press {{icon}} to give Open now the whole view.',
                { icon: GLYPH_SLOT }
              )}
              icon={FOLD_ICON.unfolded}
              label={t('Fold the saved session away')}
            />
          ),
          primary: next,
        };
      case 'save':
        if (saveCard === 'sessions') {
          return {
            text: t('Your saved sessions are all here, just as you left them.'),
            primary: next,
          };
        }
        // Once the run has its session, the card says so and the way on is Next (R6).
        if (run.sessionId !== null) {
          // The example is no save of the user's, so it must not say "Saved."
          const sentence = isSampleSession(run.sessionId)
            ? t(
                'This is an example. Press {{icon}} any time to save your own windows.',
                { icon: GLYPH_SLOT }
              )
            : t('Saved. Press {{icon}} any time to save your windows again.', {
                icon: GLYPH_SLOT,
              });
          return {
            text: <GlyphSentence sentence={sentence} {...saveGlyph} />,
            primary: next,
          };
        }
        if (saveCard === 'nothingToSave') {
          return {
            text: (
              <GlyphSentence
                sentence={t(
                  "This is where you save your open windows as a session: press {{icon}}. Only Tab Keeper is open right now, so let's try it with an example.",
                  { icon: GLYPH_SLOT }
                )}
                {...saveGlyph}
              />
            ),
            primary: useExample,
          };
        }
        return {
          text: (
            <GlyphSentence
              sentence={t(
                "Save these windows as a session. We've named it for you; change it if you like, then press {{icon}}.",
                { icon: GLYPH_SLOT }
              )}
              {...saveGlyph}
            />
          ),
          fine: t('Saving keeps them safe even after you close them.'),
          primary: useExample,
        };
      case 'row':
        return {
          text: t(
            'Here are your saved sessions. The selected one shows its windows and tabs on the right.'
          ),
          primary: next,
        };
      case 'open':
        return {
          text: t(
            "Open brings back all of this session's windows and tabs, beside the ones you have open."
          ),
          primary: next,
        };
      case 'switch':
        return {
          text: t(
            'Switch saves the windows you have open, closes them, and opens this session in their place.'
          ),
          primary: next,
        };
      case 'delete':
        return {
          text: t(
            'Delete removes the saved session. Your open windows stay as they are.'
          ),
          primary: next,
        };
      case 'windows':
        return {
          text: t(
            "Each window can be opened on its own. Click a window's title to rename it."
          ),
          primary: next,
        };
      case 'twoViews':
        return {
          text: t(
            "The Tab Keeper button opens a quick list of your saved sessions. This page is for everything you have open. Keep it in a pinned tab so it's one click away?"
          ),
          fine: t('Undo any time: right-click the tab → Unpin.'),
          secondary: { label: t('Not now'), onPress: finish },
          primary: { label: t('Pin this tab'), onPress: pin },
        };
      case 'fullView':
        return {
          text: t(
            "Want to see and search everything you have open? It's all in the full view. Press ⤢ to open it now, or any time later."
          ),
          primary: { label: t('Done'), onPress: finish },
        };
    }
  };
  const card = cardFor();

  const isLast = run.step === RUN_STEPS[run.view];
  const sides = plan.sides;
  const place =
    sides === 'pane'
      ? placeInPopupPane
      : (
          anchor: Box,
          mark: Size,
          viewport: Size,
          bright: Box
        ): AnchoredPlacement =>
          placeBeside(anchor, mark, viewport, sides, bright);

  return (
    <CoachMark
      step={run.step}
      total={RUN_STEPS[run.view]}
      text={card.text}
      fine={card.fine}
      anchors={plan.anchors}
      boxOf={plan.boxOf}
      isLive={plan.isLive}
      width={CARD_WIDTH[run.view]}
      place={place}
      onSkip={isLast ? undefined : skip}
      onBack={run.step >= 2 ? goBack : undefined}
      secondary={card.secondary}
      primary={card.primary}
      onEscape={isLast ? finish : skip}
    />
  );
}
