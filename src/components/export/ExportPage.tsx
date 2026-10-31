import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { css, Global, keyframes } from '@emotion/react';

// `?inline` so the mark is base64 IN the bundle: the exported file must carry
// its own icon, because it is opened from disk, offline, long after the
// extension that wrote it is out of the picture.
import markDataUri from '../../assets/exportMark.png?inline';
import Button from '../common/Button';
import Icon from '../common/Icon';
import ExportEditor from './ExportEditor';
import PreviewBackLink from './PreviewBackLink';
import SavePdfPointer from './SavePdfPointer';
import { isSaveAsPdfShortcut } from './saveAsPdfShortcut';
import SlidingPair, { type SlidingOption } from '../common/SlidingPair';
import { EXPORT_PAIR_METRICS, KNOB_TRANSITION } from './slidingPairStyle';
import {
  CHALK_THEME,
  CHARCOAL_THEME,
  isDarkTheme,
  ThemeColorsOverride,
} from '../../hooks/useThemeColors';
import { useFontFamily } from '../../hooks/useFontFamily';
import { useOtherPageSettings } from '../../hooks/useOtherPageSettings';
import { useIsMac } from '../../hooks/useIsMac';
import { AppDispatch, RootState } from '../../redux/store';
import {
  markPressedSaveAsPdf,
  setExportLayout,
} from '../../redux/slices/settingsDataStateSlice';
import {
  replaceState,
  type tabContainerData,
} from '../../redux/slices/tabContainerDataStateSlice';
import { captureOpenWindows } from '../../utils/functions/capture';
import {
  isValidTabMasterContainer,
  loadFromLocalStorage,
} from '../../utils/functions/local';
import { EXPORT_STORE_URL, TOAST_MESSAGES } from '../../utils/constants/common';
import { showToast } from '../../redux/slices/globalStateSlice';
import { Toast } from '../common/Toast';
import { TooltipLayer } from '../common/TooltipLayer';
import { formatGroupCounts, formatTabCount } from '../../utils/functions/local';
import { sessionDateStamp } from '../../utils/functions/sessionDate';
import {
  EXPORT_PALETTE,
  sessionToHtml,
  tidySessionForExport,
  type ExportLayout,
  type ExportScheme,
} from '../../utils/functions/sessionExportHtml';
import { copySessionLinks } from '../../utils/functions/copySessionLinks';
import {
  exportIconKey,
  readExportIcons,
} from '../../utils/functions/exportIcons';
import { CORNER_SHAPE, TYPE } from '../../styles/scale';
import type { PreviewFrom } from '../../utils/functions/previewFrom';
import {
  applyExportEdits,
  countExportEdits,
  NO_EXPORT_EDITS,
  type ExportEdits,
} from '../../utils/functions/sessionExportEdits';

/**
 * The page that opens when a session is exported.
 *
 * It shows the file BEFORE it is saved, which is the point: a file you have
 * seen is one you are willing to send to someone else. Saving is therefore a
 * second click, not the first.
 *
 * Everything below "a session to preview" is the same whichever source it came
 * from -- the preview, edit mode, Copy and Save as PDF never ask.
 */

/**
 * KAN-880. The sheet's width, and the header's content's: the toolbar's edges
 * are the sheet's. Replaces KAN-235's 930px band; with Layout as glyphs
 * (KAN-827) the widest toolbar is Russian at 746px, so 816 holds every
 * language on one line.
 */
const SHEET_WIDTH = `
  box-sizing: border-box;
  width: calc(100% - 48px);
  max-width: 816px;
`;

// KAN-603. The longest Print waits for the icons; measured, they land 60-160ms after opening.
const OUTPUT_WAIT_CAP_MS = 1000;

/**
 * Where the page's session comes from (KAN-208).
 *
 * `saved` is a session named by id, because this is a URL: the tab can be
 * reloaded, bookmarked, or opened after the session was deleted in the popup,
 * so an id matching nothing is a state this renders, not a crash.
 *
 * `open-windows` is a capture the page takes for ITSELF when it loads -- what
 * is open right now, never saved. A reload re-captures, so the page cannot
 * show stale windows.
 */
export type ExportSource =
  { kind: 'saved'; tabGroupId: string } | { kind: 'open-windows' };

