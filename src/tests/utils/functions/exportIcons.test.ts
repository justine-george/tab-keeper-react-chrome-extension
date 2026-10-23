import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  exportIconKey,
  faviconRequestOf,
  fetchPngDataUri,
  GLOBE_PROBE_URL,
  isPngDataUri,
  readExportIcons,
} from '../../../utils/functions/exportIcons';
import type { tabContainerData } from '../../../redux/slices/tabContainerDataStateSlice';
import { setupChromeFake } from '../../setup/chrome.fake';

const A = 'data:image/png;base64,AQID';
const GLOBE = 'data:image/png;base64,Z2xvYmU=';

const pageUrlOf = (input: string) =>
  new URL(input).searchParams.get('pageUrl') ?? '';

const png = (bytes: number[]) =>
  new Response(new Uint8Array(bytes), { status: 200 });

function session(urls: string[]): tabContainerData {
  return {
    tabGroupId: 's',
    createdTime: '',
    title: 'S',
    windowCount: 1,
    tabCount: urls.length,
    isAutoSave: false,
    isSelected: false,
    windows: [
      {
        windowId: 'w',
        windowHeight: 0,
        windowWidth: 0,
        windowOffsetTop: 0,
        windowOffsetLeft: 0,
        tabCount: urls.length,
        title: '',
        tabs: urls.map((url, i) => ({
          tabId: `t${i}`,
          favicon: '',
          title: url,
          url,
        })),
      },
    ],
  };
}

describe('export icons (KAN-603)', () => {
  let handle: ReturnType<typeof setupChromeFake> | undefined;

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    handle?.restore();
    handle = undefined;
  });

  test('the request accepts a chrome:// page', () => {
    handle = setupChromeFake();
    const request = faviconRequestOf('chrome://settings/');
    expect(request).toContain('/_favicon/');
    expect(request).toContain('pageUrl=chrome%3A%2F%2Fsettings%2F&size=32');
  });

  describe('fetchPngDataUri', () => {
    test('OK bytes become a PNG data URI', async () => {
      vi.stubGlobal('fetch', async () => png([1, 2, 3]));
      expect(await fetchPngDataUri('x')).toBe(A);
    });

    test('a 404 is null', async () => {
      vi.stubGlobal('fetch', async () => new Response('', { status: 404 }));
      expect(await fetchPngDataUri('x')).toBeNull();
    });

    test('a throw is null', async () => {
      vi.stubGlobal('fetch', async () => {
        throw new TypeError('boom');
      });
      expect(await fetchPngDataUri('x')).toBeNull();
    });

    test('zero bytes are null', async () => {
      vi.stubGlobal('fetch', async () => png([]));
      expect(await fetchPngDataUri('x')).toBeNull();
    });

    test('a fetch that never answers is null once the cap passes', async () => {
      vi.useFakeTimers();
      vi.stubGlobal('fetch', () => new Promise<Response>(() => {}));
      let result: string | null | undefined;
      void fetchPngDataUri('x', 800).then((value) => (result = value));
      await vi.advanceTimersByTimeAsync(799);
      expect(result).toBeUndefined();
      await vi.advanceTimersByTimeAsync(1);
      expect(result).toBeNull();
    });
  });

  describe('readExportIcons', () => {
    test('a cached page gets its icon; an empty or failed one gets the globe', async () => {
      handle = setupChromeFake();
      const fetched: string[] = [];
      vi.stubGlobal('fetch', async (input: string) => {
        const page = pageUrlOf(input);
        fetched.push(page);
        if (page === 'https://a.test/') return png([1, 2, 3]);
        if (page === GLOBE_PROBE_URL)
          return png([...'globe'].map((c) => c.charCodeAt(0)));
        throw new TypeError('down');
      });
      const icons = await readExportIcons([
        'https://a.test/',
        'https://a.test/',
        '',
        'https://down.test/',
      ]);
      expect(Object.fromEntries(icons)).toEqual({
        'https://a.test/': A,
        '': GLOBE,
        'https://down.test/': GLOBE,
      });
      expect(fetched.filter((p) => p === 'https://a.test/')).toHaveLength(1);
      expect(fetched.filter((p) => p === GLOBE_PROBE_URL)).toHaveLength(1);
      expect(fetched).not.toContain('');
    });

    test('when every fetch fails, the globe included, the map is empty', async () => {
      handle = setupChromeFake();
      vi.stubGlobal('fetch', async () => {
        throw new TypeError('down');
      });
      const icons = await readExportIcons(['https://a.test/', '']);
      expect(icons.size).toBe(0);
    });

    test('300 addresses settle together in one call', async () => {
      handle = setupChromeFake();
      vi.stubGlobal('fetch', async () => {
        await new Promise((done) => setTimeout(done, 10));
        return png([1, 2, 3]);
      });
      const urls = Array.from({ length: 300 }, (_, i) => `https://s${i}.test/`);
      const started = Date.now();
      const icons = await readExportIcons(urls);
      expect(icons.size).toBe(300);
      // In parallel: 300 sequential 10ms fetches would take 3s.
      expect(Date.now() - started).toBeLessThan(800);
    });
  });

  test('the key is the sorted distinct addresses', () => {
    expect(exportIconKey(session(['b', 'a', 'b']))).toBe('a\nb');
  });

  test('only a PNG data URI passes', () => {
    expect(isPngDataUri(A)).toBe(true);
    for (const bad of [
      'data:image/png;base64,',
      'https://x/i.png',
      'javascript:alert(1)',
      'data:image/png;base64,AQ"ID',
      'data:image/png;base64,AQ)ID',
      'data:image/svg+xml;base64,AQID',
    ]) {
      expect(isPngDataUri(bad)).toBe(false);
    }
  });
});
