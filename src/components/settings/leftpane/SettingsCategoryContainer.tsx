import { Fragment } from 'react';

import { useDispatch, useSelector } from 'react-redux';

import { css } from '@emotion/react';

import ClickableRow from '../../common/ClickableRow';
import Divider from '../../common/Divider';
import { NormalLabel } from '../../common/Label';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { AppDispatch, RootState } from '../../../redux/store';
import {
  SettingsCategory,
  selectCategory,
} from '../../../redux/slices/settingsCategoryStateSlice';
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

  const containerStyle = css`
    display: flex;
    flex-direction: column;
    height: 100%;
    border: 1px solid ${COLORS.BORDER_COLOR};
    margin: 6px 0 8px 0;
    overflow: auto;
    user-select: none;
  `;

  // A plain string, not css``: handed to ClickableRow's `style` prop. width
  // is explicit because a <button> shrink-wraps its content where the div it
  // replaced stretched to fill the flex column.
  const selectableStyle = (isSelected: boolean) => `
    cursor: pointer;
    transition: background-color 0.2s;
    width: 100%;
    &:hover {
      background-color: ${!isSelected ? COLORS.HOVER_COLOR : 'unset'};
    }
    background-color: ${
      isSelected ? COLORS.SELECTION_COLOR : COLORS.PRIMARY_COLOR
    };
    padding: 15px clamp(10px, 12%, 38px);
  `;

  return (
    <div css={containerStyle}>
      {settingsCategoryList.map(
        ({ name, isSelected }: SettingsCategoryContainer) => {
          return (
            // A named Fragment, not <>: the shorthand cannot take a key, and
            // this row is a div plus its Divider, so there is no single
            // element to hang the key on. `name` is the SettingsCategory enum
            // value, unique across the list by construction.
            <Fragment key={name}>
              {/* KAN-64: was a role-less div with tabIndex={0} and onClick,
                  so it took a tab stop, announced nothing (naming is
                  prohibited on `generic`) and ignored Space. The label is
                  already translated, so the name costs no new i18n key. */}
              <ClickableRow
                ariaLabel={t(name)}
                onClick={() => handleSelectCategoryClick(name)}
                style={selectableStyle(isSelected)}
              >
                <NormalLabel
                  value={t(name)}
                  size="1rem"
                  color={COLORS.LABEL_L1_COLOR}
                />
              </ClickableRow>
              <Divider />
            </Fragment>
          );
        }
      )}
    </div>
  );
};

export default SettingsCategoryContainer;
