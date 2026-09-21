import { useEffect, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';

import { css } from '@emotion/react';

import { useFontFamily } from '../../hooks/useFontFamily';
import { useThemeColors } from '../../hooks/useThemeColors';
import { AppDispatch, RootState } from '../../redux/store';
import {
  closeDeleteCloudDataModal,
  deleteCloudData,
} from '../../redux/slices/globalStateSlice';
import { TYPE } from '../../styles/scale';
import { dialogButtonStyles } from './dialogButtons';

const TITLE_ID = 'delete-cloud-data-title';
const BODY_ID = 'delete-cloud-data-body';

/**
 * Confirms "Delete cloud data" (KAN-254). The same <dialog> contract as
 * FocusConfirmModal: showModal() for the top layer, focus trap and Escape;
 * Cancel first so the initial focus lands on the action that changes nothing.
 *
 * The body says the one thing the user cannot see from here: other devices on
 * the same Chrome profile hold their own copy and will upload it again unless
 * auto sync is off there too. Without that line the delete looks complete and
 * is not.
 */
export const DeleteCloudDataModal: React.FC = () => {
  const COLORS = useThemeColors();
  const FONT_FAMILY = useFontFamily();
  const { t } = useTranslation();
  const dispatch: AppDispatch = useDispatch();

  const dialogRef = useRef<HTMLDialogElement>(null);

  const isOpen = useSelector(
    (state: RootState) => state.globalState.isDeleteCloudDataModalOpen
  );

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) {
      dialog.showModal();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleCancel = () => {
    dispatch(closeDeleteCloudDataModal());
  };

  const handleConfirm = () => {
    void dispatch(deleteCloudData());
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
    width: 78%;
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

    &::backdrop {
      background: rgba(0, 0, 0, 0.8);
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
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  `;

  return (
    <dialog
      ref={dialogRef}
      css={dialogStyle}
      aria-labelledby={TITLE_ID}
      aria-describedby={BODY_ID}
      onCancel={handleCancel}
    >
      <h2 id={TITLE_ID} css={titleStyle}>
        {t('Delete your cloud data?')}
      </h2>

      <p id={BODY_ID} css={bodyStyle}>
        {t('DeleteCloudDataBody')}
      </p>

      <div css={actionsStyle}>
        <button type="button" css={buttons.quiet} onClick={handleCancel}>
          {t('Cancel')}
        </button>
        <button type="button" css={buttons.danger} onClick={handleConfirm}>
          {t('Delete')}
        </button>
      </div>
    </dialog>
  );
};
