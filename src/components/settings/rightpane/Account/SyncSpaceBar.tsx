import { useEffect, useState } from 'react';
import { css } from '@emotion/react';
import { useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';

import { useFontFamily } from '../../../../hooks/useFontFamily';
import { useThemeColors } from '../../../../hooks/useThemeColors';
import { RootState } from '../../../../redux/store';
import { DURATION, RADIUS, TYPE } from '../../../../styles/scale';
import { FIRESTORE_MAX_DOCUMENT_BYTES } from '../../../../utils/functions/local';
import { syncBytes } from '../../../../utils/functions/cloudDocument';
import { trackSyncMeasure } from './syncMeasures';
import { withoutSamples } from '../../../../utils/functions/sampleSession';
import type { TabMasterContainer } from '../../../../redux/slices/tabContainerDataStateSlice';
import {
  formatSyncLimit,
  formatSyncUsed,
  isSyncUseShown,
  syncSpaceLevel,
} from '../../../../utils/functions/syncSpace';
import { corners } from '../../../../styles/corners';

// KAN-625. What it measures: the sessions here against the sync limit, not storage in the cloud.
const LINE_KEY = {
  ok: 'SyncLimitUsed',
  near: 'SyncLimitUsedNear',
  full: 'SyncLimitUsedFull',
} as const;

// Under 1 kB the line rounds to 0 and the bar shows nothing; from there a sliver at least.
const SLIVER = '3px';

// KAN-6. The compressed size, measured off the main path; null until the first measure lands.
function useSyncBytes(container: TabMasterContainer): number | null {
  const [bytes, setBytes] = useState<number | null>(null);
  useEffect(() => {
    let current = true;
    void trackSyncMeasure(syncBytes(container)).then(
      (measured) => {
        // A measure of a container that has since changed never shows.
        if (current) setBytes(measured);
      },
      (error: unknown) => console.warn('Could not measure sync size:', error)
    );
    return () => {
      current = false;
    };
  }, [container]);
  return bytes;
}

/**
 * KAN-596. How much of the 1 MB the sync may write. KAN-6: the compressed size,
 * which reads full exactly when saveToFirestoreIfDirty refuses.
 */
const SyncSpaceBar: React.FC<{ hideWhenOk?: boolean }> = ({
  hideWhenOk = false,
}) => {
  const COLORS = useThemeColors();
  const FONT_FAMILY = useFontFamily();
  const { t, i18n } = useTranslation();
  const container = useSelector((s: RootState) => s.tabContainerDataState);
  const bytes = useSyncBytes(container);
  if (bytes === null) return null;

  const level = syncSpaceLevel(bytes);
  if (hideWhenOk && level === 'ok') return null;
  const share = Math.min(1, bytes / FIRESTORE_MAX_DOCUMENT_BYTES);
  const percent = Math.round(share * 100);
  // KAN-6. Saved sessions that round to 0 kB compressed read "under 1 kB", with the sliver.
  const isUnderOneKb =
    !isSyncUseShown(bytes) && withoutSamples(container).tabGroups.length > 0;
  const text = isUnderOneKb
    ? t('SyncLimitUsedUnder', {
        size: formatSyncUsed(1024, i18n.language),
        limit: formatSyncLimit(i18n.language),
      })
    : t(LINE_KEY[level], {
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
          ${corners(RADIUS.CONTROL)}
          background: ${COLORS.DIVIDER_COLOR};
          overflow: hidden;
        `}
      >
        <div
          // KAN-625. The exact share: whole percent drew nothing under 0.5%.
          style={{
            width: `${share * 100}%`,
            minWidth:
              isSyncUseShown(bytes) || isUnderOneKb ? SLIVER : undefined,
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
