import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
import SlidingPair, { type SlidingOption } from '../common/SlidingPair';
import { EXPORT_PAIR_METRICS, KNOB_TRANSITION } from './slidingPairStyle';
import {
  DARKENHEIMER_THEME,
  isDarkTheme,
  LIGHT_THEME,
  ThemeColorsOverride,
} from '../../hooks/useThemeColors';
import { useFontFamily } from '../../hooks/useFontFamily';
import { AppDispatch, RootState } from '../../redux/store';
import { setExportLayout } from '../../redux/slices/settingsDataStateSlice';
import {
  replaceState,
  type tabContainerData,
} from '../../redux/slices/tabContainerDataStateSlice';
import { captureOpenWindows } from '../../utils/functions/capture';
import {
  isValidTabMasterContainer,
  loadFromLocalStorage,
} from '../../utils/functions/local';
import { EXPORT_STORE_URL } from '../../utils/constants/common';
import { formatGroupCounts, formatTabCount } from '../../utils/functions/local';
import { sessionDateLabel } from '../../utils/functions/sessionDate';
import {
  EXPORT_PALETTE,
  exportFileName,
  sessionToHtml,
  tidySessionForExport,
  type ExportLayout,
  type ExportScheme,
} from '../../utils/functions/sessionExportHtml';
import { copySessionLinks } from '../../utils/functions/copySessionLinks';
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
 * from -- the preview, edit mode, Copy, Save as HTML and Print never ask.
 */

/**
 * How wide the header's content may grow, centred (KAN-235).
 *
 * The document below sits in a 720px column; this is what keeps Edit and
 * PDF / Print from running to the monitor's edges above it. The number is the
 * toolbar's one-line floor: it wraps its right-hand group onto its own line
 * when it cannot fit, and the widest locale's one-line width is Russian at
 * 1061px (zh 736, en 834, hi 848, ja 877, it 906, pt 958, de 962, es 973,
 * fr 989). At 960 five locales would wrap on a screen with room to spare.
 * Rendered at 2000 and 1440 in en and ru before choosing.
 */
const HEADER_CONTENT_MAX_PX = 1100;

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
  | { kind: 'saved'; tabGroupId: string }
  | { kind: 'open-windows' };

