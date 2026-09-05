import { useDispatch, useSelector } from 'react-redux';

import { css } from '@emotion/react';

import Button from '../common/Button';
import { useFontFamily } from '../../hooks/useFontFamily';
import { useThemeColors } from '../../hooks/useThemeColors';
import { AppDispatch, RootState } from '../../redux/store';
import { closeTabGroupsPrompt } from '../../redux/slices/globalStateSlice';
import { useTranslation } from 'react-i18next';
import {
  setNeverAskAgainForTabGroups,
  setTabGroupsPromptAnsweredOnce,
  SettingsData,
} from '../../redux/slices/settingsDataStateSlice';
import { requestTabGroupsPermission } from '../../utils/functions/permissions';
import {
  asPartialSettings,
  loadFromLocalStorage,
} from '../../utils/functions/local';

interface TabGroupsPermissionModalProps {
  style?: string;
}

// KAN-74. Offers the optional "tabGroups" permission to a user who has tab
// groups open right now. App.tsx decides WHETHER to open this; everything here
// is about what happens once it is open.
export const TabGroupsPermissionModal: React.FC<
  TabGroupsPermissionModalProps
> = ({ style }) => {
  const COLORS = useThemeColors();
  const FONT_FAMILY = useFontFamily();
  const { t } = useTranslation();
  const dispatch: AppDispatch = useDispatch();

  const tabGroupsPromptCount = useSelector(
    (state: RootState) => state.globalState.tabGroupsPromptCount
  );

  // Below the hooks, never above them: an early return placed at the top of
  // this component would change the number of hooks React sees between the
  // closed and open renders, which is the one thing hook ordering forbids.
  if (tabGroupsPromptCount === null) return null;

  // Read straight from localStorage rather than from the settings slice, the
  // same way RateAndReviewModal does. Both modals can render before the
  // settings state has been rehydrated, and the stored value is the one that
  // decides whether the permanent opt-out has been earned.
  const { isTabGroupsPromptAnsweredOnce = false } =
    asPartialSettings<SettingsData>(loadFromLocalStorage('settingsData'));

  // Both paths below record that the offer has been ANSWERED once, which is
  // what reveals the permanent opt-out on the next showing.
  //
  // Answered, not "dismissed": measured on a real popup, a user who clicked
  // the CTA and then pressed Deny on Chrome's own prompt had given the
  // strongest refusal available and still got no escape hatch, because only
  // "Not now" used to set this. Enable-then-deny, repeated, was an unbounded
  // loop with no opt-out ever appearing -- the exact dead end the escape hatch
  // exists to prevent.
  //
  // Setting it on the CTA path costs nothing when the user ALLOWS: the offer
  // is then gated off by hasTabGroupsPermission() and never renders again, so
  // the revealed link is never seen.
  const rememberAnswered = () => {
    if (!isTabGroupsPromptAnsweredOnce) {
      dispatch(setTabGroupsPromptAnsweredOnce());
    }
  };

  const handleEnable = () => {
    // Deliberately NOT awaited, and deliberately followed by an unconditional
    // close. chrome.permissions.request() destroys this popup on a coin flip
    // and its promise may never settle, so there is no "then" to close in and
    // nothing here may depend on the answer. The outcome is read from
    // contains() on the next popup mount -- see permissions.ts.
    //
    // rememberAnswered() runs FIRST for that reason: the request can tear this
    // popup down synchronously, and a write queued after it may never happen.
    rememberAnswered();
    requestTabGroupsPermission();
    dispatch(closeTabGroupsPrompt());
  };

  const handleNotNow = () => {
    // The offer still fires on every open until the permanent opt-out is
    // taken. This only unlocks that opt-out.
    rememberAnswered();
    dispatch(closeTabGroupsPrompt());
  };

  const handleNeverAskAgain = () => {
    dispatch(setNeverAskAgainForTabGroups());
    dispatch(closeTabGroupsPrompt());
  };

  // Paired keys picked by a ternary, not i18next's `_one`/`_other` suffixes:
  // that is how FocusConfirmModal does plurals and this repo has no plural
  // suffixes anywhere. Note the ru value keeps the count parenthetical,
  // because Russian declines the noun on the number.
  const bodyKey =
    tabGroupsPromptCount === 1
      ? 'TabGroupsPromptBodyOne'
      : 'TabGroupsPromptBodyOther';

  // The two dismissals are real <button>s, not NormalLabels with onClick.
  //
  // NormalLabel renders a bare `<div onClick>`: no role, no tab stop. Measured
  // in a live popup, "Not now" appeared in the accessibility tree as
  // StaticText, i.e. a control no keyboard user can reach -- the exact defect
  // class KAN-66/67/68 went through this codebase to remove. RateAndReviewModal
  // still dismisses that way and should be fixed too, but that is its own
  // change; this one is not going to add a fourth instance.
  //
  // NormalLabel is also `white-space: nowrap`, which ran the body sentence off
  // both edges of the 500px card. That is why the body below is a <p>.
  const dismissStyle = css`
    align-self: center;
    background: none;
    border: none;
    padding: 0;
    font-family: ${FONT_FAMILY};
    font-size: 0.9rem;
    color: ${COLORS.TEXT_COLOR};
    cursor: pointer;
    &:hover {
      text-decoration: underline;
    }
  `;

  return (
    <div
      css={css`
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.8);
        z-index: 999;
        display: flex;
        justify-content: center;
        align-items: center;
        ${style}
      `}
    >
      <div
        css={css`
          background-color: ${COLORS.PRIMARY_COLOR};
          color: ${COLORS.LABEL_L1_COLOR};
          border: 1px solid ${COLORS.BORDER_COLOR};
          width: 500px;
          padding: 20px;
          align-items: flex-start;
          border-radius: 0px;
          display: flex;
          flex-direction: column;
          padding-bottom: 25px;
          gap: 20px;
        `}
      >
        <h2
          css={css`
            font-weight: 500;
            font-family: ${FONT_FAMILY};
            font-size: 1.3rem;
            margin: 10px 0;
          `}
        >
          {t('TabGroupsPromptTitle')}
        </h2>
        <p
          css={css`
            font-family: ${FONT_FAMILY};
            font-size: 0.9rem;
            color: ${COLORS.TEXT_COLOR};
            text-align: left;
            margin: 0 0 10px 0;
          `}
        >
          {t(bodyKey, { count: tabGroupsPromptCount })}
        </p>
        {/* Full width, and that is a translation decision as much as a visual
            one. The label is a whole phrase ("Enable tab group support") and
            several locales run far longer -- fr is "Activer la prise en charge
            des groupes d'onglets", es renders widest at 404px. A content-width
            button left only ~48px of headroom in es; spanning the card gives
            every locale the full 500px. Never reintroduce a fixed width: the
            217px this started with clipped most of them.

            The card is align-items: flex-start, so without width: 100% this
            button would shrink to its own text and read as a stray chip in a
            wide card -- which is what left-aligning the copy exposed. */}
        <Button
          text={t('TabGroupsPromptConfirm')}
          onClick={handleEnable}
          ariaLabel={t('TabGroupsPromptConfirm')}
          iconType="check_circle"
          style="width: 100%; max-width: 100%; margin-bottom: 10px; cursor: pointer; justify-content: center;"
        />
        <button type="button" css={dismissStyle} onClick={handleNotNow}>
          {t('TabGroupsPromptDismiss')}
        </button>
        {/* Earned, not offered: the permanent opt-out appears only after the
            user has already said "not now" once. Same escalation as
            RateAndReviewModal's "Never Remind Again". */}
        {isTabGroupsPromptAnsweredOnce && (
          <button
            type="button"
            css={dismissStyle}
            onClick={handleNeverAskAgain}
          >
            {t('TabGroupsPromptNever')}
          </button>
        )}
      </div>
    </div>
  );
};
