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
import { DURATION, TYPE } from '../../styles/scale';

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

  const buttonStyle = css`
    padding: 8px 16px;
    border: 1px solid ${COLORS.BORDER_COLOR};
    background: none;
    color: ${COLORS.TEXT_COLOR};
    font-family: inherit;
    font-size: inherit;
    cursor: pointer;
    transition: background-color ${DURATION.MOVE};

    &:hover {
      background-color: ${COLORS.HOVER_COLOR};
    }

    &:focus-visible {
      outline: 2px solid ${COLORS.TEXT_COLOR};
      outline-offset: -4px;
    }
  `;

  // The destructive action wears the delete red every other destructive
  // control wears (KAN-204), so the two buttons cannot be confused by shape.
  const confirmButtonStyle = css`
    ${buttonStyle}
    background-color: ${COLORS.DELETE_ICON_HOVER_COLOR};
    &:hover {
      background-color: ${COLORS.DELETE_ICON_HOVER_COLOR};
    }
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
        <button type="button" css={buttonStyle} onClick={handleCancel}>
          {t('Cancel')}
        </button>
        <button type="button" css={confirmButtonStyle} onClick={handleConfirm}>
          {t('Delete')}
        </button>
      </div>
    </dialog>
  );
};
