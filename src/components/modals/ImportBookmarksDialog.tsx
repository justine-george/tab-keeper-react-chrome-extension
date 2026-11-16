import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useDispatch, useSelector, useStore } from 'react-redux';
import { useTranslation } from 'react-i18next';

import { css } from '@emotion/react';

import { useFontFamily } from '../../hooks/useFontFamily';
import { useThemeColors } from '../../hooks/useThemeColors';
import type { AppDispatch, RootState } from '../../redux/store';
import { showToast } from '../../redux/slices/globalStateSlice';
import { selectSkipsDuplicateTabs } from '../../redux/slices/settingsDataStateSlice';
import type { tabContainerData } from '../../redux/slices/tabContainerDataStateSlice';
import {
  importBookmarkSessions,
  importSizeRefusal,
  importedBookmarkKeys,
  selectImportedBookmarks,
} from '../../redux/bookmarkImport';
import {
  endBookmarkImport,
  NOTHING_TO_IMPORT_TEXT,
  readBookmarkRoot,
} from '../../redux/startBookmarkImport';
import {
  folderTree,
  nothingToImport,
  sessionsFor,
  topFolders,
  type BookmarkFolder,
  type SessionFromBookmarks,
} from '../../utils/functions/bookmarkImport';
import {
  formatActionOnItem,
  formatGroupCounts,
  formatTabCount,
} from '../../utils/functions/local';
import { windowLabel } from '../../utils/functions/windowLabel';
import {
  NON_INTERACTIVE_ICON_STYLE,
  TOAST_MESSAGES,
} from '../../utils/constants/common';
import { RADIUS, TYPE } from '../../styles/scale';
import { visuallyHiddenStyle } from '../../styles/visuallyHidden';
import { corners, trackClearOfCorners } from '../../styles/corners';
import Icon from '../common/Icon';
import ChevronGlyph from '../common/ChevronGlyph';
import Tickbox, { type TickState } from '../common/Tickbox';
import { RowTag } from '../common/RowTag';
import { focusRingCss } from '../common/focusRing';
import {
  dialogButtonStyles,
  flushLinkCss,
  tallButtonCss,
} from './dialogButtons';
import { dialogTitleSize } from './dialogTitleSize';
import { dialogFitsWindow } from './dialogFit';

const TITLE_ID = 'import-bookmarks-title';
const LEAD_ID = 'import-bookmarks-lead';

// KAN-862 Review Focus 1. Ticks come in bursts; the sync size is measured once they settle.
const SIZE_CHECK_DEBOUNCE_MS = 300;

type BookmarkNode = chrome.bookmarks.BookmarkTreeNode;
type Refusal = { used: string; limit: string };

// The listed top folder that starts unfolded: Chrome's own Bookmarks Bar, else the first listed one.
// folderType is Chrome 134+, and before it the bar comes first.
function firstBarId(
  root: BookmarkNode,
  folders: readonly BookmarkFolder[]
): string | undefined {
  const listed = new Set(folders.map((f) => f.id));
  const tops = topFolders(root).filter((n) => listed.has(n.id));
  return (tops.find((n) => n.folderType === 'bookmarks-bar') ?? tops[0])?.id;
}

function forEachFolder(
  folders: readonly BookmarkFolder[],
  visit: (folder: BookmarkFolder) => void
): void {
  for (const folder of folders) {
    visit(folder);
    forEachFolder(folder.children, visit);
  }
}

// KAN-862 (11-16). The tickbox slot: a tickbox, or under a ticked user folder what the folder becomes.
type RowSlot = TickState | 'becomesWindow' | 'joinsWindowAbove';

interface ShownRow {
  folder: BookmarkFolder;
  depth: number;
  slot: RowSlot;
  isOpen: boolean;
}

