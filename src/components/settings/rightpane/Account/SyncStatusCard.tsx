import { css } from '@emotion/react';
import { useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';

import Icon from '../../../common/Icon';
import { NormalLabel } from '../../../common/Label';
import { describeSyncState } from './describeSyncState';
import { useFontFamily } from '../../../../hooks/useFontFamily';
import { useThemeColors } from '../../../../hooks/useThemeColors';
import { RootState } from '../../../../redux/store';
import { RADIUS, TYPE } from '../../../../styles/scale';

/**
 * The sync status card (KAN-248), replacing LoggedIn/NotLoggedIn.
 *
 * What it says comes from describeSyncState, which reads the same facts the
 * header's cloud icon does, so the two cannot disagree. This file only draws.
 *
 * The body line is LABEL_L1, not the LABEL_L3 the old cards used: L3 is the
 * 2px-marker token, 2.56:1 on Paper against the 4.5:1 body text needs, and
 * L2 clears 4.5 on only two of the five themes (syncStatusCard.test.tsx has
 * the numbers). Rendered as a wrapping paragraph rather than a NormalLabel,
 * which is nowrap + ellipsis and would cut a sentence off at the card's edge.
 */
const SyncStatusCard: React.FC = () => {
  const COLORS = useThemeColors();
  const FONT_FAMILY = useFontFamily();
  const { t } = useTranslation();

  const state = useSelector((s: RootState) =>
    describeSyncState({
      isSignedIn: s.globalState.isSignedIn,
      isAutoSync: s.settingsDataState.isAutoSync,
      isCloudConfigured: s.globalState.isCloudConfigured,
      syncStatus: s.globalState.syncStatus,
    })
  );

  const containerStyle = css`
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    width: 100%;
    min-width: 0;
    padding: 22px clamp(12px, 10%, 64px) 28px;
    border: 1px solid ${COLORS.BORDER_COLOR};
    margin-top: 8px;
    border-radius: ${RADIUS.SQUARE};
  `;

  const iconTitleStyle = css`
    display: flex;
    flex-direction: column;
    align-items: center;
    max-width: 100%;
    min-width: 0;
    margin-bottom: 12px;
  `;

  const lineStyle = css`
    margin: 0;
    max-width: 42ch;
    font-family: ${FONT_FAMILY};
    font-size: ${TYPE.BODY};
    line-height: 1.45;
    color: ${COLORS.LABEL_L1_COLOR};
    text-align: center;
    text-wrap: balance;
  `;

  return (
    <div
      css={containerStyle}
      data-testid="sync-status-card"
      data-sync-state={state.kind}
    >
      <div css={iconTitleStyle}>
        <Icon type={state.icon} disable={true} style={'padding-right: 4px;'} />
        <NormalLabel
          value={t(state.title)}
          size={TYPE.SECTION}
          color={COLORS.TEXT_COLOR}
          style="justify-content: center; align-items: center;"
        />
      </div>
      <p css={lineStyle} data-sync-line>
        {t(state.line)}
      </p>
    </div>
  );
};

export default SyncStatusCard;
