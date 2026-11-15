import { describe, it, expect } from 'vitest';

import {
  COMPRESS_FROM_BYTES,
  encodeCloudDocument,
  syncBytes,
} from '../../../utils/functions/cloudDocument';
import { decompressFromBytes } from '../../../utils/functions/compression';
import {
  FIRESTORE_MAX_DOCUMENT_BYTES,
  stripEmbeddedFavicons,
} from '../../../utils/functions/local';
import {
  SAMPLE_ID_PREFIX,
  withoutSamples,
} from '../../../utils/functions/sampleSession';
import type { TabMasterContainer } from '../../../redux/slices/tabContainerDataStateSlice';
import { buildContainer, buildSession } from '../../fixtures/sessionFixture';
import { incompressible } from '../../fixtures/incompressible';

const utf8 = (s: string) => new TextEncoder().encode(s).byteLength;
const plainBytes = (c: TabMasterContainer) =>
  utf8(JSON.stringify(stripEmbeddedFavicons(withoutSamples(c))));

// One session whose single tab url carries `pad` extra characters (compressible).
function padded(pad: number, id = 'big'): TabMasterContainer {
  const base = buildSession({ tabGroupId: id });
  const tab = base.windows[0].tabs[0];
  return buildContainer([
    {
      ...base,
      windows: [
        {
          ...base.windows[0],
          tabs: [{ ...tab, url: `${tab.url}${'a'.repeat(pad)}` }],
        },
      ],
    },
  ]);
}

// A container whose plain document is exactly `bytes` long.
function plainOf(bytes: number): TabMasterContainer {
  const c = padded(bytes - plainBytes(padded(0)));
  expect(plainBytes(c)).toBe(bytes);
  return c;
}

describe('the cloud document sync writes (KAN-6)', () => {
  it('stays plain below the line, exactly as written today', async () => {
    const c = buildContainer([buildSession()]);
    const encoded = await encodeCloudDocument(c);
    expect(encoded.compressed).toBe(false);
    expect(encoded.fields).toEqual(stripEmbeddedFavicons(withoutSamples(c)));
    expect(encoded.bytes).toBe(plainBytes(c));
  });

  it('compresses from exactly 80% of the limit', async () => {
    expect(COMPRESS_FROM_BYTES).toBe(838_861); // 80% of 1 MiB, whole bytes
    const below = await encodeCloudDocument(plainOf(COMPRESS_FROM_BYTES - 1));
    const at = await encodeCloudDocument(plainOf(COMPRESS_FROM_BYTES));
    expect(below.compressed).toBe(false);
    expect(at.compressed).toBe(true);
  });

  it('writes sessions only as tabGroupsZ when compressed, and they read back', async () => {
    const c = {
      ...plainOf(COMPRESS_FROM_BYTES),
      selectedTabGroupId: 'big',
      deletedTabGroups: [{ tabGroupId: 'gone', deletedAt: 900 }],
    };
    const encoded = await encodeCloudDocument(c);
    if (!encoded.compressed) throw new Error('premise: compressed');
    expect('tabGroups' in encoded.fields).toBe(false);
    expect(encoded.fields.tabGroupsZ).toBeInstanceOf(Uint8Array);
    expect(
      JSON.parse(await decompressFromBytes(encoded.fields.tabGroupsZ))
    ).toEqual(stripEmbeddedFavicons(withoutSamples(c)).tabGroups);
    const { tabGroupsZ, ...rest } = encoded.fields;
    expect(rest).toEqual({
      lastModified: c.lastModified,
      selectedTabGroupId: 'big',
      deletedTabGroups: [{ tabGroupId: 'gone', deletedAt: 900 }],
    });
    expect(encoded.bytes).toBe(tabGroupsZ.length + utf8(JSON.stringify(rest)));
  });

  // Firestore rejects a field set to undefined.
  it('leaves deletedTabGroups out when the container has none', async () => {
    const encoded = await encodeCloudDocument(plainOf(COMPRESS_FROM_BYTES));
    expect('deletedTabGroups' in encoded.fields).toBe(false);
  });

  it('leaves the sample session out in both shapes', async () => {
    const sample = buildSession({ tabGroupId: `${SAMPLE_ID_PREFIX}x` });
    const small = buildContainer([buildSession(), sample]);
    const smallEncoded = await encodeCloudDocument(small);
    if (smallEncoded.compressed) throw new Error('premise: plain');
    expect(smallEncoded.fields.tabGroups.map((g) => g.tabGroupId)).toEqual([
      'session-1',
    ]);

    const big = plainOf(COMPRESS_FROM_BYTES);
    big.tabGroups.push(sample);
    const bigEncoded = await encodeCloudDocument(big);
    if (!bigEncoded.compressed) throw new Error('premise: compressed');
    const sessions = JSON.parse(
      await decompressFromBytes(bigEncoded.fields.tabGroupsZ)
    ) as { tabGroupId: string }[];
    expect(sessions.map((g) => g.tabGroupId)).toEqual(['big']);
  });

  it('goes plain again once the account is pruned below the line', async () => {
    const big = plainOf(COMPRESS_FROM_BYTES + 1000);
    expect((await encodeCloudDocument(big)).compressed).toBe(true);
    const pruned = buildContainer([buildSession()]);
    const encoded = await encodeCloudDocument(pruned);
    expect(encoded.compressed).toBe(false);
    expect('tabGroupsZ' in encoded.fields).toBe(false);
    expect('tabGroups' in encoded.fields).toBe(true);
  });
});

describe('syncBytes measures the compressed document at any size (KAN-6)', () => {
  it('equals what a compressed write measures', async () => {
    const c = plainOf(COMPRESS_FROM_BYTES + 1000);
    expect(await syncBytes(c)).toBe((await encodeCloudDocument(c)).bytes);
  });

  it('is below the plain size for a small account', async () => {
    const c = buildContainer([
      buildSession({ title: 'Reading list '.repeat(40) }),
    ]);
    expect(await syncBytes(c)).toBeLessThan(plainBytes(c));
  });

  it('passes the limit for text gzip cannot shrink', async () => {
    const c = buildContainer([
      buildSession({ title: incompressible(1_500_000) }),
    ]);
    expect(await syncBytes(c)).toBeGreaterThan(FIRESTORE_MAX_DOCUMENT_BYTES);
  });
});
