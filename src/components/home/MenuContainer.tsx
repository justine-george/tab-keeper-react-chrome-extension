import { useDispatch, useSelector } from 'react-redux';

import { css } from '@emotion/react';

import Icon from '../common/Icon';
import { AppDispatch, RootState } from '../../redux/store';
import {
  closeToast,
  openSettingsPage,
  syncStateWithFirestore,
} from '../../redux/slice/globalStateSlice';
import {
  isRedoableSelector,
  isUndoableSelector,
  redo,
  undo,
} from '../../redux/slice/undoRedoSlice';
import { SettingsCategory } from '../../redux/slice/settingsCategoryStateSlice';

export default function MenuContainer() {
  const syncStatus = useSelector(
    (state: RootState) => state.globalState.syncStatus
  );

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

  // sync icon change with syncStatus
  let syncIconType = '';
  let isDisabled = false;
  if (syncStatus === 'loading') {
    syncIconType = 'cloud_sync';
    isDisabled = true;
  } else if (syncStatus === 'error') {
    syncIconType = 'sync_problem';
  } else if (syncStatus === 'idle') {
    syncIconType = 'sync';
  } else if (syncStatus === 'success') {
    syncIconType = 'cloud_done';
  }

  const containerStyle = css`
    display: flex;
    justify-content: space-around;
  `;

  return (
    <div css={containerStyle}>
      <Icon
        ariaLabel="undo"
        tooltipText="Undo"
        type="undo"
        onClick={handleClickUndo}
        style={isUndoable ? 'opacity: 1;' : 'opacity: 0.3;'}
        disable={!isUndoable}
        focusable={isUndoable}
      />
      <Icon
        ariaLabel="redo"
        tooltipText="Redo"
        type="redo"
        onClick={handleClickRedo}
        style={isRedoable ? 'opacity: 1;' : 'opacity: 0.3;'}
        disable={!isRedoable}
        focusable={isRedoable}
      />
      <Icon
        ariaLabel="sync"
        tooltipText="Sync now"
        type={syncIconType}
        onClick={handleClickSync}
        disable={isDisabled}
      />
      <Icon
        ariaLabel="settings"
        tooltipText="Settings"
        type="settings"
        onClick={handleClickSettings}
        animationFrom={`transform: rotate(0deg);`}
        animationTo={`transform: rotate(120deg);`}
      />
    </div>
  );
}
