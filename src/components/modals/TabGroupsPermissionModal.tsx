import { useEffect, useRef } from 'react';

import { useDispatch, useSelector } from 'react-redux';

import { css } from '@emotion/react';

import { useFontFamily } from '../../hooks/useFontFamily';
import { useThemeColors } from '../../hooks/useThemeColors';
import { AppDispatch, RootState } from '../../redux/store';
import { closeTabGroupsPrompt } from '../../redux/slices/globalStateSlice';
import { useTranslation } from 'react-i18next';
import { requestTabGroupsPermission } from '../../utils/functions/permissions';
import { DIALOG, ICON, RADIUS, TYPE } from '../../styles/scale';
import Icon from '../common/Icon';
import { dialogButtonStyles, pairCss, tallButtonCss } from './dialogButtons';

interface TabGroupsPermissionModalProps {
  style?: string;
}

const TITLE_ID = 'tab-groups-prompt-title';
const BODY_ID = 'tab-groups-prompt-body';

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

  const dialogRef = useRef<HTMLDialogElement>(null);

  // KAN-89. This was a plain fixed-position div -- visible, but not modal.
  // showModal() moves the dialog to the top layer, confines Tab to the
  // controls inside it, marks the rest of the popup inert, and closes it on
  // Escape. Measured on the sibling RateAndReviewModal before the fix: focus
  // never entered, Tab walked the page behind it, and Enter on a control back
  // there navigated the whole app while the dialog stayed up.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) {
      dialog.showModal();
      // KAN-243. showModal() lands focus on the first control, and on a page
      // with no pointer interaction yet Chrome paints its :focus-visible ring
      // on it -- so this opened with a blue ring around the CTA, and Enter,
      // before anyone had read it, fired the CTA. Focus the dialog itself
      // instead (tabindex=-1 below): focus is still inside, the dialog is
      // still announced by its title and description, nothing is lit, and the
      // first Tab reaches the CTA. `autofocus` on the dialog does not do this
      // in Chromium 151; measured.
      dialog.focus();
    }
  }, [tabGroupsPromptCount]);

  // Below the hooks, never above them: an early return placed at the top of
  // this component would change the number of hooks React sees between the
  // closed and open renders, which is the one thing hook ordering forbids.
  if (tabGroupsPromptCount === null) return null;

  const handleEnable = () => {
    // Deliberately NOT awaited, and deliberately followed by an unconditional
    // close. chrome.permissions.request() destroys this popup on a coin flip
    // and its promise may never settle, so there is no "then" to close in and
    // nothing here may depend on the answer. The outcome is read from
    // contains() on the next popup mount -- see permissions.ts.
    requestTabGroupsPermission();
    dispatch(closeTabGroupsPrompt());
  };

  // KAN-732. No opt-out here: the offer comes back on every open until the permission is held.
  const handleNotNow = () => dispatch(closeTabGroupsPrompt());

  // Paired keys picked by a ternary, not i18next's `_one`/`_other` suffixes:
  // that is how FocusConfirmModal does plurals and this repo has no plural
  // suffixes anywhere. Note the ru value keeps the count parenthetical,
  // because Russian declines the noun on the number.
  const bodyKey =
    tabGroupsPromptCount === 1
      ? 'TabGroupsPromptBodyOne'
      : 'TabGroupsPromptBodyOther';

  // Real <button>s, not NormalLabels with onClick: a bare div has no role and
  // no tab stop (KAN-66/67/68). The body is a <p> because NormalLabel is
  // nowrap and ran the sentence off the card.
  const buttons = dialogButtonStyles(COLORS);
  // KAN-732. The sync dialog's pair: the way out, then the yes half as wide again, at the right.
  const actionsStyle = css`
    ${pairCss}
    margin-left: auto;
  `;
  const tall = tallButtonCss(24);

  return (
    // The overlay div is gone: ::backdrop is the browser's own, and it dims the
    // top layer rather than sitting in the page, which is what stops the
    // content behind from being reachable at all.
    <dialog
      ref={dialogRef}
      // Focusable only by script, never by Tab; see the effect above.
      tabIndex={-1}
      aria-labelledby={TITLE_ID}
      aria-describedby={BODY_ID}
      // Escape is Not now.
      onCancel={handleNotNow}
      // KAN-501. Built like the confirm dialogs (CloudConsentModal) and the review prompt.
      css={css`
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        margin: 0;
        padding: 20px;
        width: ${DIALOG.WIDTH};
        max-width: none;
        max-height: none;
        background-color: ${COLORS.PRIMARY_COLOR};
        color: ${COLORS.LABEL_L1_COLOR};
        border: 1px solid ${COLORS.PANEL_BORDER_COLOR};
        border-radius: ${RADIUS.SQUARE};
        font-family: ${FONT_FAMILY};
        font-size: ${TYPE.BODY};

        /* Scoped to [open] so the dialog stays hidden until showModal() runs,
           rather than flashing as a non-modal box for a frame. */
        &[open] {
          display: block;
        }

        &::backdrop {
          background: ${COLORS.MODAL_BACKDROP};
        }

        /* The container carries initial focus (KAN-243) and is never reached
           by Tab, so a ring on it would mark nothing anyone can act on. */
        outline: none;

        ${style}
      `}
    >
      <h2
        id={TITLE_ID}
        css={css`
          display: flex;
          align-items: center;
          gap: 10px;
          margin: 0 0 12px 0;
          font-size: ${TYPE.SECTION};
          font-weight: 500;
          color: ${COLORS.TEXT_COLOR};
        `}
      >
        <Icon type="tab_group" size={ICON.DEFAULT} disable={true} />
        {t('TabGroupsPromptTitle')}
      </h2>
      <p
        id={BODY_ID}
        css={css`
          margin: 0 0 20px 0;
          line-height: 1.5;
          color: ${COLORS.LABEL_L1_COLOR};
        `}
      >
        {t(bodyKey, { count: tabGroupsPromptCount })}
      </p>
      <div css={actionsStyle}>
        <button
          type="button"
          css={[buttons.quiet, tall]}
          onClick={handleNotNow}
        >
          {t('Not now')}
        </button>
        <button
          type="button"
          css={[buttons.filled, tall]}
          onClick={handleEnable}
        >
          {t('Turn on')}
        </button>
      </div>
    </dialog>
  );
};
