import { useRef, useState } from 'react';

import { css } from '@emotion/react';
import { useTranslation } from 'react-i18next';

import Button from '../../common/Button';
import ClickableRow from '../../common/ClickableRow';
import Icon from '../../common/Icon';
import { NormalLabel } from '../../common/Label';
import { Tag } from '../../common/Tag';
import { useFontFamily } from '../../../hooks/useFontFamily';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { NON_INTERACTIVE_ICON_STYLE } from '../../../utils/constants/common';
import { resolveFaviconUrl } from '../../../utils/functions/local';
import {
  setOpenTabMuted,
  switchToOpenTab,
} from '../../../utils/functions/openNow';
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
import { DURATION, ICON, TYPE } from '../../../styles/scale';

// WindowEntryContainer's GROUP_TITLE_SIZE, the one documented off-scale size
// (scaleConformance.test.ts). Copied rather than exported from there, for the
// reason the styles below are.
const GROUP_TITLE_SIZE = '0.85rem';

// Icon's box: its glyph plus 4px padding a side. rem-based, so it follows
// Chrome's font size (KAN-312).
const ICON_SLOT = `calc(${ICON.DEFAULT} + 8px)`;
const speakerSlotStyle = css`
  display: flex;
  align-items: center;
  flex: none;
  margin-right: ${ICON_SLOT};
`;
// The icon slot × uses: no border, no resting fill. Button's quiet palette
// still gives it the icon hover and press fills.
const speakerButtonStyle = `
  border: none;
  padding: 0;
  height: auto;
  background-color: transparent;
`;

// A held Enter or Space repeats into whatever has focus, and after a close
// that is the next row's × (KAN-280 O7b). Its repeats stop here, in the
// capture phase, before the Icon's own keydown turns each into a click: one
// press closes one tab. Other keys pass, so a held Tab still moves on. The
// speaker is a native <button>, whose repeats would each be the browser's own
// click, so they stop here too: one press toggles once (KAN-280 O10a, O7b).
function holdBackRepeatedActivation(event: React.KeyboardEvent) {
  if (!event.repeat || (event.key !== 'Enter' && event.key !== ' ')) return;
  event.preventDefault();
  event.stopPropagation();
}

// A click whose count is past 1 is a double-click's second click, and it
// does nothing (KAN-280 O7c). On a close, the row below has moved up under
// the pointer, so it would close that row too. On the speaker (O10a), it
// would undo the first click. Icon's key press arrives through click() with
// a count of 0.
function onFirstClickOnly(action: () => void): React.MouseEventHandler {
  return (event) => {
    if (event.detail > 1) return;
    action();
  };
}

interface OpenNowWindowProps {
  openWindow: OpenWindow;
  index: number;
  isOpen: boolean;
  onToggle: () => void;
  onCloseTab: (tab: OpenTab) => void;
  onSaveWindow: () => void;
  // Absent for "This window": closing it would close the tab view itself.
  onCloseWindow?: () => void;
}

