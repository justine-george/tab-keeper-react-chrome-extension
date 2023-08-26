import { css } from "@emotion/react";
import { useThemeColors } from "../hook/useThemeColors";
import { useDispatch, useSelector } from "react-redux";
import { AppDispatch, RootState } from "../../redux/store";
import { replaceState } from "../../redux/slice/tabContainerDataStateSlice";
import {
  closeConflictModal,
  setIsNotDirty,
  syncWithThunk,
} from "../../redux/slice/globalStateSlice";
import { setPresentStartup } from "../../redux/slice/undoRedoSlice";

interface ConflictModalProps {
  style?: string;
}

export const ConflictModal: React.FC<ConflictModalProps> = ({ style }) => {
  const COLORS = useThemeColors();
  const dispatch: AppDispatch = useDispatch();

  const isConflictModalOpen = useSelector(
    (state: RootState) => state.globalState.isConflictModalOpen
  );

  const tabDataLocal = useSelector(
    (state: RootState) => state.globalState.tabDataLocal
  );

  const tabDataCloud = useSelector(
    (state: RootState) => state.globalState.tabDataCloud
  );

  if (!isConflictModalOpen) return null;

  // Assuming tabContainerData includes a `timestamp` property
  // TODO: change tabdata structure to include a lastmodified timestamp
  console.log("Inside Modal:");
  console.log("tabDataLocal:");
  console.log(tabDataLocal![0]);
  console.log("tabDataCloud:");
  console.log(tabDataCloud![0]);

  const isLocalRecent =
    tabDataLocal![0].createdTime > tabDataCloud![0].createdTime;

  const chooseLocalData = () => {
    dispatch(replaceState(tabDataLocal!));
    dispatch(syncWithThunk());
    // reset presentState in the undoRedoState
    dispatch(setPresentStartup({ tabContainerDataState: tabDataLocal! }));
    dispatch(closeConflictModal());
  };

  const chooseCloudData = () => {
    dispatch(replaceState(tabDataCloud!));
    dispatch(setIsNotDirty());
    // reset presentState in the undoRedoState
    dispatch(setPresentStartup({ tabContainerDataState: tabDataCloud! }));
    dispatch(closeConflictModal());
  };

  const overlayStyle = css`
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.6);
    z-index: 999;
    ${style && style}
  `;

  const modalContentStyle = css`
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background-color: ${COLORS.INVERSE_PRIMARY_COLOR};
    border: 1px solid ${COLORS.BORDER_COLOR};
    width: 70%;
    height: 70%;
    z-index: 1000;
    display: flex;
  `;

  const paneStyle = css`
    width: 50%;
    height: 100%;
    padding: 20px;
    border: 1px solid ${COLORS.BORDER_COLOR};
    cursor: pointer;

    &:hover {
      background-color: ${COLORS.PRIMARY_COLOR};
      color: ${COLORS.INVERSE_PRIMARY_COLOR};
    }
  `;

  return (
    <div css={overlayStyle}>
      <div css={modalContentStyle}>
        <div css={paneStyle} onClick={chooseLocalData}>
          <h2>Local Data</h2>
          <p>{isLocalRecent ? "Recent" : "Old"}</p>
          <p>Last updated: {tabDataLocal![0].createdTime}</p>
          {/* ... Display other details as needed */}
        </div>

        <div css={paneStyle} onClick={chooseCloudData}>
          <h2>Cloud Data</h2>
          <p>{!isLocalRecent ? "Recent" : "Old"}</p>
          <p>Last updated: {tabDataCloud![0].createdTime}</p>
          {/* ... Display other details as needed */}
        </div>
      </div>
    </div>
  );
};
