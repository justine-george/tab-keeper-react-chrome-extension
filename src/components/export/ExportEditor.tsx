import { css } from '@emotion/react';
import { useTranslation } from 'react-i18next';

import Button from '../common/Button';
import type {
  tabContainerData,
  tabData,
  windowGroupData,
} from '../../redux/slices/tabContainerDataStateSlice';
import {
  exportRowKey,
  type ExportEdits,
} from '../../utils/functions/sessionExportEdits';
import {
  EXPORT_PALETTE,
  type ExportScheme,
} from '../../utils/functions/sessionExportHtml';
import {
  partitionTabsIntoRuns,
  sanitizeTabGroupColor,
  TAB_GROUP_COLOR_HEX,
} from '../../utils/functions/tabGroups';

interface ExportEditorProps {
  /** The session as saved. Edits are drawn over it, never written into it. */
  session: tabContainerData;
  edits: ExportEdits;
  /** The file's scheme, so the rows being edited look like the file. */
  scheme: ExportScheme;
  onRename: (key: string, title: string) => void;
  onToggleHidden: (key: string) => void;
}

// The system stack the file itself is set in (sessionExportHtml styles()).
const FILE_FONT =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

function siteOf(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

/**
 * The export page's Edit mode (KAN-194): the file's rows, with every title a
 * field where it sits and an eye at the end of each row.
 *
 * It lives on the page rather than inside the preview frame, which is
 * sandboxed without scripts. A hidden row stays where it was, faded and struck
 * through, so the same control brings it back; the file itself leaves it out.
 */
export default function ExportEditor({
  session,
  edits,
  scheme,
  onRename,
  onToggleHidden,
}: ExportEditorProps) {
  const { t } = useTranslation();
  const palette = EXPORT_PALETTE[scheme];

  const fieldStyle = css`
    font: inherit;
    color: inherit;
    background: transparent;
    border: 0;
    border-bottom: 1px dashed ${palette.rule};
    border-radius: 0;
    padding: 1px 2px;
    width: 100%;
    min-width: 0;
    &:focus {
      outline: none;
      border-bottom: 2px solid ${palette.link};
      background-color: ${palette.groupBg};
    }
  `;

  const rowStyle = css`
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  `;

  const field = (
    key: string,
    original: string,
    label: string,
    extra?: ReturnType<typeof css>
  ) => (
    <input
      type="text"
      aria-label={`${label}: ${original}`}
      value={edits.titles[key] ?? original}
      onChange={(event) => onRename(key, event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
      }}
      data-dims
      css={[fieldStyle, extra]}
    />
  );

  /**
   * KAN-222. The eye, from Justine's pick after a review against Emil
   * Kowalski's animation guidance:
   *
   * - held, it dips to 95% -- deeper than the toolbar's 97%, because 3% of a
   *   30px button is under a pixel -- and fills with the file's rule colour,
   *   one visible step past hover. Its own :active used to come BEFORE this
   *   :hover, so pressing looked exactly like hovering (the KAN-220 pattern);
   * - hover fills for a mouse or trackpad only;
   * - its glyph crossfades to the struck-through eye with a 2px blur, over
   *   150ms rather than 200, because rows get hidden in runs;
   * - reduced motion drops the dip and the blur.
   *
   * It is never dimmed with its row: see `data-dims`.
   */
  const eye = (key: string, name: string) => (
    <Button
      iconType="visibility"
      secondFace={{
        iconType: 'visibility_off',
        shown: edits.hidden.has(key),
        durationMs: 150,
      }}
      ariaLabel={`${t('Hide')}: ${name}`}
      ariaPressed={edits.hidden.has(key)}
      tooltipText={t('Hide')}
      onClick={() => onToggleHidden(key)}
      iconSize="1.1rem"
      iconColor={palette.muted}
      style={`
        flex: none;
        width: 30px;
        height: 28px;
        padding: 0;
        justify-content: center;
        border: 1px solid transparent;
        border-radius: 3px;
        background-color: transparent;
        transition:
          background-color 120ms ease,
          border-color 120ms ease,
          transform 140ms cubic-bezier(0.23, 1, 0.32, 1);
        @media (hover: hover) and (pointer: fine) {
          &:hover {
            background-color: ${palette.groupBg};
            border-color: ${palette.rule};
          }
        }
        @media not all and (hover: hover) and (pointer: fine) {
          &:hover {
            background-color: transparent;
          }
        }
        &:active {
          transform: scale(0.95);
          background-color: ${palette.rule};
          border-color: ${palette.rule};
        }
        @media (prefers-reduced-motion: reduce) {
          transition:
            background-color 120ms ease,
            border-color 120ms ease;
          &:active {
            transform: none;
          }
        }
      `}
    />
  );

  const tabRow = (window: windowGroupData, tab: tabData, index: number) => {
    const key = exportRowKey.tab(window, tab.tabId);
    const name = tab.title || tab.url;
    return (
      <li
        key={`${tab.tabId}-${index}`}
        css={[
          rowStyle,
          css`
            padding: 2px 0;
            border-bottom: 1px solid ${palette.rule};
          `,
        ]}
        data-hidden={edits.hidden.has(key) || undefined}
      >
        {field(
          key,
          tab.title,
          t('Rename tab'),
          css`
            font-size: 14px;
            color: ${/^https?:\/\//i.test(tab.url)
              ? palette.link
              : palette.plain};
          `
        )}
        <span
          data-dims
          css={css`
            flex: none;
            max-width: 30%;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            font-size: 12px;
            color: ${palette.muted};
          `}
        >
          {siteOf(tab.url)}
        </span>
        {eye(key, name)}
      </li>
    );
  };

  const sessionKey = exportRowKey.session();

  return (
    <div
      css={css`
        flex-grow: 1;
        background-color: ${palette.bg};
        color: ${palette.text};
        font: 15px/1.5 ${FILE_FONT};
        padding: 30px 24px 40px;

        /* KAN-222. A hidden row stays where it was, faded and struck through,
           so the same eye brings it back. The fade goes on the row's own
           content, marked data-dims, and never on a container: on a container
           it dimmed the eye with it (1.95:1 light, 2.40:1 dark) and compounded
           through a hidden window (0.45 x 0.45). Each dimmable element is
           dimmed once, by any hidden row it sits in. The fade stays under
           reduced motion: it is colour, not movement. */
        [data-dims] {
          transition: opacity 150ms ease;
        }
        [data-hidden] [data-dims] {
          opacity: 0.45;
        }
        [data-hidden] input,
        [data-hidden] textarea {
          text-decoration: line-through;
        }
      `}
    >
      <div
        css={css`
          max-width: 720px;
          margin: 0 auto;
          display: flex;
          flex-direction: column;
          gap: 24px;
        `}
      >
        {/* A textarea, not an input: a long session title wraps, as the
            file's heading does, instead of scrolling out of sight. */}
        <textarea
          rows={1}
          aria-label={`${t('Rename session')}: ${session.title}`}
          value={edits.titles[sessionKey] ?? session.title}
          onChange={(event) => onRename(sessionKey, event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              event.currentTarget.blur();
            }
          }}
          css={[
            fieldStyle,
            css`
              font-size: 26px;
              font-weight: 700;
              line-height: 1.2;
              resize: none;
              overflow: hidden;
              field-sizing: content;
            `,
          ]}
        />

        {session.windows.map((window, index) => {
          const windowKey = exportRowKey.window(window);
          return (
            <section
              key={`${window.windowId}-${index}`}
              data-hidden={edits.hidden.has(windowKey) || undefined}
            >
              <div
                css={[
                  rowStyle,
                  css`
                    font-size: 14px;
                    font-weight: 600;
                    margin-bottom: 6px;
                  `,
                ]}
              >
                <span
                  data-dims
                  css={css`
                    flex: none;
                    white-space: nowrap;
                  `}
                >
                  {t('Window')} {index + 1} ·
                </span>
                {field(windowKey, window.title, t('Rename window group'))}
                {eye(windowKey, window.title)}
              </div>
              <ul
                css={css`
                  list-style: none;
                  margin: 0;
                  padding: 0;
                `}
              >
                {partitionTabsIntoRuns(window.tabs, window.chromeTabGroups).map(
                  (run, runIndex) => {
                    if (run.kind === 'ungrouped') {
                      return run.tabs.map((tab, tabIndex) =>
                        tabRow(window, tab, runIndex * 1000 + tabIndex)
                      );
                    }
                    const groupKey = exportRowKey.group(
                      window,
                      run.group.groupId
                    );
                    const color =
                      TAB_GROUP_COLOR_HEX[
                        sanitizeTabGroupColor(run.group.color)
                      ];
                    return (
                      <li
                        key={`${run.group.groupId}-${runIndex}`}
                        data-hidden={edits.hidden.has(groupKey) || undefined}
                        css={css`
                          position: relative;
                          isolation: isolate;
                          margin: 4px 0;
                          padding: 0 10px 0 14px;
                        `}
                      >
                        {/* The group's colour band, as a layer of its own so it
                          can dim without dimming the eyes on top of it. The
                          4px border moved inside the layer, so the left
                          padding grew by 4px and nothing moves. */}
                        <span
                          aria-hidden="true"
                          data-group-band
                          data-dims
                          css={css`
                            position: absolute;
                            inset: 0;
                            z-index: -1;
                            border-left: 4px solid ${color};
                            background-color: ${palette.groupBg};
                          `}
                        />
                        <div
                          css={[
                            rowStyle,
                            css`
                              font-size: 12px;
                              font-weight: 600;
                              color: ${palette.muted};
                              padding-top: 4px;
                            `,
                          ]}
                        >
                          {field(groupKey, run.group.title, t('Rename group'))}
                          {eye(groupKey, run.group.title)}
                        </div>
                        <ul
                          css={css`
                            list-style: none;
                            margin: 0;
                            padding: 0;
                          `}
                        >
                          {run.tabs.map((tab, tabIndex) =>
                            tabRow(window, tab, tabIndex)
                          )}
                        </ul>
                      </li>
                    );
                  }
                )}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
