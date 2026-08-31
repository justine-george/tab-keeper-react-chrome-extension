# KAN-32 — Automatic per-session sync merge

Replace the sync conflict prompt with an automatic per-session merge, and delete
`ConflictModal.tsx` entirely.

Status: design, approved 2026-08-31. Not implemented.
Baseline: `main` at `92a8160` — 81 tests passing, lint 0 errors / 29 warnings, `npm audit` 0.

## 1. Why

The current sync compares one whole-container `lastModified` between local and
cloud and forces an either/or choice. That is lossy by construction: whichever
side loses is discarded in full, including sessions the other side never had.

The deviation from the ticket — KAN-32 step 6 keeps the modal as a fallback for
the ambiguous case; this design deletes it — rests on three findings, all
verified by execution against `main` before writing this.

### 1.1 The prompt is already asymmetric

A probe drove the real `syncStateWithFirestore` thunk with a real store and a
mocked Firestore, with one session present only on each side:

| Scenario | Modal opened | Wrote to cloud | Sessions surviving |
|---|---|---|---|
| Cloud newer than local | `true` | `false` | `[]` |
| Local newer than cloud | `false` | `true` | `["g1"]` |

Local-newer discards the cloud-only session `g2` and writes the result to
Firestore without asking. Only cloud-newer prompts. The modal is therefore not a
safety property of the sync — it is an inconsistency in it. Removing it makes
the two directions agree; it does not remove a guarantee that currently exists.

### 1.2 The container timestamp is bumped by navigation, not just edits

`selectTabContainer` (`tabContainerDataStateSlice.ts:394`) sets
`state.lastModified = Date.now()` unconditionally. Verified: re-selecting the
*already selected* id still advances the timestamp — the reducer has no same-id
guard, only the click handler at `TabGroupEntryContainer.tsx:87-92` does.

`SELECT_TAB_CONTAINER_ACTION` is in `actionsToCapture`
(`customMiddleware.ts:28`) and is not in the `isDataStateChangeAction` ignore
list, so selection dispatches `setIsDirty`, which schedules the debounced
`syncStateWithFirestore`. Verified action sequence:

```
tabContainerDataState/selectTabContainer
undoRedo/set
globalState/setIsDirty
THUNK
global/syncStateWithFirestore/pending
...
global/saveToFirestoreIfDirty/pending
```

So browsing between saved sessions on one device makes that device "newer" and
can present the other device with an either/or prompt over an edit that never
happened. A single container-wide timestamp is not merely coarse; it is being
advanced by pure view-state changes.

### 1.3 A single timestamp cannot express the actual state

Two devices that each added a different session have no representable merge
under one timestamp. The union is the answer the user wants in nearly every
case, and it cannot be reached without per-session versioning.

## 2. Sequencing — KAN-33 lands first, as its own PR

`globalStateSlice.ts:92-93` asserts the result of `loadFromLocalStorage`
(declared `any`) as `TabMasterContainer` with no validation. Today the only
things read off it before the modal opens are `.lastModified` and the two
objects handed to the modal for display, and a human then decides.

Under automatic merge the same unvalidated object is iterated and the result is
**written back to Firestore**. Corruption stops being a display bug and becomes
a replication bug: local garbage overwrites an intact cloud copy with no user
present. That is a new failure mode this change introduces, so it is closed
first rather than alongside.

KAN-33 is also cheap and independently valuable: `isValidTabMasterContainer`
already exists (`local.ts:324`), takes `unknown`, and is covered by the existing
suite. Landing it separately keeps the KAN-32 diff — which already spans the
persisted schema, the merge, a deleted component and 10 locale files —
reviewable, and keeps the validation if KAN-32 is ever reverted.

**Risk to check during KAN-33, not assumed:** `isValidTabMasterContainer`
requires `createdTime`, `windowCount`, `tabCount`, `isAutoSave` and `isSelected`
on every group. If any real saved session predates one of those fields, wiring
the validator in would reject valid data and fall back to cloud-only — trading a
corruption bug for a data-loss bug. Run it against real localStorage from a
populated profile before trusting it.

