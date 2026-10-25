import type { TFunction } from 'i18next';
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';

import {
  copyScopeLinks,
  copySessionLinks,
} from '../../../utils/functions/copySessionLinks';
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

    await expect(copySessionLinks(buildSession(), t, 'en')).resolves.toBeNull();

    expect(write).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledTimes(1);
  });

  test('a refused rich write falls back to plain and resolves the count', async () => {
    const { writeText } = stubClipboard(refused, () => Promise.resolve());

    await expect(copySessionLinks(buildSession(), t, 'en')).resolves.toBe(1);

    expect(writeText).toHaveBeenCalledTimes(1);
  });

  test('the rich write landing resolves the count and skips the plain write', async () => {
    const { writeText } = stubClipboard(
      () => Promise.resolve(),
      () => Promise.resolve()
    );

    await expect(copySessionLinks(buildSession(), t, 'en')).resolves.toBe(1);

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

    await expect(copyScopeLinks(scope, t)).resolves.toBe(2);

    const [[[item]]] = write.mock.calls as unknown as [[[FakeClipboardItem]]];
    const plain = await item.items['text/plain'].text();
    const html = await item.items['text/html'].text();
    expect(plain.split('\n').slice(0, 2)).toEqual(['Hotels', '2 Tabs']);
    expect(html.startsWith('<h3>Hotels</h3><p>2 Tabs</p><ul>')).toBe(true);
    expect(writeText).not.toHaveBeenCalled();
  });

  test('a refused rich write falls back to the plain list', async () => {
    const { writeText } = stubClipboard(refused, () => Promise.resolve());

    await expect(copyScopeLinks(scope, t)).resolves.toBe(2);

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(String(writeText.mock.calls[0])).toMatch(/^Hotels\n2 Tabs\n/);
  });

  test('both writes refused resolves null and does not reject', async () => {
    stubClipboard(refused, refused);

    await expect(copyScopeLinks(scope, t)).resolves.toBeNull();
  });
});
