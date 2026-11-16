import { describe, expect, it } from 'vitest';

import {
  folderToSession,
  folderTree,
  isImportableUrl,
  sessionsFor,
  type BookmarkFolder,
} from '../../utils/functions/bookmarkImport';

const OWN = 'chrome-extension://abcdef/';
const NOW = new Date(2026, 10, 15, 12, 0, 0);
const NONE: ReadonlySet<string> = new Set();

type Node = chrome.bookmarks.BookmarkTreeNode;

const link = (id: string, url: string, title = `T${id}`): Node => ({
  id,
  title,
  url,
  syncing: false,
});
const folder = (
  id: string,
  title: string,
  children: Node[],
  extra: Partial<Node> = {}
): Node => ({ id, title, children, syncing: false, ...extra });
const links = (prefix: string, n: number): Node[] =>
  Array.from({ length: n }, (_, i) =>
    link(`${prefix}${i}`, `https://${prefix}.test/${i}`)
  );

function fixture(): Node {
  return folder('0', '', [
    folder(
      '1',
      'Bookmarks bar',
      [
        link('l1', 'https://a.test/1'),
        link('l2', 'javascript:alert(1)'),
        link('l3', 'https://a.test/3'),
        folder('kitchen', 'Kitchen remodel', [
          ...links('k', 3),
          folder('tiles', 'Tiles', links('t', 5)),
          folder('appl', 'Appliances', [
            ...links('a', 4),
            folder('fridges', 'Fridges', links('f', 2)),
          ]),
        ]),
        folder('old', 'Old stuff', []),
        folder('recipes', 'Recipes', links('r', 2)),
      ],
      { folderType: 'bookmarks-bar' }
    ),
    folder('2', 'Other bookmarks', links('o', 1), {
      folderType: 'other',
    }),
  ]);
}

describe('isImportableUrl', () => {
  it('rejects bookmarklets, blanks and our own pages', () => {
    expect(isImportableUrl('javascript:alert(1)', OWN)).toBe(false);
    expect(isImportableUrl('', OWN)).toBe(false);
    expect(isImportableUrl(undefined, OWN)).toBe(false);
    expect(isImportableUrl(`${OWN}index.html`, OWN)).toBe(false);
  });
  it('accepts web and chrome pages', () => {
    expect(isImportableUrl('https://a.test/', OWN)).toBe(true);
    expect(isImportableUrl('chrome://settings', OWN)).toBe(true);
  });
});

describe('folderTree', () => {
  it('counts importable links at any depth and lists only folders', () => {
    const [bar, other] = folderTree(fixture(), OWN, NONE);
    expect(bar.title).toBe('Bookmarks bar');
    expect(bar.count).toBe(2 + 14 + 0 + 2);
    expect(other.count).toBe(1);
    const titles = bar.children.map((c) => c.title);
    expect(titles).toEqual(['Kitchen remodel', 'Old stuff', 'Recipes']);
    expect(bar.children[1].count).toBe(0);
    expect([bar.isTop, other.isTop, bar.children[0].isTop]).toEqual([
      true,
      true,
      false,
    ]);
    expect(bar.children[0].children.map((c) => c.title)).toEqual([
      'Tiles',
      'Appliances',
    ]);
  });
  it('marks twin top folders account or device, and only then', () => {
    const root = folder('0', '', [
      folder('1', 'Bookmarks bar', [], {
        folderType: 'bookmarks-bar',
        syncing: true,
      }),
      folder('2', 'Bookmarks bar', [], {
        folderType: 'bookmarks-bar',
        syncing: false,
      }),
      folder('3', 'Other', [], { folderType: 'other' }),
    ]);
    const tops = folderTree(root, OWN, NONE);
    expect(tops.map((t) => t.where)).toEqual(['account', 'device', undefined]);
    expect(folderTree(fixture(), OWN, NONE).map((t) => t.where)).toEqual([
      undefined,
      undefined,
    ]);
  });
});

