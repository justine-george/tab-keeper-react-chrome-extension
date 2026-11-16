import { v4 as uuidv4 } from 'uuid';

import type {
  tabContainerData,
  tabData,
  windowGroupData,
} from '../../redux/slices/tabContainerDataStateSlice';
import { getStringDate, resolveTabUrl } from './local';
import { withoutRepeats } from './skipDuplicates';

type BookmarkNode = chrome.bookmarks.BookmarkTreeNode;

// KAN-862. One folder as the import dialog's tree shows it.
export interface BookmarkFolder {
  id: string;
  title: string;
  // Importable links, at any depth.
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

function toFolder(
  node: BookmarkNode,
  ownOrigin: string,
  isTop: boolean
): BookmarkFolder {
  const children: BookmarkFolder[] = [];
  let count = 0;
  for (const child of node.children ?? []) {
    if (isFolder(child)) {
      const folder = toFolder(child, ownOrigin, false);
      children.push(folder);
      count += folder.count;
    } else if (isImportableUrl(child.url, ownOrigin)) count += 1;
  }
  return { id: node.id, title: node.title, count, isTop, children };
}

// The root's folders, each with its subfolders; links only feed the counts.
export function folderTree(
  root: BookmarkNode,
  ownOrigin: string
): BookmarkFolder[] {
  const tops = topFolders(root);
  const typeCounts = new Map<string, number>();
  for (const top of tops)
    if (top.folderType !== undefined)
      typeCounts.set(top.folderType, (typeCounts.get(top.folderType) ?? 0) + 1);
  return tops.map((top) => {
    const folder = toFolder(top, ownOrigin, true);
    const twinned =
      top.folderType !== undefined && (typeCounts.get(top.folderType) ?? 0) > 1;
    return twinned
      ? { ...folder, where: top.syncing ? 'account' : 'device' }
      : folder;
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

// Every importable link under `node`, depth first in bookmark order.
function flatten(node: BookmarkNode, ownOrigin: string, into: tabData[]): void {
  for (const child of node.children ?? []) {
    if (isFolder(child)) flatten(child, ownOrigin, into);
    else if (child.url !== undefined && isImportableUrl(child.url, ownOrigin))
      into.push(toTab(child, child.url));
  }
}

function ownLinks(node: BookmarkNode, ownOrigin: string): tabData[] {
  const tabs: tabData[] = [];
  for (const child of node.children ?? [])
    if (child.url !== undefined && isImportableUrl(child.url, ownOrigin))
      tabs.push(toTab(child, child.url));
  return tabs;
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

// KAN-862. The folder's own links are one window named after it; each subfolder is a window, deeper ones folded into it. null when nothing is left.
export function folderToSession(
  node: BookmarkNode,
  now: Date,
  ownOrigin: string,
  untitled: string
): tabContainerData | null {
  const title = node.title || untitled;
  const windows = [toWindow(title, ownLinks(node, ownOrigin))];
  for (const sub of node.children ?? []) {
    if (!isFolder(sub)) continue;
    const tabs: tabData[] = [];
    flatten(sub, ownOrigin, tabs);
    windows.push(toWindow(sub.title, tabs));
  }
  return toSession(title, windows, now);
}

// KAN-862 (11-16). A ticked top folder's session: only its loose links, one window named after it. null when it has none.
function looseLinksSession(
  node: BookmarkNode,
  now: Date,
  ownOrigin: string,
  untitled: string
): tabContainerData | null {
  const title = node.title || untitled;
  return toSession(title, [toWindow(title, ownLinks(node, ownOrigin))], now);
}

// KAN-862. One session per ticked folder, in tree order. A folder under a ticked user folder is part of that one's session; a ticked top folder (the root's own) gives only its loose links, and its folders count by their own ticks. Unknown ids and empty folders add nothing.
export function sessionsFor(
  root: BookmarkNode,
  ticked: ReadonlySet<string>,
  opts: {
    now: Date;
    ownOrigin: string;
    untitled: string;
    skipDuplicates: boolean;
  }
): tabContainerData[] {
  const sessions: tabContainerData[] = [];
  const add = (session: tabContainerData | null): void => {
    const result =
      session !== null && opts.skipDuplicates
        ? withoutRepeats(session).container
        : session;
    if (result !== null && result.tabCount > 0) sessions.push(result);
  };
  const visit = (node: BookmarkNode): void => {
    for (const child of node.children ?? []) {
      if (!isFolder(child)) continue;
      if (ticked.has(child.id))
        add(folderToSession(child, opts.now, opts.ownOrigin, opts.untitled));
      else visit(child);
    }
  };
  for (const top of topFolders(root)) {
    if (ticked.has(top.id))
      add(looseLinksSession(top, opts.now, opts.ownOrigin, opts.untitled));
    visit(top);
  }
  return sessions;
}
