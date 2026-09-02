import { describe, it, expect } from 'vitest';
import {
  compressToBytes,
  decompressFromBytes,
} from '../../../utils/functions/compression';

describe('gzip helper', () => {
  // An INDEPENDENT fixture: produced by node's zlib, outside the module under
  // test. A pure round-trip test passes even when compress and decompress share
  // the same bug, so this is the control that makes the round-trip meaningful.
  it('decodes a gzip blob this module did not produce', async () => {
    const b64 =
      'H4sIAAAAAAAAE4uuVipJTHIvyi8t8ExRslLKzssvz9M1VNJRKsksyUlVslLyBokoBKcWF2fm5ynVxgIA5clfqDIAAAA=';
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    await expect(decompressFromBytes(bytes)).resolves.toBe(
      '[{"tabGroupId":"known-1","title":"Known Session"}]'
    );
  });

  it('round-trips a realistic session payload and actually compresses it', async () => {
    const big = JSON.stringify(
      Array.from({ length: 2000 }, (_, i) => ({
        tabId: `id-${i}`,
        url: `https://github.com/a/b/c/${i}`,
        title: `Title number ${i}`,
      }))
    );
    const packed = await compressToBytes(big);
    expect(packed.byteLength).toBeLessThan(
      new TextEncoder().encode(big).byteLength / 3
    );
    await expect(decompressFromBytes(packed)).resolves.toBe(big);
  });

  // The document is measured and stored in BYTES, not UTF-16 units. A title in
  // a non-Latin script is one character and three bytes, and getting that wrong
  // is the failure that silently truncates someone's sessions.
  it('round-trips non-Latin text exactly', async () => {
    const s = JSON.stringify({ t: '日本語のタイトル', u: 'Ünïcødé — ok' });
    await expect(decompressFromBytes(await compressToBytes(s))).resolves.toBe(
      s
    );
  });

  it('rejects on non-gzip input rather than returning empty', async () => {
    await expect(
      decompressFromBytes(new Uint8Array([1, 2, 3, 4, 5]))
    ).rejects.toThrow();
  });

  it('round-trips an empty array, the new-user case', async () => {
    await expect(
      decompressFromBytes(await compressToBytes('[]'))
    ).resolves.toBe('[]');
  });
});
