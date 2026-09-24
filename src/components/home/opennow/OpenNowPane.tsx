import { Ref, useRef, useState } from 'react';

import { css } from '@emotion/react';
import { useTranslation } from 'react-i18next';
import { useDispatch } from 'react-redux';

import Icon from '../../common/Icon';
import { NormalLabel } from '../../common/Label';
import type { IconName } from '../../common/iconNames';
import { useFontFamily } from '../../../hooks/useFontFamily';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { formatGroupCounts } from '../../../utils/functions/local';
import type { OpenTab, OpenWindow } from '../../../utils/functions/openNow';
import {
  openWindowsToSession,
  suggestTitleForWindow,
} from '../../../utils/functions/openWindowsToSession';
import { closeOpenTab, closeOpenWindow } from '../../../utils/functions/reopen';
import { offerReopen } from '../../../redux/reopenOffer';
import { saveToTabContainer } from '../../../redux/slices/tabContainerDataStateSlice';
import type { AppDispatch } from '../../../redux/store';
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
  // Shown in the header's action row after Collapse all and Save all, in
  // order.
  actions: OpenNowHeaderAction[];
  // The "Open now" heading's id. The pane is a region named by its heading,
  // so its controls are told apart from the saved pane's same-named ones, and
  // the drawer names itself by the same heading (KAN-280 O2).
  headingId: string;
  // The "Open now" heading, for a caller that moves focus to it (the
  // drawer, KAN-280 O2).
  headingRef?: Ref<HTMLHeadingElement>;
}

// The first control inside a window's block: its collapse chevron (an Icon,
// so role="button" on a div).
function firstControlIn(element: Element | undefined): HTMLElement | null {
  const control = element?.querySelector('button, [role="button"]');
  return control instanceof HTMLElement ? control : null;
}

// A tab row's ×, found by its strip's mark rather than by its place in the
// row (KAN-280 O7b).
function closeControlIn(row: Element | undefined): HTMLElement | null {
  const control = row?.querySelector('[data-close-tab] [role="button"]');
  return control instanceof HTMLElement ? control : null;
}

// Rule 8's neighbour: the element after `index`, else the one before. None
// when `index` is -1, i.e. the element is not in the list at all.
function neighbourAt(list: Element[], index: number): Element | undefined {
  if (index === -1) return undefined;
  return list[index + 1] ?? list[index - 1];
}

