import { useCallback } from 'react';
import { shallowEqual, useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';

import CoachMark from './CoachMark';
import { CARD_WIDTH, SAVE, rowButton } from './runSteps';
import {
  placeBeside,
  type AnchoredPlacement,
  type Box,
  type Size,
} from './coachMarkPlacement';
import { thisView } from '../../redux/firstRun';
import {
  closeEnding,
  selectEndingTarget,
  selectIsEndingShown,
} from '../../redux/onboardingEnding';
import { endingLines } from '../../utils/functions/onboardingEnding';
import type { AppDispatch, RootState } from '../../redux/store';

const place = (
  anchor: Box,
  mark: Size,
  viewport: Size,
  bright: Box
): AnchoredPlacement =>
  placeBeside(anchor, mark, viewport, ['below', 'right', 'left'], bright);

// KAN-879. The onboarding's last card: saved, Open brings it back, have a good day. No dim; Open still works.
export default function EndingCard() {
  const { t } = useTranslation();
  const dispatch = useDispatch<AppDispatch>();
  const target = useSelector(
    (state: RootState) =>
      selectIsEndingShown(state) ? selectEndingTarget(state) : null,
    shallowEqual
  );
  const title = useSelector((state: RootState) =>
    target?.kind === 'session'
      ? (state.tabContainerDataState.tabGroups.find(
          (g) => g.tabGroupId === target.sessionId
        )?.title ?? '')
      : ''
  );
  const close = useCallback(() => void dispatch(closeEnding()), [dispatch]);
  if (target === null) return null;

  const [first, second, signOff] = endingLines(target, title, t);
  // A row not drawn (a folded list) leaves Save to point at.
  const anchors =
    target.kind === 'session'
      ? [rowButton(target.sessionId, 'open'), SAVE]
      : [SAVE];

  return (
    <CoachMark
      progress={null}
      kind="ending"
      text={
        <>
          {first}
          <br />
          {second}
          <br />
          {signOff}
        </>
      }
      anchors={anchors}
      isLive
      isDimmed={false}
      width={CARD_WIDTH[thisView()]}
      place={place}
      primary={{ label: t('Got it'), onPress: close }}
      onEscape={close}
    />
  );
}