describe('folderToSession', () => {
  const kitchen = () => {
    const bar = fixture().children?.[0];
    const node = bar?.children?.find((c) => c.id === 'kitchen');
    if (node === undefined) throw new Error('fixture');
    return node;
  };
  it('makes one window per folder with deeper folders flattened', () => {
    const s = folderToSession(kitchen(), NOW, OWN, 'Untitled', NONE);
    expect(s?.title).toBe('Kitchen remodel');
    expect(s?.windows.map((w) => w.title)).toEqual([
      'Kitchen remodel',
      'Tiles',
      'Appliances',
    ]);
    const urls = s?.windows[2].tabs.map((t) => t.url);
    expect(urls).toEqual([
      ...[0, 1, 2, 3].map((i) => `https://a.test/${i}`),
      'https://f.test/0',
      'https://f.test/1',
    ]);
    expect(s?.tabCount).toBe(14);
    expect(s?.windowCount).toBe(3);
    expect(
      s?.windows.every((w) =>
        w.tabs.every((t) => t.chromeGroupId === undefined)
      )
    ).toBe(true);
  });
  it('returns null for an empty folder', () => {
    expect(
      folderToSession(folder('old', 'Old stuff', []), NOW, OWN, 'U', NONE)
    ).toBe(null);
  });
  it('names a blank folder untitled but leaves a blank window title blank', () => {
    const s = folderToSession(
      folder('x', '', [
        link('a', 'https://a.test/'),
        folder('y', '', links('b', 1)),
      ]),
      NOW,
      OWN,
      'Untitled',
      NONE
    );
    expect(s?.title).toBe('Untitled');
    expect(s?.windows.map((w) => w.title)).toEqual(['Untitled', '']);
  });
});

// The sessions alone, without the folder each came from.
const sessionsOf = (...args: Parameters<typeof sessionsFor>) =>
  sessionsFor(...args).map((made) => made.session);

