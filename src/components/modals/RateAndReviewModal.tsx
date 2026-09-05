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
import Button from '../common/Button';
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

  // KAN-75. Both dismissals are real <button>s, not NormalLabels with onClick.
  //
  // NormalLabel renders a bare `<div onClick>`: no role, no tab stop. Measured
  // in a live popup on the equivalent KAN-74 modal, the dismissal reached the
  // accessibility tree as StaticText -- a control no keyboard user can reach.
  // Since this modal has no Escape handler and no close affordance, that left
  // a keyboard-only user who could reach the CTA with no way to decline it.
  //
  // Kept in sync with TabGroupsPermissionModal's identical block by hand. Two
  // copies rather than a shared component: there are exactly two, and the
  // abstraction would have to carry the modal's whole visual language to earn
  // its name.
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
    // The overlay div is gone: ::backdrop is the browser's own, and it dims
    // the top layer rather than sitting in the page, which is what stops the
    // content behind from being reachable at all.
    <dialog
      ref={dialogRef}
      aria-labelledby={TITLE_ID}
      aria-describedby={BODY_ID}
      // Escape reaches this, and it means the same thing the visible
      // dismissal means -- not now, ask again later. Without it the dialog
      // would close itself in the DOM while the store still believed it open,
      // and it could never be reopened.
      onCancel={handleRemindLater}
      css={css`
        /* The UA gives <dialog> its own box; reset it back to the card's
           geometry. Same reset as FocusConfirmModal. */
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        margin: 0;
        max-width: none;
        max-height: none;
        background-color: ${COLORS.PRIMARY_COLOR};
        color: ${COLORS.LABEL_L1_COLOR};
        border: 1px solid ${COLORS.BORDER_COLOR};
        width: 500px;
        padding: 20px;
        align-items: flex-start;
        border-radius: 0px;
        flex-direction: column;
        padding-bottom: 25px;
        gap: 20px;

        /* Scoped to [open] so the dialog stays hidden until showModal() runs,
           rather than flashing as a non-modal box for a frame. */
        &[open] {
          display: flex;
        }

        &::backdrop {
          background: rgba(0, 0, 0, 0.8);
        }

        ${style}
      `}
    >
      <h2
        id={TITLE_ID}
        css={css`
          font-weight: 500;
          font-family: ${FONT_FAMILY};
          font-size: 1.3rem;
          margin: 10px 0;
        `}
      >
        {t('RequestUserReviewHeader')}
      </h2>
      {/* Body copy, not a control. This carried its own
            `onClick={handleRateExtension}` -- an invisible click target that
            opened the Web Store, duplicating the CTA directly beneath it and
            just as unreachable by keyboard. A sentence is not a button, so the
            handler is gone rather than promoted; the CTA below is the only way
            to the review page.

            A <p> also escapes NormalLabel's `white-space: nowrap;
            overflow: hidden`, which silently clips any body copy too long for
            the 500px card. Nothing clips today -- pt is the longest at 56
            characters -- but that is a property of the current copy, not of
            the markup. */}
      <p
        id={BODY_ID}
        css={css`
          font-family: ${FONT_FAMILY};
          font-size: 0.9rem;
          color: ${COLORS.TEXT_COLOR};
          text-align: left;
          margin: 0 0 10px 0;
        `}
      >
        {t(`RequestUserReviewText`)}
      </p>
      {/* Full width, never a fixed one. This was `width: 217px` -- sized to
            the English label and wrong for everyone else: measured in a real
            browser, 7 of the 10 locales wrapped it onto two lines inside the
            button while the card had 500px going spare (KAN-78). Spanning the
            card removes the bet that no future translation outgrows a number.

            Matches TabGroupsPermissionModal deliberately: both are "offer"
            modals and should read as one component. FocusConfirmModal is a
            different family -- a compact confirm with a right-aligned button
            pair -- and is left alone. */}
      <Button
        text={t(`Rate this app`)}
        onClick={handleRateExtension}
        ariaLabel={t(`Rate this app`)}
        iconType="thumb_up"
        style="width: 100%; margin-bottom: 10px; cursor: pointer; justify-content: center;"
      />
      <button type="button" css={dismissStyle} onClick={handleRemindLater}>
        {t(`Maybe Later`)}
      </button>
      {/* Earned, not offered: the permanent opt-out appears only after the
            user has already skipped once. */}
      {isSkippedUserReviewOnce && (
        <button type="button" css={dismissStyle} onClick={handleNeverAskAgain}>
          {t(`Never Remind Again`)}
        </button>
      )}
    </dialog>
  );
};
