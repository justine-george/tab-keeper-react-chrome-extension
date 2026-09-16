import type { tabContainerData } from '../../redux/slices/tabContainerDataStateSlice';
import { formatGroupCounts } from './local';
import {
  sessionToLinkHtml,
  sessionToLinkList,
  type LinkListStrings,
} from './sessionExportHtml';

/**
 * Puts a session's links on the clipboard: a rich list for editors that read
 * HTML, and a plain layout for everything else. The app pasted into picks one.
 *
 * ONE definition, because there are two places to copy from (KAN-209): the
 * export page's toolbar and the session's own menu in the popup. Those are the
 * same promise made twice, and two implementations of it would drift -- the
 * label a window gets, the counts line, which failures fall back to plain text.
 * Whatever this does, both places do.
 *
 * Copies `session` VERBATIM. It does not tidy, and the caller must hand over
 * the session it actually wants on the clipboard.
 *
 * That is a deliberate refusal, not an omission (KAN-210). Tidying here would
 * be safe for the menu and wrong for the export page: `applyExportEdits`
 * renames tab titles, so a second tidy pass would run dropNotificationCount
 * over the user's OWN words -- rename a tab to "(3) Meeting notes" and Copy
 * would quietly strip the prefix while the saved file kept it, which is the
 * same disagreement between two outputs that this ticket exists to remove.
 *
 * So each caller prepares its session and the difference between them is
 * visible at the call site:
 *
 *   the export page  applyExportEdits(tidySessionForExport(s), edits)
 *   the session menu tidySessionForExport(s)
 *
 * Both are tidied. Only the export page applies edits, because only it has a
 * preview to respect. KAN-210 was this function shipping while the menu passed
 * a raw session, so the shortcut gave the worse of two answers.
 *
 * `t` and `language` are passed in because nothing outside the component tree
 * has a `t` to call -- the same division of labour the toast messages keep.
 *
 * Resolves once something is on the clipboard. It does not resolve false or
 * throw on the rich path failing, because that is not a failure the user needs
 * to hear about: the plain list is a complete answer, and it is what most
 * targets would have taken anyway.
 */
export async function copySessionLinks(
  session: tabContainerData,
  t: (key: string) => string,
  language: string
): Promise<void> {
  const strings: LinkListStrings = {
    window: t('Window'),
    tabCountLabel: (count: number) =>
      `${count} ${count > 1 ? t('Tabs') : t('Tab')}`,
    // DERIVED from the session being copied, not read off its stored
    // windowCount/tabCount (KAN-210). The line describes this copy, so it is
    // counted from this copy.
    //
    // It also makes the two callers agree by construction. applyExportEdits
    // recomputes both fields as it walks, so the export page's session always
    // carried derived counts; tidySessionForExport does not, so the menu's
    // carried whatever was stored. They matched only while the stored numbers
    // were accurate, and a session whose counts had drifted would have printed
    // an honest line from one button and a false one from the other.
    countsLabel: formatGroupCounts(
      session.windows.length,
      session.windows.reduce((sum, window) => sum + window.tabs.length, 0),
      false,
      t
    ),
    locale: language,
  };

  const plain = sessionToLinkList(session, strings);
  if (await writeRich(sessionToLinkHtml(session, strings), plain)) return;
  await navigator.clipboard.writeText(plain);
}

/**
 * The rich write, and whether it landed.
 *
 * False rather than throwing, for both of the ways it can fail: a browser with
 * no `ClipboardItem` at all, and a `write` the page is not allowed to make.
 * The caller answers both the same way -- copy the plain text -- so telling
 * them apart would buy nothing.
 *
 * The one thing that must never happen here is a silent return: the clipboard
 * gives no feedback of its own, so a caught exception with no fallback copies
 * nothing and looks exactly like success.
 */
async function writeRich(html: string, plain: string): Promise<boolean> {
  if (typeof ClipboardItem === 'undefined') return false;
  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([plain], { type: 'text/plain' }),
      }),
    ]);
    return true;
  } catch {
    return false;
  }
}
