import { css } from '@emotion/react';
import { useDispatch } from 'react-redux';
import Icon from '../common/Icon';
import { NormalLabel } from '../common/Label';
import { useThemeColors } from '../hook/useThemeColors';
import {
  closeSettingsPage,
  closeToast,
} from '../../redux/slice/globalStateSlice';
import { AppDispatch } from '../../redux/store';

export default function MenuContainer() {
  const COLORS = useThemeColors();

  const containerStyle = css`
    display: flex;
    justify-content: space-around;
    align-items: center;
  `;

  const dispatch: AppDispatch = useDispatch();

  const handleBackClick = () => {
    dispatch(closeSettingsPage());
    dispatch(closeToast());
  };

  return (
    <div css={containerStyle}>
      <Icon
        tooltipText="Go back"
        ariaLabel="go back"
        type="arrow_back"
        onClick={handleBackClick}
      />
      <NormalLabel
        value="Back"
        size="1.125rem"
        color={COLORS.TEXT_COLOR}
        style="padding-left: 8px;"
      />
    </div>
  );
}