// Only the rows on screen: a folded folder's subtree is never walked.
function shownRows(
  folders: readonly BookmarkFolder[],
  unfolded: ReadonlySet<string>,
  ticked: ReadonlySet<string>
): ShownRow[] {
  const rows: ShownRow[] = [];
  // Where `list` sits: not under a ticked folder, directly in one, or deeper.
  const walk = (
    list: readonly BookmarkFolder[],
    depth: number,
    covered: 'no' | 'directly' | 'deeper'
  ) => {
    for (const folder of list) {
      const isOn = ticked.has(folder.id);
      const isOpen = unfolded.has(folder.id);
      const slot: RowSlot =
        covered === 'no'
          ? isOn
            ? 'on'
            : 'off'
          : covered === 'directly'
            ? 'becomesWindow'
            : 'joinsWindowAbove';
      rows.push({ folder, depth, slot, isOpen });
      // A ticked top folder covers nothing: its folders tick on their own.
      const next =
        covered !== 'no' ? 'deeper' : isOn && !folder.isTop ? 'directly' : 'no';
      if (isOpen) walk(folder.children, depth + 1, next);
    }
  };
  walk(folders, 0, 'no');
  return rows;
}

// KAN-862 (11-16). Ticking a folder takes back the ticks inside it, which it covers. A top folder also ticks each folder directly in it.
function addTick(ticks: Set<string>, folder: BookmarkFolder): void {
  forEachFolder(folder.children, (inside) => ticks.delete(inside.id));
  ticks.add(folder.id);
  if (folder.isTop) for (const child of folder.children) ticks.add(child.id);
}

// Unticking a top folder clears the folders directly in it too.
function toggledTicks(
  prev: ReadonlySet<string>,
  id: string,
  folder: BookmarkFolder | undefined
): ReadonlySet<string> {
  const next = new Set(prev);
  if (next.has(id)) {
    next.delete(id);
    if (folder?.isTop === true)
      for (const child of folder.children) next.delete(child.id);
  } else if (folder !== undefined) addTick(next, folder);
  else next.add(id);
  return next;
}

// KAN-862. Whether the ticks already take everything left in `folder`: a ticked user folder takes all of it; otherwise
// its own links need its own tick (a top folder's are its loose links), and each folder in it must be taken.
function isTaken(folder: BookmarkFolder, ticked: ReadonlySet<string>): boolean {
  const isTicked = ticked.has(folder.id);
  if (isTicked && !folder.isTop) return true;
  const inFolders = folder.children.reduce((sum, c) => sum + c.count, 0);
  const ownTaken = folder.count === inFolders || isTicked;
  return ownTaken && folder.children.every((c) => isTaken(c, ticked));
}

// KAN-862 R20. Select all: every top folder ticked, and so every folder directly in one.
function everyTick(folders: readonly BookmarkFolder[]): ReadonlySet<string> {
  const ticks = new Set<string>();
  for (const top of folders) addTick(ticks, top);
  return ticks;
}

interface FolderRowProps {
  folder: BookmarkFolder;
  depth: number;
  slot: RowSlot;
  isOpen: boolean;
  untitled: string;
  onTick: (id: string) => void;
  onFold: (id: string, open: boolean) => void;
}

