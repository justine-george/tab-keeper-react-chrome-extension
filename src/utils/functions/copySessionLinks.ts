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
 * Takes the session to copy rather than reading one, so the export page can
 * pass the edited copy it is previewing while the menu passes the stored one.
 * That is the only difference between the two call sites, and it is the
 * caller's to decide.
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
    countsLabel: formatGroupCounts(
      session.windowCount,
      session.tabCount,
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
