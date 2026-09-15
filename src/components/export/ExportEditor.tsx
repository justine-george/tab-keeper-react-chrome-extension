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

  const hiddenStyle = css`
    opacity: 0.45;
    input,
    textarea {
      text-decoration: line-through;
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
      css={[fieldStyle, extra]}
    />
  );

  const eye = (key: string, name: string) => (
    <Button
      iconType={edits.hidden.has(key) ? 'visibility_off' : 'visibility'}
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
        &:hover {
          background-color: ${palette.groupBg};
          border-color: ${palette.rule};
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
          edits.hidden.has(key) && hiddenStyle,
        ]}
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
              css={edits.hidden.has(windowKey) && hiddenStyle}
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
                        css={[
                          css`
                            margin: 4px 0;
                            padding: 0 10px;
                            border-left: 4px solid ${color};
                            background-color: ${palette.groupBg};
                          `,
                          edits.hidden.has(groupKey) && hiddenStyle,
                        ]}
                      >
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