// Memoized: a tick re-renders only the rows whose state it changed.
const FolderRow = React.memo(function FolderRow({
  folder,
  depth,
  slot,
  isOpen,
  untitled,
  onTick,
  onFold,
}: FolderRowProps) {
  const COLORS = useThemeColors();
  const { t } = useTranslation();
  const name = folder.title || untitled;
  const hasChildren = folder.children.length > 0;
  const hasTickbox = slot === 'on' || slot === 'off';
  const foldAction = isOpen ? t('Collapse') : t('Expand');

  const rowCss = css`
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 38px;
    padding: 0 8px 0 ${4 + depth * 28}px;
    ${corners(RADIUS.CONTROL)}
    background-color: ${slot === 'on' ? COLORS.SELECTION_COLOR : 'transparent'};
  `;
  const pickCss = css`
    flex: 1;
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    align-self: stretch;
    cursor: ${hasTickbox ? 'pointer' : 'default'};
  `;
  const nameBlockCss = css`
    display: flex;
    flex-direction: column;
    min-width: 0;
  `;
  const nameCss = css`
    color: ${COLORS.TEXT_COLOR};
    overflow-wrap: anywhere;
  `;
  // The tickbox's 18px, so marked rows line up with ticked ones.
  const markSlotCss = css`
    position: relative;
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
  `;
  const noteCss = css`
    font-size: ${TYPE.SECONDARY};
    color: ${COLORS.LABEL_L2_COLOR};
  `;

  return (
    <div
      css={rowCss}
      data-folder-row={folder.id}
      onKeyDown={(e) => {
        if (!hasChildren) return;
        if (e.key === 'ArrowRight' && !isOpen) {
          e.preventDefault();
          onFold(folder.id, true);
        } else if (e.key === 'ArrowLeft' && isOpen) {
          e.preventDefault();
          onFold(folder.id, false);
        }
      }}
    >
      {hasChildren ? (
        <Icon
          type={isOpen ? 'expand_less' : 'expand_more'}
          tooltipText={foldAction}
          ariaLabel={formatActionOnItem(foldAction, name, t)}
          ariaExpanded={isOpen}
          renderGlyph={(glyphCss) => (
            <ChevronGlyph open={isOpen} glyphCss={glyphCss} />
          )}
          onClick={() => onFold(folder.id, !isOpen)}
        />
      ) : (
        // Holds the chevron's place, so every row's tickbox lines up.
        <Icon type="expand_more" style="visibility: hidden;" />
      )}
      {hasTickbox ? (
        <Tickbox state={slot} label={name} onToggle={() => onTick(folder.id)} />
      ) : (
        <span css={markSlotCss}>
          {slot === 'becomesWindow' && (
            <Icon
              type="web_asset"
              size="18px"
              style={`${NON_INTERACTIVE_ICON_STYLE} padding: 0;`}
            />
          )}
          <span css={visuallyHiddenStyle}>
            {slot === 'becomesWindow'
              ? t('Becomes a window')
              : t('Goes into the window above')}
          </span>
        </span>
      )}
      {/* A click past the box ticks too, as on a <label>; the keyboard has the box. */}
      <span
        css={pickCss}
        onClick={hasTickbox ? () => onTick(folder.id) : undefined}
      >
        <Icon
          type={isOpen ? 'folder_open' : 'folder'}
          style={NON_INTERACTIVE_ICON_STYLE}
        />
        <span css={nameBlockCss}>
          <span css={nameCss}>{name}</span>
          {folder.where !== undefined && (
            <span css={noteCss}>
              {folder.where === 'account'
                ? t('In your Google Account')
                : t('Only on this device')}
            </span>
          )}
        </span>
        <RowTag value={t('BookmarkCount', { count: folder.count })} />
      </span>
    </div>
  );
});

/**
 * KAN-862. Import from bookmarks: Chrome's folder tree to tick on the left,
 * the sessions the ticks make on the right. Opened only with the bookmarks
 * permission granted (startBookmarkImport); every way out goes through
 * endBookmarkImport, which gives it back. Opened unlit, as LoadBackupModal is.
 */
