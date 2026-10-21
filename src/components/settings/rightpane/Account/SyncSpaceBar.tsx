import { useMemo } from 'react';
import { css } from '@emotion/react';
import { useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';

import { useFontFamily } from '../../../../hooks/useFontFamily';
import { useThemeColors } from '../../../../hooks/useThemeColors';
import { RootState } from '../../../../redux/store';
import { DURATION, RADIUS, TYPE } from '../../../../styles/scale';
import {
  estimateFirestoreBytes,
  FIRESTORE_MAX_DOCUMENT_BYTES,
} from '../../../../utils/functions/local';
import {
  formatSyncLimit,
  formatSyncUsed,
  isSyncUseShown,
  syncSpaceLevel,
} from '../../../../utils/functions/syncSpace';

// KAN-625. What it measures: the sessions here against the sync limit, not storage in the cloud.
const LINE_KEY = {
  ok: 'SyncLimitUsed',
  near: 'SyncLimitUsedNear',
  full: 'SyncLimitUsedFull',
} as const;

// Under 1 kB the line rounds to 0 and the bar shows nothing; from there a sliver at least.
const SLIVER = '3px';

/**
 * KAN-596. How much of the 1 MB the sync may write. It measures with
 * estimateFirestoreBytes, the same function saveToFirestoreIfDirty refuses
 * with, so the bar and the refusal cannot disagree.
 */
const SyncSpaceBar: React.FC<{ hideWhenOk?: boolean }> = ({
  hideWhenOk = false,
}) => {
  const COLORS = useThemeColors();
  const FONT_FAMILY = useFontFamily();
  const { t, i18n } = useTranslation();
  const container = useSelector((s: RootState) => s.tabContainerDataState);
  const bytes = useMemo(() => estimateFirestoreBytes(container), [container]);

  const level = syncSpaceLevel(bytes);
  if (hideWhenOk && level === 'ok') return null;
  const share = Math.min(1, bytes / FIRESTORE_MAX_DOCUMENT_BYTES);
  const percent = Math.round(share * 100);
  const text = t(LINE_KEY[level], {
    used: formatSyncUsed(bytes, i18n.language),
    limit: formatSyncLimit(i18n.language),
  });

  return (
    <div
      data-testid="sync-space"
      data-level={level}
      css={css`
        display: grid;
        gap: 6px;
        width: min(100%, 280px);
        margin-top: 12px;
      `}
    >
      <div
        role="meter"
        aria-label={t('Sync limit used')}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={text}
        css={css`
          height: 6px;
          border-radius: ${RADIUS.SQUARE};
          background: ${COLORS.DIVIDER_COLOR};
          overflow: hidden;
        `}
      >
        <div
          // KAN-625. The exact share: whole percent drew nothing under 0.5%.
          style={{
            width: `${share * 100}%`,
            minWidth: isSyncUseShown(bytes) ? SLIVER : undefined,
          }}
          css={css`
            height: 100%;
            background: ${
              level === 'ok' ? COLORS.LABEL_L2_COLOR : COLORS.DANGER_MARK
            };
            transition: width ${DURATION.MOVE};
          `}
        />
      </div>
      <p
        css={css`
          margin: 0;
          font-family: ${FONT_FAMILY};
          font-size: ${TYPE.SECONDARY};
          line-height: 1.45;
          color: ${COLORS.LABEL_L1_COLOR};
          font-variant-numeric: tabular-nums;
        `}
      >
        {text}
      </p>
    </div>
  );
};

export default SyncSpaceBar;
