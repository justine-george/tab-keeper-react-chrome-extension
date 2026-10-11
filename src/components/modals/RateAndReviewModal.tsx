import { useEffect, useRef } from 'react';

import { useDispatch, useSelector } from 'react-redux';

import { css } from '@emotion/react';

import { useFontFamily } from '../../hooks/useFontFamily';
import { useThemeColors } from '../../hooks/useThemeColors';
import { AppDispatch, RootState } from '../../redux/store';
import { closeRateAndReviewModal } from '../../redux/slices/globalStateSlice';
import { useTranslation } from 'react-i18next';
import {
  setNeverAskAgainToRate,
  setSkippedUserReviewOnce,
  setUserRatedAndReviewed,
  updateLastReviewRequestTime,
  SettingsData,
} from '../../redux/slices/settingsDataStateSlice';
import { APP_CHROME_WEBSTORE_LINK } from '../../utils/constants/common';
import Icon from '../common/Icon';
import { dialogButtonStyles } from './dialogButtons';
import { cardFadeIn } from '../common/cardFade';
import { DIALOG, ICON, RADIUS, TYPE } from '../../styles/scale';
import {
  asPartialSettings,
  loadFromLocalStorage,
} from '../../utils/functions/local';

interface RateAndReviewModalProps {
  style?: string;
}

const TITLE_ID = 'rate-review-title';
const BODY_ID = 'rate-review-body';

export const RateAndReviewModal: React.FC<RateAndReviewModalProps> = ({
  style,
}) => {
  const COLORS = useThemeColors();
  const FONT_FAMILY = useFontFamily();
  const { t } = useTranslation();
  const dispatch: AppDispatch = useDispatch();

  const isRateAndReviewModalOpen = useSelector(
    (state: RootState) => state.globalState.isRateAndReviewModalOpen
  );

  const dialogRef = useRef<HTMLDialogElement>(null);

  // KAN-89. This was a plain fixed-position div, which is VISIBLE but not
  // MODAL. Measured in a live popup: focus stayed on <body> when it opened,
  // five Tab presses walked the page behind it without ever entering, Enter on
  // the Settings control behind it navigated the whole app, and Escape did
  // nothing -- while the overlay still swallowed every mouse click. The pointer
  // was blocked and the keyboard was not.
  //
  // showModal() is what fixes all of that at once: the browser moves the
  // dialog to the top layer, confines Tab to the controls inside it, marks the
  // rest of the popup inert, and closes it on Escape. Same call, and same
  // reasoning, as FocusConfirmModal -- this is that component's semantics, not
  // its visual family, which stays a compact confirm and is left alone.
  //
  // The hooks sit ABOVE the early return so the hook count cannot change
  // between the closed and open renders.
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
  }, [isRateAndReviewModalOpen]);

  if (!isRateAndReviewModalOpen) return null;

  const { isSkippedUserReviewOnce = false } = asPartialSettings<SettingsData>(
    loadFromLocalStorage('settingsData')
  );

  const cleanUp = () => {
    dispatch(updateLastReviewRequestTime());
    dispatch(closeRateAndReviewModal());
  };

  const handleRateExtension = () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const currentTabIndex = tabs[0].index;
      chrome.tabs.create({
        url: APP_CHROME_WEBSTORE_LINK + '/reviews',
        active: true,
        index: currentTabIndex + 1,
      });
    });
    dispatch(setUserRatedAndReviewed());
    cleanUp();
  };

  const handleNeverAskAgain = () => {
    dispatch(setNeverAskAgainToRate());
    cleanUp();
  };

  const handleRemindLater = () => {
    if (!isSkippedUserReviewOnce) {
      dispatch(setSkippedUserReviewOnce());
    }
    cleanUp();
  };

  // KAN-75. The dismissals are real <button>s: a NormalLabel is a bare
  // `<div onClick>` no keyboard user can reach.
  //
  // KAN-501 (A1). Built like the confirm dialogs (CloudConsentModal): their
  // width and icon-and-title row, the offer's footer with the dismissal as a
  // link on the left and the filled action on the right, and the earned
  // opt-out as a quiet line under it.
  const buttons = dialogButtonStyles(COLORS);
  const dialogStyle = css`
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
    border: 1px solid ${COLORS.BORDER_COLOR};
    border-radius: ${RADIUS.SQUARE};
    font-family: ${FONT_FAMILY};
    font-size: ${TYPE.BODY};
    &[open] {
      display: block;
    }
    /* The container carries initial focus (KAN-243) and is never reached by
       Tab, so a ring on it would mark nothing anyone can act on. */
    &:focus {
      outline: none;
    }
    &::backdrop {
      background: rgba(0, 0, 0, 0.8);
    }
    ${style ?? ''}
  `;
  const titleStyle = css`
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 0 0 12px 0;
    font-size: ${TYPE.SECTION};
    font-weight: 500;
    color: ${COLORS.TEXT_COLOR};
  `;
  const bodyStyle = css`
    margin: 0 0 20px 0;
    line-height: 1.5;
    color: ${COLORS.LABEL_L1_COLOR};
  `;
  // KAN-242. Signed, on its own line in LABEL_L2, so it reads as a signature.
  const signStyle = css`
    display: block;
    margin-top: 8px;
    color: ${COLORS.LABEL_L2_COLOR};
  `;
  const footerStyle = css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  `;
  const rateStyle = css`
    display: inline-flex;
    align-items: center;
    gap: 8px;
  `;
  const neverStyle = css`
    display: block;
    margin: 12px auto 0;
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    color: ${COLORS.TEXT_COLOR};
    cursor: pointer;
    &:hover {
      text-decoration: underline;
    }
  `;

  return (
    <dialog
      ref={dialogRef}
      // Focusable only by script, never by Tab; see the effect above.
      tabIndex={-1}
      aria-labelledby={TITLE_ID}
      aria-describedby={BODY_ID}
      // Escape means what the visible dismissal means: not now, ask later.
      onCancel={handleRemindLater}
      css={[cardFadeIn, dialogStyle]}
    >
      <h2 id={TITLE_ID} css={titleStyle}>
        <Icon type="thumb_up" size={ICON.DEFAULT} disable={true} />
        {t('RequestUserReviewHeader')}
      </h2>
      <p id={BODY_ID} css={bodyStyle}>
        {t(`RequestUserReviewText`)}
        <span css={signStyle}>{t(`RequestUserReviewSignOff`)}</span>
      </p>
      <div css={footerStyle}>
        <button type="button" css={buttons.link} onClick={handleRemindLater}>
          {t(`Maybe Later`)}
        </button>
        <button
          type="button"
          css={[buttons.filled, rateStyle]}
          onClick={handleRateExtension}
        >
          <Icon
            type="star"
            size={ICON.SMALL}
            color={COLORS.PRIMARY_COLOR}
            disable={true}
            style="padding: 0;"
          />
          {t(`Rate this app`)}
        </button>
      </div>
      {/* Earned, not offered: the permanent opt-out appears only after the
            user has already skipped once. */}
      {isSkippedUserReviewOnce && (
        <button type="button" css={neverStyle} onClick={handleNeverAskAgain}>
          {t(`Never Remind Again`)}
        </button>
      )}
    </dialog>
  );
};
