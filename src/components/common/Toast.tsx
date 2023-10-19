import { useSelector } from 'react-redux';

import { css } from '@emotion/react';

import { RootState } from '../../redux/store';
import { useFontFamily } from '../../hooks/useFontFamily';
import { useThemeColors } from '../../hooks/useThemeColors';
import { useTranslation } from 'react-i18next';

interface ToastProps {
  style?: string;
}

export const Toast: React.FC<ToastProps> = ({ style }) => {
  const COLORS = useThemeColors();
  const FONT_FAMILY = useFontFamily();
  const { t } = useTranslation();

  const toastText = useSelector(
    (state: RootState) => state.globalState.toastText
  );
  const isToastOpen = useSelector(
    (state: RootState) => state.globalState.isToastOpen
  );
  const isSettingsPage = useSelector(
    (state: RootState) => state.globalState.isSettingsPage
  );

  if (!isToastOpen) return null;

  const toastStyle = css`
    position: fixed;
    bottom: 20px;
    ${isSettingsPage ? `right: 20px` : `left: 20px`};
    background-color: ${COLORS.PRIMARY_COLOR};
    color: ${COLORS.TEXT_COLOR};
    padding: 10px;
    border: 1px solid ${COLORS.BORDER_COLOR};
    border-radius: 0px;
    z-index: 1000;
    width: 300px;
    min-height: 50px;
    display: flex;
    justify-content: center;
    font-family: ${FONT_FAMILY};
    font-size: 0.9rem;
    align-items: center;
    user-select: none;
    ${style && style}
  `;

  return <div css={toastStyle}>{t(toastText)}</div>;
};