export default function ExportPage({ source }: { source: ExportSource }) {
  const { t, i18n } = useTranslation();
  const dispatch: AppDispatch = useDispatch();
  const FONT_FAMILY = useFontFamily();
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout>>();
  // KAN-221. Set by Edit and Done, never on arrival: the row fades in when it
  // replaces the other row, not when the page opens.
  const [rowSwapped, setRowSwapped] = useState(false);
  // KAN-194. Edits are for this export only: held here, applied to a copy,
  // and gone when the tab closes. `writtenEdits` is the set last saved to a
  // file, so closing after saving does not warn about changes already kept.
  const [editing, setEditing] = useState(false);
  const [edits, setEdits] = useState<ExportEdits>(NO_EXPORT_EDITS);
  const [writtenEdits, setWrittenEdits] =
    useState<ExportEdits>(NO_EXPORT_EDITS);
  const frameRef = useRef<HTMLIFrameElement>(null);

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
   * The page's own tab is left out BY ID -- chrome.windows.getAll lists it
   * too -- so another Tab Keeper page that is genuinely open still appears.
   */
  const [captured, setCaptured] = useState<tabContainerData | null | undefined>(
    undefined
  );
  useEffect(() => {
    if (source.kind !== 'open-windows') return;
    let cancelled = false;
    (async () => {
      const own = await chrome.tabs.getCurrent();
      const snapshot = await captureOpenWindows(
        t('Open windows'),
        'all-windows',
        { excludeTabId: own?.id }
      );
      if (!cancelled) setCaptured(snapshot);
    })();
    return () => {
      cancelled = true;
    };
  }, [source.kind, t]);

  const session =
    source.kind === 'saved' ? savedSession : captured ?? undefined;
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
  const tally = useMemo(
    () =>
      tidied ? countExportEdits(tidied, edits) : { renamed: 0, hiddenTabs: 0 },
    [tidied, edits]
  );

  // Nothing is stored, so closing with unsaved edits loses them. Chrome asks
  // only when a beforeunload listener cancels the event, and draws its own
  // dialog; the page cannot choose the words.
  const pending =
    (tally.renamed > 0 || tally.hiddenTabs > 0) && edits !== writtenEdits;
  useEffect(() => {
    if (!pending) return;
    const ask = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', ask);
    return () => window.removeEventListener('beforeunload', ask);
  }, [pending]);
  const layout = useSelector(
    (state: RootState) => state.settingsDataState.exportLayout
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

  // The page opens on the extension theme's polarity and follows it until
  // Light or Dark is pressed here.
  const scheme: ExportScheme =
    pageScheme ?? (isDarkTheme(theme) ? 'dark' : 'light');
  // One page, light or dark: the header and the file share a polarity, rather
  // than the extension's tinted chrome framing a document. The shared
  // components below get the same colours through ThemeColorsOverride.
  const COLORS = scheme === 'dark' ? DARKENHEIMER_THEME : LIGHT_THEME;

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
      dateLabel:
        source.kind === 'saved'
          ? sessionDateLabel(session, sessionDateBasis, i18n.language, t)
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
        notAWebLink: t('ExportNotAWebLink'),
        savedWith: t('ExportFooterCredit'),
        getExtension: t('Get the extension'),
      },
      mark: markDataUri,
      storeUrl: EXPORT_STORE_URL,
      savedOn: new Date().toLocaleDateString(i18n.language, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      }),
    });
  }, [
    session,
    edited,
    layout,
    scheme,
    sessionDateBasis,
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

  const pageStyle = css`
    min-height: 100vh;
    background-color: ${COLORS.PRIMARY_COLOR};
    font-family: ${FONT_FAMILY};
    color: ${COLORS.TEXT_COLOR};
    display: flex;
    flex-direction: column;
  `;

  /**
   * The two choices, each a SlidingPair (KAN-218).
   *
   * Colour is GLYPHS and Layout is WORDS, deliberately (KAN-212):
   *
   * - the row wraps at the popup width in Russian. Measured at 900px, the
   *   colour pair cost 168.9px there against 125.5 in English as words, and a
   *   glyph costs the same in every language.
   * - light and dark have a symbol everyone already knows. Comfortable and
   *   compact do not: density_large against density_small is two sets of
   *   horizontal lines differing by a few pixels of spacing, and neither says
   *   which one is roomier.
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
        { value: 'compact', label: t('Compact') },
        { value: 'comfortable', label: t('Comfortable') },
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

  // Still capturing: the page, and nothing on it. NOT "Session not found",
  // which would be a false statement for the length of the capture and would
  // flash on every load.
  if (capturing) {
    return <div css={pageStyle} data-capturing />;
  }

  if (!session || !tidied || !edited) {
    return (
      <div css={pageStyle}>
        <p
          css={css`
            margin: 48px auto;
            color: ${COLORS.LABEL_L1_COLOR};
          `}
        >
          {t('Session not found')}
        </p>
      </div>
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

  const handleSave = () => {
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = exportFileName(edited.title, new Date());
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    // Revoked on a later turn, not immediately: the download is handed off
    // asynchronously, and revoking in the same tick cancels it in Chrome.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    setWrittenEdits(edits);
  };

  // KAN-209. The copy itself now lives in copySessionLinks, which the session
  // menu in the popup also calls -- one definition of what "copy all links"
  // means, rather than the same promise implemented twice.
  //
  // `edited`, not the stored session: this page is previewing a copy with the
  // user's renames and hidden rows applied, and Copy should give what is on
  // screen. That is the ONLY difference between the two call sites; the menu
  // passes the session as stored because it has no preview to respect.
  const handleCopy = async () => {
    await copySessionLinks(edited, t, i18n.language);
    setCopied(true);
    // A second copy restarts the two seconds rather than ending the first early.
    clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(false), 2000);
  };

  // Reaching into the frame needs same-origin, which is why the preview is
  // sandboxed with allow-same-origin and nothing else: scripts stay blocked,
  // so the file still cannot run anything, and the browser's print dialog is
  // where "Save as PDF" lives.
  const handlePrint = () => {
    frameRef.current?.contentWindow?.print();
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
    background-color: ${COLORS.BORDER_COLOR};
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
            `;

  return (
    <ThemeColorsOverride.Provider value={COLORS}>
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
            background-color: ${COLORS.PRIMARY_COLOR};
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
      <div css={pageStyle}>
        {/* The toolbar has a row of its own, always. Beside the title it fit
          or wrapped depending on how long each mode's toolbar was, so pressing
          Edit moved every control up a row.

          KAN-235. The header's CONTENT lives in a centred band; the header
          itself stays full bleed. The document below sits in a 720px column,
          and with the toolbar running edge to edge a wide monitor put Edit
          and PDF / Print ~1970px apart with the thing they act on in the
          middle. Done with align-items on this column and a max-width on
          each child rather than a wrapper, so nothing that walks from
          data-toolbar-row to its parent changes. Below the band's width this
          is inert: the 16px gutter is the edge, exactly as before. */}
        <div
          css={css`
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 10px;
            padding: 12px 16px;
            background-color: ${COLORS.SECONDARY_COLOR};
            border-bottom: 1px solid ${COLORS.BORDER_COLOR};
          `}
        >
          <div
            css={css`
              display: flex;
              flex-direction: column;
              gap: 2px;
              min-width: 0;
              width: 100%;
              max-width: ${HEADER_CONTENT_MAX_PX}px;
            `}
          >
            {/* The page names its mode here and only here (picked from mocks).
              The header otherwise repeats the title the file shows below it,
              and nothing said the page is the file rather than the app. The
              label's height is fixed and the pencil sized into it, so swapping
              Preview for Editing moves nothing. */}
            <span
              css={css`
                display: inline-flex;
                align-items: center;
                gap: 5px;
                height: 1rem;
                font-size: 0.68rem;
                font-weight: 600;
                letter-spacing: 0.08em;
                text-transform: uppercase;
                color: ${COLORS.LABEL_L2_COLOR};
              `}
            >
              {editing && (
                <Icon type="edit" size="0.9rem" style="padding: 0;" />
              )}
              <span>{editing ? t('Editing') : t('Preview')}</span>
            </span>
            <span
              css={css`
                font-size: 1.125rem;
              `}
            >
              {edited.title}
            </span>
            <span
              css={css`
                font-size: 0.75rem;
                color: ${COLORS.LABEL_L2_COLOR};
              `}
            >
              {formatGroupCounts(edited.windowCount, edited.tabCount, false, t)}
            </span>
          </div>

          <div
            // Keyed by mode so the new row mounts, and its fade plays, on
            // every swap.
            key={editing ? 'editing' : 'preview'}
            data-toolbar-row
            data-swapped={rowSwapped}
            css={css`
              display: flex;
              align-items: center;
              gap: 10px;
              flex-wrap: wrap;
              width: 100%;
              max-width: ${HEADER_CONTENT_MAX_PX}px;
              &[data-swapped='true'] {
                animation: ${rowIn} 180ms cubic-bezier(0.23, 1, 0.32, 1);
              }
              @media (prefers-reduced-motion: reduce) {
                &[data-swapped='true'] {
                  animation: none;
                }
              }
            `}
          >
            {editing ? (
              <>
                <span
                  role="status"
                  css={css`
                    font-size: 0.78rem;
                    color: ${COLORS.LABEL_L1_COLOR};
                    border: 1px solid ${COLORS.BORDER_COLOR};
                    border-radius: 999px;
                    padding: 2px 9px;
                    white-space: nowrap;
                    font-variant-numeric: tabular-nums;
                  `}
                >
                  {t('ExportEditTally', {
                    renamed: tally.renamed,
                    hidden: tally.hiddenTabs,
                  })}
                </span>
                <span css={endStyle}>
                  <Button
                    text={t('Reset')}
                    ariaLabel={t('Reset')}
                    onClick={() => setEdits(NO_EXPORT_EDITS)}
                    // KAN-221. Nothing to put back until something is edited;
                    // the same count as the tally beside it, so they agree.
                    ariaDisabled={tally.renamed === 0 && tally.hiddenTabs === 0}
                    style={actionStyle}
                  />
                  <Button
                    text={t('Done')}
                    ariaLabel={t('Done')}
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
                </span>
              </>
            ) : (
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
              end of the row -- the primary stands where Done stands while
              editing. KAN-207 made that the PDF output rather than the HTML
              file: a PDF is what people attach to a message, and an .html file
              is the specialist's output of the two. */}
                <span css={endStyle}>
                  {/* Copy first: it ignores the choices, so it must not sit between
              the two outputs that follow them. Swapping those two outputs in
              KAN-207 left that rule untouched -- Copy still precedes both. */}
                  <Button
                    text={t('Copy all links')}
                    ariaLabel={t('Copy all links')}
                    iconType="link"
                    onClick={handleCopy}
                    // KAN-221. "Copied" appears in the button, where the click
                    // was, rather than in a toast across the page.
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
                    text={t('Save as HTML')}
                    ariaLabel={t('Save as HTML')}
                    iconType="download"
                    onClick={handleSave}
                    iconSize="1.2rem"
                    iconStyle={actionIconStyle}
                    style={actionStyle}
                  />
                  <Button
                    // KAN-207. Deliberately still "PDF / Print", not "Save as
                    // PDF". handlePrint opens the browser's print dialog and the
                    // user picks the destination -- Save as PDF is only Chrome's
                    // usual default, and it can go to a printer. Naming an
                    // outcome this page does not control is the same
                    // over-promise as the "web page" wording this ticket
                    // removed from the menu item, and promoting the control is
                    // no reason to start making it.
                    text={t('Print')}
                    ariaLabel={t('Print')}
                    iconType="print"
                    onClick={handlePrint}
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
            )}
          </div>
        </div>

        {/* KAN-221. The button shows "Copied"; this says it to a screen
          reader, which cannot see the swap. Visually hidden, not a toast. */}
        <div
          role="status"
          css={css`
            position: absolute;
            width: 1px;
            height: 1px;
            margin: -1px;
            overflow: hidden;
            clip-path: inset(50%);
            white-space: nowrap;
          `}
        >
          {copied ? t('Links copied') : ''}
        </div>

        {editing ? (
          <ExportEditor
            session={tidied}
            edits={edits}
            scheme={scheme}
            onRename={renameRow}
            onToggleHidden={toggleHidden}
          />
        ) : (
          <>
            {/* The preview is the file itself, in its own document: it carries its
          own security rule and styling, and nothing on this page can leak
          into what gets saved. */}
            <iframe
              ref={frameRef}
              title={edited.title}
              srcDoc={html}
              // allow-modals is what makes print() work: Chrome ignores print()
              // from a sandboxed frame without it, silently but for a console line.
              // allow-scripts is still absent, so the file cannot run anything.
              sandbox="allow-same-origin allow-modals"
              css={css`
                border: 0;
                flex-grow: 1;
                width: 100%;
                background-color: ${EXPORT_PALETTE[scheme].bg};
              `}
            />
          </>
        )}
      </div>
    </ThemeColorsOverride.Provider>
  );
}
