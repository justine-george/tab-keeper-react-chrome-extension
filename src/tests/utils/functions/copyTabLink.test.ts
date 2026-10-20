import { afterEach, describe, expect, test, vi } from 'vitest';

import { copyTabLink } from '../../../utils/functions/copyTabLink';

// KAN-708. Copy link on a tab row: the address the tab stands for, and a yes or no.

const SUSPENDED =
  'chrome-extension://laameccjpleogmfhilmffpdbiibgbekf/suspended.html?title=Settings&url=chrome%3A%2F%2Fsettings%2F%3Fsearch%3Dzoom&time=1788746910025';

function stubClipboard(writeText: (text: string) => Promise<void>) {
  const spy = vi.fn(writeText);
  vi.stubGlobal('navigator', { clipboard: { writeText: spy } });
  return spy;
}

afterEach(() => vi.unstubAllGlobals());

describe('copyTabLink (KAN-708)', () => {
  test('copies a plain address and resolves true', async () => {
    const writeText = stubClipboard(() => Promise.resolve());

    await expect(copyTabLink('https://a.test/page?x=1')).resolves.toBe(true);

    expect(writeText).toHaveBeenCalledExactlyOnceWith(
      'https://a.test/page?x=1'
    );
  });

  test('a suspended tab copies the address it stands for', async () => {
    const writeText = stubClipboard(() => Promise.resolve());

    await expect(copyTabLink(SUSPENDED)).resolves.toBe(true);

    expect(writeText).toHaveBeenCalledExactlyOnceWith(
      'chrome://settings/?search=zoom'
    );
  });

  test('a refused write resolves false and does not reject', async () => {
    stubClipboard(() =>
      Promise.reject(new DOMException('no', 'NotAllowedError'))
    );

    await expect(copyTabLink('https://a.test/')).resolves.toBe(false);
  });

  test('a write that throws at once resolves false too', async () => {
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText: () => {
          throw new TypeError('no clipboard here');
        },
      },
    });

    await expect(copyTabLink('https://a.test/')).resolves.toBe(false);
  });
});
