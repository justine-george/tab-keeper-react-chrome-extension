import { useDispatch, useSelector } from 'react-redux';

import { css } from '@emotion/react';

import { Tag } from './Tag';
import { NormalLabel } from './Label';
import { useThemeColors } from '../hook/useThemeColors';
import { AppDispatch, RootState } from '../../redux/store';
import { getStringDate } from '../../utils/helperFunctions';
import { setPresentStartup } from '../../redux/slice/undoRedoSlice';
import { replaceState } from '../../redux/slice/tabContainerDataStateSlice';
import {
  closeConflictModal,
  saveToFirestoreIfDirty,
  setHasSyncedBefore,
  setIsDirty,
  setIsNotDirty,
} from '../../redux/slice/globalStateSlice';

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

  const hasSyncedBefore = useSelector(
    (state: RootState) => state.globalState.hasSyncedBefore
  );

  if (!isConflictModalOpen) return null;

  const isLocalRecent = tabDataLocal!.lastModified > tabDataCloud!.lastModified;

  const tabDataLocalLength = tabDataLocal!.tabGroups.length;
  const tabDataCloudLength = tabDataCloud!.tabGroups.length;

  const handleChooseLocalData = () => {
    dispatch(replaceState(tabDataLocal!));
    dispatch(setIsDirty());
    dispatch(saveToFirestoreIfDirty());
    if (!hasSyncedBefore) {
      // reset presentState in the undoRedoState
      dispatch(setPresentStartup({ tabContainerDataState: tabDataLocal! }));
      dispatch(setHasSyncedBefore());
    }
    dispatch(closeConflictModal());
  };

  const handleChooseCloudData = () => {
    dispatch(replaceState(tabDataCloud!));
    dispatch(setIsNotDirty());
    if (!hasSyncedBefore) {
      // reset presentState in the undoRedoState
      dispatch(setPresentStartup({ tabContainerDataState: tabDataCloud! }));
      dispatch(setHasSyncedBefore());
    }
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
    font-family: 'Libre Franklin', sans-serif;
    font-size: 0.9rem;
    ${style && style}
  `;

  const modalContentStyle = css`
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background-color: ${COLORS.PRIMARY_COLOR};
    color: ${COLORS.LABEL_L1_COLOR};
    border: 1px solid ${COLORS.BORDER_COLOR};
    width: 80%;
    height: 50%;
    z-index: 1000;
    display: flex;
  `;

  const paneStyle = css`
    display: flex;
    flex-direction: column;
    justify-content: flex-start;
    align-items: center;
    width: 50%;
    height: 100%;
    padding: 20px;
    border: 1px solid ${COLORS.BORDER_COLOR};
    cursor: pointer;
    transition:
      background-color 0.2s,
      color 0.2s;

    &:hover {
      background-color: ${COLORS.SELECTION_COLOR};
      color: ${COLORS.CONTRAST_COLOR};
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

  const h2Style = css`
    font-weight: 500;
  `;

  return (
    <div css={overlayStyle}>
      <div css={modalContentStyle}>
        <div css={paneStyle} onClick={handleChooseLocalData}>
          <div css={topRowStyle}>
            <span css={iconStyle} className="material-symbols-outlined">
              storage
            </span>
            <h2 css={h2Style}>Local Data</h2>
            {isLocalRecent && <Tag value="LATEST" style={latestTagStyle} />}
          </div>
          <NormalLabel
            value={`Last updated: ${getStringDate(
              new Date(tabDataLocal!.lastModified)
            )}`}
            size="0.9rem"
            color={COLORS.TEXT_COLOR}
            style="margin-top: 40px; align-self: flex-start;"
          />
          <NormalLabel
            value={`${tabDataLocalLength} Tab Group${
              tabDataLocalLength > 1 ? 's' : ''
            }`}
            size="0.9rem"
            color={COLORS.TEXT_COLOR}
            style="margin-top: 40px; align-self: flex-start;"
          />
        </div>

        <div css={paneStyle} onClick={handleChooseCloudData}>
          <div css={topRowStyle}>
            <span css={iconStyle} className="material-symbols-outlined">
              cloud
            </span>
            <h2 css={h2Style}>Cloud Data</h2>
            {!isLocalRecent && <Tag value="LATEST" style={latestTagStyle} />}
          </div>
          <NormalLabel
            value={`Last updated: ${getStringDate(
              new Date(tabDataCloud!.lastModified)
            )}`}
            size="0.9rem"
            color={COLORS.TEXT_COLOR}
            style="margin-top: 40px;  align-self: flex-start;"
          />
          <NormalLabel
            value={`${tabDataCloudLength} Tab Group${
              tabDataCloudLength > 1 ? 's' : ''
            }`}
            size="0.9rem"
            color={COLORS.TEXT_COLOR}
            style="margin-top: 40px; align-self: flex-start;"
          />
        </div>
      </div>
    </div>
  );
};
