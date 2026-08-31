import { useEffect, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';

import { css } from '@emotion/react';

import { Tag } from '../common/Tag';
import { NormalLabel } from '../common/Label';
import { useFontFamily } from '../../hooks/useFontFamily';
import { useThemeColors } from '../../hooks/useThemeColors';
import { AppDispatch, RootState } from '../../redux/store';
import { setPresentStartup } from '../../redux/slices/undoRedoSlice';
import { replaceState } from '../../redux/slices/tabContainerDataStateSlice';
import {
  closeConflictModal,
  saveToFirestoreIfDirty,
  setHasSyncedBefore,
  setIsDirty,
  setIsNotDirty,
} from '../../redux/slices/globalStateSlice';
import { useTranslation } from 'react-i18next';
import { getStringDate } from '../../utils/functions/local';

const TITLE_ID = 'conflict-modal-title';

interface ConflictModalProps {
  style?: string;
}

export const ConflictModal: React.FC<ConflictModalProps> = ({ style }) => {
  const COLORS = useThemeColors();
  const FONT_FAMILY = useFontFamily();
  const { t } = useTranslation();
  const dispatch: AppDispatch = useDispatch();

  const dialogRef = useRef<HTMLDialogElement>(null);

  const isConflictModalOpen = useSelector(
    (state: RootState) => state.globalState.isConflictModalOpen
  );

  const tabDataLocal = useSelector(
    (state: RootState) => state.globalState.tabDataLocal
  );

  const tabDataCloud = useSelector(
    (state: RootState) => state.globalState.tabDataCloud
  );

  const hasSyncedBefore = useSelector(
    (state: RootState) => state.globalState.hasSyncedBefore
  );

  const hasConflictToResolve =
    isConflictModalOpen && tabDataLocal !== null && tabDataCloud !== null;

  // showModal() is what makes this modal rather than merely visible: the
  // browser moves the dialog to the top layer, confines Tab to the controls
  // inside it, marks the panes behind it inert so a screen reader cannot walk
  // into UI the user can neither see nor use, and closes it on Escape.
  // Rendering the element with the `open` attribute instead would give none of
  // that. The effect must sit above the early return to keep hook order fixed.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) {
      dialog.showModal();
    }
  }, [hasConflictToResolve]);

  // Narrowing rather than asserting: both fields really are
  // `TabMasterContainer | null`, and there is nothing to show without them.
  // This is what lets the body below read them without `!`.
  if (!hasConflictToResolve) return null;

  const isLocalRecent = tabDataLocal.lastModified > tabDataCloud.lastModified;

  const tabDataLocalLength = tabDataLocal.tabGroups.length;
  const tabDataCloudLength = tabDataCloud.tabGroups.length;

  const handleChooseLocalData = () => {
    dispatch(replaceState(tabDataLocal));
    dispatch(setIsDirty());
    dispatch(saveToFirestoreIfDirty());
    if (!hasSyncedBefore) {
      // reset presentState in the undoRedoState
      dispatch(setPresentStartup({ tabContainerDataState: tabDataLocal }));
      dispatch(setHasSyncedBefore());
    }
    dispatch(closeConflictModal());
  };

  const handleChooseCloudData = () => {
    dispatch(replaceState(tabDataCloud));
    dispatch(setIsNotDirty());
    if (!hasSyncedBefore) {
      // reset presentState in the undoRedoState
      dispatch(setPresentStartup({ tabContainerDataState: tabDataCloud }));
      dispatch(setHasSyncedBefore());
    }
    dispatch(closeConflictModal());
  };

  // Leaving the conflict unresolved writes nothing; the next sync re-offers it.
  const handleDismiss = () => {
    dispatch(closeConflictModal());
  };

  const dialogStyle = css`
    /* The UA gives <dialog> its own box; reset it back to the modal's geometry. */
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    margin: 0;
    padding: 0;
    width: 80%;
    height: 50%;
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
      display: flex;
    }

    &::backdrop {
      background: rgba(0, 0, 0, 0.8);
    }

    ${style && style}
  `;

  const paneStyle = css`
    display: flex;
    flex-direction: column;
    justify-content: flex-start;
    align-items: center;
    width: 50%;
    height: 100%;
    padding: 20px;
    margin: 0;
    border: 1px solid ${COLORS.BORDER_COLOR};
    background: none;
    color: inherit;
    font-family: inherit;
    font-size: inherit;
    text-align: left;
    cursor: pointer;
    transition: background-color 0.2s;

    /* Only the background shifts on hover. Recolouring the text here used to
       set CONTRAST_COLOR, which is an accent value rather than a foreground:
       it does not track each theme's light/dark polarity, so the heading and
       icon dropped to 1.32-1.56:1 in every theme except LIGHT. Inheriting
       LABEL_L1_COLOR instead keeps them at 5.13:1 or better everywhere. */
    &:hover {
      background-color: ${COLORS.SELECTION_COLOR};
    }

    /* TEXT_COLOR is the theme's foreground, so it contrasts with every pane
       background by construction, hover included. Inset so the ring is not
       clipped by the neighbouring pane's border. */
    &:focus-visible {
      outline: 2px solid ${COLORS.TEXT_COLOR};
      outline-offset: -4px;
    }
  `;

  const closeButtonStyle = css`
    position: absolute;
    top: 6px;
    right: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    padding: 0;
    background: none;
    border: none;
    color: ${COLORS.TEXT_COLOR};
    font-family: inherit;
    cursor: pointer;

    &:hover {
      background-color: ${COLORS.HOVER_COLOR};
    }

    &:focus-visible {
      outline: 2px solid ${COLORS.TEXT_COLOR};
      outline-offset: -2px;
    }
  `;

  const topRowStyle = css`
    display: flex;
    justify-content: flex-start;
    align-items: center;
    height: 50px;
    width: 100%;
  `;

  const latestTagStyle = `
    display: flex;
    justify-content: center;
    align-items: center;
    padding: 2px 4px;
    width: 100px;
    margin-left: 20px;
    height: 30px;
  `;

  const iconStyle = css`
    font-size: 1.5rem;
    margin-right: 4px;
  `;

  // Deliberately not iconStyle: that carries a margin-right to space the pane
  // glyphs from their headings, which would push this one off-centre.
  const closeIconStyle = css`
    font-size: 1.5rem;
  `;

  // Was an <h2>, which is invalid inside a <button>. The UA's h2 sizing
  // (1.5em of the dialog's 0.9rem) is restated here so the panes look unchanged.
  const paneHeadingStyle = css`
    font-size: 1.35rem;
    font-weight: 500;
  `;

  // Names the dialog for assistive tech without altering the visual layout.
  const visuallyHiddenStyle = css`
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  `;

  return (
    <dialog
      ref={dialogRef}
      css={dialogStyle}
      aria-labelledby={TITLE_ID}
      onCancel={handleDismiss}
    >
      <h2 id={TITLE_ID} css={visuallyHiddenStyle}>
        {t('SyncConflictHeader')}
      </h2>

      <button
        type="button"
        css={closeButtonStyle}
        onClick={handleDismiss}
        aria-label={t('SyncConflictDismissLabel')}
      >
        <span css={closeIconStyle} className="material-symbols-outlined">
          close
        </span>
      </button>

      <button type="button" css={paneStyle} onClick={handleChooseLocalData}>
        <div css={topRowStyle}>
          <span css={iconStyle} className="material-symbols-outlined">
            storage
          </span>
          <span css={paneHeadingStyle}>{t('Local Data')}</span>
          {isLocalRecent && <Tag value={t('LATEST')} style={latestTagStyle} />}
        </div>
        <NormalLabel
          value={`${t('Last updated')}: ${getStringDate(
            new Date(tabDataLocal.lastModified)
          )}`}
          size="0.9rem"
          color={COLORS.TEXT_COLOR}
          style="margin-top: 40px; align-self: flex-start;"
        />
        <NormalLabel
          value={`${tabDataLocalLength} ${
            tabDataLocalLength > 1 ? t('Saved sessions') : t('Saved session')
          }`}
          size="0.9rem"
          color={COLORS.TEXT_COLOR}
          style="margin-top: 40px; align-self: flex-start;"
        />
      </button>

      <button type="button" css={paneStyle} onClick={handleChooseCloudData}>
        <div css={topRowStyle}>
          <span css={iconStyle} className="material-symbols-outlined">
            cloud
          </span>
          <span css={paneHeadingStyle}>{t('Cloud Data')}</span>
          {!isLocalRecent && <Tag value={t('LATEST')} style={latestTagStyle} />}
        </div>
        <NormalLabel
          value={`${t('Last updated')}: ${getStringDate(
            new Date(tabDataCloud.lastModified)
          )}`}
          size="0.9rem"
          color={COLORS.TEXT_COLOR}
          style="margin-top: 40px;  align-self: flex-start;"
        />
        <NormalLabel
          value={`${tabDataCloudLength} ${
            tabDataCloudLength > 1 ? t('Saved sessions') : t('Saved session')
          }`}
          size="0.9rem"
          color={COLORS.TEXT_COLOR}
          style="margin-top: 40px; align-self: flex-start;"
        />
      </button>
    </dialog>
  );
};
