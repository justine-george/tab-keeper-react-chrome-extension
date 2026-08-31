import { useEffect, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';

import { css } from '@emotion/react';

import { useFontFamily } from '../../hooks/useFontFamily';
import { useThemeColors } from '../../hooks/useThemeColors';
import { AppDispatch, RootState } from '../../redux/store';
import { closeFocusModal } from '../../redux/slices/globalStateSlice';
import { focusTabContainer } from '../../redux/slices/tabContainerDataStateSlice';

const TITLE_ID = 'focus-confirm-title';
const BODY_ID = 'focus-confirm-body';

interface FocusConfirmModalProps {
  style?: string;
}

export const FocusConfirmModal: React.FC<FocusConfirmModalProps> = ({
  style,
}) => {
  const COLORS = useThemeColors();
  const FONT_FAMILY = useFontFamily();
  const { t } = useTranslation();
  const dispatch: AppDispatch = useDispatch();

  const dialogRef = useRef<HTMLDialogElement>(null);

  const focusRequest = useSelector(
    (state: RootState) => state.globalState.focusRequest
  );

  const tabGroups = useSelector(
    (state: RootState) => state.tabContainerDataState.tabGroups
  );

  const tabGroup = focusRequest
    ? tabGroups.find((group) => group.tabGroupId === focusRequest.tabGroupId)
    : undefined;

  // showModal() is what makes this modal rather than merely visible: the
  // browser moves the dialog to the top layer, confines Tab to the controls
  // inside it, marks the rest of the popup inert, and closes it on Escape.
  // The effect sits above the early return to keep hook order fixed.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) {
      dialog.showModal();
    }
  }, [focusRequest, tabGroup]);

  // Narrowing rather than asserting. A request naming a session that is no
  // longer there has nothing to confirm.
  if (!focusRequest || !tabGroup) return null;

  const { windowCount, willSave } = focusRequest;

  const bodyKey = willSave
    ? windowCount > 1
      ? 'FocusConfirmBodyOther'
      : 'FocusConfirmBodyOne'
    : windowCount > 1
      ? 'FocusConfirmBodySavedOther'
      : 'FocusConfirmBodySavedOne';

  const handleCancel = () => {
    dispatch(closeFocusModal());
  };

  const handleConfirm = () => {
    dispatch(
      focusTabContainer({
        tabGroupId: focusRequest.tabGroupId,
        goToURLText: t('Go to URL'),
        saveTitle: t('FocusAutoSaveTitle'),
      })
    );
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
    font-size: 0.9rem;

    /* Scoped to [open] so the dialog stays hidden until showModal() runs,
       rather than flashing as a non-modal box for a frame. */
    &[open] {
      display: block;
    }

    &::backdrop {
      background: rgba(0, 0, 0, 0.8);
    }

    ${style && style}
  `;

  const titleStyle = css`
    margin: 0 0 12px 0;
    font-size: 1.1rem;
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

  // TEXT_COLOR is the theme's foreground, so it contrasts with either button
  // background by construction, hover included.
  const buttonStyle = css`
    padding: 8px 16px;
    border: 1px solid ${COLORS.BORDER_COLOR};
    background: none;
    color: ${COLORS.TEXT_COLOR};
    font-family: inherit;
    font-size: inherit;
    cursor: pointer;
    transition: background-color 0.2s;

    &:hover {
      background-color: ${COLORS.HOVER_COLOR};
    }

    &:focus-visible {
      outline: 2px solid ${COLORS.TEXT_COLOR};
      outline-offset: -4px;
    }
  `;

  const confirmButtonStyle = css`
    ${buttonStyle}
    background-color: ${COLORS.SELECTION_COLOR};
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
        {t('FocusConfirmTitle', { title: tabGroup.title })}
      </h2>

      <p id={BODY_ID} css={bodyStyle}>
        {t(bodyKey, { count: windowCount })}
      </p>

      <div css={actionsStyle}>
        {/* Cancel comes first so showModal() lands the initial focus on the
            action that changes nothing. */}
        <button type="button" css={buttonStyle} onClick={handleCancel}>
          {t('FocusConfirmCancel')}
        </button>
        <button type="button" css={confirmButtonStyle} onClick={handleConfirm}>
          {t('FocusConfirmConfirm')}
        </button>
      </div>
    </dialog>
  );
};
