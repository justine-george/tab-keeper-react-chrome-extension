import { useRef, type KeyboardEvent } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { css, keyframes } from '@emotion/react';

import { useFontFamily } from '../../hooks/useFontFamily';
import { useThemeColors } from '../../hooks/useThemeColors';
import { useHasRisen } from '../../hooks/useHasRisen';
import type { AppDispatch, RootState } from '../../redux/store';
import { closeReviewCard } from '../../redux/slices/globalStateSlice';
import {
  setNeverAskAgainToRate,
  setSkippedUserReviewOnce,
  setUserRatedAndReviewed,
} from '../../redux/slices/settingsDataStateSlice';
import { APP_CHROME_WEBSTORE_LINK } from '../../utils/constants/common';
import { reviewCardCopy } from '../../utils/functions/reviewAsk';
import { isTabView } from '../../utils/functions/viewMode';
import { dialogButtonStyles } from '../modals/dialogButtons';
import ClickableTabKeeperMark from '../common/ClickableTabKeeperMark';
import Icon from '../common/Icon';
import { CONTROL, DURATION, EASE, ICON, TYPE } from '../../styles/scale';

const TITLE_ID = 'review-card-title';

// Look D (KAN-653, mock rounds 3-4): the full view's card is the bigger one,
// M; the popup keeps the small one. Body and Rate are TYPE.BODY in both: the
// mock's 1rem is not on the type scale (scaleConformance.test).
const SIZE = {
  full: {
    width: '440px',
    pad: 24,
    title: TYPE.TITLE,
    mark: '28px',
    gap: 10,
  },
  popup: {
    width: '360px',
    pad: 16,
    title: TYPE.SECTION,
    mark: '24px',
    gap: 8,
  },
} as const;

const RISE = keyframes`
  from { opacity: 0; transform: translateY(16px); }
  to { opacity: 1; transform: translateY(0); }
`;

// The ✕'s square: a row-high box, which the title keeps out from under.
const CLOSE_BOX = CONTROL.ROW;

/**
 * The review card (KAN-653): a corner card that asks for a rating. Not a
 * dialog -- nothing behind it is blocked, and it never takes focus, so it
 * cannot swallow a keystroke meant for the page. ✕ means Not now; "Never ask
 * again" is offered only to someone who has closed one before.
 *
 * Always mounted, so its live region exists before the card does: a region
 * that arrives with its content is not reliably announced.
 */
export function ReviewCard() {
  const reviewCard = useSelector(
    (state: RootState) => state.globalState.reviewCard
  );
  return (
    <div aria-live="polite">
      {reviewCard !== null && (
        <OpenReviewCard
          moment={reviewCard.moment}
          offersNever={reviewCard.offersNever}
        />
      )}
    </div>
  );
}

function OpenReviewCard({
  moment,
  offersNever,
}: NonNullable<RootState['globalState']['reviewCard']>) {
  const COLORS = useThemeColors();
  const FONT_FAMILY = useFontFamily();
  const { t } = useTranslation();
  const dispatch: AppDispatch = useDispatch();
  const cardRef = useRef<HTMLElement>(null);
  // Pointer input waits for the rise. Reduced motion has no rise.
  const hasRisen = useHasRisen(cardRef);

  const size = isTabView() ? SIZE.full : SIZE.popup;
  const { titleKey, bodyKey } = reviewCardCopy(moment);
  const buttons = dialogButtonStyles(COLORS);

  const notNow = () => {
    dispatch(setSkippedUserReviewOnce());
    dispatch(closeReviewCard());
  };

  const rate = () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      chrome.tabs.create({
        url: APP_CHROME_WEBSTORE_LINK + '/reviews',
        active: true,
        index: tabs[0].index + 1,
      });
    });
    dispatch(setUserRatedAndReviewed());
    dispatch(closeReviewCard());
  };

  const neverAskAgain = () => {
    dispatch(setNeverAskAgainToRate());
    dispatch(closeReviewCard());
  };

  // KAN-403. Only from inside the card, and consumed, or Chrome closes the
  // popup. An Esc anywhere else is the page's, untouched.
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape' || event.nativeEvent.isComposing) return;
    event.preventDefault();
    notNow();
  };

  const cardStyle = css`
    position: fixed;
    right: ${size.pad}px;
    bottom: ${size.pad}px;
    /* Over the Open now drawer (900), which can open over a card already
       up; under menus (1000), the tour's dim (1010) and toasts (1050). */
    z-index: 950;
    box-sizing: border-box;
    width: ${size.width};
    max-width: calc(100vw - 32px);
    padding: ${size.pad}px;
    background-color: ${COLORS.PRIMARY_COLOR};
    color: ${COLORS.LABEL_L1_COLOR};
    border: 1px solid ${COLORS.PANEL_BORDER_COLOR};
    box-shadow: ${COLORS.FLOATING_SHADOW};
    font-family: ${FONT_FAMILY};
    font-size: ${TYPE.BODY};
    pointer-events: ${hasRisen ? 'auto' : 'none'};
    animation: ${RISE} ${DURATION.MOVE} ${EASE.OUT};
    @media (prefers-reduced-motion: reduce) {
      animation: none;
    }
  `;
  const titleStyle = css`
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 0 0 ${size.gap}px 0;
    padding-right: ${CLOSE_BOX};
    font-size: ${size.title};
    /* The popup's one weight, not the heading's bold: hierarchy is size and
       colour tier (scaleConformance.test). */
    font-weight: inherit;
    color: ${COLORS.TEXT_COLOR};
    overflow-wrap: anywhere;
  `;
  const closeStyle = css`
    position: absolute;
    top: ${size.pad - 6}px;
    right: ${size.pad - 6}px;
    width: ${CLOSE_BOX};
    height: ${CLOSE_BOX};
    display: grid;
    place-items: center;
  `;
  const bodyStyle = css`
    margin: 0 0 ${size.pad - 2}px 0;
    line-height: 1.5;
  `;
  const rateStyle = css`
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    width: 100%;
    height: ${CONTROL.DEFAULT};
  `;
  const neverStyle = css`
    display: block;
    margin: 10px auto 0;
    padding: 0;
    background: none;
    border: none;
    font: inherit;
    color: ${COLORS.TEXT_COLOR};
    text-decoration: underline;
    text-underline-offset: 3px;
    cursor: pointer;
  `;

  return (
    <aside
      aria-labelledby={TITLE_ID}
      data-testid="review-card"
      ref={cardRef}
      onKeyDown={onKeyDown}
      css={cardStyle}
    >
      <h2 id={TITLE_ID} css={titleStyle}>
        <ClickableTabKeeperMark
          markSize={size.mark}
          shutterOnMountAfterMs={parseInt(DURATION.MOVE, 10)}
        />
        <span>{t(titleKey)}</span>
      </h2>
      <div css={closeStyle}>
        <Icon
          type="close"
          size={ICON.DEFAULT}
          ariaLabel={t('Not now')}
          onClick={notNow}
          style="padding: 4px;"
        />
      </div>
      <p css={bodyStyle}>{t(bodyKey)}</p>
      <button type="button" css={[buttons.filled, rateStyle]} onClick={rate}>
        <Icon
          type="star"
          size={ICON.MEDIUM}
          color={COLORS.PRIMARY_COLOR}
          disable={true}
          style="padding: 0;"
        />
        <span>{t('Rate Tab Keeper')}</span>
      </button>
      {offersNever && (
        <button type="button" css={neverStyle} onClick={neverAskAgain}>
          {t('Never ask again')}
        </button>
      )}
    </aside>
  );
}
