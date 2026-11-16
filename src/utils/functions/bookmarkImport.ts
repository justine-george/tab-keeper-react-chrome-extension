import { v4 as uuidv4 } from 'uuid';

import type {
  tabContainerData,
  tabData,
  windowGroupData,
} from '../../redux/slices/tabContainerDataStateSlice';
import { getStringDate, resolveTabUrl } from './local';
import { withoutRepeats } from './skipDuplicates';

type BookmarkNode = chrome.bookmarks.BookmarkTreeNode;

// KAN-862. One folder as the import dialog's tree shows it: only folders with something left to import (R19).
export interface BookmarkFolder {
  id: string;
  title: string;
  // Importable links at any depth not imported before; always above 0.
  count: number;
  // One of topFolders: its tick makes a session of its loose links and ticks its folders (11-16).
  isTop: boolean;
  // Only on top folders whose folderType appears more than once: account sync or this device.
  where?: 'account' | 'device';
  children: BookmarkFolder[];
}

const isFolder = (node: BookmarkNode): boolean => node.url === undefined;

// KAN-862. Chrome's own folders, the root's: Bookmarks Bar, Other Bookmarks, Mobile, managed, and their twins.
export const topFolders = (root: BookmarkNode): BookmarkNode[] =>
  (root.children ?? []).filter(isFolder);

// KAN-862. A save leaves out Tab Keeper's own pages (isTabKeeperPage); bookmarklets and blanks have no page to open.
export function isImportableUrl(
  url: string | undefined,
  ownOrigin: string
): boolean {
  if (url === undefined || url === '') return false;
  if (url.toLowerCase().startsWith('javascript:')) return false;
  return !resolveTabUrl(url).startsWith(ownOrigin);
}

// KAN-862 (11-16). `imported` holds bookmark ids imported before: a user folder's covers everything in it, a link's only itself.
// The folder with the links an import would still take, or null when there are none.
function toFolder(
  node: BookmarkNode,
  ownOrigin: string,
  isTop: boolean,
  imported: ReadonlySet<string>
): BookmarkFolder | null {
  const children: BookmarkFolder[] = [];
  let count = 0;
  for (const child of node.children ?? []) {
    if (imported.has(child.id)) continue;
    if (isFolder(child)) {
      const sub = toFolder(child, ownOrigin, false, imported);
      if (sub === null) continue;
      children.push(sub);
      count += sub.count;
    } else if (isImportableUrl(child.url, ownOrigin)) count += 1;
  }
  return count === 0
    ? null
    : { id: node.id, title: node.title, count, isTop, children };
}

// The root's folders with something left to import, each with its subfolders that have some; links only feed the counts.
export function folderTree(
  root: BookmarkNode,
  ownOrigin: string,
  imported: ReadonlySet<string>
): BookmarkFolder[] {
  const tops = topFolders(root);
  const typeCounts = new Map<string, number>();
  for (const top of tops)
    if (top.folderType !== undefined)
      typeCounts.set(top.folderType, (typeCounts.get(top.folderType) ?? 0) + 1);
  return tops.flatMap((top) => {
    const folder = toFolder(top, ownOrigin, true, imported);
    if (folder === null) return [];
    const twinned =
      top.folderType !== undefined && (typeCounts.get(top.folderType) ?? 0) > 1;
    return [
      twinned
        ? { ...folder, where: top.syncing ? 'account' : 'device' }
        : folder,
    ];
  });
}

function toTab(node: BookmarkNode, url: string): tabData {
  return { tabId: uuidv4(), favicon: '', title: node.title || url, url };
}

function toWindow(title: string, tabs: tabData[]): windowGroupData {
  return {
    windowId: uuidv4(),
    windowHeight: 0,
    windowWidth: 0,
    windowOffsetTop: 0,
    windowOffsetLeft: 0,
    title,
    tabs,
    tabCount: tabs.length,
  };
}

// Every importable link under `node`, depth first in bookmark order, leaving out what was imported before.
function flatten(
  node: BookmarkNode,
  ownOrigin: string,
  imported: ReadonlySet<string>,
  into: tabData[]
): void {
  for (const child of node.children ?? []) {
    if (imported.has(child.id)) continue;
    if (isFolder(child)) flatten(child, ownOrigin, imported, into);
    else if (child.url !== undefined && isImportableUrl(child.url, ownOrigin))
      into.push(toTab(child, child.url));
  }
}

