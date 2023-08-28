import { css } from '@emotion/react';
import { useDispatch } from 'react-redux';
import Icon from '../common/Icon';
import { NormalLabel } from '../common/Label';
import { useThemeColors } from '../hook/useThemeColors';
import { closeSettingsPage } from '../../redux/slice/globalStateSlice';
import { AppDispatch } from '../../redux/store';

export default function MenuContainer() {
  const COLORS = useThemeColors();

  const containerStyle = css`
    display: flex;
    justify-content: space-around;
    align-items: center;
  `;

  const dispatch: AppDispatch = useDispatch();

  return (
    <div css={containerStyle}>
      <Icon type="arrow_back" onClick={() => dispatch(closeSettingsPage())} />
      <NormalLabel
        value="Back"
        size="1.125rem"
        color={COLORS.TEXT_COLOR}
        style="padding-left: 8px;"
      />
    </div>
  );
}
