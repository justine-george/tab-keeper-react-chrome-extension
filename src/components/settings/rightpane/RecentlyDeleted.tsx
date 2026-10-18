import { useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';

import { css } from '@emotion/react';

import Button from '../../common/Button';
import { EmptyRecentlyDeletedModal } from '../../modals/EmptyRecentlyDeletedModal';
import { useFontFamily } from '../../../hooks/useFontFamily';
import { useRecentlyDeleted } from '../../../hooks/useRecentlyDeleted';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { useToday } from '../../../hooks/useToday';
import type { AppDispatch, RootState } from '../../../redux/store';
import { restoreDeletedSession } from '../../../redux/slices/tabContainerDataStateSlice';
import { TYPE } from '../../../styles/scale';
import { daysLeft, sessionWhen } from '../../../utils/functions/sessionDate';

// One width for Restore and Empty, kept when text beside them is long, so the
// column of buttons lines up.
const SAME_WIDTH = 'width: 8rem; flex-shrink: 0; justify-content: center;';

/**
 * Settings → Recently deleted (KAN-595). Sessions deleted on this device in the
 * last 30 days, newest first; Restore on every row, and Empty for all of them,
 * behind a confirm that says it cannot be undone.
 */
export function RecentlyDeleted() {
  const COLORS = useThemeColors();
  const FONT_FAMILY = useFontFamily();
  const { t, i18n } = useTranslation();
  const dispatch: AppDispatch = useDispatch();
  const today = useToday();
  const timeFormat = useSelector(
    (state: RootState) => state.settingsDataState.timeFormat
  );
  const { shown, now, empty } = useRecentlyDeleted();
  const [confirming, setConfirming] = useState(false);

  const text = (size: string, color: string) => css`
    font-family: ${FONT_FAMILY};
    font-size: ${size};
    line-height: 1.45;
    color: ${color};
    margin: 0;
  `;

  const detail = (tabCount: number, deletedAt: number) => {
    const left = daysLeft(deletedAt, now);
    return [
      t('DeletedSessionTabs', { count: tabCount }),
      t('DeletedOn', {
        when: sessionWhen(deletedAt, i18n.language, timeFormat, today),
      }),
      ...(left === null ? [] : [t('DaysLeft', { count: left })]),
    ].join(' · ');
  };

  return (
    <div
      data-settings-section
      css={css`
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        padding-left: clamp(16px, 8%, 72px);
        padding-right: clamp(16px, 8%, 72px);
        width: 100%;
        margin-top: 20px;
        padding-bottom: 24px;
      `}
    >
      {/* The settings reading width: a wide full view must not put Restore a screen away from its session. */}
      <div
        data-recently-deleted-column
        css={css`
          width: 100%;
          max-width: 36rem;
        `}
      >
        <div
          css={css`
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            width: 100%;
            min-height: 48px;
          `}
        >
          {/* Top, not centred, and line-height normal: the title sits 20px down like every panel's (KAN-606). */}
          <div
            css={css`
              align-self: flex-start;
            `}
          >
            <span
              css={[
                text(TYPE.BODY, COLORS.LABEL_L1_COLOR),
                css`
                  line-height: normal;
                `,
              ]}
            >
              {t('Recently deleted')}
            </span>
            <p
              css={[
                text(TYPE.SECONDARY, COLORS.LABEL_L1_COLOR),
                css`
                  margin-top: 4px;
                `,
              ]}
            >
              {t('Kept for 30 days, then permanently deleted.')}
            </p>
          </div>
          {shown.length > 0 && (
            <Button
              text={t('EmptyRecentlyDeleted')}
              iconType="delete"
              variant="danger"
              style={SAME_WIDTH}
              onClick={() => setConfirming(true)}
            />
          )}
        </div>

        {shown.length === 0 ? (
          <p
            css={[
              text(TYPE.SECONDARY, COLORS.LABEL_L2_COLOR),
              css`
                margin-top: 16px;
              `,
            ]}
          >
            {t('Nothing deleted in the last 30 days.')}
          </p>
        ) : (
          <div
            css={css`
              display: grid;
              width: 100%;
              margin-top: 12px;
              border-top: 1px solid ${COLORS.DIVIDER_COLOR};
            `}
          >
            {shown.map(({ session, deletedAt }) => (
              <div
                key={session.tabGroupId}
                data-testid="recently-deleted-row"
                css={css`
                  display: grid;
                  grid-template-columns: minmax(0, 1fr) auto;
                  align-items: center;
                  gap: 12px;
                  padding: 8px 0;
                  border-bottom: 1px solid ${COLORS.DIVIDER_COLOR};
                `}
              >
                <div
                  css={css`
                    min-width: 0;
                  `}
                >
                  <p
                    css={[
                      text(TYPE.BODY, COLORS.TEXT_COLOR),
                      css`
                        white-space: nowrap;
                        overflow: hidden;
                        text-overflow: ellipsis;
                      `,
                    ]}
                  >
                    {session.title}
                  </p>
                  <p
                    css={[
                      text(TYPE.SECONDARY, COLORS.LABEL_L2_COLOR),
                      css`
                        font-variant-numeric: tabular-nums;
                      `,
                    ]}
                  >
                    {detail(session.tabCount, deletedAt)}
                  </p>
                </div>
                <Button
                  text={t('RestoreDeletedSession')}
                  ariaLabel={t('RestoreDeletedSessionNamed', {
                    title: session.title,
                  })}
                  iconType="undo"
                  variant="chip"
                  style={SAME_WIDTH}
                  onClick={() => void dispatch(restoreDeletedSession(session))}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {confirming && (
        <EmptyRecentlyDeletedModal
          count={shown.length}
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            empty().catch((error: unknown) =>
              console.error('Recently deleted: could not empty', error)
            );
          }}
        />
      )}
    </div>
  );
}
