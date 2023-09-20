import { useDispatch, useSelector } from 'react-redux';

import { css } from '@emotion/react';

import Divider from '../common/Divider';
import { NormalLabel } from '../common/Label';
import { useThemeColors } from '../hook/useThemeColors';
import { AppDispatch, RootState } from '../../redux/store';
import {
  SettingsCategory,
  selectCategory,
} from '../../redux/slice/settingsCategoryStateSlice';
import { useTranslation } from 'react-i18next';

export interface SettingsCategoryContainer {
  name: SettingsCategory;
  isSelected: boolean;
}

const SettingsCategoryContainer: React.FC = () => {
  const COLORS = useThemeColors();
  const { t } = useTranslation();

  const settingsCategoryList = useSelector(
    (state: RootState) => state.settingsCategoryState
  );

  const dispatch: AppDispatch = useDispatch();

  const handleSelectCategoryClick = (name: SettingsCategory) => {
    dispatch(selectCategory(name));
  };

  function handleKeyPress(
    e: React.KeyboardEvent<HTMLDivElement>,
    name: SettingsCategory
  ) {
    if (e.key === 'Enter') {
      handleSelectCategoryClick(name);
    }
  }

  const containerStyle = css`
    display: flex;
    flex-direction: column;
    height: 100%;
    border: 1px solid ${COLORS.BORDER_COLOR};
    margin: 6px 0 8px 0;
    overflow: auto;
    user-select: none;
  `;

  const selectableStyle = (isSelected: boolean) => css`
    cursor: pointer;
    transition: background-color 0.2s;
    &:hover {
      background-color: ${!isSelected && COLORS.HOVER_COLOR};
    }
    background-color: ${isSelected
      ? COLORS.SELECTION_COLOR
      : COLORS.PRIMARY_COLOR};
    padding: 15px 38px;
  `;

  return (
    <div css={containerStyle}>
      {settingsCategoryList.map(
        ({ name, isSelected }: SettingsCategoryContainer) => {
          return (
            <>
              <div
                css={selectableStyle(isSelected)}
                onClick={() => handleSelectCategoryClick(name)}
                onKeyDown={(e) => handleKeyPress(e, name)}
                tabIndex={0}
              >
                <NormalLabel
                  value={t(name)}
                  size="1rem"
                  color={COLORS.LABEL_L1_COLOR}
                />
              </div>
              <Divider />
            </>
          );
        }
      )}
    </div>
  );
};

export default SettingsCategoryContainer;
