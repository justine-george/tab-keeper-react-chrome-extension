import { useState } from 'react';

import { css } from '@emotion/react';
import { useTranslation } from 'react-i18next';

import Icon from '../../common/Icon';
import { NormalLabel } from '../../common/Label';
import type { IconName } from '../../common/iconNames';
import { useFontFamily } from '../../../hooks/useFontFamily';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { formatGroupCounts } from '../../../utils/functions/local';
import type { OpenWindow } from '../../../utils/functions/openNow';
import { TYPE } from '../../../styles/scale';

import OpenNowWindow from './OpenNowWindow';

export type OpenNowHeaderAction = {
  icon: IconName;
  // Already translated; it is the control's accessible name and its tooltip.
  label: string;
  onClick: () => void;
};

interface OpenNowPaneProps {
  // null while the first read is in flight; [] when it found nothing to list.
  windows: OpenWindow[] | null;
  // Shown in the header's action row after the collapse toggle, in order.
  actions: OpenNowHeaderAction[];
}

// The Open now pane (KAN-280): the browser's live windows, drawn the way the
// saved-session detail draws a saved one. Presentational -- the caller reads
// Chrome and hands the result in as `windows`.
export default function OpenNowPane({ windows, actions }: OpenNowPaneProps) {
  const COLORS = useThemeColors();
  const FONT_FAMILY = useFontFamily();
  const { t } = useTranslation();

  // Folded windows, by Chrome window id. Local and unsaved: a live window has
  // no identity worth keeping past this page, and an id Chrome has since
  // closed only means one stale entry nothing reads.
  const [collapsedIds, setCollapsedIds] = useState<ReadonlySet<number>>(
    () => new Set()
  );

  const listed = windows ?? [];
  const tabCount = listed.reduce((sum, w) => sum + w.tabs.length, 0);

  // Majority rules, as the saved header's toggle (KAN-206): it asks whether
  // any window on screen is open, so unfolding one by hand never leaves it
  // offering the opposite of what the pane needs.
  const anyWindowOpen = listed.some((w) => !collapsedIds.has(w.id));

  const toggleWindow = (id: number) =>
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Copied from RightPane's containerStyle, so the pane sits in its column the
  // way the saved detail does.
  const paneStyle = css`
    display: flex;
    flex-direction: column;
    padding: 8px 8px;
    height: 100%;
  `;

  // Copied from HeroContainerRight's containerStyle and topStyle.
  const headerStyle = css`
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    justify-content: space-between;
    border: 1px solid ${COLORS.BORDER_COLOR};
    font-family: ${FONT_FAMILY};
    user-select: none;
    background-color: ${COLORS.SECONDARY_COLOR};
    width: 100%;
  `;

  const topStyle = css`
    display: flex;
    flex-direction: column;
    width: 100%;
  `;

  // Copied from TabGroupDetailsContainer's containerStyle.
  const bodyStyle = css`
    display: flex;
    flex-direction: column;
    flex-grow: 1;
    margin-top: 8px;
    border: 1px solid ${COLORS.BORDER_COLOR};
    overflow: auto;
    user-select: none;
  `;

  const emptyStyle = css`
    display: flex;
    height: 100%;
    justify-content: center;
    align-items: center;
  `;

  return (
    <div css={paneStyle}>
      <div css={headerStyle}>
        <div css={topStyle}>
          <NormalLabel
            value={t('Open now')}
            size={TYPE.SECTION}
            color={COLORS.TEXT_COLOR}
            style="height: 32px; padding-left: 8px; margin-right: 8px; max-width: 100%;"
          />
          {/* No counts while loading, and none for an empty list: "0 Windows"
              says less than the body's own message does. */}
          {listed.length > 0 && (
            <NormalLabel
              value={formatGroupCounts(listed.length, tabCount, false, t)}
              size={TYPE.META}
              color={COLORS.LABEL_L1_COLOR}
              style="padding-top: 2px; padding-left: 8px;"
            />
          )}
          {/* Words, not a dot: every theme's POSITIVE_COLOR measured under
              3:1 against this header (Justine, 2026-09-24). */}
          <NormalLabel
            value={t('Updates as you browse')}
            size={TYPE.META}
            color={COLORS.LABEL_L2_COLOR}
            style="padding-top: 2px; padding-left: 8px;"
          />
        </div>
        <div
          css={css`
            display: flex;
            padding-top: 8px;
          `}
        >
          {/* Only with something to fold; with no windows it would offer
              "Expand all" over an empty list. */}
          {listed.length > 0 && (
            <Icon
              tooltipText={
                anyWindowOpen
                  ? t('Collapse all windows')
                  : t('Expand all windows')
              }
              ariaLabel={
                anyWindowOpen
                  ? t('Collapse all windows')
                  : t('Expand all windows')
              }
              type={anyWindowOpen ? 'unfold_less' : 'unfold_more'}
              onClick={() =>
                setCollapsedIds(
                  anyWindowOpen ? new Set(listed.map((w) => w.id)) : new Set()
                )
              }
            />
          )}
          {actions.map((action, index) => (
            <Icon
              // By position: the caller's list is fixed, and two actions may
              // share a label.
              key={index}
              tooltipText={action.label}
              ariaLabel={action.label}
              type={action.icon}
              onClick={action.onClick}
            />
          ))}
        </div>
      </div>
      <div css={bodyStyle}>
        {windows !== null && windows.length === 0 ? (
          <div css={emptyStyle}>
            <NormalLabel
              value={t('No other tabs are open')}
              color={COLORS.LABEL_L2_COLOR}
            />
          </div>
        ) : (
          listed.map((openWindow, index) => (
            <OpenNowWindow
              key={openWindow.id}
              openWindow={openWindow}
              index={index}
              isOpen={!collapsedIds.has(openWindow.id)}
              onToggle={() => toggleWindow(openWindow.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}