// The Open now pane (KAN-280): the browser's live windows, drawn the way the
// saved-session detail draws a saved one. The caller reads Chrome and hands
// the result in as `windows`; the pane closes tabs and windows itself (O7a)
// and saves them (O13).
export default function OpenNowPane({
  windows,
  actions,
  headingId,
  headingRef,
}: OpenNowPaneProps) {
  const COLORS = useThemeColors();
  const FONT_FAMILY = useFontFamily();
  const { t } = useTranslation();
  const dispatch: AppDispatch = useDispatch();
  const paneRef = useRef<HTMLDivElement>(null);

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

  // KAN-280 rule 8. Focus moves BEFORE the close, read from the rows on
  // screen: the closed row is about to go, and the re-read that drops it can
  // land before Chrome answers, taking the row this would have been measured
  // from with it. A later refresh never moves focus.
  const focusAfterWindowCloses = (windowId: number) => {
    const blocks = [
      ...(paneRef.current?.querySelectorAll('[data-open-window-id]') ?? []),
    ];
    const index = blocks.findIndex(
      (block) => block.getAttribute('data-open-window-id') === String(windowId)
    );
    (
      firstControlIn(neighbourAt(blocks, index)) ??
      document.getElementById(headingId)
    )?.focus();
  };

  // KAN-280 O7b: the neighbour's ×, not its Switch button, so a second Enter
  // closes that tab too instead of switching Chrome away from Tab Keeper. A
  // window with no tab left to list is not listed (toOpenWindows), so a row
  // with no neighbour takes its window row with it: focus goes where closing
  // the window would send it, not to a chevron about to vanish.
  const focusAfterTabCloses = (openWindow: OpenWindow, tab: OpenTab) => {
    const block = paneRef.current?.querySelector(
      `[data-open-window-id="${openWindow.id}"]`
    );
    const rows = [...(block?.querySelectorAll('[data-open-tab-id]') ?? [])];
    const index = rows.findIndex(
      (row) => row.getAttribute('data-open-tab-id') === String(tab.id)
    );
    const next = closeControlIn(neighbourAt(rows, index));
    if (next) next.focus();
    else focusAfterWindowCloses(openWindow.id);
  };

  // A null close means the tab or window was already gone -- a second press
  // before the re-read, say -- so there is nothing to offer (O8a).
  const handleCloseTab = async (openWindow: OpenWindow, tab: OpenTab) => {
    focusAfterTabCloses(openWindow, tab);
    const item = await closeOpenTab(openWindow, tab);
    if (item) void dispatch(offerReopen(item));
  };

  const handleCloseWindow = async (openWindow: OpenWindow) => {
    focusAfterWindowCloses(openWindow.id);
    const item = await closeOpenWindow(openWindow);
    if (item) void dispatch(offerReopen(item));
  };

  // KAN-280 O13. The snapshot on screen is what is saved, named by rule 1 and
  // announced by rule 2.
  const handleSaveWindow = async (openWindow: OpenWindow) => {
    const title = await suggestTitleForWindow(
      openWindow.id,
      t('New Tab Group')
    );
    void dispatch(
      saveToTabContainer({
        container: openWindowsToSession([openWindow], title, new Date()),
        scope: 'one-window',
      })
    );
  };

  // This window first, as a capture orders them (windowsInScope), so a
  // restore brings the user back where they were. Named from This window
  // alone, which is exactly the name box's suggestion; a This window holding
  // only Tab Keeper is not listed, and falls back.
  const handleSaveAll = async () => {
    const thisWindow = listed.find((w) => w.isThisWindow);
    const ordered = thisWindow
      ? [thisWindow, ...listed.filter((w) => w !== thisWindow)]
      : listed;
    const title = thisWindow
      ? await suggestTitleForWindow(thisWindow.id, t('New Tab Group'))
      : t('New Tab Group');
    void dispatch(
      saveToTabContainer({
        container: openWindowsToSession(ordered, title, new Date()),
        scope: 'all-windows',
      })
    );
  };

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

  // A real heading, drawn as the NormalLabel it replaced (KAN-280 O2): the
  // label's declarations on the h2 itself, since an h2 may hold only phrasing
  // content and NormalLabel renders a div. The h2's own margin and bold are
  // reset, and the label's margin-right is padding here, so the h2 keeps the
  // header's full width and the text the same room.
  const headingStyle = css`
    display: flex;
    align-items: center;
    height: 32px;
    max-width: 100%;
    min-width: 0;
    margin: 0;
    padding: 0 8px;
    font-family: ${FONT_FAMILY};
    font-size: ${TYPE.SECTION};
    font-weight: inherit;
    color: ${COLORS.TEXT_COLOR};
    overflow: hidden;
    white-space: nowrap;
  `;

  // NormalLabel's inner box: text-overflow does not apply to a flex
  // container, so the ellipsis lives on the text's own span.
  const headingTextStyle = css`
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
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
    <div
      ref={paneRef}
      css={paneStyle}
      role="region"
      aria-labelledby={headingId}
    >
      <div css={headerStyle}>
        <div css={topStyle}>
          {/* tabIndex -1: focusable from script (the drawer moves focus here
              on open), never a Tab stop. */}
          <h2 id={headingId} ref={headingRef} tabIndex={-1} css={headingStyle}>
            <span css={headingTextStyle}>{t('Open now')}</span>
          </h2>
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
          {/* With nothing listed there is nothing to save. */}
          {listed.length > 0 && (
            <Icon
              tooltipText={t('Save every open window as a session')}
              ariaLabel={t('Save every open window as a session')}
              type="library_add"
              onClick={() => void handleSaveAll()}
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
              onCloseTab={(tab) => void handleCloseTab(openWindow, tab)}
              onSaveWindow={() => void handleSaveWindow(openWindow)}
              onCloseWindow={
                openWindow.isThisWindow
                  ? undefined
                  : () => void handleCloseWindow(openWindow)
              }
            />
          ))
        )}
      </div>
    </div>
  );
}
