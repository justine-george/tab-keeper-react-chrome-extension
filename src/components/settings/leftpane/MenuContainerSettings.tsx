import { useDispatch } from 'react-redux';

import { css } from '@emotion/react';

import Icon from '../../common/Icon';
import { NormalLabel } from '../../common/Label';
import { AppDispatch } from '../../../redux/store';
import { useThemeColors } from '../../../hooks/useThemeColors';
import {
  closeSettingsPage,
  closeToast,
} from '../../../redux/slices/globalStateSlice';
import { useTranslation } from 'react-i18next';

export default function MenuContainer() {
  const COLORS = useThemeColors();
  const { t } = useTranslation();

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
    <div
      css={containerStyle}
      onClick={handleBackClick}
      title={t('Go back')}
      tabIndex={0}
    >
      <Icon ariaLabel="go back" type="arrow_back" />
      <NormalLabel
        value={t('Back')}
        size="1.125rem"
        color={COLORS.TEXT_COLOR}
        style="padding-left: 8px; cursor: pointer;"
      />
    </div>
  );
}
