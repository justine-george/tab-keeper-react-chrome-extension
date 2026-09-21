import { useEffect, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';

import { css } from '@emotion/react';

import { useFontFamily } from '../../hooks/useFontFamily';
import { useThemeColors } from '../../hooks/useThemeColors';
import { AppDispatch, RootState } from '../../redux/store';
import {
  cancelReplaceSessions,
  replaceSessionsFromBackup,
} from '../../redux/slices/globalStateSlice';
import { TYPE } from '../../styles/scale';
import { dialogButtonStyles } from './dialogButtons';

const TITLE_ID = 'replace-sessions-title';
const BODY_ID = 'replace-sessions-body';

/**
 * Confirms "Replace sessions from a backup" (KAN-252). The same <dialog>
 * contract as DeleteCloudDataModal, opened UNLIT as the cloud question is
 * (KAN-243): the dialog takes the focus, so Escape works and the first Tab
 * lands on Cancel, but Replace is not one accidental Enter away.
 *
 * The body says the two numbers the user cannot otherwise see side by side --
 * how many sessions are saved here, how many the file holds -- and that this
 * cannot be undone, which is the fact that makes the question worth asking.
 * Each count is its own sentence with its own One/Other pair, so no locale
 * has to agree two plurals inside one clause.
 */
export const ReplaceSessionsModal: React.FC = () => {
  const COLORS = useThemeColors();
  const FONT_FAMILY = useFontFamily();
  const { t } = useTranslation();
  const dispatch: AppDispatch = useDispatch();

  const dialogRef = useRef<HTMLDialogElement>(null);

  const pending = useSelector((s: RootState) => s.globalState.pendingImport);
  const savedHere = useSelector(
    (s: RootState) => s.tabContainerDataState.tabGroups.length
  );

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) {
      dialog.showModal();
      dialog.focus();
    }
  }, [pending]);

  if (pending === null) return null;

  const inFile = pending.container.tabGroups.length;

  const handleCancel = () => {
    dispatch(cancelReplaceSessions());
  };

  const handleReplace = () => {
    void dispatch(replaceSessionsFromBackup(pending.container));
  };

  const buttons = dialogButtonStyles(COLORS);

  const dialogStyle = css`
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
    overflow-wrap: anywhere;
  `;

  const actionsStyle = css`
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  `;

  return (
    <dialog
      ref={dialogRef}
      tabIndex={-1}
      css={dialogStyle}
      aria-labelledby={TITLE_ID}
      aria-describedby={BODY_ID}
      onCancel={(e) => {
        e.preventDefault();
        handleCancel();
      }}
    >
      <h2 id={TITLE_ID} css={titleStyle}>
        {t('Replace your saved sessions?')}
      </h2>

      <p id={BODY_ID} css={bodyStyle}>
        {t(
          savedHere === 1
            ? 'ReplaceSessionsHereOne'
            : 'ReplaceSessionsHereOther',
          { count: savedHere }
        )}{' '}
        {t(
          inFile === 1 ? 'ReplaceSessionsFileOne' : 'ReplaceSessionsFileOther',
          {
            count: inFile,
            file: pending.fileName,
          }
        )}{' '}
        {t('This cannot be undone.')}
      </p>

      <div css={actionsStyle}>
        <button type="button" css={buttons.quiet} onClick={handleCancel}>
          {t('Cancel')}
        </button>
        <button type="button" css={buttons.danger} onClick={handleReplace}>
          {t('Replace')}
        </button>
      </div>
    </dialog>
  );
};
