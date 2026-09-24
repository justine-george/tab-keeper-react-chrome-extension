import { useEffect, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';

import { css } from '@emotion/react';

import { useFontFamily } from '../../hooks/useFontFamily';
import { useThemeColors } from '../../hooks/useThemeColors';
import { AppDispatch, RootState } from '../../redux/store';
import {
  cancelReplaceSessions,
  mergeSessionsFromBackup,
  replaceSessionsFromBackup,
} from '../../redux/slices/globalStateSlice';
import { DIALOG, TYPE } from '../../styles/scale';
import { dialogButtonStyles } from './dialogButtons';

const TITLE_ID = 'load-backup-title';
const BODY_ID = 'load-backup-body';

/**
 * The question after "Load sessions from a backup" has read the file (KAN-252,
 * KAN-261): Merge keeps everything saved here and adds the file's sessions
 * that are not here yet; Replace throws away what is here first and cannot be
 * undone. The same <dialog> contract as DeleteCloudDataModal, opened UNLIT as
 * the cloud question is (KAN-243): the dialog takes the focus, so Escape works
 * and the first Tab lands on Cancel, but neither answer is one accidental
 * Enter away.
 *
 * The title carries the file's count and the file name sits on its own quiet
 * line under it: a real backup is named tabkeeper_backup_1.8.0_<epoch>.json,
 * and in the title it swallowed the question. Each body sentence carries the
 * count on this device with its own One/Other pair, so no locale has to agree
 * two plurals inside one clause. Replace wears the danger style, as Delete
 * does on Delete cloud data; Merge does not -- it deletes nothing. Neither is
 * "primary": the dialog opens unlit and no answer is pre-chosen.
 */
export const LoadBackupModal: React.FC = () => {
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

  const handleMerge = () => {
    void dispatch(mergeSessionsFromBackup(pending.container));
  };

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

  const fileStyle = css`
    margin: -6px 0 12px 0;
    font-size: ${TYPE.SECONDARY};
    color: ${COLORS.LABEL_L2_COLOR};
    overflow-wrap: anywhere;
  `;

  const bodyStyle = css`
    margin: 0 0 12px 0;
    line-height: 1.5;
    color: ${COLORS.LABEL_L1_COLOR};
    overflow-wrap: anywhere;
    &:last-of-type {
      margin-bottom: 20px;
    }
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
        {t(inFile === 1 ? 'LoadBackupTitleOne' : 'LoadBackupTitleOther', {
          count: inFile,
        })}
      </h2>
      {/* Not translated: it is the user's own file name. */}
      <p css={fileStyle}>{pending.fileName}</p>

      {/* One answer per paragraph, so the eye can find the one it wants. */}
      <div id={BODY_ID}>
        <p css={bodyStyle}>
          {t(savedHere === 1 ? 'MergeKeepsOne' : 'MergeKeepsOther', {
            count: savedHere,
          })}
        </p>
        <p css={bodyStyle}>
          {t(savedHere === 1 ? 'ReplaceDeletesOne' : 'ReplaceDeletesOther', {
            count: savedHere,
          })}
        </p>
      </div>

      <div css={actionsStyle}>
        <button type="button" css={buttons.quiet} onClick={handleCancel}>
          {t('Cancel')}
        </button>
        <button type="button" css={buttons.quiet} onClick={handleMerge}>
          {t('Merge sessions')}
        </button>
        <button type="button" css={buttons.danger} onClick={handleReplace}>
          {t('Replace sessions')}
        </button>
      </div>
    </dialog>
  );
};