// One live window in the Open now pane (KAN-280): its row, its group bands
// and its tab rows, with the fold, click-to-switch and the close controls
// (O7a), and Save window (O13). The pane owns what a close or a save does.
export default function OpenNowWindow({
  openWindow,
  index,
  isOpen,
  onToggle,
  onCloseTab,
  onSaveWindow,
  onCloseWindow,
}: OpenNowWindowProps) {
  const COLORS = useThemeColors();
  const FONT_FAMILY = useFontFamily();
  const { t } = useTranslation();

  const [isParentHovered, setIsParentHovered] = useState(false);
  // By Chrome tab id, not by position, for KAN-127's reason: a re-read (and,
  // later, a drag) moves rows, and a position-keyed flag would then reveal
  // whichever tab moved into the hovered slot.
  const [hoveredTabId, setHoveredTabId] = useState<number | null>(null);
  // KAN-280 O10a rule 4A: a speaker whose reason (audible/muted) went away
  // stays while the pointer or focus is still on it, so the target does not
  // vanish out from under a click or between tracks. Keyed by tab id for
  // hoveredTabId's own reason above (KAN-127).
  const [pointerSpeakerTabId, setPointerSpeakerTabId] = useState<number | null>(
    null
  );
  const [focusSpeakerTabId, setFocusSpeakerTabId] = useState<number | null>(
    null
  );
  // A row can leave this window (a move, KAN-127) with no mouseleave or blur
  // on its speaker to release a hold -- jsdom fires neither for a removed
  // element, and a real browser fires blur but not mouseleave. Left stale,
  // the id would light up a phantom speaker if the same tab id returns here.
  // A hold only ever means "on a row of THIS window", so it cannot outlive
  // that row. Corrected during render, not in an effect
  // (react-hooks/set-state-in-effect, KAN-51): each check only fires the
  // setState it guards, and only on the render where the held tab has
  // actually gone, so it settles in the same extra pass React already gives
  // a render-time state correction.
  if (
    pointerSpeakerTabId !== null &&
    !openWindow.tabs.some((tab) => tab.id === pointerSpeakerTabId)
  ) {
    setPointerSpeakerTabId(null);
  }
  if (
    focusSpeakerTabId !== null &&
    !openWindow.tabs.some((tab) => tab.id === focusSpeakerTabId)
  ) {
    setFocusSpeakerTabId(null);
  }
  // A mousedown on the speaker precedes both jsdom's userEvent and real
  // Chromium's own focus (measured order: pointerdown, mousedown, focus), so
  // it marks the focus that follows as pointer-caused. :focus-visible would
  // say the same thing (KAN-280 O7d's precedent), but jsdom 30.0.1 never
  // matches it even once focused, so this tracks the press directly instead.
  const pointerPressTabIdRef = useRef<number | null>(null);

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

  // The action strips (KAN-280 O7a), copied from WindowEntryContainer's
  // parentRightStyle and childRightStyle for the same reason, less the
  // saved row's editing and search cases. KAN-100: the mask lands in one
  // frame with the row's fill and only the icons ease, or the row fills in
  // two halves with an edge between them. Keyboard focus reveals them too
  // (KAN-68), and only keyboard focus: after a mouse close, focus moves to
  // the next row's × (O7b), and :focus-within would show it under a pointer
  // that has moved on (KAN-280 O7d). :has(:focus-visible), as KAN-94's
  // TabGroupEntry does.
  const parentRightStyle = css`
    display: flex;
    position: absolute;
    top: 50%;
    right: 0;
    transform: translateY(-50%);
    background-color: ${isParentHovered ? COLORS.HOVER_COLOR : 'transparent'};
    & > * {
      opacity: ${isParentHovered ? 1 : 0};
      transition: opacity ${DURATION.COLOR} ease-out;
    }
    &:has(:focus-visible) {
      background-color: ${COLORS.HOVER_COLOR};
      & > * {
        opacity: 1;
      }
    }
  `;

  const childRightStyle = (tabId: number) => css`
    position: absolute;
    top: 50%;
    right: 0;
    transform: translateY(-50%);
    background-color: ${hoveredTabId === tabId
      ? COLORS.HOVER_COLOR
      : 'transparent'};
    & > * {
      opacity: ${hoveredTabId === tabId ? 1 : 0};
      transition: opacity ${DURATION.COLOR} ease-out;
    }
    &:has(:focus-visible) {
      background-color: ${COLORS.HOVER_COLOR};
      & > * {
        opacity: 1;
      }
    }
  `;

  const childrenContainerStyle = css`
    padding-left: 70px;
  `;

  // The bar alone marks the active tab (KAN-280 M3, Justine's pick B3, then
  // no shade): a resting shade read as a hovered row. The bar is LABEL_L2,
  // KAN-199's quietest token clearing 3:1 on the pane and on hover. Drawn as
  // ::before so the row keeps the saved row's size.
  const frontTabBar = `
    &::before {
      content: '';
      position: absolute;
      left: 0;
      top: 8px;
      bottom: 8px;
      width: 3px;
      background: ${COLORS.LABEL_L2_COLOR};
      pointer-events: none;
    }
  `;
  const childrenStyle = (active: boolean) => css`
    position: relative;
    display: flex;
    align-items: stretch;
    justify-content: space-between;
    ${active ? frontTabBar : ''}
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
      <div
        key={tab.id}
        css={childrenStyle(tab.active)}
        data-open-tab-id={tab.id}
        onMouseEnter={() => setHoveredTabId(tab.id)}
        onMouseLeave={() => setHoveredTabId(null)}
      >
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
              // (scaleConformance.test.ts, KAN-205); the row's bar alone
              // marks it (KAN-280 M3).
              style="padding-left: 4px; height: 100%; max-width: 100%;"
            />
          </div>
        </ClickableRow>
        {(tab.audible ||
          tab.muted ||
          pointerSpeakerTabId === tab.id ||
          focusSpeakerTabId === tab.id) && (
          // KAN-280 O10a (1B): after the Switch button and one slot in from
          // the edge, so × keeps the same column on every row. Its own
          // button, never inside the Switch button. A double-click (O7c) and
          // a held key (O7b) each toggle once. Rule 4A: a click that removes
          // the thing it clicked, or a speaker that goes between tracks,
          // loses the pointer's target, so the hold above keeps it up until
          // the pointer or focus leaves.
          <span
            data-speaker
            css={speakerSlotStyle}
            onKeyDownCapture={holdBackRepeatedActivation}
            onMouseEnter={() => setPointerSpeakerTabId(tab.id)}
            onMouseLeave={() =>
              setPointerSpeakerTabId((id) => (id === tab.id ? null : id))
            }
            // A press hands the hold to the pointer outright: it marks the
            // focus that follows as the press's own (consumed below, so it
            // never starts a focus hold), and drops any focus hold this tab
            // already had, since a keyboard-focused speaker can still be
            // clicked.
            onMouseDown={() => {
              pointerPressTabIdRef.current = tab.id;
              setPointerSpeakerTabId(tab.id);
              setFocusSpeakerTabId((id) => (id === tab.id ? null : id));
            }}
            onFocus={() => {
              if (pointerPressTabIdRef.current === tab.id) {
                pointerPressTabIdRef.current = null;
                return;
              }
              setFocusSpeakerTabId(tab.id);
            }}
            onBlur={() => {
              setFocusSpeakerTabId((id) => (id === tab.id ? null : id));
              // A press on an already-focused speaker never re-fires focus,
              // so onFocus above never gets a turn to consume the ref
              // (KAN-280 O10a rule 4A). Once focus actually leaves, that
              // press is over regardless of how it ended (a click, or a
              // drag released elsewhere) -- clear it here so a later,
              // genuine refocus of this tab is never mistaken for it.
              if (pointerPressTabIdRef.current === tab.id) {
                pointerPressTabIdRef.current = null;
              }
            }}
          >
            <Button
              iconType="volume_up"
              secondFace={{
                iconType: 'volume_off',
                shown: tab.muted,
                durationMs: 150,
              }}
              ariaLabel={t('Mute tab') + ': ' + tab.title}
              ariaPressed={tab.muted}
              tooltipText={t('Mute tab')}
              // The glyph waits for Chrome's answer through the live read
              // (O10a). A refusal means the tab closed; the next read drops
              // the row.
              onClick={onFirstClickOnly(
                () =>
                  void setOpenTabMuted(tab.id, !tab.muted).catch(
                    () => undefined
                  )
              )}
              style={speakerButtonStyle}
            />
          </span>
        )}
        {/* data-row-actions: the stylesheet's hook for hiding the strip
            during a drag (KAN-135), which an emotion class cannot give it.
            data-close-tab: where the pane finds this row's × after a close
            (KAN-280 O7b); the strip holds the × alone. */}
        <div
          data-row-actions
          data-close-tab
          css={childRightStyle(tab.id)}
          onKeyDownCapture={holdBackRepeatedActivation}
        >
          <Icon
            tooltipText={t('Close tab')}
            ariaLabel={t('Close tab') + ': ' + tab.title}
            type="close"
            onClick={onFirstClickOnly(() => onCloseTab(tab))}
          />
        </div>
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
      <div
        css={parentStyle}
        onMouseEnter={() => setIsParentHovered(true)}
        onMouseLeave={() => setIsParentHovered(false)}
      >
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
        <div data-row-actions css={parentRightStyle}>
          <Icon
            tooltipText={t('Save window as a session')}
            ariaLabel={t('Save window as a session') + ': ' + title}
            type="add_box"
            onClick={onSaveWindow}
          />
          {onCloseWindow && (
            <Icon
              tooltipText={t('Close window')}
              ariaLabel={t('Close window') + ': ' + title}
              type="close"
              onClick={onFirstClickOnly(onCloseWindow)}
            />
          )}
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