export const ImportBookmarksDialog: React.FC = () => {
  const COLORS = useThemeColors();
  const FONT_FAMILY = useFontFamily();
  const { t, i18n } = useTranslation();
  const dispatch: AppDispatch = useDispatch();
  const store = useStore<RootState>();
  const skipDuplicates = useSelector(selectSkipsDuplicateTabs);
  const importedEntries = useSelector(selectImportedBookmarks);
  const imported = useMemo(
    () => importedBookmarkKeys(importedEntries),
    [importedEntries]
  );

  const dialogRef = useRef<HTMLDialogElement>(null);
  const [root, setRoot] = useState<BookmarkNode | null>(null);
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  const [unfolded, setUnfolded] = useState<ReadonlySet<string>>(new Set());
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  // The size check that may still set the refusal; an older answer landing late is dropped.
  const latestCheck = useRef(0);
  const hasEnded = useRef(false);
  // The button or card that opened it: left on <body>, the next Tab over setup lands on its ✕.
  const opener = useRef<HTMLElement | null>(null);

  const end = useCallback(
    (unreadable: boolean) => {
      if (hasEnded.current) return;
      hasEnded.current = true;
      // The page behind a modal is inert, so the dialog closes before focus goes back.
      dialogRef.current?.close();
      if (opener.current?.isConnected) opener.current.focus();
      if (unreadable) {
        void dispatch(
          showToast({ toastText: TOAST_MESSAGES.BOOKMARKS_UNREADABLE })
        );
      }
      void dispatch(endBookmarkImport());
    },
    [dispatch]
  );

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) {
      const active = document.activeElement;
      opener.current = active instanceof HTMLElement ? active : null;
      dialog.showModal();
      dialog.focus();
    }
  }, []);

  useEffect(() => {
    let isLive = true;
    readBookmarkRoot().then(
      (read) => {
        if (!isLive) return;
        setRoot(read);
      },
      () => {
        if (isLive) end(true);
      }
    );
    return () => {
      isLive = false;
    };
  }, [end]);

  const ownOrigin = useMemo(() => chrome.runtime.getURL(''), []);
  const untitled = t('Untitled folder');
  const folders = useMemo(
    () => (root === null ? [] : folderTree(root, ownOrigin, imported)),
    [root, ownOrigin, imported]
  );
  // Once, from the first read: Import's fresh read leaves the folding as the user left it.
  const [hasFirstFold, setHasFirstFold] = useState(false);
  if (root !== null && !hasFirstFold) {
    setHasFirstFold(true);
    const bar = firstBarId(root, folders);
    if (bar !== undefined) setUnfolded(new Set([bar]));
  }
  const foldersById = useMemo(() => {
    const byId = new Map<string, BookmarkFolder>();
    forEachFolder(folders, (folder) => byId.set(folder.id, folder));
    return byId;
  }, [folders]);

  const build = useCallback(
    (from: BookmarkNode, ticks: ReadonlySet<string>): SessionFromBookmarks[] =>
      ticks.size === 0
        ? []
        : sessionsFor(from, ticks, {
            now: new Date(),
            ownOrigin,
            untitled,
            skipDuplicates,
            imported,
          }),
    [ownOrigin, untitled, skipDuplicates, imported]
  );
  const sessions = useMemo(
    () =>
      root === null ? [] : build(root, ticked).map((made) => made.session),
    [root, ticked, build]
  );
  const rows = useMemo(
    () => shownRows(folders, unfolded, ticked),
    [folders, unfolded, ticked]
  );
  // KAN-862 R19. Nothing left to list: everything was imported, or there was never a link to import.
  // The press opens no dialog with nothing left (R23); this covers a list that empties while open, as when another page imports.
  const nothingLeft = useMemo(
    () =>
      root === null || folders.length > 0
        ? null
        : nothingToImport(root, ownOrigin, imported),
    [root, folders, ownOrigin, imported]
  );
  const allTicks = useMemo(() => everyTick(folders), [folders]);
  const isEverythingTaken = folders.every((top) => isTaken(top, ticked));
  const toggleAll = () => setTicked(isEverythingTaken ? new Set() : allTicks);

  const toggleTick = useCallback(
    (id: string) =>
      setTicked((prev) => toggledTicks(prev, id, foldersById.get(id))),
    [foldersById]
  );
  const setFold = useCallback(
    (id: string, open: boolean) =>
      setUnfolded((prev) => {
        const next = new Set(prev);
        if (open) next.add(id);
        else next.delete(id);
        return next;
      }),
    []
  );

  const measure = useCallback(
    async (made: tabContainerData[]): Promise<Refusal | null> => {
      try {
        return await importSizeRefusal(store.getState(), made, i18n.language);
      } catch (error) {
        // Unmeasurable: let it through, as a save is; sync's own size refusal still stands guard.
        console.warn('Could not measure the import for sync:', error);
        return null;
      }
    },
    [store, i18n.language]
  );

  useEffect(() => {
    latestCheck.current += 1;
    const check = latestCheck.current;
    if (sessions.length === 0) return;
    const timer = setTimeout(() => {
      void measure(sessions).then((answer) => {
        if (latestCheck.current === check) setRefusal(answer);
      });
    }, SIZE_CHECK_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [sessions, measure]);

  // A refusal stands through the next check's wait, but goes once nothing is ticked, so a new pick starts clear.
  // Set during render, as React's "adjusting state when a prop changes" does.
  const isEmpty = sessions.length === 0;
  const [wasEmpty, setWasEmpty] = useState(isEmpty);
  if (isEmpty !== wasEmpty) {
    setWasEmpty(isEmpty);
    if (isEmpty) setRefusal(null);
  }
  const canImport = !isEmpty && refusal === null && !isImporting;

  // KAN-862 Review Focus 2. Built from a fresh read: a folder deleted since the dialog opened adds nothing.
  const handleImport = async () => {
    if (!canImport) return;
    setIsImporting(true);
    let fresh: BookmarkNode;
    try {
      fresh = await readBookmarkRoot();
    } catch {
      end(true);
      return;
    }
    // The tree, and every later check, now go by what Import read.
    setRoot(fresh);
    const made = build(fresh, ticked);
    if (made.length === 0) {
      // Everything ticked is gone: the tree shows the library as it is now.
      setIsImporting(false);
      return;
    }
    const refused = await measure(made.map((m) => m.session));
    // Closed while it read and measured (Esc, ✕, Cancel): that close was the answer.
    if (hasEnded.current) return;
    if (refused !== null) {
      latestCheck.current += 1;
      setRefusal(refused);
      setIsImporting(false);
      return;
    }
    dispatch(importBookmarkSessions(made));
    end(false);
  };

  const buttons = dialogButtonStyles(COLORS);

  const dialogStyle = css`
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    margin: 0;
    padding: 20px 24px;
    box-sizing: border-box;
    width: min(calc(100% - 32px), 1000px);
    height: min(88vh, 660px);
    max-width: none;
    ${dialogFitsWindow()}
    background-color: ${COLORS.PRIMARY_COLOR};
    color: ${COLORS.LABEL_L1_COLOR};
    border: 1px solid ${COLORS.PANEL_BORDER_COLOR};
    ${corners(RADIUS.DIALOG)}
    font-family: ${FONT_FAMILY};
    font-size: ${TYPE.BODY};

    &[open] {
      display: grid;
      grid-template-rows: auto minmax(0, 1fr) auto;
      gap: 16px;
    }
    &:focus {
      outline: none;
    }
    &::backdrop {
      background: ${COLORS.MODAL_BACKDROP};
    }
  `;
  const titleRowStyle = css`
    display: flex;
    align-items: flex-start;
    gap: 12px;
  `;
  const titleBlockStyle = css`
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 4px;
  `;
  const titleStyle = css`
    margin: 0;
    font-size: ${dialogTitleSize()};
    font-weight: inherit;
    color: ${COLORS.TEXT_COLOR};
  `;
  const leadStyle = css`
    margin: 0;
    color: ${COLORS.LABEL_L2_COLOR};
    line-height: 1.5;
  `;
  const panesStyle = css`
    display: grid;
    grid-template-columns: 1.15fr 1fr;
    gap: 16px;
    min-height: 0;
    @media (max-width: 719.98px) {
      grid-template-columns: 1fr;
      grid-template-rows: repeat(2, minmax(0, 1fr));
    }
  `;
  const paneStyle = css`
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow: auto;
    padding: 4px;
    border: 1px solid ${COLORS.PANEL_BORDER_COLOR};
    ${corners(RADIUS.PANEL)}
    ${trackClearOfCorners(RADIUS.PANEL, ['top', 'bottom'])}
    ${focusRingCss(COLORS)}
  `;
  // Above the rows, by itself: it ticks every top folder.
  const selectAllStyle = css`
    flex: none;
    align-self: flex-start;
    margin: 0 0 4px;
    padding-block: 4px;
  `;
  const emptyStyle = css`
    margin: auto;
    padding: 0 16px;
    text-align: center;
    line-height: 1.5;
    color: ${COLORS.LABEL_L2_COLOR};
  `;
  const sessionStyle = css`
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 10px 8px 12px;
    &:not(:last-child) {
      border-bottom: 1px solid ${COLORS.PANEL_BORDER_COLOR};
    }
  `;
  const sessionNameStyle = css`
    color: ${COLORS.TEXT_COLOR};
    overflow-wrap: anywhere;
  `;
  const sessionMetaStyle = css`
    font-size: ${TYPE.SECONDARY};
    color: ${COLORS.LABEL_L2_COLOR};
  `;
  const windowListStyle = css`
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin: 6px 0 0;
    padding: 0;
    list-style: none;
  `;
  const windowStyle = css`
    display: flex;
    align-items: center;
    gap: 8px;
    color: ${COLORS.TEXT_COLOR};
  `;
  const footerStyle = css`
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 16px;
  `;
  const refusalStyle = css`
    flex: 1;
    margin: 0;
    text-align: end;
    font-size: ${TYPE.SECONDARY};
    color: ${COLORS.LABEL_L1_COLOR};
  `;
  const importStyle = css`
    margin-left: auto;
    &[aria-disabled='true'] {
      opacity: 0.45;
      cursor: default;
    }
    &[aria-disabled='true']:hover,
    &[aria-disabled='true']:active {
      background-color: ${COLORS.TEXT_COLOR};
      border-color: ${COLORS.TEXT_COLOR};
    }
  `;

  return (
    <dialog
      ref={dialogRef}
      tabIndex={-1}
      css={dialogStyle}
      aria-labelledby={TITLE_ID}
      aria-describedby={LEAD_ID}
      onCancel={(e) => {
        e.preventDefault();
        end(false);
      }}
    >
      <div css={titleRowStyle}>
        <div css={titleBlockStyle}>
          <h2 id={TITLE_ID} css={titleStyle}>
            {t('Import from bookmarks')}
          </h2>
          <p id={LEAD_ID} css={leadStyle}>
            {t('ImportBookmarksLead')}
          </p>
        </div>
        <Icon
          type="close"
          ariaLabel={t('Close')}
          tooltipText={t('Close')}
          onClick={() => end(false)}
        />
      </div>

      <div css={panesStyle} data-import-panes="">
        <div css={paneStyle}>
          {folders.length > 0 && (
            <button
              type="button"
              css={[buttons.link, selectAllStyle]}
              onClick={toggleAll}
            >
              {isEverythingTaken ? t('Deselect all') : t('Select all')}
            </button>
          )}
          {nothingLeft !== null && (
            <p css={emptyStyle}>{t(NOTHING_TO_IMPORT_TEXT[nothingLeft])}</p>
          )}
          {rows.map((row) => (
            <FolderRow
              key={row.folder.id}
              folder={row.folder}
              depth={row.depth}
              slot={row.slot}
              isOpen={row.isOpen}
              untitled={untitled}
              onTick={toggleTick}
              onFold={setFold}
            />
          ))}
        </div>
        {/* Focusable, so a long preview scrolls from the keyboard. */}
        <div
          css={paneStyle}
          role="region"
          aria-label={t('Preview')}
          tabIndex={0}
        >
          {sessions.length === 0 ? (
            <p css={emptyStyle}>{t('ImportPreviewEmpty')}</p>
          ) : (
            sessions.map((session) => (
              <div
                key={session.tabGroupId}
                css={sessionStyle}
                data-preview-session=""
              >
                <span css={sessionNameStyle}>{session.title}</span>
                <span css={sessionMetaStyle}>
                  {formatGroupCounts(
                    session.windowCount,
                    session.tabCount,
                    false,
                    t
                  )}
                </span>
                <ul css={windowListStyle}>
                  {session.windows.map((win, i) => (
                    <li
                      key={win.windowId}
                      css={windowStyle}
                      data-preview-window=""
                    >
                      <Icon
                        type="web_asset"
                        style={`${NON_INTERACTIVE_ICON_STYLE} opacity: 0.7;`}
                      />
                      <span data-preview-window-name="">
                        {
                          windowLabel(
                            win.title,
                            t('WindowNumbered', { number: i + 1 })
                          ).text
                        }
                      </span>
                      <RowTag value={formatTabCount(win.tabCount, t)} />
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </div>
      </div>

      <div css={footerStyle}>
        <button
          type="button"
          css={[buttons.link, flushLinkCss]}
          onClick={() => end(false)}
        >
          {t('Cancel')}
        </button>
        {refusal !== null && (
          <p css={refusalStyle} role="status">
            {t('ImportTooLarge', refusal)}
          </p>
        )}
        <button
          type="button"
          css={[buttons.filled, tallButtonCss(24), importStyle]}
          aria-disabled={canImport ? undefined : true}
          onClick={() => void handleImport()}
        >
          {sessions.length === 0
            ? t('ImportButton')
            : t('ImportSessions', { count: sessions.length })}
        </button>
      </div>
    </dialog>
  );
};
