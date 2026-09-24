import { css } from '@emotion/react';
import { useTranslation } from 'react-i18next';

import ClickableRow from '../../common/ClickableRow';
import Icon from '../../common/Icon';
import { NormalLabel } from '../../common/Label';
import { Tag } from '../../common/Tag';
import { useFontFamily } from '../../../hooks/useFontFamily';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { NON_INTERACTIVE_ICON_STYLE } from '../../../utils/constants/common';
import { resolveFaviconUrl } from '../../../utils/functions/local';
import { switchToOpenTab } from '../../../utils/functions/openNow';
import type { OpenTab, OpenWindow } from '../../../utils/functions/openNow';
import {
  partitionTabsIntoRuns,
  sanitizeTabGroupColor,
  TAB_GROUP_COLOR_HEX,
} from '../../../utils/functions/tabGroups';
import {
  ADJACENT_GROUP_GAP_PX,
  BAND_MARGIN_PX,
} from '../rightpane/bandSpacing';
import { TYPE } from '../../../styles/scale';

// WindowEntryContainer's GROUP_TITLE_SIZE, the one documented off-scale size
// (scaleConformance.test.ts). Copied rather than exported from there, for the
// reason the styles below are.
const GROUP_TITLE_SIZE = '0.85rem';

interface OpenNowWindowProps {
  openWindow: OpenWindow;
  index: number;
  isOpen: boolean;
  onToggle: () => void;
}

