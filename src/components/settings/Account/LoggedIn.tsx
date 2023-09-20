import { css } from '@emotion/react';

import Icon from '../../common/Icon';
import { NormalLabel } from '../../common/Label';
import { useThemeColors } from '../../hook/useThemeColors';
import { useTranslation } from 'react-i18next';

const LoggedIn: React.FC = () => {
  const COLORS = useThemeColors();
  const { t } = useTranslation();

  const containerStyle = css`
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    padding: 22px 83px 32px;
    border: 1px solid ${COLORS.BORDER_COLOR};
    margin-top: 8px;
    border-radius: 0px;
  `;

  const iconLabelContainer = css`
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    margin-bottom: 16px;
  `;

  return (
    <div css={containerStyle}>
      <div css={iconLabelContainer}>
        <Icon
          type={`cloud_done`}
          disable={true}
          focusable={false}
          style={'padding-right: 4px;'}
        />
        <NormalLabel
          value={t(`Cloud Sync Active`)}
          size="1.1rem"
          color={COLORS.TEXT_COLOR}
          style="justify-content: center; align-items: center;"
        />
      </div>

      <NormalLabel
        value={t(`Secure token sync. No emails. Full privacy.`)}
        size="0.9rem"
        color={COLORS.LABEL_L3_COLOR}
        style="text-align: center;"
      />
    </div>
  );
};

export default LoggedIn;
