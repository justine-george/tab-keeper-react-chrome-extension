import { css } from "@emotion/react";
import Divider from "../common/Divider";
import { NormalLabel } from "../common/Label";
import { SettingsCategory } from "../../utils/Interfaces";
import { useThemeColors } from "../hook/useThemeColors";

interface SettingsCategoryContainerProps {
  settingsCategoryList: SettingsCategory[];
  onUpdateSettingsCategoryList: Function;
}

const SettingsCategoryContainer: React.FC<SettingsCategoryContainerProps> = ({
  settingsCategoryList,
  onUpdateSettingsCategoryList,
}) => {
  const COLORS = useThemeColors();

  const containerStyle = css`
    display: flex;
    flex-direction: column;
    height: 100%;
    border: 1px solid ${COLORS.BORDER_COLOR};
    margin: 0 0 8px 0;
    overflow: auto;
    user-select: none;
  `;

  const selectableStyle = (isSelected: boolean) => css`
    cursor: pointer;
    transition: background-color 0.3s;
    &:hover {
      background-color: ${!isSelected && COLORS.HOVER_COLOR};
    }
    background-color: ${isSelected
      ? COLORS.SELECTION_COLOR
      : COLORS.PRIMARY_COLOR};
    padding: 10px 38px;
  `;

  return (
    <div css={containerStyle}>
      {settingsCategoryList.map(({ name, isSelected }: SettingsCategory) => {
        return (
          <>
            <div
              css={selectableStyle(isSelected)}
              onClick={() => onUpdateSettingsCategoryList(name)}
            >
              <NormalLabel
                value={name}
                size="1rem"
                color={COLORS.LABEL_L1_COLOR}
              />
            </div>
            <Divider />
          </>
        );
      })}
    </div>
  );
};

export default SettingsCategoryContainer;