// One live window in the Open now pane (KAN-280): its row, its group bands
// and its tab rows. Read-only apart from the fold and click-to-switch.
export default function OpenNowWindow({
  openWindow,
  index,
  isOpen,
  onToggle,
}: OpenNowWindowProps) {
  const COLORS = useThemeColors();
  const FONT_FAMILY = useFontFamily();
  const { t } = useTranslation();

  // Copied from WindowEntryContainer's own containerStyle, parentStyle,
  // parentLeftStyle, childrenContainerStyle, childrenStyle, childLeftStyle and
  // windowChildLinkStyle (WindowEntryContainer.tsx:334-478 when copied), NOT
  // imported: the drag engine owns that file's CSS
  // channels, so the saved pane must not change for this one. Live and saved
  // rows must still measure the same (KAN-280, "Rows look like saved rows"),
  // which e2e/open-now.spec.ts tests 7, 7b and 7c pin.
  const containerStyle = css`
    display: flex;
    flex-direction: column;
    font-family: ${FONT_FAMILY};
    margin-bottom: 8px;
  `;

  const parentStyle = css`
    position: relative;
    display: flex;
    justify-content: space-between;
    &:hover {
      background-color: ${COLORS.HOVER_COLOR};
    }
  `;

  const parentLeftStyle = css`
    display: flex;
    align-items: center;
    flex-grow: 1;
    min-width: 0;
  `;

  const childrenContainerStyle = css`
    padding-left: 70px;
  `;

  // The active tab's shade sits below the hover rule, so hovering it still
  // answers the pointer.
  const childrenStyle = (active: boolean) => css`
    position: relative;
    display: flex;
    align-items: stretch;
    justify-content: space-between;
    ${active ? `background-color: ${COLORS.SECONDARY_COLOR};` : ''}
    &:hover {
      background-color: ${COLORS.HOVER_COLOR};
    }
  `;

  // A plain string, not css``: handed to ClickableRow's `style` prop.
  const childLeftStyle = `
    display: flex;
    align-items: center;
    flex-grow: 1;
    min-width: 0;
  `;

  const windowChildLinkStyle = css`
    text-decoration: none;
    color: inherit;
    display: flex;
    align-items: center;
    height: 100%;
    flex-grow: 1;
    min-width: 0;
    margin-left: 4px;
    margin-right: 4px;
    cursor: pointer;
  `;

  const windowTitleStyle = css`
    display: flex;
    align-items: center;
    height: 100%;
    flex-grow: 1;
    min-width: 0;
    padding-right: 9px;
  `;

  const title = t('Window') + ' ' + (index + 1);

  // The adapters partitionTabsIntoRuns takes, keyed back to the OpenTab by id
  // afterwards. One partition rule for both panes, so a live group draws where
  // the saved one would.
  const tabsById = new Map(openWindow.tabs.map((tab) => [String(tab.id), tab]));
  const runs = partitionTabsIntoRuns(
    openWindow.tabs.map((tab) => ({
      tabId: String(tab.id),
      favicon: tab.favIconUrl,
      title: tab.title,
      url: tab.url,
      chromeGroupId: tab.groupId === null ? undefined : String(tab.groupId),
    })),
    openWindow.groups.map((group) => ({
      groupId: String(group.id),
      title: group.title,
      color: group.color,
    }))
  );

  function renderTab(tab: OpenTab) {
    return (
      <div key={tab.id} css={childrenStyle(tab.active)}>
        <ClickableRow
          ariaLabel={t('Switch to tab') + ': ' + tab.title}
          ariaCurrent={tab.active}
          // Chrome rejects when the tab closed after this row was drawn. There
          // is nothing to switch to, and the next read drops the row.
          onClick={() => void switchToOpenTab(tab).catch(() => undefined)}
          style={childLeftStyle}
        >
          <Icon
            faviconUrl={resolveFaviconUrl(tab.favIconUrl, tab.url)}
            type="globe"
            style={`&:hover {background-color: unset;}`}
          />
          <div css={windowChildLinkStyle}>
            <NormalLabel
              value={tab.title}
              color={COLORS.TEXT_COLOR}
              size={TYPE.BODY}
              // The active title keeps the one weight the popup uses
              // (scaleConformance.test.ts, KAN-205); the row's shade alone
              // marks it (KAN-280).
              style="padding-left: 4px; height: 100%; max-width: 100%;"
            />
          </div>
        </ClickableRow>
      </div>
    );
  }

  const renderTabsOf = (tabIds: string[]) =>
    tabIds.flatMap((tabId) => {
      const tab = tabsById.get(tabId);
      return tab ? [renderTab(tab)] : [];
    });

  return (
    <div css={containerStyle} data-open-window-id={openWindow.id}>
      <div css={parentStyle}>
        <div css={parentLeftStyle}>
          <Icon
            tooltipText={isOpen ? t('Collapse') : t('Expand')}
            // Names its window, as the tab rows name their tab, so N windows
            // are not N identical "Collapse" buttons (KAN-280).
            ariaLabel={(isOpen ? t('Collapse') : t('Expand')) + ': ' + title}
            ariaExpanded={isOpen}
            type={isOpen ? 'expand_less' : 'expand_more'}
            onClick={onToggle}
          />
          <Icon type="web_asset" style={NON_INTERACTIVE_ICON_STYLE} />
          <div css={windowTitleStyle}>
            <NormalLabel
              value={title}
              color={COLORS.TEXT_COLOR}
              size={TYPE.BODY}
              style="padding-left: 8px; height: 100%; max-width: 100%;"
            />
            {openWindow.isThisWindow && (
              <Tag
                value={t('This window')}
                style="margin-left: 8px; flex-shrink: 0; white-space: nowrap;"
              />
            )}
          </div>
        </div>
      </div>
      {isOpen && (
        <div css={childrenContainerStyle}>
          {runs.map((run, runIndex) => {
            if (run.kind === 'ungrouped') {
              return renderTabsOf(run.tabs.map((tab) => tab.tabId));
            }
            // Already a TabGroupColor on the way in; the partition hands it
            // back as the saved shape's string, so it is narrowed again.
            const color = sanitizeTabGroupColor(run.group.color);
            const groupName = run.group.title || t('Unnamed group');
            return (
              // The saved band, at rest (KAN-280: a live grouped tab sits
              // exactly where a saved one does). Copied, not shared, for the
              // reason the styles above are:
              // (line numbers as of the copy; the names are what to search)
              //   band        the role="group" band's css in
              //               WindowEntryContainer.tsx (945-966)
              //   strip       bandStyle in GroupColorPicker.tsx (101-125)
              //   column      the band's flex: 1 column in
              //               WindowEntryContainer.tsx (1073-1077)
              //   title row   the data-group-drag-handle row and its
              //               ClickableRow style (1098-1120, 1218)
              //   title label groupTitleLabel in
              //               WindowEntryContainer.tsx (516-522)
              // Only the resting declarations: the drag-only rules
              // ([data-drag-held], [data-drag-removed], [data-drop-target],
              // the strip's hover widen) never apply here, and the strip's
              // var(--frame-top, 0px) / var(--frame-bottom, 0px) margins are
              // written as their resting 0.
              <div
                key={run.group.groupId}
                role="group"
                aria-label={groupName}
                data-after-group={
                  runIndex > 0 && runs[runIndex - 1].kind === 'group'
                    ? ''
                    : undefined
                }
                css={css`
                  display: flex;
                  align-items: stretch;
                  margin: ${BAND_MARGIN_PX}px 0;
                  &[data-after-group] {
                    margin-top: ${ADJACENT_GROUP_GAP_PX}px;
                  }
                `}
              >
                <div
                  aria-hidden="true"
                  data-open-now-group-strip
                  css={css`
                    flex: 0 0 7px;
                    width: 7px;
                    margin-right: 9px;
                    align-self: stretch;
                    background-color: ${TAB_GROUP_COLOR_HEX[color]};
                    margin-top: 0px;
                    margin-bottom: 0px;
                  `}
                />
                <div
                  css={css`
                    flex: 1;
                    min-width: 0;
                  `}
                >
                  {/* No hover fill: unlike the saved title, this one opens
                      nothing. The saved row's padding-right: 100px keeps its
                      title clear of the action strip; there is none here. */}
                  <div
                    css={css`
                      position: relative;
                      display: flex;
                      align-items: center;
                      min-height: 32px;
                    `}
                  >
                    <div
                      css={css`
                        display: flex;
                        align-items: center;
                        align-self: stretch;
                        min-width: 0;
                        width: 100%;
                        box-sizing: border-box;
                      `}
                    >
                      <NormalLabel
                        value={groupName}
                        color={
                          run.group.title
                            ? COLORS.LABEL_L2_COLOR
                            : COLORS.LABEL_L3_COLOR
                        }
                        size={GROUP_TITLE_SIZE}
                        style={`padding-left: 4px;${
                          run.group.title ? '' : ' font-style: italic;'
                        }`}
                      />
                    </div>
                  </div>
                  <div>{renderTabsOf(run.tabs.map((tab) => tab.tabId))}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
