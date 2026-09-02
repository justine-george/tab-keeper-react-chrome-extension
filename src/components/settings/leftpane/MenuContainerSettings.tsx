import { useDispatch } from 'react-redux';

import Icon from '../../common/Icon';
import ClickableRow from '../../common/ClickableRow';
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

  const containerStyle = `
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
    <ClickableRow
      ariaLabel={t('Go back')}
      tooltipText={t('Go back')}
      onClick={handleBackClick}
      style={containerStyle}
    >
      <Icon type="arrow_back" />
      <NormalLabel
        value={t('Back')}
        size="1.125rem"
        color={COLORS.TEXT_COLOR}
        style="padding-left: 8px; cursor: pointer;"
      />
    </ClickableRow>
  );
}
