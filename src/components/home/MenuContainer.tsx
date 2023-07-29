import { css } from "@emotion/react";
import Icon from "../common/Icon";
import { useDispatch } from "react-redux";
import { openSettingsPage } from "../../redux/slice/globalStateSlice";

export default function MenuContainer() {
  const dispatch = useDispatch();

  function handleClickUndo() {
    // dispatch(undo()); TODO
  }

  function handleClickRedo() {
    // dispatch(redo()); TODO
  }

  function handleClickSync() {
    // dispatch(sync()); TODO
  }

  function handleClickSettings() {
    dispatch(openSettingsPage());
  }

  const containerStyle = css`
    display: flex;
    justify-content: space-around;
  `;

  return (
    <div css={containerStyle}>
      <Icon type="undo" onClick={handleClickUndo} />
      <Icon type="redo" onClick={handleClickRedo} />
      <Icon type="sync" onClick={handleClickSync} />
      <Icon type="settings" onClick={handleClickSettings} />
    </div>
  );
}