describe('sessionsFor', () => {
  const opts = {
    now: NOW,
    ownOrigin: OWN,
    untitled: 'U',
    skipDuplicates: false,
    imported: NONE,
  };
  it('ignores a ticked folder under another ticked folder', () => {
    const out = sessionsOf(fixture(), new Set(['kitchen', 'tiles']), opts);
    expect(out.map((s) => s.title)).toEqual(['Kitchen remodel']);
  });
  it('follows tree order, ignores unknown ids, drops empty folders', () => {
    const out = sessionsOf(
      fixture(),
      new Set(['recipes', 'kitchen', 'nope', 'old']),
      opts
    );
    expect(out.map((s) => s.title)).toEqual(['Kitchen remodel', 'Recipes']);
  });
  // KAN-862 (11-16). Chrome's top folders: their loose links are one session; their folders tick on their own.
  const shape = (out: ReturnType<typeof sessionsOf>) =>
    out.map((s) => [s.title, s.windows.map((w) => [w.title, w.tabCount])]);

  it('a ticked top folder makes a session of its loose links, then one per ticked folder in it, in tree order', () => {
    const out = sessionsOf(
      fixture(),
      new Set(['recipes', '1', 'kitchen']),
      opts
    );
    expect(shape(out)).toEqual([
      ['Bookmarks bar', [['Bookmarks bar', 2]]],
      [
        'Kitchen remodel',
        [
          ['Kitchen remodel', 3],
          ['Tiles', 5],
          ['Appliances', 6],
        ],
      ],
      ['Recipes', [['Recipes', 2]]],
    ]);
  });

  it('a ticked top folder alone makes only its loose-links session', () => {
    const out = sessionsOf(fixture(), new Set(['1']), opts);
    expect(shape(out)).toEqual([['Bookmarks bar', [['Bookmarks bar', 2]]]]);
  });

  it('a folder unticked under a ticked top folder is left out; a tick deeper in it counts', () => {
    const out = sessionsOf(fixture(), new Set(['1', 'recipes', 'tiles']), opts);
    expect(out.map((s) => s.title)).toEqual([
      'Bookmarks bar',
      'Tiles',
      'Recipes',
    ]);
  });

  it('a ticked top folder with no loose links makes no session of its own', () => {
    const root = folder('0', '', [
      folder('bar', 'Bookmarks bar', [folder('w', 'Work', links('w', 2))]),
    ]);
    expect(
      sessionsOf(root, new Set(['bar', 'w']), opts).map((s) => s.title)
    ).toEqual(['Work']);
    expect(sessionsOf(root, new Set(['bar']), opts)).toEqual([]);
  });

  it('a blank top folder is named untitled', () => {
    const root = folder('0', '', [folder('bar', '', links('x', 1))]);
    expect(shape(sessionsOf(root, new Set(['bar']), opts))).toEqual([
      ['U', [['U', 1]]],
    ]);
  });

  it('dedupes a top folder’s loose links when asked', () => {
    const root = folder('0', '', [
      folder('bar', 'Bar', [
        link('1', 'https://x.test/'),
        link('2', 'https://x.test/'),
        folder('w', 'Work', links('w', 2)),
      ]),
    ]);
    const on = sessionsOf(root, new Set(['bar']), {
      ...opts,
      skipDuplicates: true,
    });
    expect(on.map((s) => s.tabCount)).toEqual([1]);
    expect(
      sessionsOf(root, new Set(['bar']), opts).map((s) => s.tabCount)
    ).toEqual([2]);
  });

  it('dedupes each session on its own when asked', () => {
    const dup = folder('0', '', [
      folder('bar', 'Bar', [
        folder('p', 'P', [
          link('1', 'https://x.test/'),
          link('2', 'https://x.test/'),
        ]),
        folder('q', 'Q', [link('3', 'https://x.test/')]),
      ]),
    ]);
    const on = sessionsOf(dup, new Set(['p', 'q']), {
      ...opts,
      skipDuplicates: true,
    });
    expect(on.map((s) => s.tabCount)).toEqual([1, 1]);
    const off = sessionsOf(dup, new Set(['p', 'q']), opts);
    expect(off.map((s) => s.tabCount)).toEqual([2, 1]);
  });
  it('handles 1,000 folders and 10,000 links in under 200 ms', () => {
    const tops = Array.from({ length: 10 }, (_, t) =>
      folder(
        `top${t}`,
        `Top ${t}`,
        Array.from({ length: 100 }, (_, f) =>
          folder(`f${t}-${f}`, `F${f}`, links(`x${t}-${f}-`, 10))
        )
      )
    );
    // Under a top folder, so each ticked folder makes its whole session.
    const root = folder('0', '', [folder('bar', 'Bar', tops)]);
    const start = performance.now();
    const tree = folderTree(root, OWN, NONE);
    const out = sessionsOf(root, new Set(tops.map((t) => t.id)), {
      ...opts,
      skipDuplicates: true,
    });
    const ms = performance.now() - start;
    expect(tree[0].children).toHaveLength(10);
    expect(out).toHaveLength(10);
    expect(out[0].tabCount).toBe(1000);
    expect(ms).toBeLessThan(200);
  });
});

