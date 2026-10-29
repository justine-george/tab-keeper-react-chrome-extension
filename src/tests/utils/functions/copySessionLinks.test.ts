import type { TFunction } from 'i18next';
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';

import {
  copyScopeLinks,
  copySessionLinks,
} from '../../../utils/functions/copySessionLinks';
import {
  linksOnlyHtml,
  linksOnlyList,
} from '../../../utils/functions/sessionExportHtml';
import { buildSession } from '../../fixtures/sessionFixture';
import { tFor } from '../../setup/localeT';

// KAN-713. Copy all links: the link count once something is on the clipboard,
// null when both writes were refused, and never a rejection.

class FakeClipboardItem {
  constructor(readonly items: Record<string, Blob>) {}
}

let t: TFunction;
beforeAll(async () => {
  t = await tFor('en');
});

function stubClipboard(
  write: () => Promise<void>,
  writeText: () => Promise<void>
) {
  const spies = { write: vi.fn(write), writeText: vi.fn(writeText) };
  vi.stubGlobal('ClipboardItem', FakeClipboardItem);
  vi.stubGlobal('navigator', { clipboard: spies });
  return spies;
}

const refused = () => Promise.reject(new DOMException('no', 'NotAllowedError'));

afterEach(() => vi.unstubAllGlobals());

describe('copySessionLinks (KAN-713)', () => {
  test('both writes refused resolves null and does not reject', async () => {
    const { write, writeText } = stubClipboard(refused, refused);

    await expect(
      copySessionLinks(buildSession(), t, 'en', 'with-headings')
    ).resolves.toBeNull();

    expect(write).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledTimes(1);
  });

  test('a refused rich write falls back to plain and resolves the count', async () => {
    const { writeText } = stubClipboard(refused, () => Promise.resolve());

    await expect(
      copySessionLinks(buildSession(), t, 'en', 'with-headings')
    ).resolves.toBe(1);

    expect(writeText).toHaveBeenCalledTimes(1);
  });

  test('the rich write landing resolves the count and skips the plain write', async () => {
    const { writeText } = stubClipboard(
      () => Promise.resolve(),
      () => Promise.resolve()
    );

    await expect(
      copySessionLinks(buildSession(), t, 'en', 'with-headings')
    ).resolves.toBe(1);

    expect(writeText).not.toHaveBeenCalled();
  });
});

// KAN-783. A window's or a group's copy keeps the same promise.
describe('copyScopeLinks (KAN-783)', () => {
  const scope = {
    heading: 'Hotels',
    tabs: buildSession().windows[0].tabs.concat(buildSession().windows[0].tabs),
  };

  test('puts the scope on the clipboard as rich and plain text and resolves its link count', async () => {
    const { write, writeText } = stubClipboard(
      () => Promise.resolve(),
      () => Promise.resolve()
    );

    await expect(copyScopeLinks(scope, t, 'with-headings')).resolves.toBe(2);

    const [[[item]]] = write.mock.calls as unknown as [[[FakeClipboardItem]]];
    const plain = await item.items['text/plain'].text();
    const html = await item.items['text/html'].text();
    expect(plain.split('\n').slice(0, 2)).toEqual(['Hotels', '2 Tabs']);
    expect(html.startsWith('<h3>Hotels</h3><p>2 Tabs</p><ul>')).toBe(true);
    expect(writeText).not.toHaveBeenCalled();
  });

  test('a refused rich write falls back to the plain list', async () => {
    const { writeText } = stubClipboard(refused, () => Promise.resolve());

    await expect(copyScopeLinks(scope, t, 'with-headings')).resolves.toBe(2);

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(String(writeText.mock.calls[0])).toMatch(/^Hotels\n2 Tabs\n/);
  });

  test('both writes refused resolves null and does not reject', async () => {
    stubClipboard(refused, refused);

    await expect(copyScopeLinks(scope, t, 'with-headings')).resolves.toBeNull();
  });
});

// KAN-859. The caller's stored layout picks what lands on the clipboard.
describe('links only (KAN-859)', () => {
  const written = async (write: ReturnType<typeof vi.fn>) => {
    const [[[item]]] = write.mock.calls as unknown as [[[FakeClipboardItem]]];
    return {
      plain: await item.items['text/plain'].text(),
      html: await item.items['text/html'].text(),
    };
  };

  test('a session copies one line per tab and resolves its link count', async () => {
    const { write } = stubClipboard(
      () => Promise.resolve(),
      () => Promise.resolve()
    );
    const session = buildSession();
    const tabs = session.windows.flatMap((w) => w.tabs);

    await expect(
      copySessionLinks(session, t, 'en', 'links-only')
    ).resolves.toBe(tabs.length);

    expect(await written(write)).toEqual({
      plain: linksOnlyList(tabs),
      html: linksOnlyHtml(tabs),
    });
  });

  test('a scope copies its tabs with no heading and resolves its link count', async () => {
    const { write } = stubClipboard(
      () => Promise.resolve(),
      () => Promise.resolve()
    );
    const scope = {
      heading: 'Hotels',
      tabs: buildSession().windows[0].tabs.concat(
        buildSession().windows[0].tabs
      ),
    };

    await expect(copyScopeLinks(scope, t, 'links-only')).resolves.toBe(2);

    const { plain, html } = await written(write);
    expect(plain).toBe(linksOnlyList(scope.tabs));
    expect(plain.split('\n')).toHaveLength(2);
    expect(plain.startsWith('Hotels')).toBe(false);
    expect(html).toBe(linksOnlyHtml(scope.tabs));
  });

  // A group whose members are apart (an import or a merge) is drawn at its
  // first member, with the rest pulled up to it; Links only pastes that order.
  const apart = () => {
    const [first] = buildSession().windows[0].tabs;
    const tab = (id: string, chromeGroupId?: string) => ({
      ...first,
      tabId: id,
      title: id,
      url: `https://${id}.test/`,
      ...(chromeGroupId ? { chromeGroupId } : {}),
    });
    return {
      tabs: [tab('a', 'g1'), tab('b'), tab('c', 'g1')],
      groups: [{ groupId: 'g1', title: 'Food', color: 'orange' as const }],
    };
  };
  const SHOWN = [
    'https://a.test/ | a',
    'https://c.test/ | c',
    'https://b.test/ | b',
  ];

  test('a session pastes its tabs in the order shown, a group together', async () => {
    const { write } = stubClipboard(
      () => Promise.resolve(),
      () => Promise.resolve()
    );
    const { tabs, groups } = apart();
    const session = buildSession();
    session.windows = [
      { ...session.windows[0], tabs, chromeTabGroups: groups },
    ];

    await copySessionLinks(session, t, 'en', 'links-only');

    expect((await written(write)).plain.split('\n')).toEqual(SHOWN);
  });

  test('a scope pastes its tabs in the order shown, a group together', async () => {
    const { write } = stubClipboard(
      () => Promise.resolve(),
      () => Promise.resolve()
    );

    await copyScopeLinks({ heading: 'Hotels', ...apart() }, t, 'links-only');

    expect((await written(write)).plain.split('\n')).toEqual(SHOWN);
  });

  test('a refused rich write falls back to the links only text', async () => {
    const { writeText } = stubClipboard(refused, () => Promise.resolve());
    const session = buildSession();

    await copySessionLinks(session, t, 'en', 'links-only');

    expect(writeText).toHaveBeenCalledWith(
      linksOnlyList(session.windows.flatMap((w) => w.tabs))
    );
  });
});
