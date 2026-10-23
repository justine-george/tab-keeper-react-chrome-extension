import { useEffect, useId, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { css } from '@emotion/react';

import { useFontFamily } from '../../hooks/useFontFamily';
import { useThemeColors } from '../../hooks/useThemeColors';
import { DIALOG, TYPE } from '../../styles/scale';
import { dialogButtonStyles, pairCss, tallButtonCss } from './dialogButtons';

/**
 * Confirms Empty on Recently deleted (KAN-595). The same <dialog> contract as
 * DeleteCloudDataModal: showModal() for the top layer, focus trap and Escape;
 * Cancel first so the initial focus lands on the action that changes nothing.
 */
export function EmptyRecentlyDeletedModal({
  count,
  onCancel,
  onConfirm,
}: {
  count: number;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const COLORS = useThemeColors();
  const FONT_FAMILY = useFontFamily();
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const bodyId = useId();
  const buttons = dialogButtonStyles(COLORS);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      onCancel={onCancel}
      css={css`
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
      `}
    >
      <h2
        id={titleId}
        css={css`
          margin: 0 0 12px 0;
          font-size: ${TYPE.SECTION};
          font-weight: 500;
          color: ${COLORS.TEXT_COLOR};
        `}
      >
        {t('EmptyRecentlyDeletedTitle', { count })}
      </h2>
      <p
        id={bodyId}
        css={css`
          margin: 0 0 20px 0;
          line-height: 1.5;
        `}
      >
        {t('EmptyRecentlyDeletedBody', { count })}
      </p>
      {/* KAN-748. The tab groups offer's pair: Cancel, then Delete half as wide again, at the right. */}
      <div
        css={css`
          ${pairCss}
          margin-left: auto;
        `}
      >
        <button
          type="button"
          css={[buttons.quiet, tallButtonCss(24)]}
          onClick={onCancel}
        >
          {t('Cancel')}
        </button>
        <button
          type="button"
          css={[buttons.danger, tallButtonCss(24)]}
          onClick={onConfirm}
        >
          {t('Delete')}
        </button>
      </div>
    </dialog>
  );
}
