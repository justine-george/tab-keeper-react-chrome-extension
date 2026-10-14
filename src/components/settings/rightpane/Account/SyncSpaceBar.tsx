import { useMemo } from 'react';
import { css } from '@emotion/react';
import { useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';

import { useFontFamily } from '../../../../hooks/useFontFamily';
import { useThemeColors } from '../../../../hooks/useThemeColors';
import { RootState } from '../../../../redux/store';
import { DURATION, TYPE } from '../../../../styles/scale';
import {
  estimateFirestoreBytes,
  FIRESTORE_MAX_DOCUMENT_BYTES,
} from '../../../../utils/functions/local';
import {
  formatSyncLimit,
  formatSyncUsed,
  syncSpaceLevel,
} from '../../../../utils/functions/syncSpace';

const LINE_KEY = {
  ok: 'SyncSpaceUsed',
  near: 'SyncSpaceUsedNear',
  full: 'SyncSpaceUsedFull',
} as const;

/**
 * KAN-596. How much of the 1 MB the sync may write. It measures with
 * estimateFirestoreBytes, the same function saveToFirestoreIfDirty refuses
 * with, so the bar and the refusal cannot disagree.
 */
const SyncSpaceBar: React.FC = () => {
  const COLORS = useThemeColors();
  const FONT_FAMILY = useFontFamily();
  const { t, i18n } = useTranslation();
  const container = useSelector((s: RootState) => s.tabContainerDataState);
  const bytes = useMemo(() => estimateFirestoreBytes(container), [container]);

  const level = syncSpaceLevel(bytes);
  const percent = Math.min(
    100,
    Math.round((bytes / FIRESTORE_MAX_DOCUMENT_BYTES) * 100)
  );
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
        aria-label={t('Sync space used')}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={text}
        css={css`
          height: 6px;
          border-radius: 3px;
          background: ${COLORS.DIVIDER_COLOR};
          overflow: hidden;
        `}
      >
        <div
          css={css`
            width: ${percent}%;
            height: 100%;
            background: ${
              level === 'ok'
                ? COLORS.LABEL_L2_COLOR
                : COLORS.DELETE_ICON_HOVER_COLOR
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
