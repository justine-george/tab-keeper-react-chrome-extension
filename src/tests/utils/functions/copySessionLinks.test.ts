import type { TFunction } from 'i18next';
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';

import { copySessionLinks } from '../../../utils/functions/copySessionLinks';
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
