import { describe, expect, it } from 'vitest';

import { mergeTabContainers } from '../../../utils/functions/mergeTabData';
import { buildContainer, buildSession } from '../../fixtures/sessionFixture';

// KAN-600. The run's example is this device's alone. With sync on, a run
// replayed from Help synced it to every device, and only its grave took it
// off them again. Now the cloud side of a merge never brings one, and one held
// here is no change to write.

const NOW = Date.UTC(2026, 9, 14);
const kept = buildSession({ tabGroupId: 'kept', lastModified: NOW - 1000 });
const sample = buildSession({
  tabGroupId: 'sample:1',
  title: 'Sample: Weekend trip',
  lastModified: NOW - 500,
});
const container = (
  sessions: ReturnType<typeof buildSession>[],
  graves: { tabGroupId: string; deletedAt: number }[] = []
) => ({
  ...buildContainer(sessions),
  lastModified: NOW - 1000,
  deletedTabGroups: graves,
});
const ids = (c: { tabGroups: { tabGroupId: string }[] }) =>
  c.tabGroups.map((g) => g.tabGroupId);

describe('the example stays on its own device (KAN-600)', () => {
  it('a sample in the cloud copy is not taken in, and is no change here', () => {
    const r = mergeTabContainers(
      container([kept]),
      container([kept, sample]),
      NOW
    );
    expect(ids(r.merged)).toEqual(['kept']);
    expect(r.changedFromLocal).toBe(false);
  });

  it('a sample here stays here, and is no change to write to the cloud', () => {
    const r = mergeTabContainers(
      container([kept, sample]),
      container([kept]),
      NOW
    );
    expect(ids(r.merged).sort()).toEqual(['kept', 'sample:1']);
    expect(r.changedFromCloud).toBe(false);
  });

  it('a sample’s grave here is no change to write to the cloud', () => {
    const r = mergeTabContainers(
      container([kept], [{ tabGroupId: 'sample:1', deletedAt: NOW - 100 }]),
      container([kept]),
      NOW
    );
    expect(r.changedFromCloud).toBe(false);
  });

  it('a sample’s grave in the cloud copy does not remove the sample here', () => {
    const r = mergeTabContainers(
      container([kept, sample]),
      container([kept], [{ tabGroupId: 'sample:1', deletedAt: NOW }]),
      NOW
    );
    expect(ids(r.merged).sort()).toEqual(['kept', 'sample:1']);
    expect(r.changedFromLocal).toBe(false);
  });

  it('CONTROL: an ordinary session in either copy still merges and counts', () => {
    const other = buildSession({ tabGroupId: 'other', lastModified: NOW });
    const fromCloud = mergeTabContainers(
      container([kept]),
      container([kept, other]),
      NOW
    );
    expect(ids(fromCloud.merged).sort()).toEqual(['kept', 'other']);
    expect(fromCloud.changedFromLocal).toBe(true);
    const fromHere = mergeTabContainers(
      container([kept, other]),
      container([kept]),
      NOW
    );
    expect(fromHere.changedFromCloud).toBe(true);
  });
});
