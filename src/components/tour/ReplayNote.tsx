import { Fragment, useCallback } from 'react';
import { css } from '@emotion/react';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';

import CoachMark from './CoachMark';
import { CARD_WIDTH } from './runSteps';
import {
  placeBeside,
  type AnchoredPlacement,
  type Box,
  type Size,
} from './coachMarkPlacement';
import { leaveReplayNote, thisView } from '../../redux/firstRun';
import type { AppDispatch, RootState } from '../../redux/store';

// Where the path goes in the translated sentence, as GLYPH_SLOT marks a glyph.
const PATH_SLOT = '\u2063';
const NBSP = '\u00a0';
const SETTINGS = '[data-tour-anchor="settings"]';
const whole = css`
  white-space: nowrap;
`;

const place = (
  anchor: Box,
  mark: Size,
  viewport: Size,
  bright: Box
): AnchoredPlacement =>
  placeBeside(anchor, mark, viewport, ['below', 'left', 'right'], bright);

// KAN-499. After the run, skipped or finished: where to see it again, pointing at Settings.
export default function ReplayNote() {
  const { t } = useTranslation();
  const dispatch = useDispatch<AppDispatch>();
  const isShown = useSelector(
    (state: RootState) =>
      state.globalState.isReplayNoteOpen && !state.globalState.isSettingsPage
  );
  const leave = useCallback(() => void dispatch(leaveReplayNote()), [dispatch]);
  if (!isShown) return null;

  // The labels on screen, each kept whole (Chinese breaks between any two characters), with a break only after an arrow.
  const path = [t('Settings'), t('Help'), t('Show me around')].map(
    (label, i) => (
      <Fragment key={label}>
        {i > 0 && `${NBSP}→ `}
        <span css={whole}>{label}</span>
      </Fragment>
    )
  );
  const [before, after = ''] = t(
    'Want to see this tour again? Go to {{path}}.',
    { path: PATH_SLOT }
  ).split(PATH_SLOT);

  return (
    <CoachMark
      progress={null}
      text={
        <>
          {before}
          {path}
          {after}
        </>
      }
      anchors={[SETTINGS]}
      isLive={false}
      width={CARD_WIDTH[thisView()]}
      place={place}
      primary={{ label: t('Got it'), onPress: leave }}
      onEscape={leave}
    />
  );
}