export default function ExportPage({
  source,
  from,
}: {
  source: ExportSource;
  // KAN-880. Where "Back to Tab Keeper" goes.
  from: PreviewFrom;
}) {
  const { t, i18n } = useTranslation();
  const dispatch: AppDispatch = useDispatch();
  // KAN-305. Layout saves every setting; without this it saves stale ones.
  useOtherPageSettings();
  const FONT_FAMILY = useFontFamily();
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout>>();
  // KAN-221. Set by Edit and Done, never on arrival: the row fades in when it
  // replaces the other row, not when the page opens.
  const [rowSwapped, setRowSwapped] = useState(false);
  // KAN-194. Edits are for this export only: held here, applied to a copy,
  // and gone when the tab closes. Nothing keeps them, so they always warn.
  const [editing, setEditing] = useState(false);
  const [edits, setEdits] = useState<ExportEdits>(NO_EXPORT_EDITS);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  // KAN-826. The pointer measures the sheet and Save as PDF…; state, so it
  // re-renders when either mounts. Button forwards no ref, so the button is
  // read as the last child of the group it ends.
  const [frameEl, setFrameEl] = useState<HTMLIFrameElement | null>(null);
  const attachFrame = useCallback((el: HTMLIFrameElement | null) => {
    frameRef.current = el;
    setFrameEl(el);
  }, []);
  const [saveButton, setSaveButton] = useState<HTMLElement | null>(null);
  const attachEndGroup = useCallback((el: HTMLSpanElement | null) => {
    const last = el?.lastElementChild;
    setSaveButton(last instanceof HTMLElement ? last : null);
  }, []);
  // KAN-881. The toolbar row kept only for its height: hidden, inert, and out of the accessibility tree.
  const attachReserve = useCallback((el: HTMLDivElement | null) => {
    if (el && !el.inert) el.inert = true;
  }, []);
  // KAN-603. A Save as PDF press waiting for the icons.
  const [printPending, setPrintPending] = useState(false);
  // KAN-826. A held key repeats faster than a render, so this, not the state, says busy.
  const printPendingRef = useRef(false);
  // KAN-603. The document the preview frame last finished loading.
  const [loadedHtml, setLoadedHtml] = useState<string | null>(null);

  // This page is its own document with its own store, and nothing fills that
  // store for it: in the popup, App does this on mount. Read-only -- the
  // sync middleware ignores replaceState, so previewing a session cannot mark
  // it dirty or push anything to the cloud.
  //
  // Validated rather than asserted, exactly as App does it: storage can hold
  // something older or truncated, and "Session not found" is a better answer
  // than a crash on a page whose whole job is to show a file.
  //
  // The live capture (KAN-208) reads no stored session, so it skips this
  // entirely rather than filling a store it will not look at.
  useEffect(() => {
    if (source.kind !== 'saved') return;
    const candidate = loadFromLocalStorage('tabContainerData');
    if (isValidTabMasterContainer(candidate)) {
      dispatch(replaceState(candidate));
    } else if (candidate !== undefined) {
      console.warn('Ignoring unreadable tabContainerData in localStorage.');
    }
  }, [dispatch, source.kind]);

  const savedSession = useSelector((state: RootState) =>
    source.kind === 'saved'
      ? state.tabContainerDataState.tabGroups.find(
          (group) => group.tabGroupId === source.tabGroupId
        )
      : undefined
  );

  /**
   * The live capture, held here and NEVER dispatched (KAN-208).
   *
   * That is load-bearing, not incidental: replaceState writes localStorage
   * (tabContainerDataStateSlice), so a dispatched capture would put an unsaved
   * session into the list -- exactly the clutter this export removes. With no
   * data-state change there is also no undo entry (it is not in
   * customMiddleware's actionsToCapture) and nothing for the sync to push.
   *
   * Three states, kept apart: `undefined` is "still capturing", `null` is
   * "nothing open", a value is the capture. Collapsing the first two would
   * flash "Session not found" on every load.
   *
   * The page's own tab is left out along with every other Tab Keeper page --
   * chrome.windows.getAll lists it too -- by captureOpenWindows itself now
   * (isTabKeeperPage, capture.ts, KAN-300).
   */
  const [captured, setCaptured] = useState<tabContainerData | null | undefined>(
    undefined
  );
  useEffect(() => {
    if (source.kind !== 'open-windows') return;
    let cancelled = false;
    (async () => {
      const snapshot = await captureOpenWindows(
        t('Open windows'),
        'all-windows'
      );
      if (!cancelled) setCaptured(snapshot);
    })();
    return () => {
      cancelled = true;
    };
  }, [source.kind, t]);

  const session =
    source.kind === 'saved' ? savedSession : (captured ?? undefined);
  const capturing = source.kind === 'open-windows' && captured === undefined;

  // Every output -- the preview, the saved file, the PDF, the clipboard --
  // is built from this one copy, so they cannot disagree about an edit.
  // KAN-202. Tidied once, here: every output below is built from this, and so
  // is the editor, so what Edit mode shows is what the file will say.
  const tidied = useMemo(
    () => (session ? tidySessionForExport(session) : undefined),
    [session]
  );
  const edited = useMemo(
    () => (tidied ? applyExportEdits(tidied, edits) : undefined),
    [tidied, edits]
  );

  // KAN-603. Read once per set of addresses, so renames and hides never refetch;
  // every icon lands in one update, so the frame reloads once. A newer set's
  // read supersedes an older one, which `key` tells apart.
  const iconKey = tidied ? exportIconKey(tidied) : undefined;
  const [readIcons, setReadIcons] = useState<{
    key: string;
    icons: ReadonlyMap<string, string>;
  } | null>(null);
  useEffect(() => {
    if (iconKey === undefined) return;
    let cancelled = false;
    // Addresses never hold a newline: Chrome's URL parser strips them.
    void readExportIcons(iconKey.split('\n')).then((icons) => {
      if (!cancelled) setReadIcons({ key: iconKey, icons });
    });
    return () => {
      cancelled = true;
    };
  }, [iconKey]);
  const icons = useMemo<ReadonlyMap<string, string>>(
    () => readIcons?.icons ?? new Map(),
    [readIcons]
  );
  const iconsReady = readIcons !== null && readIcons.key === iconKey;
  // KAN-401. Every row hidden leaves nothing to export, so Done waits for one.
  const nothingKept =
    edited !== undefined &&
    edited.windows.every((window) => window.tabs.length === 0);
  const tally = useMemo(
    () =>
      tidied ? countExportEdits(tidied, edits) : { renamed: 0, hiddenTabs: 0 },
    [tidied, edits]
  );

  // Nothing is stored, so closing with unsaved edits loses them. Chrome asks
  // only when a beforeunload listener cancels the event, and draws its own
  // dialog; the page cannot choose the words.
  const pending = tally.renamed > 0 || tally.hiddenTabs > 0;
  // KAN-880. Set by Go back, so Chrome adds no "Leave site?" to the card's answer.
  const leavingRef = useRef(false);
  useEffect(() => {
    if (!pending) return;
    const ask = (event: BeforeUnloadEvent) => {
      if (!leavingRef.current) event.preventDefault();
    };
    window.addEventListener('beforeunload', ask);
    return () => window.removeEventListener('beforeunload', ask);
  }, [pending]);
  const layout = useSelector(
    (state: RootState) => state.settingsDataState.exportLayout
  );
  const copyLinksLayout = useSelector(
    (state: RootState) => state.settingsDataState.copyLinksLayout
  );
  const theme = useSelector(
    (state: RootState) => state.settingsDataState.theme
  );
  // KAN-198. Pressing Light or Dark sets this, and nothing else: it lives in
  // this page while it is open and is never saved, so a choice made for one
  // export cannot outlive it or change the extension theme.
  const [pageScheme, setPageScheme] = useState<ExportScheme | null>(null);
  const sessionDateBasis = useSelector(
    (state: RootState) => state.settingsDataState.sessionDateBasis
  );
  const timeFormat = useSelector(
    (state: RootState) => state.settingsDataState.timeFormat
  );
  const hasPressedSaveAsPdf = useSelector(
    (state: RootState) => state.settingsDataState.hasPressedSaveAsPdf
  );

  // The page opens on the extension theme's polarity and follows it until
  // Light or Dark is pressed here.
  const scheme: ExportScheme =
    pageScheme ?? (isDarkTheme(theme) ? 'dark' : 'light');
  // One page, light or dark: the header and the file share a polarity, rather
  // than the extension's tinted chrome framing a document. The shared
  // components below get the same colours through ThemeColorsOverride.
  const COLORS = scheme === 'dark' ? CHARCOAL_THEME : CHALK_THEME;

  // KAN-201. Button and Icon fade their background over 200ms while their text
  // and icons switch instantly, so a palette change left every control wearing
  // the old fill under the new text -- measured mid-press at rgb(240, 242, 245),
  // neither palette's colour. The popup never shows this because KAN-22
  // suppresses transitions for the frame of a theme swap; that rule lives in
  // App.css, which this page does not load, so it carries its own.
  //
  // useLayoutEffect, and not on the first render: the flag has to be on the
  // element in the same commit that changes the colours, and there is nothing
  // to suppress before the first paint.
  const painted = useRef(false);
  useLayoutEffect(() => {
    if (!painted.current) {
      painted.current = true;
      return;
    }
    const root = document.documentElement;
    root.setAttribute('data-scheme-switching', '');

    // Two frames, as useDocumentTheme does: the first guarantees the new
    // styles are computed, the second that they are painted.
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() =>
        root.removeAttribute('data-scheme-switching')
      );
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
      root.removeAttribute('data-scheme-switching');
    };
  }, [scheme]);

  const html = useMemo(() => {
    if (!session || !edited) return '';
    return sessionToHtml(edited, {
      layout,
      scheme,
      // A capture of what is open has no history to describe, so it carries
      // no date line at all -- rather than a "created" instant that means
      // only "a moment ago, in this tab".
      // The full timestamp, not the popup's trimmed label: a file is read
      // later, when "this year" may not be (KAN-347).
      dateLabel:
        source.kind === 'saved'
          ? sessionDateStamp(
              session,
              sessionDateBasis,
              i18n.language,
              timeFormat,
              t
            )
          : undefined,
      countsLabel: formatGroupCounts(
        edited.windowCount,
        edited.tabCount,
        false,
        t
      ),
      tabCountLabel: (count) => formatTabCount(count, t),
      strings: {
        window: t('Window'),
        notAWebLink: t('SavePdfNotAWebLink'),
        savedWith: t('SavePdfFooterCredit'),
        getExtension: t('Get the extension'),
      },
      mark: markDataUri,
      storeUrl: EXPORT_STORE_URL,
      savedOn: new Date().toLocaleDateString(i18n.language, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      }),
      icons,
      iconsReady,
    });
  }, [
    session,
    edited,
    icons,
    iconsReady,
    layout,
    scheme,
    sessionDateBasis,
    timeFormat,
    source.kind,
    i18n.language,
    t,
  ]);

  // The tab can be pinned or reloaded, so it says which session it holds --
  // several tabs all called "Tab Keeper" would say nothing. Left alone when
  // the session is gone, so the not-found tab keeps the static title.
  useEffect(() => {
    if (session) document.title = session.title;
  }, [session]);

  // KAN-603. Print waits until the frame has loaded the file carrying the
  // icons, or OUTPUT_WAIT_CAP_MS, whichever comes first.
  const frameShowsIcons = iconsReady && loadedHtml === html;
  const frameShowsIconsRef = useRef(false);
  const outputWaiters = useRef(new Set<() => void>());
  useEffect(() => {
    frameShowsIconsRef.current = frameShowsIcons;
    if (!frameShowsIcons) return;
    for (const done of outputWaiters.current) done();
  }, [frameShowsIcons]);

  // KAN-826. The ground the preview sheet lies on, the header's colour.
  const pageStyle = css`
    min-height: 100vh;
    background-color: ${COLORS.SECONDARY_COLOR};
    font-family: ${FONT_FAMILY};
    color: ${COLORS.TEXT_COLOR};
    display: flex;
    flex-direction: column;
  `;

  /**
   * The two choices, each a SlidingPair (KAN-218).
   *
   * Both pairs are GLYPHS (Colour since KAN-212, Layout since KAN-827):
   *
   * - the row wraps at the popup width in Russian and German. Measured at
   *   900px, the colour pair cost 168.9px there against 125.5 in English as
   *   words, and a glyph costs the same in every language.
   * - light and dark have a symbol everyone already knows. Layout had none:
   *   Material's density_large and density_small differ by a few pixels of
   *   spacing and neither says which is roomier. Its own glyphs answer that,
   *   five lines against three. Three even lines is also the menu icon;
   *   inside a labelled pair beside five lines it reads as fewer, roomier rows.
   *
   * Each word stays as the button's name and its tooltip.
   *
   * Both stay PAIRS rather than a lone sun or moon, which cannot say whether it
   * reports the state you are in or the one you would move to. Both states
   * shown and one marked is what the shape buys.
   *
   * Compact comes first because it is the default (KAN-212); the order is
   * visual only. The sun turns an eighth of a turn when pressed: its rays are
   * symmetric at 45 degrees, so it twinkles and comes to rest looking the same.
   */
  const layoutOptions = useMemo(
    () =>
      [
        { value: 'compact', label: t('Compact'), icon: 'layout_compact' },
        {
          value: 'comfortable',
          label: t('Comfortable'),
          icon: 'layout_comfortable',
        },
      ] as const satisfies readonly [
        SlidingOption<ExportLayout>,
        SlidingOption<ExportLayout>,
      ],
    [t]
  );
  const schemeOptions = useMemo(
    () =>
      [
        {
          value: 'light',
          label: t('Light'),
          icon: 'light_mode',
          pressedTurn: '45deg',
        },
        { value: 'dark', label: t('Dark'), icon: 'dark_mode' },
      ] as const satisfies readonly [
        SlidingOption<ExportScheme>,
        SlidingOption<ExportScheme>,
      ],
    [t]
  );

  // Above the early returns, as callbacks: they read only refs and setters,
  // and the ⌘P/⌘S handler (KAN-826) needs the same handlePrint.
  const untilFrameShowsIcons = useCallback(
    () =>
      new Promise<void>((resolve) => {
        if (frameShowsIconsRef.current) return resolve();
        const done = () => {
          clearTimeout(cap);
          outputWaiters.current.delete(done);
          resolve();
        };
        const cap = setTimeout(done, OUTPUT_WAIT_CAP_MS);
        outputWaiters.current.add(done);
      }),
    []
  );

  // KAN-603. Busy at once, so a second press is ignored.
  const afterIcons = useCallback(
    async (run: () => void) => {
      if (printPendingRef.current) return;
      printPendingRef.current = true;
      setPrintPending(true);
      await untilFrameShowsIcons();
      // A refused print must not leave the button busy until a reload.
      try {
        run();
      } catch (error) {
        console.error('Could not print the export:', error);
      } finally {
        printPendingRef.current = false;
        setPrintPending(false);
      }
    },
    [untilFrameShowsIcons]
  );

  // Reaching into the frame needs same-origin, which is why the preview is
  // sandboxed with allow-same-origin and nothing else: scripts stay blocked,
  // so the file still cannot run anything, and the browser's print dialog is
  // where the PDF, or a printer, is picked.
  //
  // KAN-826. Every press marks the device; the pointer is done at the press,
  // since Chrome does not say whether the dialog saved or was cancelled.
  const handlePrint = useCallback(() => {
    dispatch(markPressedSaveAsPdf());
    return afterIcons(() => frameRef.current?.contentWindow?.print());
  }, [afterIcons, dispatch]);

  // KAN-826. ⌘P and ⌘S run Save as PDF…: the browser's own print or save the
  // page around the file. Edit mode has no preview to print, but the keys are
  // still kept from the browser. One listener, reading the latest state.
  const isMac = useIsMac();
  const onShortcut = useRef<(e: KeyboardEvent) => void>(() => {});
  useLayoutEffect(() => {
    onShortcut.current = (e) => {
      if (!isSaveAsPdfShortcut(e, isMac)) return;
      e.preventDefault();
      if (!editing && frameRef.current) void handlePrint();
    };
  });
  const takeShortcut = useCallback(
    (e: KeyboardEvent) => onShortcut.current(e),
    []
  );
  useEffect(() => {
    addEventListener('keydown', takeShortcut);
    return () => removeEventListener('keydown', takeShortcut);
  }, [takeShortcut]);
  // After a click in the preview the keys go to the frame's document, where a
  // listener the page adds still hears them (measured with real keys).
  const frameDoc = useRef<Document | null>(null);
  const listenInFrame = useCallback(
    (doc: Document | null) => {
      frameDoc.current?.removeEventListener('keydown', takeShortcut);
      frameDoc.current = doc;
      doc?.addEventListener('keydown', takeShortcut);
    },
    [takeShortcut]
  );
  useEffect(() => () => listenInFrame(null), [listenInFrame]);

  // KAN-880. No band: the header lies on the sheet's ground. Line 1 is the way back, line 2 the toolbar.
  // KAN-881. A grid, so the two toolbar rows can share one cell (below).
  const headerStyle = css`
    display: grid;
    grid-template-columns: 100%;
    justify-items: center;
    row-gap: 10px;
    padding-top: 16px;
  `;
  // KAN-826. A sheet on the ground, so it reads as the page that gets saved; KAN-880: the editor wears it too.
  const sheetStyle = css`
    ${SHEET_WIDTH}
    display: block;
    flex-grow: 1;
    margin: 0 auto;
    border: 1px solid ${COLORS.PANEL_BORDER_COLOR};
    box-shadow: ${COLORS.FLOATING_SHADOW};
    background-color: ${EXPORT_PALETTE[scheme].bg};
  `;
  const backLine = (
    <div
      css={css`
        ${SHEET_WIDTH}
        display: flex;
        align-items: center;
        min-height: 22px;
      `}
    >
      <PreviewBackLink
        from={from}
        pending={pending}
        onLeave={() => {
          leavingRef.current = true;
        }}
        onLeaveFailed={() => {
          leavingRef.current = false;
        }}
      />
    </div>
  );

  // KAN-880. Every state paints the page, "Session not found" and capturing too.
  const pageGlobal = (
    <Global
      styles={css`
        /* KAN-212. The browser's default body margin, never reset: this page
           loads no stylesheet of its own and App.css belongs to the popup.
           Measured, the page sat at left 8, top 8 in a 1280px viewport with
           both html and body at rgba(0,0,0,0) -- so the 8px band showed the
           browser's own canvas, which is white in EITHER scheme because
           nothing in the app was painting it.

           Both elements are painted, not just body: the overscroll gutter a
           trackpad opens past the end of the page comes from the root, and
           leaving it transparent shows the same white there. */
        html,
        body {
          margin: 0;
          background-color: ${COLORS.SECONDARY_COLOR};
        }
        /* KAN-880. Edit and Done change the page's height; a classic scrollbar coming or going would shift it sideways. */
        html {
          scrollbar-gutter: stable;
        }
        [data-scheme-switching] * {
          transition: none !important;
        }
        /* KAN-218. Except the knobs: pressing Light or Dark changes the
           palette in the same commit that moves the Colour knob, and the rule
           above would make it jump. Only the knob's own motion comes back --
           clip-path on the knob, rotate inside it -- so every colour still
           switches at once. Never under reduced motion, where the knob does
           not move at all. */
        @media (prefers-reduced-motion: no-preference) {
          [data-scheme-switching] [data-sliding-knob] {
            transition: clip-path ${KNOB_TRANSITION} !important;
          }
          [data-scheme-switching] [data-sliding-knob] * {
            transition: rotate ${KNOB_TRANSITION} !important;
          }
        }
      `}
    />
  );

  // Still capturing: the page and the way back, nothing else. NOT "Session
  // not found", which would be a false statement for the length of the
  // capture and would flash on every load. KAN-880: both keep the link, or an
  // old preview link lands on a dead end.
  if (capturing || !session || !tidied || !edited) {
    return (
      <ThemeColorsOverride.Provider value={COLORS}>
        {pageGlobal}
        <div css={pageStyle} data-capturing={capturing || undefined}>
          <div data-preview-header css={headerStyle}>
            {backLine}
          </div>
          {!capturing && (
            <p
              css={css`
                margin: 48px auto;
                color: ${COLORS.LABEL_L1_COLOR};
              `}
            >
              {t('Session not found')}
            </p>
          )}
          <TooltipLayer />
        </div>
      </ThemeColorsOverride.Provider>
    );
  }

  const renameRow = (key: string, title: string) =>
    setEdits((prev) => ({ ...prev, titles: { ...prev.titles, [key]: title } }));

  const toggleHidden = (key: string) =>
    setEdits((prev) => {
      const hidden = new Set(prev.hidden);
      if (hidden.has(key)) hidden.delete(key);
      else hidden.add(key);
      return { ...prev, hidden };
    });

  // KAN-209. The copy itself now lives in copySessionLinks, which the session
  // menu in the popup also calls -- one definition of what "copy all links"
  // means, rather than the same promise implemented twice.
  //
  // `edited`, not the stored session: this page is previewing a copy with the
  // user's renames and hidden rows applied, and Copy should give what is on
  // screen. That is the ONLY difference between the two call sites; the menu
  // passes the session as stored because it has no preview to respect.
  const handleCopy = async () => {
    const count = await copySessionLinks(
      edited,
      t,
      i18n.language,
      copyLinksLayout
    );
    // KAN-713. Nothing on the clipboard: no toast, no "Copied".
    if (count === null) return;
    // KAN-401. The popup's toast, with the count; the button says Copied.
    dispatch(
      showToast({
        toastText: TOAST_MESSAGES.COPY_LINKS_SUCCESS,
        toastParams: { count },
        stacksOnTwin: true,
      })
    );
    setCopied(true);
    // A second copy restarts the two seconds rather than ending the first early.
    clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(false), 2000);
  };

  // Icon carries 4px of its own padding all round, and Button adds 8px to
  // its right -- so the gap left of the icon was 4px wider than the gap right
  // of the label. Dropping the left padding makes the button symmetrical.
  const actionIconStyle = 'padding-left: 0; padding-right: 6px;';

  /**
   * KAN-221. How the toolbar's actions move, from Justine's picks after a
   * review against Emil Kowalski's animation guidance. Export page only: the
   * popup's Buttons are unchanged.
   *
   * - Held, an action dips to 97% over 160ms on a strong ease-out, so a press
   *   is felt before anything else happens. Not while unavailable.
   * - Hover fills only for a mouse or trackpad. A tap otherwise leaves the
   *   hover fill stuck on, so for any other pointer hover shows the rest fill.
   * - Reduced motion keeps the colour and drops the dip.
   *
   * `rest` and `press` are the button's own fills, so the touch override and
   * the press can be restated here, after Button's rules and the caller's.
   */
  const actionMotion = (rest: string, press: string) => `
    transition:
      background-color 120ms ease,
      transform 160ms cubic-bezier(0.23, 1, 0.32, 1);
    @media not all and (hover: hover) and (pointer: fine) {
      &:hover {
        background-color: ${rest};
      }
    }
    &:active:not([aria-disabled='true']) {
      transform: scale(0.97);
      background-color: ${press};
    }
    @media (prefers-reduced-motion: reduce) {
      transition: background-color 120ms ease;
      &:active:not([aria-disabled='true']) {
        transform: none;
      }
    }
  `;

  const actionStyle = `height: 34px; padding: 6px 14px; ${actionMotion(
    COLORS.PRIMARY_COLOR,
    COLORS.ICON_ACTIVE_COLOR
  )}`;

  // KAN-221. The row that replaces the other one on Edit or Done fades in from
  // 40% with a 2px blur, and does not move. Nothing under reduced motion.
  const rowIn = keyframes`
    from {
      opacity: 0.4;
      filter: blur(2px);
    }
    to {
      opacity: 1;
      filter: blur(0);
    }
  `;

  const dividerStyle = css`
    width: 1px;
    align-self: stretch;
    margin: 2px 0;
    background-color: ${COLORS.PANEL_BORDER_COLOR};
  `;

  // The end of the toolbar row. When the row is too narrow it wraps whole
  // onto its own line and stays right-aligned.
  const endStyle = css`
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    justify-content: flex-end;
    margin-left: auto;
  `;

  // KAN-220. The primary holds its HOVER fill while pressed, and the dip is
  // its press cue. The next rung, LABEL_L2, puts the label at 4.32:1 on the
  // dark page, below 4.5 -- the limit KAN-204 hit with the danger buttons. It
  // used to hold that fill by accident: this :hover came after Button's
  // :active, and nothing else moved, so pressing looked exactly like hovering.
  const primaryStyle = `
              height: 34px;
              padding: 6px 14px;
              font-weight: 500;
              color: ${COLORS.PRIMARY_COLOR};
              background-color: ${COLORS.TEXT_COLOR};
              border-color: ${COLORS.TEXT_COLOR};
              &:hover {
                background-color: ${COLORS.LABEL_L1_COLOR};
                border-color: ${COLORS.LABEL_L1_COLOR};
              }
              ${actionMotion(COLORS.TEXT_COLOR, COLORS.LABEL_L1_COLOR)}
              @media not all and (hover: hover) and (pointer: fine) {
                &:hover {
                  border-color: ${COLORS.TEXT_COLOR};
                }
              }
              /* KAN-401. Unavailable keeps this fill, not Button's light one. */
              &&[aria-disabled='true']:hover,
              &&[aria-disabled='true']:active {
                background-color: ${COLORS.TEXT_COLOR};
                border-color: ${COLORS.TEXT_COLOR};
              }
            `;

  // KAN-881. Each mode's controls, so the row not shown can keep its height (below).
  const editingControls = (
    <>
      {/* KAN-831. Done stands where Edit stood, so finishing an edit is a
        press in place; the tally takes the end of the row. */}
      <Button
        text={t('Done')}
        ariaLabel={t('Done')}
        ariaDisabled={nothingKept}
        tooltipText={nothingKept ? t('SavePdfNothingKept') : undefined}
        iconType="check"
        onClick={() => {
          setEditing(false);
          setRowSwapped(true);
        }}
        iconSize="1.2rem"
        iconColor={COLORS.PRIMARY_COLOR}
        iconStyle={actionIconStyle}
        style={primaryStyle}
      />
      <Button
        text={t('Reset')}
        ariaLabel={t('Reset')}
        onClick={() => setEdits(NO_EXPORT_EDITS)}
        // KAN-221. Nothing to put back until something is edited;
        // the same count as the tally, so they agree.
        ariaDisabled={tally.renamed === 0 && tally.hiddenTabs === 0}
        style={actionStyle}
      />
      <span css={endStyle}>
        <span
          role="status"
          css={css`
            font-size: 0.78rem;
            color: ${COLORS.LABEL_L1_COLOR};
            border: 1px solid ${COLORS.PANEL_BORDER_COLOR};
            border-radius: 999px;
            corner-shape: ${CORNER_SHAPE};
            padding: 2px 9px;
            white-space: nowrap;
            font-variant-numeric: tabular-nums;
          `}
        >
          {t('SavePdfEditTally', {
            renamed: tally.renamed,
            hidden: tally.hiddenTabs,
          })}
        </span>
      </span>
    </>
  );
  const previewControls = (reserve: boolean) => (
    <>
      {/* Edit changes what the file says; the choices after it change how
        it looks, and the outputs after those write it. */}
      <Button
        text={t('Edit')}
        ariaLabel={t('Edit')}
        iconType="edit"
        onClick={() => {
          setEditing(true);
          setRowSwapped(true);
          // KAN-603. The frame leaves; the one Done brings back has loaded nothing yet.
          setLoadedHtml(null);
        }}
        iconSize="1.2rem"
        iconStyle={actionIconStyle}
        style={actionStyle}
      />
      <span aria-hidden="true" css={dividerStyle} />
      <SlidingPair
        label={t('Layout')}
        options={layoutOptions}
        value={layout}
        onChange={(value) => dispatch(setExportLayout(value))}
        metrics={EXPORT_PAIR_METRICS}
      />
      <SlidingPair
        label={t('Colour')}
        options={schemeOptions}
        value={scheme}
        onChange={setPageScheme}
        metrics={EXPORT_PAIR_METRICS}
      />
      {/* Deciding ends here; what follows leaves the page, from the
        end of the row. A PDF is what people attach to a message; the
        .html file KAN-734 hid is gone for good (KAN-742). */}
      <span css={endStyle} ref={reserve ? undefined : attachEndGroup}>
        {/* Copy first: it ignores the choices, so it sits apart from the
          output that follows them. */}
        <Button
          text={t('Copy all links')}
          ariaLabel={t('Copy all links')}
          iconType="link"
          onClick={handleCopy}
          // KAN-221. "Copied" appears in the button, where the click
          // was; the toast (KAN-401) says how many.
          secondFace={{
            iconType: 'check',
            text: t('Copied'),
            shown: copied,
          }}
          iconSize="1.2rem"
          iconStyle={actionIconStyle}
          style={actionStyle}
        />
        <Button
          // KAN-742. A PDF is the only file this page makes; the "…" says
          // Chrome's print dialog follows, where a printer can still be picked
          // (KAN-207's objection, weighed and accepted).
          text={t('Save as PDF')}
          ariaLabel={t('Save as PDF')}
          iconType="print"
          onClick={handlePrint}
          busy={printPending}
          iconSize="1.2rem"
          iconColor={COLORS.PRIMARY_COLOR}
          iconStyle={actionIconStyle}
          // FILLED, not tinted. A tint is what a pressed segment wears here,
          // so tinting the primary would make the loudest control on the
          // row read as one more selected state.
          style={primaryStyle}
        />
      </span>
    </>
  );
  const toolbarRowStyle = css`
    grid-area: 2 / 1;
    align-self: start;
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    ${SHEET_WIDTH}
  `;

  return (
    <ThemeColorsOverride.Provider value={COLORS}>
      {pageGlobal}
      <div css={pageStyle}>
        {/* The toolbar has a row of its own, always. Beside the title it fit
          or wrapped depending on how long each mode's toolbar was, so pressing
          Edit moved every control up a row. KAN-880: the title and counts left
          the header; the sheet shows both in large type. Done with
          align-items on this column and a width on each child rather than a
          wrapper, so nothing that walks from data-toolbar-row to its parent
          changes. */}
        <div data-preview-header css={headerStyle}>
          {backLine}

          <div
            // Keyed by mode so the new row mounts, and its fade plays, on
            // every swap.
            key={editing ? 'editing' : 'preview'}
            data-toolbar-row
            data-swapped={rowSwapped}
            css={[
              toolbarRowStyle,
              css`
                &[data-swapped='true'] {
                  animation: ${rowIn} 180ms cubic-bezier(0.23, 1, 0.32, 1);
                }
                @media (prefers-reduced-motion: reduce) {
                  &[data-swapped='true'] {
                    animation: none;
                  }
                }
              `,
            ]}
          >
            {editing ? editingControls : previewControls(false)}
          </div>
          {/* KAN-881. The other mode's row, in the same grid cell and hidden, so
            the toolbar is as tall as the taller of the two at every width and
            Edit or Done never moves the sheet. After the shown row, so that
            row's previous sibling is still the way back. */}
          <div
            key={editing ? 'reserve-preview' : 'reserve-editing'}
            data-toolbar-row-reserve
            aria-hidden="true"
            ref={attachReserve}
            css={[
              toolbarRowStyle,
              css`
                visibility: hidden;
              `,
            ]}
          >
            {editing ? previewControls(true) : editingControls}
          </div>
        </div>

        {/* KAN-880. The page names its mode just above the sheet's top-left corner,
          not in the header. Its height is fixed and the pencil sized into it,
          so swapping Preview for Editing moves nothing. */}
        <span
          css={css`
            ${SHEET_WIDTH}
            display: flex;
            align-items: center;
            gap: 5px;
            height: 1rem;
            margin: 16px auto 4px;
            font-size: ${TYPE.META};
            font-weight: 600;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            color: ${COLORS.LABEL_L2_COLOR};
          `}
        >
          {editing && <Icon type="edit" size="0.9rem" style="padding: 0;" />}
          <span>{editing ? t('Editing') : t('Preview')}</span>
        </span>
        {editing ? (
          // KAN-880. The editor on the same sheet as the file, so Edit and Done change only the words.
          <div css={sheetStyle}>
            <ExportEditor
              session={tidied}
              edits={edits}
              scheme={scheme}
              layout={layout}
              icons={icons}
              onRename={renameRow}
              onToggleHidden={toggleHidden}
            />
          </div>
        ) : (
          <>
            {/* The preview is the file itself, in its own document: it carries its
          own security rule and styling, and nothing on this page can leak
          into what gets saved. */}
            <iframe
              ref={attachFrame}
              title={edited.title}
              srcDoc={html}
              onLoad={(e) => {
                setLoadedHtml(html);
                listenInFrame(e.currentTarget.contentDocument);
              }}
              // allow-modals is what makes print() work: Chrome ignores print()
              // from a sandboxed frame without it, silently but for a console line.
              // allow-scripts is still absent, so the file cannot run anything.
              sandbox="allow-same-origin allow-modals"
              css={sheetStyle}
            />
            {!hasPressedSaveAsPdf && (
              <SavePdfPointer button={saveButton} sheet={frameEl} />
            )}
          </>
        )}
        {/* KAN-401, KAN-695. Inside the override, so they take the page's scheme. */}
        <Toast />
        <TooltipLayer />
      </div>
    </ThemeColorsOverride.Provider>
  );
}
