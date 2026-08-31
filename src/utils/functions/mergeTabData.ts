// This module must stay DOM-free: the slice pulls in
// src/utils/constants/common.ts, which reads window.screen.height at module
// load, and that cannot be imported under vitest's node environment.
//
// `import type` is what keeps it that way, but not by affecting the emitted
// output - esbuild already elides any import whose bindings are used only in
// type positions, so plain `import` here emits the same JS. The protection is
// at compile time: `import type` makes it an error to use any of these
// bindings as a *value*, which is the change that would actually survive
// elision and drag common.ts in. Verified both directions - swapping to a
// plain import changes nothing, while adding a real runtime reference to a
// slice export fails the whole test file with
// `ReferenceError: window is not defined`.
import type {
  TabMasterContainer,
  tabContainerData,
  deletedTabGroup,
} from '../../redux/slices/tabContainerDataStateSlice';

export interface MergeResult {
  merged: TabMasterContainer;
  // The merged result differs from what this device already had. Drives the
  // toast: false means this device learned nothing new.
  changedFromLocal: boolean;
  // The merged result differs from what the cloud already had. Drives the
  // Firestore write: false means the cloud is already correct, which is what
  // stops every popup open from producing a commit.
  changedFromCloud: boolean;
}

// A document written before per-session timestamps existed carries only the
// container's. Treating that as every session's timestamp makes the merge
// degrade to a per-id union with the newer side winning - strictly better than
// discarding a whole side, which is what the old conflict prompt did.
function sessionTimestamp(
  group: tabContainerData,
  container: TabMasterContainer
): number {
  return group.lastModified ?? container.lastModified;
}

type Event =
  | { kind: 'present'; at: number; group: tabContainerData }
  | { kind: 'deleted'; at: number };

// One event per tabGroupId. A session version and a tombstone compete on the
// same axis, so delete-versus-edit needs no special case: a later edit beats an
// earlier delete, an earlier edit loses to a later delete.
function collect(events: Map<string, Event>, side: TabMasterContainer): void {
  for (const group of side.tabGroups) {
    const at = sessionTimestamp(group, side);
    const existing = events.get(group.tabGroupId);
    if (!existing || at >= existing.at) {
      events.set(group.tabGroupId, { kind: 'present', at, group });
    }
  }
  for (const tombstone of side.deletedTabGroups ?? []) {
    const existing = events.get(tombstone.tabGroupId);
    if (!existing || tombstone.deletedAt >= existing.at) {
      events.set(tombstone.tabGroupId, {
        kind: 'deleted',
        at: tombstone.deletedAt,
      });
    }
  }
}

// A tombstone is ~60 bytes, so the cap costs about 30 KB against Firestore's
// 1 MiB ceiling. Bounded on both axes deliberately: a TTL alone leaves a heavy
// churner unbounded within the window, and a cap alone keeps dead ids forever.
// Accepted tradeoff: a device offline longer than the TTL can resurrect a
// session deleted while it was away. That failure reappears data; it never
// loses any.
export const TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const TOMBSTONE_MAX = 500;

function collectTombstones(
  events: Map<string, Event>,
  now: number
): deletedTabGroup[] {
  const graves: deletedTabGroup[] = [];
  for (const [tabGroupId, event] of events) {
    if (event.kind === 'deleted' && now - event.at <= TOMBSTONE_TTL_MS) {
      graves.push({ tabGroupId, deletedAt: event.at });
    }
  }
  graves.sort((a, b) => b.deletedAt - a.deletedAt);
  return graves.slice(0, TOMBSTONE_MAX);
}

// A side's own view, for the changed-from comparisons. Comparing event sets
// rather than deep-equalling containers keeps the flags insensitive to field
// order and to selectedTabGroupId, which is per-device view state.
function signature(events: Map<string, Event>): string {
  return [...events.entries()]
    .map(([id, e]) => `${id}:${e.kind}:${e.at}`)
    .sort()
    .join('|');
}

function sideEvents(side: TabMasterContainer): Map<string, Event> {
  const events = new Map<string, Event>();
  collect(events, side);
  return events;
}

export function mergeTabContainers(
  local: TabMasterContainer,
  cloud: TabMasterContainer,
  // Injected rather than read from Date.now() so tombstone garbage collection
  // is deterministic under test.
  now: number
): MergeResult {
  // Local first, then cloud, with `>=` in collect(): cloud takes exact ties.
  // That is the only convergent choice - if local won ties, each device would
  // write its own version and they would ping-pong indefinitely.
  const events = new Map<string, Event>();
  collect(events, local);
  collect(events, cloud);

  const survivors: tabContainerData[] = [];
  for (const event of events.values()) {
    if (event.kind === 'present') {
      survivors.push({ ...event.group, lastModified: event.at });
    }
  }
  survivors.sort((a, b) => b.lastModified! - a.lastModified!);

  // Selection is per-device view state; pushing the other device's selection
  // across is pure churn. Keep this device's, unless its session lost.
  const selectedTabGroupId =
    local.selectedTabGroupId &&
    survivors.some((g) => g.tabGroupId === local.selectedTabGroupId)
      ? local.selectedTabGroupId
      : null;

  const merged: TabMasterContainer = {
    // max, not `now` - otherwise every popup open would look newer to the
    // other device forever.
    lastModified: Math.max(local.lastModified, cloud.lastModified),
    selectedTabGroupId,
    tabGroups: survivors.map((g) => ({
      ...g,
      isSelected: g.tabGroupId === selectedTabGroupId,
    })),
    deletedTabGroups: collectTombstones(events, now),
  };

  const mergedSig = signature(events);
  return {
    merged,
    changedFromLocal: mergedSig !== signature(sideEvents(local)),
    changedFromCloud: mergedSig !== signature(sideEvents(cloud)),
  };
}

export type { deletedTabGroup };