// KAN-862 (11-16). A folder imported once can't be imported again: the tree and the sessions leave it out.
describe('with folders imported before', () => {
  const opts = {
    now: NOW,
    ownOrigin: OWN,
    untitled: 'U',
    skipDuplicates: false,
  };
  const tree = (...imported: string[]) =>
    folderTree(fixture(), OWN, new Set(imported));
  const everyFolder = (folders: BookmarkFolder[]): BookmarkFolder[] =>
    folders.flatMap((f) => [f, ...everyFolder(f.children)]);
  const byId = (folders: BookmarkFolder[], id: string): BookmarkFolder => {
    const found = everyFolder(folders).find((f) => f.id === id);
    if (found === undefined) throw new Error(`no folder ${id}`);
    return found;
  };
  const stateAndCount = (folders: BookmarkFolder[], ids: string[]) =>
    ids.map((id) => {
      const f = byId(folders, id);
      return [id, f.importState, f.count];
    });
  const madeFrom = (imported: string[], ticked: string[]) =>
    sessionsFor(fixture(), new Set(ticked), {
      ...opts,
      imported: new Set(imported),
    });
  const shapeOf = (made: ReturnType<typeof madeFrom>) =>
    made.map(({ session }) => [
      session.title,
      session.windows.map((w) => [w.title, w.tabCount]),
    ]);

  it('nothing imported: every folder is notImported', () => {
    const folders = tree();
    expect(
      stateAndCount(folders, ['1', 'kitchen', 'appl', 'old', '2'])
    ).toEqual([
      ['1', 'notImported', 18],
      ['kitchen', 'notImported', 14],
      ['appl', 'notImported', 6],
      ['old', 'notImported', 0],
      ['2', 'notImported', 1],
    ]);
  });

  it('an imported user folder counts nothing; the folders in it keep their counts but are insideImported', () => {
    expect(
      stateAndCount(tree('kitchen'), [
        '1',
        'kitchen',
        'tiles',
        'appl',
        'fridges',
        'recipes',
      ])
    ).toEqual([
      ['1', 'notImported', 2 + 2],
      ['kitchen', 'imported', 0],
      ['tiles', 'insideImported', 5],
      ['appl', 'insideImported', 6],
      ['fridges', 'insideImported', 2],
      ['recipes', 'notImported', 2],
    ]);
  });

  it('an imported subfolder leaves its parent’s count, and the parent stays tickable', () => {
    expect(
      stateAndCount(tree('appl'), ['1', 'kitchen', 'appl', 'fridges', 'tiles'])
    ).toEqual([
      ['1', 'notImported', 2 + 8 + 2],
      ['kitchen', 'notImported', 3 + 5],
      ['appl', 'imported', 0],
      ['fridges', 'insideImported', 2],
      ['tiles', 'notImported', 5],
    ]);
  });

  it('a top folder’s record covers only its loose links: its folders stay free', () => {
    expect(stateAndCount(tree('1'), ['1', 'kitchen', 'recipes'])).toEqual([
      ['1', 'notImported', 14 + 2],
      ['kitchen', 'notImported', 14],
      ['recipes', 'notImported', 2],
    ]);
  });

  it('a top folder with nothing left reads imported', () => {
    expect(
      stateAndCount(tree('1', 'kitchen', 'recipes', '2'), ['1', '2', 'old'])
    ).toEqual([
      ['1', 'imported', 0],
      ['2', 'imported', 0],
      ['old', 'notImported', 0],
    ]);
  });

  it('a user folder whose every link is in imported folders reads imported', () => {
    const root = folder('0', '', [
      folder('bar', 'Bar', [
        folder('x', 'X', [
          folder('y', 'Y', links('y', 2)),
          folder('e', 'E', []),
        ]),
      ]),
    ]);
    const [bar] = folderTree(root, OWN, new Set(['y']));
    expect(stateAndCount([bar], ['bar', 'x', 'y', 'e'])).toEqual([
      ['bar', 'imported', 0],
      ['x', 'imported', 0],
      ['y', 'imported', 0],
      ['e', 'notImported', 0],
    ]);
  });

  it('each session says which folder it came from', () => {
    expect(
      madeFrom([], ['recipes', '1', 'kitchen', 'old']).map((m) => m.folderId)
    ).toEqual(['1', 'kitchen', 'recipes']);
  });

  it('a ticked user folder leaves out the imported folders in it', () => {
    expect(shapeOf(madeFrom(['appl'], ['kitchen']))).toEqual([
      [
        'Kitchen remodel',
        [
          ['Kitchen remodel', 3],
          ['Tiles', 5],
        ],
      ],
    ]);
  });

  it('a deeper imported folder leaves its window above', () => {
    expect(shapeOf(madeFrom(['fridges'], ['kitchen']))).toEqual([
      [
        'Kitchen remodel',
        [
          ['Kitchen remodel', 3],
          ['Tiles', 5],
          ['Appliances', 4],
        ],
      ],
    ]);
  });

  it('a ticked top folder whose loose links are imported adds no session of its own', () => {
    expect(
      madeFrom(['1'], ['1', 'kitchen', 'recipes']).map((m) => m.folderId)
    ).toEqual(['kitchen', 'recipes']);
  });

  it('an imported folder’s tick, or a tick inside one, adds nothing', () => {
    expect(
      madeFrom(['appl'], ['appl', 'fridges', 'recipes']).map((m) => m.folderId)
    ).toEqual(['recipes']);
  });
});
