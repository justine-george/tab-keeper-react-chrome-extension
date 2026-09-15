import { useEffect, useMemo, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { css } from '@emotion/react';

// `?inline` so the mark is base64 IN the bundle: the exported file must carry
// its own icon, because it is opened from disk, offline, long after the
// extension that wrote it is out of the picture.
import markDataUri from '../../assets/exportMark.png?inline';
import Button from '../common/Button';
import Icon from '../common/Icon';
import ExportEditor from './ExportEditor';
import { useThemeColors } from '../../hooks/useThemeColors';
import { useFontFamily } from '../../hooks/useFontFamily';
import { AppDispatch, RootState } from '../../redux/store';
import {
  setExportLayout,
  setExportScheme,
  Theme,
} from '../../redux/slices/settingsDataStateSlice';
import { replaceState } from '../../redux/slices/tabContainerDataStateSlice';
import {
  isValidTabMasterContainer,
  loadFromLocalStorage,
} from '../../utils/functions/local';
import { EXPORT_STORE_URL } from '../../utils/constants/common';
import { formatGroupCounts } from '../../utils/functions/local';
import { sessionDateLabel } from '../../utils/functions/sessionDate';
import {
  exportFileName,
  sessionToHtml,
  sessionToLinkList,
  type ExportLayout,
  type ExportScheme,
} from '../../utils/functions/sessionExportHtml';
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
 * The session is named by id rather than passed in, because this is a URL: the
 * tab can be reloaded, bookmarked, or opened after the session was deleted in
 * the popup. `tabGroupId` matching nothing is a state this renders, not a
 * crash.
 */
export default function ExportPage({ tabGroupId }: { tabGroupId: string }) {
  const { t, i18n } = useTranslation();
  const dispatch: AppDispatch = useDispatch();
  const COLORS = useThemeColors();
  const FONT_FAMILY = useFontFamily();
  const [copied, setCopied] = useState(false);
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
  useEffect(() => {
    const candidate = loadFromLocalStorage('tabContainerData');
    if (isValidTabMasterContainer(candidate)) {
      dispatch(replaceState(candidate));
    } else if (candidate !== undefined) {
      console.warn('Ignoring unreadable tabContainerData in localStorage.');
    }
  }, [dispatch]);

  const session = useSelector((state: RootState) =>
    state.tabContainerDataState.tabGroups.find(
      (group) => group.tabGroupId === tabGroupId
    )
  );

  // Every output -- the preview, the saved file, the PDF, the clipboard --
  // is built from this one copy, so they cannot disagree about an edit.
  const edited = useMemo(
    () => (session ? applyExportEdits(session, edits) : undefined),
    [session, edits]
  );
  const tally = useMemo(
    () =>
      session
        ? countExportEdits(session, edits)
        : { renamed: 0, hiddenTabs: 0 },
    [session, edits]
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
  const schemePreference = useSelector(
    (state: RootState) => state.settingsDataState.exportScheme
  );
  const sessionDateBasis = useSelector(
    (state: RootState) => state.settingsDataState.sessionDateBasis
  );

  const scheme: ExportScheme =
    schemePreference === 'auto'
      ? theme === Theme.DARKENHEIMER || theme === Theme.BLUE
        ? 'dark'
        : 'light'
      : schemePreference;

  const html = useMemo(() => {
    if (!session || !edited) return '';
    return sessionToHtml(edited, {
      layout,
      scheme,
      dateLabel: sessionDateLabel(session, sessionDateBasis, i18n.language, t),
      countsLabel: formatGroupCounts(
        edited.windowCount,
        edited.tabCount,
        false,
        t
      ),
      tabCountLabel: (count) => `${count} ${count > 1 ? t('Tabs') : t('Tab')}`,
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
  }, [session, edited, layout, scheme, sessionDateBasis, i18n.language, t]);

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

  if (!session || !edited) {
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

  const handleCopy = async () => {
    await navigator.clipboard.writeText(
      sessionToLinkList(edited, {
        window: t('Window'),
        tabCountLabel: (count) =>
          `${count} ${count > 1 ? t('Tabs') : t('Tab')}`,
      })
    );
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Reaching into the frame needs same-origin, which is why the preview is
  // sandboxed with allow-same-origin and nothing else: scripts stay blocked,
  // so the file still cannot run anything, and the browser's print dialog is
  // where "Save as PDF" lives.
  const handlePrint = () => {
    frameRef.current?.contentWindow?.print();
  };

  // A button inside a joined pair: no border of its own, no radius, and a
  // hairline against its neighbour. The group draws the box.
  const segmentStyle = (selected: boolean, first: boolean) => `
    height: 100%;
    padding: 6px 14px;
    border: 0;
    border-radius: 0;
    ${first ? '' : `border-left: 1px solid ${COLORS.BORDER_COLOR};`}
    background-color: ${
      selected ? COLORS.SELECTION_COLOR : COLORS.PRIMARY_COLOR
    };
  `;

  // Icon carries 4px of its own padding all round, and Button adds 8px to
  // its right -- so the gap left of the icon was 4px wider than the gap right
  // of the label. Dropping the left padding makes the button symmetrical.
  const actionIconStyle = 'padding-left: 0; padding-right: 6px;';

  // 34px outside, border included, like every other control on the row. As
  // content-box around 34px buttons the pair stood 36px, so the resting row was
  // 2px taller than the editing row and the page rose when Edit was pressed.
  const groupStyle = css`
    box-sizing: border-box;
    height: 34px;
    display: inline-flex;
    align-items: stretch;
    border: 1px solid ${COLORS.BORDER_COLOR};
    border-radius: 3px;
    overflow: hidden;
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

  const schemeButton = (value: ExportScheme, label: string, first: boolean) => (
    <Button
      text={label}
      ariaLabel={label}
      ariaPressed={scheme === value}
      onClick={() => dispatch(setExportScheme(value))}
      style={segmentStyle(scheme === value, first)}
    />
  );

  const layoutButton = (value: ExportLayout, label: string, first: boolean) => (
    <Button
      text={label}
      ariaLabel={label}
      ariaPressed={layout === value}
      onClick={() => dispatch(setExportLayout(value))}
      style={segmentStyle(layout === value, first)}
    />
  );

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
            `;

  return (
    <div css={pageStyle}>
      {/* The toolbar has a row of its own, always. Beside the title it fit
          or wrapped depending on how long each mode's toolbar was, so pressing
          Edit moved every control up a row. */}
      <div
        css={css`
          display: flex;
          flex-direction: column;
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
            {editing && <Icon type="edit" size="0.9rem" style="padding: 0;" />}
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
          css={css`
            display: flex;
            align-items: center;
            gap: 10px;
            flex-wrap: wrap;
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
                  style={`height: 34px; padding: 6px 14px;`}
                />
                <Button
                  text={t('Done')}
                  ariaLabel={t('Done')}
                  iconType="check"
                  onClick={() => setEditing(false)}
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
                onClick={() => setEditing(true)}
                iconSize="1.2rem"
                iconStyle={actionIconStyle}
                style={`height: 34px; padding: 6px 14px;`}
              />
              <span aria-hidden="true" css={dividerStyle} />
              <span css={groupStyle} role="group" aria-label={t('Layout')}>
                {layoutButton('comfortable', t('Comfortable'), true)}
                {layoutButton('compact', t('Compact'), false)}
              </span>
              <span css={groupStyle} role="group" aria-label={t('Colour')}>
                {schemeButton('light', t('Light'), true)}
                {schemeButton('dark', t('Dark'), false)}
              </span>
              {/* Deciding ends here; what follows leaves the page, from the
              end of the row -- Save stands where Done stands while editing. */}
              <span css={endStyle}>
                {/* Copy first: it ignores the choices, so it must not sit between
              the two outputs that follow them. */}
                <Button
                  text={t('Copy all links')}
                  ariaLabel={t('Copy all links')}
                  iconType="link"
                  onClick={handleCopy}
                  iconSize="1.2rem"
                  iconStyle={actionIconStyle}
                  style={`height: 34px; padding: 6px 14px;`}
                />
                <Button
                  text={t('Print')}
                  ariaLabel={t('Print')}
                  iconType="print"
                  onClick={handlePrint}
                  iconSize="1.2rem"
                  iconStyle={actionIconStyle}
                  style={`height: 34px; padding: 6px 14px;`}
                />
                <Button
                  text={t('Save as HTML')}
                  ariaLabel={t('Save as HTML')}
                  iconType="download"
                  onClick={handleSave}
                  iconSize="1.2rem"
                  iconColor={COLORS.PRIMARY_COLOR}
                  iconStyle={actionIconStyle}
                  // FILLED, not tinted. A tint is what a pressed segment wears here,
                  // so tinting Save would make the loudest control on the row read
                  // as one more selected state.
                  style={primaryStyle}
                />
              </span>
            </>
          )}
        </div>
      </div>

      {copied && (
        <div
          role="status"
          css={css`
            /* Floating, not in the flow: as a block this pushed the whole
               preview down and pulled it back two seconds later, so the
               confirmation moved the thing it was confirming. */
            position: fixed;
            right: 16px;
            bottom: 16px;
            z-index: 2;
            pointer-events: none;
            padding: 8px 14px;
            border-radius: 4px;
            font-size: 0.85rem;
            color: ${COLORS.PRIMARY_COLOR};
            background-color: ${COLORS.TEXT_COLOR};
            box-shadow: 0 2px 10px rgba(0, 0, 0, 0.25);
          `}
        >
          {t('Links copied')}
        </div>
      )}

      {editing ? (
        <ExportEditor
          session={session}
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
              background-color: #fff;
            `}
          />
        </>
      )}
    </div>
  );
}
