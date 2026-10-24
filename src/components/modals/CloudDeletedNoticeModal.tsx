import { useEffect, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';

import { css } from '@emotion/react';

import { useFontFamily } from '../../hooks/useFontFamily';
import { useThemeColors } from '../../hooks/useThemeColors';
import { AppDispatch, RootState } from '../../redux/store';
import {
  closeCloudDeletedNotice,
  turnSyncBackOn,
} from '../../redux/slices/globalStateSlice';
import { DIALOG, TYPE } from '../../styles/scale';
import { dialogButtonStyles, pairCss, tallButtonCss } from './dialogButtons';

const TITLE_ID = 'cloud-deleted-notice-title';
const BODY_ID = 'cloud-deleted-notice-body';

/**
 * KAN-759. Shown in the page whose sync found the cloud copy gone that this
 * device had synced with: another device deleted it, and sync is now off
 * here. The same <dialog> contract as DeleteCloudDataModal, with the way out
 * first so the first focus changes nothing.
 *
 * The sync that finds it runs after the open's first dialogs have decided,
 * so it can arrive while one of them is up. It waits for every other dialog
 * to close rather than stacking on top.
 */
export const CloudDeletedNoticeModal: React.FC = () => {
  const COLORS = useThemeColors();
  const FONT_FAMILY = useFontFamily();
  const { t } = useTranslation();
  const dispatch: AppDispatch = useDispatch();

  const dialogRef = useRef<HTMLDialogElement>(null);

  const isOpen = useSelector(
    (state: RootState) => state.globalState.isCloudDeletedNoticeOpen
  );

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const anotherIsOpen = () =>
      [...document.querySelectorAll('dialog')].some(
        (other) => other !== dialog && other.open
      );
    const observer = new MutationObserver(() => openWhenClear());
    function openWhenClear() {
      if (!dialog || dialog.open || anotherIsOpen()) return;
      observer.disconnect();
      dialog.showModal();
    }
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['open'],
    });
    openWhenClear();
    return () => observer.disconnect();
  }, [isOpen]);

  if (!isOpen) return null;

  const keepSyncOff = () => {
    dispatch(closeCloudDeletedNotice());
  };

  const turnSyncOn = () => {
    void dispatch(turnSyncBackOn());
  };

  const buttons = dialogButtonStyles(COLORS);

  const dialogStyle = css`
    /* The UA gives <dialog> its own box; reset it back to the modal's geometry. */
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
    font-family: ${FONT_FAMILY};
    font-size: ${TYPE.BODY};

    &[open] {
      display: block;
    }

    &::backdrop {
      background: ${COLORS.MODAL_BACKDROP};
    }
  `;

  const titleStyle = css`
    margin: 0 0 12px 0;
    font-size: ${TYPE.SECTION};
    font-weight: 500;
    color: ${COLORS.TEXT_COLOR};
    overflow-wrap: anywhere;
  `;

  const bodyStyle = css`
    margin: 0 0 20px 0;
    line-height: 1.5;
    color: ${COLORS.LABEL_L1_COLOR};
  `;

  const actionsStyle = css`
    ${pairCss}
    margin-left: auto;
  `;
  const tall = tallButtonCss(24);

  return (
    <dialog
      ref={dialogRef}
      css={dialogStyle}
      aria-labelledby={TITLE_ID}
      aria-describedby={BODY_ID}
      onCancel={keepSyncOff}
    >
      <h2 id={TITLE_ID} css={titleStyle}>
        {t('Your cloud copy was deleted')}
      </h2>

      <p id={BODY_ID} css={bodyStyle}>
        {t('CloudDeletedElsewhereBody')}
      </p>

      <div css={actionsStyle}>
        <button type="button" css={[buttons.quiet, tall]} onClick={keepSyncOff}>
          {t('Keep sync off')}
        </button>
        <button type="button" css={[buttons.filled, tall]} onClick={turnSyncOn}>
          {t('Turn sync on')}
        </button>
      </div>
    </dialog>
  );
};
