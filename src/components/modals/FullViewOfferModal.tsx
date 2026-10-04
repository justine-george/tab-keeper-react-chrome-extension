import { useEffect, useRef } from 'react';
import { useDispatch } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { css } from '@emotion/react';

import Icon from '../common/Icon';
import { useFontFamily } from '../../hooks/useFontFamily';
import { useThemeColors } from '../../hooks/useThemeColors';
import type { AppDispatch } from '../../redux/store';
import { closeFullViewOffer } from '../../redux/slices/globalStateSlice';
import { answerFullViewOffer } from '../../redux/slices/settingsDataStateSlice';
import { requestTabView } from '../../utils/functions/popOut';
import { ICON, TYPE } from '../../styles/scale';
import { dialogButtonStyles } from './dialogButtons';

const TITLE_ID = 'full-view-offer-title';
const BODY_ID = 'full-view-offer-body';

// KAN-7 §3. After the welcome, in the popup only; either answer, ✕ or Esc ends it for good.
export const FullViewOfferModal: React.FC = () => {
  const COLORS = useThemeColors();
  const FONT_FAMILY = useFontFamily();
  const { t } = useTranslation();
  const dispatch: AppDispatch = useDispatch();
  const dialogRef = useRef<HTMLDialogElement>(null);

  // Opens unlit (KAN-243): the dialog holds the focus, not its first control.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) {
      dialog.showModal();
      dialog.focus();
    }
  }, []);

  const notNow = () => {
    dispatch(answerFullViewOffer());
    dispatch(closeFullViewOffer());
  };
  // The answer is written first: the new tab can end this popup at once.
  const openFullView = () => {
    dispatch(answerFullViewOffer());
    void requestTabView();
    dispatch(closeFullViewOffer());
  };

  const buttons = dialogButtonStyles(COLORS);

  const dialogStyle = css`
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    margin: 0;
    padding: 20px;
    width: min(92%, 420px);
    max-width: none;
    max-height: none;
    background-color: ${COLORS.PRIMARY_COLOR};
    color: ${COLORS.LABEL_L1_COLOR};
    border: 1px solid ${COLORS.BORDER_COLOR};
    font-family: ${FONT_FAMILY};
    font-size: ${TYPE.BODY};
    &[open] {
      display: block;
    }
    &:focus {
      outline: none;
    }
    &::backdrop {
      background: rgba(0, 0, 0, 0.8);
    }
  `;
  const titleRowStyle = css`
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0 0 12px 0;
  `;
  const titleStyle = css`
    flex: 1;
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 0;
    font-size: ${TYPE.SECTION};
    font-weight: 500;
    color: ${COLORS.TEXT_COLOR};
  `;
  const bodyStyle = css`
    margin: 0;
    line-height: 1.5;
    color: ${COLORS.LABEL_L1_COLOR};
  `;
  const actionsStyle = css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-top: 16px;
  `;
  const withGlyphStyle = css`
    display: inline-flex;
    align-items: center;
    gap: 6px;
  `;

  return (
    <dialog
      ref={dialogRef}
      // Focusable only by script, never by Tab; see the effect above.
      tabIndex={-1}
      css={dialogStyle}
      aria-labelledby={TITLE_ID}
      aria-describedby={BODY_ID}
      onCancel={(e) => {
        e.preventDefault();
        notNow();
      }}
    >
      <div css={titleRowStyle}>
        <h2 id={TITLE_ID} css={titleStyle}>
          <Icon type="open_in_full" size={ICON.MEDIUM} />
          {t('Try the full view')}
        </h2>
        <Icon
          type="close"
          ariaLabel={t('Close')}
          tooltipText={t('Close')}
          onClick={notNow}
        />
      </div>
      <p id={BODY_ID} css={bodyStyle}>
        {t(
          'See every open window and tab beside your saved sessions, with room to sort, move and tidy them.'
        )}
      </p>
      <div css={actionsStyle}>
        <button type="button" css={buttons.link} onClick={notNow}>
          {t('Not now')}
        </button>
        <button
          type="button"
          css={[buttons.primary, withGlyphStyle]}
          onClick={openFullView}
        >
          {t('Open full view')}
          <Icon type="open_in_full" size={ICON.SMALL} />
        </button>
      </div>
    </dialog>
  );
};