**Behaviour on invalid local:** treat as absent and take the existing cloud-only
branch, with a `console.warn`. The data is already unreadable, and cloud is
intact. Do not throw, and do not write the invalid object anywhere.

## 3. Data model

Both new fields are optional. Existing Firestore documents and existing
localStorage have neither, so a required field would be a type that lies about
every document written before this change.

```ts
export interface tabContainerData {
  // ...existing fields unchanged
  lastModified?: number;        // NEW - per-session
}

export interface deletedTabGroup {
  tabGroupId: string;
  deletedAt: number;
}

export interface TabMasterContainer {
  lastModified: number;         // kept: migration fallback, monotonic doc version
  selectedTabGroupId: string | null;
  tabGroups: tabContainerData[];
  deletedTabGroups?: deletedTabGroup[];   // NEW - tombstones
}
```

The migration rule lives in exactly one accessor so no call site can forget it:

```ts
const sessionTimestamp = (g: tabContainerData, c: TabMasterContainer): number =>
  g.lastModified ?? c.lastModified;
```

A pre-migration document therefore degrades to "every session carries its
container's timestamp", and the merge reduces to a per-id union with the newer
side winning — strictly better than discarding a side, which is what happens
today.

### Tombstones are not optional

Union-merge by `tabGroupId` alone resurrects deleted sessions permanently: the
device that still has the session re-adds it on every sync, and the user cannot
delete it from either device. Zombie sessions are worse than the prompt being
removed.

## 4. Merge algorithm

New module `src/utils/functions/mergeTabData.ts`. Pure, no Redux, no Firestore.

```ts
export interface MergeResult {
  merged: TabMasterContainer;
  changedFromLocal: boolean;   // -> notify the user
  changedFromCloud: boolean;   // -> write to Firestore
}

export function mergeTabContainers(
  local: TabMasterContainer,
  cloud: TabMasterContainer,
  now: number,
): MergeResult
```

`now` is injected so tombstone GC is deterministic under test.

**Method.** Build a map from `tabGroupId` to the single latest *event* for that
id. A session version is an event, timestamped `sessionTimestamp(...)`. A
tombstone is an event, timestamped `deletedAt`. Walk local first, then cloud,
keeping an event when its timestamp is `>=` the incumbent.

- Winner is a session version → present in the output, normalized so
  `lastModified` is always populated.
- Winner is a tombstone → absent from the output; the tombstone is retained.

Delete-versus-edit needs no special case: a later edit beats an earlier delete,
an earlier edit loses to a later delete.

**Ties go to cloud.** Walking cloud last with `>=` gives cloud exact ties. This
is the only convergent choice — if local wins ties, device A writes its version,
device B writes its version, and they ping-pong indefinitely. Both devices
compare against the same cloud copy, so cloud-wins settles in one round.

**Output fields.**

- `lastModified = max(local.lastModified, cloud.lastModified)`. Not `now` — that
  would make every popup open look newer to the other device forever.
- `tabGroups` sorted by `lastModified` descending, matching the existing
  newest-first `unshift` convention and deterministic across devices.
- `selectedTabGroupId` keeps the **local** device's selection if that session
  survived, else `null`; `isSelected` is recomputed on every group to match.
  Selection is per-device view state, and pushing the other device's selection
  across is pure churn.
- `deletedTabGroups` GC'd: drop entries older than 30 days, then keep the 500
  newest. Bounded on both axes — worst case roughly 30 KB against the 1 MiB
  Firestore ceiling (see KAN-6, KAN-18). Accepted tradeoff: a device offline
  more than 30 days can resurrect a session deleted while it was away. The
  failure is a reappearing session, not a lost one.

**The two flags, defined precisely.** Both compare the winning event set —
the map of `tabGroupId` to `{kind, timestamp}` — against the event set each
input side contributed. They are not deep-equality checks on the whole
container, so they are unaffected by field reordering or by
`selectedTabGroupId`.

