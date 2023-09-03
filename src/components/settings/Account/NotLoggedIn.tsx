import { css } from '@emotion/react';

import Icon from '../../common/Icon';
import { NormalLabel } from '../../common/Label';
import { useThemeColors } from '../../hook/useThemeColors';

const NotLoggedIn: React.FC = () => {
  const COLORS = useThemeColors();

  const containerStyle = css`
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    padding: 22px 64px 32px;
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
          type={`cloud_off`}
          disable={true}
          focusable={false}
          style={'padding-right: 4px;'}
        />
        <NormalLabel
          value={`Cloud Sync Inactive`}
          size="1.1rem"
          color={COLORS.TEXT_COLOR}
          style="justify-content: center; align-items: center;"
        />
      </div>

      <NormalLabel
        value={`Enable Chrome sync for seamless data syncing.`}
        size="0.9rem"
        color={COLORS.LABEL_L3_COLOR}
        style="text-align: center; white-space: break-spaces;"
      />
    </div>
  );
};

export default NotLoggedIn;
