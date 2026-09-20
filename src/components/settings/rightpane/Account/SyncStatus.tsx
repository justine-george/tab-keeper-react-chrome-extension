import { css } from '@emotion/react';
import { useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { getPrettyDate } from '../../../../utils/functions/local';

import Icon from '../../../common/Icon';
import { describeSyncState } from './describeSyncState';
import { useFontFamily } from '../../../../hooks/useFontFamily';
import { useThemeColors } from '../../../../hooks/useThemeColors';
import { RootState } from '../../../../redux/store';
import { TYPE } from '../../../../styles/scale';

/**
 * The sync status line (KAN-248, unboxed in KAN-253), replacing
 * LoggedIn/NotLoggedIn.
 *
 * What it says comes from describeSyncState, which reads the same facts the
 * header's cloud icon does, so the two cannot disagree. This file only draws.
 *
 * A line, not a card: it was a centred, framed box with the same 1px
 * BORDER_COLOR frame and square corners as the Buttons under it, and read
 * as the pane's biggest button. Status is information; nothing about it is
 * a target. It now sits in the pane's own grammar -- label, then content,
 * left-aligned -- with the title at BODY, not SECTION, so it does not
 * outrank the control above it.
 *
 * The sentence is LABEL_L1, not the LABEL_L3 the old cards used: L3 is the
 * 2px-marker token, 2.56:1 on Paper against the 4.5:1 body text needs, and
 * L2 clears 4.5 on only two of the five themes (syncStatus.test.tsx has the
 * numbers). A wrapping paragraph rather than a NormalLabel, which is nowrap +
 * ellipsis and would cut a sentence off at the pane's edge.
 */
const SyncStatus: React.FC = () => {
  const COLORS = useThemeColors();
  const FONT_FAMILY = useFontFamily();
  const { t, i18n } = useTranslation();

  const lastSyncedTime = useSelector(
    (s: RootState) => s.settingsDataState.lastSyncedTime
  );
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
    align-items: flex-start;
    width: 100%;
    min-width: 0;
    margin-top: 8px;
  `;

  const titleRowStyle = css`
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  `;

  const titleStyle = css`
    font-family: ${FONT_FAMILY};
    font-size: ${TYPE.BODY};
    line-height: 1.45;
    color: ${COLORS.TEXT_COLOR};
    white-space: nowrap;
  `;

  const syncedStyle = css`
    margin: 4px 0 0;
    font-family: ${FONT_FAMILY};
    font-size: ${TYPE.SECONDARY};
    line-height: 1.45;
    color: ${COLORS.LABEL_L1_COLOR};
    font-variant-numeric: tabular-nums;
  `;

  const lineStyle = css`
    margin: 4px 0 0;
    max-width: 100%;
    font-family: ${FONT_FAMILY};
    font-size: ${TYPE.SECONDARY};
    line-height: 1.45;
    color: ${COLORS.LABEL_L1_COLOR};
    text-wrap: balance;
  `;

  return (
    <div
      css={containerStyle}
      data-testid="sync-status"
      data-sync-state={state.kind}
    >
      <div css={titleRowStyle}>
        <Icon type={state.icon} disable={true} />
        <span css={titleStyle}>{t(state.title)}</span>
      </div>
      {/* KAN-255. The time is shown where "when" answers a real question:
          on and manual. In the on state it REPLACES the sentence -- the
          sentence explains what will happen, the time says it did. Manual
          keeps its sentence, an instruction, with the time above it. Failed
          and unavailable show no time: there it would read as reassurance. */}
      {lastSyncedTime !== '' &&
        (state.kind === 'on' || state.kind === 'manual') && (
          <p css={syncedStyle} data-sync-synced>
            {t('Last synced {{time}}', {
              time: getPrettyDate(lastSyncedTime, i18n.language),
            })}
          </p>
        )}
      {!(lastSyncedTime !== '' && state.kind === 'on') && (
        <p css={lineStyle} data-sync-line>
          {t(state.line)}
        </p>
      )}
    </div>
  );
};

export default SyncStatus;
