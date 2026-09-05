import { useDispatch, useSelector } from 'react-redux';

import { css } from '@emotion/react';

import Icon from '../../common/Icon';
import { AppDispatch, RootState } from '../../../redux/store';
import {
  closeToast,
  openSettingsPage,
  syncStateWithFirestore,
} from '../../../redux/slices/globalStateSlice';
import {
  isRedoableSelector,
  isUndoableSelector,
  redo,
  undo,
} from '../../../redux/slices/undoRedoSlice';
import { SettingsCategory } from '../../../redux/slices/settingsCategoryStateSlice';
import { useTranslation } from 'react-i18next';

export default function MenuContainer() {
  const syncStatus = useSelector(
    (state: RootState) => state.globalState.syncStatus
  );

  const isSignedIn = useSelector(
    (state: RootState) => state.globalState.isSignedIn
  );

  const { t } = useTranslation();
  const dispatch: AppDispatch = useDispatch();

  const isUndoable = useSelector(isUndoableSelector);
  const isRedoable = useSelector(isRedoableSelector);

  function handleClickUndo() {
    dispatch(undo());
    dispatch(closeToast());
  }

  function handleClickRedo() {
    dispatch(redo());
    dispatch(closeToast());
  }

  function handleClickSync() {
    dispatch(syncStateWithFirestore());
  }

  function handleClickSettings() {
    dispatch(openSettingsPage(SettingsCategory.DISPLAY));
    dispatch(closeToast());
  }

  // The control offers "sync now" only when syncing is possible AND something
  // is out of sync. Every other case shows what is true instead.
  //
  // `isSignedIn` is checked FIRST and beats any status, because it is the only
  // one of the two that decides whether the action can work at all. It is not
  // a startup flash: App.tsx dispatches setLoggedOut on a failed
  // chrome.storage.sync write, on a read-back that does not match what was
  // written, and on a token that is present but unusable. In each of those the
  // control used to invite a click that called loadFromFirestore(userId!) with
  // no userId (KAN-79).
  //
  // Note what is NOT used here: `isDirty`. globalState is rebuilt on every
  // popup open, so `isDirty === false` means "no edits yet this session", not
  // "the two sides agree" -- with auto-sync off nothing has been compared at
  // all. Only a completed sync knows that, which is what syncStatus records.
  let syncIconType: string;
  let isDisabled = false;
  if (!isSignedIn) {
    syncIconType = 'cloud_off';
    isDisabled = true;
  } else if (syncStatus === 'loading') {
    syncIconType = 'cloud_sync';
    isDisabled = true;
  } else if (syncStatus === 'error') {
    syncIconType = 'sync_problem';
  } else if (syncStatus === 'success') {
    syncIconType = 'cloud_done';
  } else {
    syncIconType = 'sync';
  }

  const containerStyle = css`
    display: flex;
    justify-content: space-around;
  `;

  return (
    <div css={containerStyle}>
      <Icon
        ariaLabel={t('Undo')}
        tooltipText={t('Undo')}
        type="undo"
        onClick={handleClickUndo}
        style={isUndoable ? 'opacity: 1;' : 'opacity: 0.3;'}
        disable={!isUndoable}
      />
      <Icon
        ariaLabel={t('Redo')}
        tooltipText={t('Redo')}
        type="redo"
        onClick={handleClickRedo}
        style={isRedoable ? 'opacity: 1;' : 'opacity: 0.3;'}
        disable={!isRedoable}
      />
      <Icon
        ariaLabel={t('Sync now')}
        tooltipText={t('Sync now')}
        type={syncIconType}
        onClick={handleClickSync}
        disable={isDisabled}
      />
      <Icon
        ariaLabel={t('Settings')}
        tooltipText={t('Settings')}
        type="settings"
        onClick={handleClickSettings}
        animationFrom={`transform: rotate(0deg);`}
        animationTo={`transform: rotate(120deg);`}
      />
    </div>
  );
}
