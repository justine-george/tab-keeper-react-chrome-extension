import { useCallback } from 'react';
import { css } from '@emotion/react';
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
import { openSettingsPage } from '../../redux/slices/globalStateSlice';
import { SettingsCategory } from '../../redux/slices/settingsCategoryStateSlice';
import {
  closeEnding,
  selectEndingTarget,
  selectIsEndingShown,
} from '../../redux/onboardingEnding';
import { endingLines } from '../../utils/functions/onboardingEnding';
import type { AppDispatch, RootState } from '../../redux/store';

// A typed name with no spaces wraps rather than running past the card.
const wrapsAnywhere = css`
  overflow-wrap: anywhere;
`;

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
  // KAN-1018 (his pick A). The story behind Tab Keeper, for whoever wants it: closes the card, opens Settings › About.
  const readStory = useCallback(() => {
    dispatch(closeEnding());
    void dispatch(openSettingsPage(SettingsCategory.ABOUT));
  }, [dispatch]);
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
        <span css={wrapsAnywhere}>
          {first}
          <br />
          {second}
          <br />
          {signOff}
        </span>
      }
      anchors={anchors}
      isLive
      isDimmed={false}
      width={CARD_WIDTH[thisView()]}
      place={place}
      secondary={{ label: t('Read the story'), onPress: readStory }}
      primary={{ label: t('Got it'), onPress: close }}
      onEscape={close}
    />
  );
}