- `changedFromCloud` — true when the winning set differs from cloud's own set.
  Drives the Firestore write. False means cloud is already correct and the
  write is skipped, which is what stops every popup open from producing a
  commit.
- `changedFromLocal` — true when the winning set differs from local's own set.
  Drives the toast. False means this device learned nothing new and the user is
  told nothing.

Both are false in the steady state, so a converged pair of devices is silent and
writes nothing.

**Accepted visible side effect:** existing users see their session list reorder
once, on first merge, because pre-migration sessions share a container timestamp
and then acquire real ones.

## 5. Reducer changes

Per-session `lastModified` is bumped **only by content mutations**:
`saveToTabContainerInternal`, `addCurrWindowToTabGroupInternal`,
`addCurrTabToWindowInternal`, `updateTabGroupTitle`, `updateWindowGroupTitle`,
`deleteWindowInternal`, `deleteTabInternal`.

`selectTabContainer` does **not** bump it. Per §1.2, doing so would let browsing
on one device outrank a real edit on another — the same defect one level down.

Tombstones are written by `deleteTabContainerInternal`, and by
`deleteWindowInternal` / `deleteTabInternal` on the cascade path where
`windowCount` reaches 0 and the group is spliced out. Writing a tombstone for an
id that already has one updates `deletedAt` rather than appending a duplicate.

Out of scope, deliberately: the container-level `lastModified` behaviour and the
fact that selection triggers a sync at all. Both are real warts, neither is
load-bearing here, and changing them widens the blast radius. File the
selection-triggers-sync churn separately.

## 6. Sync branch

`globalStateSlice.ts:95-133` collapses to a single path:

```ts
if (tabDataFromCloud && tabDataFromLocalStorage) {
  const { merged, changedFromLocal, changedFromCloud } =
    mergeTabContainers(tabDataFromLocalStorage, tabDataFromCloud, Date.now());

  thunkAPI.dispatch(replaceState(merged));
  if (changedFromCloud) { /* setIsDirty + saveToFirestoreIfDirty */ }
  if (changedFromLocal) { /* showToast(SYNC_MERGED) */ }
  // setPresentStartup / setHasSyncedBefore as today
}
```

The other three branches (cloud-only, local-only, new user) are untouched.

**User-visible signal.** Divergence between devices becomes invisible once the
modal is gone. A merge that actually changed the local side shows a toast via
the existing `showToast` — no decision, no blocking. Silent when the merge is a
no-op, which is the common case.

The mechanism is a new entry in `TOAST_MESSAGES` (`common.ts:63`), not a locale
key. `Toast.tsx:52` renders `{t(toastText)}`, but no existing `TOAST_MESSAGES`
value appears in any locale file — checked — so they all fall through i18next's
missing-key fallback and render as their literal English. Follow that pattern
rather than inventing a second one; translating toasts is a separate change and
would need all 17 existing messages, not just this one.

## 7. Deletions

Verified as exclusive to the modal before listing here.

- `src/components/modals/ConflictModal.tsx` — deleted outright.
- `globalStateSlice.ts`: `ConflictModalPayload`; the `Global` fields
  `isConflictModalOpen`, `tabDataLocal`, `tabDataCloud` and their `initialState`
  entries; the `openConflictModal` / `closeConflictModal` reducers; both exports.
- `MainContainer.tsx:145` render site and its import.
- Eight i18n keys, each confirmed referenced only in `ConflictModal.tsx`:
  `Local Data`, `Cloud Data`, `LATEST`, `Last updated`, `Saved sessions`,
  `Saved session` (all ten locales), and `SyncConflictHeader`,
  `SyncConflictDismissLabel` (`en` only).

Locale files are `public/locales/{de,en,es,fr,hi,it,ja,pt,ru,zh}/translation.json`.

KAN-31's `<dialog>` accessibility work and KAN-34's contrast fix are removed
along with the component. Both remain correct in history; neither is wasted,
since both shipped value while the modal existed. Note KAN-4 (session preview in
the modal) becomes moot and should be closed rather than deprioritised.