// The node's own importable links not imported before, each with its bookmark id.
function ownLinks(
  node: BookmarkNode,
  ownOrigin: string,
  imported: ReadonlySet<string>
): { bookmarkId: string; tab: tabData }[] {
  const links: { bookmarkId: string; tab: tabData }[] = [];
  for (const child of node.children ?? [])
    if (
      child.url !== undefined &&
      !imported.has(child.id) &&
      isImportableUrl(child.url, ownOrigin)
    )
      links.push({ bookmarkId: child.id, tab: toTab(child, child.url) });
  return links;
}

function toSession(
  title: string,
  windows: windowGroupData[],
  now: Date
): tabContainerData | null {
  const kept = windows.filter((w) => w.tabs.length > 0);
  if (kept.length === 0) return null;
  return {
    tabGroupId: uuidv4(),
    title,
    createdTime: getStringDate(now),
    createdAt: now.getTime(),
    windowCount: kept.length,
    tabCount: kept.reduce((sum, w) => sum + w.tabCount, 0),
    isAutoSave: false,
    isSelected: true,
    windows: kept,
  };
}

// KAN-862. The folder's own links are one window named after it; each subfolder is a window, deeper ones folded into it.
// What was imported before is left out (11-16). null when nothing is left.
export function folderToSession(
  node: BookmarkNode,
  now: Date,
  ownOrigin: string,
  untitled: string,
  imported: ReadonlySet<string>
): tabContainerData | null {
  const title = node.title || untitled;
  const own = ownLinks(node, ownOrigin, imported).map((link) => link.tab);
  const windows = [toWindow(title, own)];
  for (const sub of node.children ?? []) {
    if (!isFolder(sub) || imported.has(sub.id)) continue;
    const tabs: tabData[] = [];
    flatten(sub, ownOrigin, imported, tabs);
    windows.push(toWindow(sub.title, tabs));
  }
  return toSession(title, windows, now);
}

// KAN-862 (11-16). A ticked top folder's session: only its loose links not imported before, one window named after it.
// It covers those links by bookmark id (R22), so links added later can still be imported.
function looseLinksSession(
  node: BookmarkNode,
  opts: SessionOptions
): SessionFromBookmarks | null {
  const title = node.title || opts.untitled;
  const links = ownLinks(node, opts.ownOrigin, opts.imported);
  const session = toSession(
    title,
    [
      toWindow(
        title,
        links.map((link) => link.tab)
      ),
    ],
    opts.now
  );
  return session === null
    ? null
    : { bookmarkIds: links.map((link) => link.bookmarkId), session };
}

// KAN-862. A session an import would make, and the bookmark ids it covers: a user folder's own id, or a top folder's loose links.
export interface SessionFromBookmarks {
  bookmarkIds: string[];
  session: tabContainerData;
}

interface SessionOptions {
  now: Date;
  ownOrigin: string;
  untitled: string;
  skipDuplicates: boolean;
  // Bookmark ids imported before: user folders whole, top folders' loose links one by one.
  imported: ReadonlySet<string>;
}

// KAN-862. One session per ticked folder, in tree order. A folder under a ticked user folder is part of that one's session; a ticked top folder (the root's own) gives only its loose links, and its folders count by their own ticks. Unknown ids and empty folders add nothing.
// What was imported before adds nothing (11-16).
export function sessionsFor(
  root: BookmarkNode,
  ticked: ReadonlySet<string>,
  opts: SessionOptions
): SessionFromBookmarks[] {
  const made: SessionFromBookmarks[] = [];
  // A duplicate the dedupe drops still counts as covered: its page is in the session.
  const add = (from: SessionFromBookmarks | null): void => {
    if (from === null) return;
    const session = opts.skipDuplicates
      ? withoutRepeats(from.session).container
      : from.session;
    if (session.tabCount > 0) made.push({ ...from, session });
  };
  const visit = (node: BookmarkNode): void => {
    for (const child of node.children ?? []) {
      if (!isFolder(child) || opts.imported.has(child.id)) continue;
      if (ticked.has(child.id)) {
        const session = folderToSession(
          child,
          opts.now,
          opts.ownOrigin,
          opts.untitled,
          opts.imported
        );
        add(session === null ? null : { bookmarkIds: [child.id], session });
      } else visit(child);
    }
  };
  for (const top of topFolders(root)) {
    if (ticked.has(top.id)) add(looseLinksSession(top, opts));
    visit(top);
  }
  return made;
}
