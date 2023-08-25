import { css } from "@emotion/react";
import Icon from "../common/Icon";
import { useDispatch, useSelector } from "react-redux";
import {
  openSettingsPage,
  syncWithThunk,
} from "../../redux/slice/globalStateSlice";
import { AppDispatch, RootState } from "../../redux/store";
import {
  isRedoableSelector,
  isUndoableSelector,
  redo,
  undo,
} from "../../redux/slice/undoRedoSlice";

export default function MenuContainer() {
  const syncStatus = useSelector(
    (state: RootState) => state.globalState.syncStatus
  );

  const dispatch: AppDispatch = useDispatch();

  const isUndoable = useSelector(isUndoableSelector);
  const isRedoable = useSelector(isRedoableSelector);

  function handleClickUndo() {
    dispatch(undo());
  }

  function handleClickRedo() {
    dispatch(redo());
  }

  function handleClickSync() {
    dispatch(syncWithThunk());
  }

  function handleClickSettings() {
    dispatch(openSettingsPage("General"));
  }

  // sync icon change with syncStatus
  let syncIconType = "";
  let isDisabled = false;
  if (syncStatus === "loading") {
    syncIconType = "cloud_sync";
    isDisabled = true;
  } else if (syncStatus === "error") {
    syncIconType = "sync_problem";
  } else if (syncStatus === "idle") {
    syncIconType = "sync";
  } else if (syncStatus === "success") {
    syncIconType = "cloud_done";
  }
  // console.log(syncIconType);

  const containerStyle = css`
    display: flex;
    justify-content: space-around;
  `;

  return (
    <div css={containerStyle}>
      <Icon
        type="undo"
        onClick={handleClickUndo}
        style={isUndoable ? "opacity: 1;" : "opacity: 0.3;"}
        disable={!isUndoable}
        focusable={isUndoable}
      />
      <Icon
        type="redo"
        onClick={handleClickRedo}
        style={isRedoable ? "opacity: 1;" : "opacity: 0.3;"}
        disable={!isRedoable}
        focusable={isRedoable}
      />
      <Icon
        type={syncIconType}
        onClick={handleClickSync}
        disable={isDisabled}
      />
      <Icon type="settings" onClick={handleClickSettings} />
    </div>
  );
}