## 8. Testing

There is no jsdom and no React Testing Library, and neither `jsdom` nor
`happy-dom` is installed. Neither is needed, and KAN-2 stays deferred.

### Constraint found while probing

`src/utils/constants/common.ts:19` evaluates `window.screen.height` at module
load. Importing any slice under vitest's default node environment fails with
`ReferenceError: window is not defined`. Two consequences:

1. `mergeTabData.ts` must use `import type` for `TabMasterContainer` and
   `tabContainerData`. A value import is not elided by esbuild and would drag
   `common.ts` — and therefore `window.screen` — into the pure module. A test
   must lock this in, or a later refactor silently reintroduces the dependency.
2. Store-level tests need a four-line `vi.hoisted` stub for `window.screen`.
   This was verified working: the real `syncStateWithFirestore` thunk, the real
   `customMiddleware` and the real slices all run under vitest today with only
   that stub plus a mock of `utils/functions/external`.

### Level 1 — unit tests on the pure merge

`src/tests/utils/functions/mergeTabData.test.ts`.

| Case | Assertion |
|---|---|
| Added on A only | present in output, both directions |
| Deleted on A, edited on B | later timestamp wins — both orderings |
| Edited on both, different timestamps | newer wins |
| Edited on both, **exact tie** | cloud wins |
| Empty local | cloud survives whole |
| Empty cloud | local survives whole |
| Pre-migration document, both sides | container timestamp used as fallback |
| Mixed migration | one side migrated, one not |
| Tombstone GC | older than 30 days dropped; capped at 500 newest |
| **Idempotence** | `merge(merge(a,b), b)` equals `merge(a,b)` — proves no resurrection on the second round trip |
| Selection | `selectedTabGroupId` survives, or nulls when its group loses |
| Flags | `changedFromLocal` / `changedFromCloud` exact |

### Level 2 — store-level integration on the real thunk

Drives `syncStateWithFirestore` with `loadFromFirestore` mocked, asserting:
the modal state no longer exists; the merged result reaches Redux and
localStorage; `saveToFirestore` is called when and only when `changedFromCloud`;
the toast fires when and only when `changedFromLocal`.

Every case gets the revert-and-watch-it-fail treatment. A test that passes
against the un-merged code is not a test.

### Level 3 — E2E in Chrome

Per the two-device localStorage recipe: build the shipped artifact (with the
remote-URL strip), load `dist/`, open the popup as a tab rather than via the
extension action, stage a second device by rewriting `tabContainerData`.
Proves the wiring only — that no modal appears, that the union reaches Firestore,
and that a deletion still sticks after a full round trip.

### Known limits

- A genuinely concurrent two-physical-device race cannot be reproduced here. It
  is simulated by rewriting localStorage between reloads, which exercises the
  same code path but not real wall-clock simultaneity. Say so in the PR.
- Not confirmed in a browser: the probe showed Redux `tabGroups` empty while the
  conflict modal was open, suggesting the app behind the modal currently shows
  zero sessions. Consistent with `App.tsx:156-174` hydrating localStorage only
  in the signed-out branch, but not verified end to end. It disappears with the
  modal either way.

## 9. Constraints carried in

- Never match Firestore failures on message text; match `error.code`. The lite
  SDK phrases messages differently and this broke error handling once (#117,
  `firestoreErrors.ts`).
- Firestore rules are console-only. `firestore.rules` and `firebase.json` were
  deleted deliberately in #115; do not re-add them.
- v1.3.3 is in Web Store review. Do not touch versions or changelogs.
- Watch the 1 MiB Firestore document limit; per-session fields plus tombstones
  grow it.

## 10. Out of scope

- Container-level `lastModified` semantics, and selection triggering a sync
  (§5) — file separately.
- Deleting the now-dead `CONTRAST_COLOR` token.
- Test infrastructure for React components (KAN-2).
- Gating the initial Firestore read on `onAuthStateChanged` (the fresh-install
  403s).
