# Automatic Per-Session Sync Merge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the either/or sync conflict prompt with an automatic per-session merge, and delete `ConflictModal.tsx` entirely.

**Architecture:** Add a per-session `lastModified` and a tombstone list to the persisted shape, both optional so existing documents stay valid. Merge by taking the latest *event* per `tabGroupId` across local and cloud, where a session version and a tombstone are both events. The merge is a pure function in its own module so the whole correctness matrix is unit-testable; the Redux thunk only wires it up.

**Tech Stack:** TypeScript 5.3, React 18, Redux Toolkit 1.x, Vitest 4 (node environment, no jsdom), Firebase 12 `firestore/lite`, i18next.

**Spec:** `docs/superpowers/specs/2026-08-31-auto-merge-sync-design.md`

## Global Constraints

- **Do not touch versions or changelogs.** v1.3.3 is in Web Store review.
- **Never match Firestore failures on message text.** Match `error.code` (`firestoreErrors.ts`). The lite SDK phrases messages differently; this broke once in #117.
- **Do not re-add `firestore.rules` or `firebase.json`.** Rules are console-only, deleted deliberately in #115.
- **Do not re-add `--max-warnings 0`** to the lint script. Baseline is 0 errors / 29 warnings and lint gates CI.
- **`src/utils/constants/common.ts:19` reads `window.screen.height` at module load.** Any test importing a slice needs the `vi.hoisted` stub from Task 1. Any module intended to be DOM-free must import types with `import type`.
- **Firestore documents are capped at 1 MiB.** Per-session fields plus tombstones grow the document.
- **Baseline to preserve:** 81 tests passing, `npx tsc --noEmit` clean, `npm run lint` 0 errors.
- **Two PRs.** Tasks 1–3 are PR one (KAN-33, off `main`). Tasks 4–11 are PR two (KAN-32, off `main` after PR one merges).

## File Structure

**PR one — KAN-33**

| File | Responsibility |
|---|---|
| `src/utils/functions/local.ts` | `loadFromLocalStorage` returns `unknown`; validators unchanged |
| `src/redux/slices/globalStateSlice.ts:92-93` | Validate before the sync branch consumes it |
| `src/App.tsx`, `src/config/i18n.tsx`, `src/redux/slices/settingsDataStateSlice.ts`, `src/components/modals/RateAndReviewModal.tsx` | Narrow the other five call sites |
| `src/tests/setup/domStub.ts` | Shared `window.screen` stub for slice-importing tests |
| `src/tests/redux/syncValidation.test.ts` | Store-level proof that invalid local is not written to cloud |

**PR two — KAN-32**

| File | Responsibility |
|---|---|
| `src/utils/functions/mergeTabData.ts` | **New.** Pure merge. No Redux, no Firestore, no DOM. |
| `src/tests/utils/functions/mergeTabData.test.ts` | **New.** The full correctness matrix. |
| `src/redux/slices/tabContainerDataStateSlice.ts` | Types, per-session bumps, tombstone writes |
| `src/redux/slices/globalStateSlice.ts` | Merge branch; delete all conflict state |
| `src/components/MainContainer.tsx` | Remove render site |
| `src/components/modals/ConflictModal.tsx` | **Deleted** |
| `public/locales/*/translation.json` | Remove 8 modal-only keys across 10 files |
| `src/utils/constants/common.ts` | `SYNC_MERGED` toast message |
| `src/tests/redux/syncMerge.test.ts` | **New.** Store-level proof of the wired thunk. |

---

## Task 1: Test harness for slice-importing tests

Nothing in this repo currently imports a Redux slice from a test. The first attempt fails with `ReferenceError: window is not defined` because `common.ts:19` evaluates `window.screen.height` at module load. This task builds the stub once so Tasks 3, 10 and 11 can use it.

**Files:**
- Create: `src/tests/setup/domStub.ts`
- Create: `src/tests/setup/makeStore.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `stubDomGlobals(): void` — call inside `vi.hoisted`. `makeTestStore(): { store, seen: string[] }` — a store with the real `customMiddleware` plus an action recorder.

- [ ] **Step 1: Write the stub module**

```ts
// src/tests/setup/domStub.ts
// src/utils/constants/common.ts reads window.screen.height at module load, so
// importing any slice under vitest's node environment throws without this.
// Call from inside vi.hoisted() so it runs before module evaluation.
export function stubDomGlobals(): void {
  const g = globalThis as unknown as { window?: unknown };
  g.window = g.window ?? globalThis;
  (g.window as { screen?: unknown }).screen = { height: 1080, width: 1920 };
}
```

- [ ] **Step 2: Write the store builder**

```ts
// src/tests/setup/makeStore.ts
import { configureStore, Middleware } from '@reduxjs/toolkit';

import globalStateReducer from '../../redux/slices/globalStateSlice';
import settingsDataStateReducer from '../../redux/slices/settingsDataStateSlice';
import settingsCategoryStateReducer from '../../redux/slices/settingsCategoryStateSlice';
import tabContainerDataStateReducer from '../../redux/slices/tabContainerDataStateSlice';
import undoRedoReducer from '../../redux/slices/undoRedoSlice';
import { customMiddleware } from '../../redux/middleware/customMiddleware';

// Mirrors src/redux/store.tsx, plus a recorder so tests can assert on the
// action sequence the middleware produces. Thunks arrive as functions and have
// no `.type`.
export function makeTestStore() {
  const seen: string[] = [];
  const recorder: Middleware = () => (next) => (action: unknown) => {
    seen.push(
      typeof action === 'function'
        ? 'THUNK'
        : String((action as { type?: unknown })?.type)
    );
    return next(action as never);
  };

  const store = configureStore({
    reducer: {
      undoRedo: undoRedoReducer,
      globalState: globalStateReducer,
      settingsDataState: settingsDataStateReducer,
      settingsCategoryState: settingsCategoryStateReducer,
      tabContainerDataState: tabContainerDataStateReducer,
    },
    middleware: (g) =>
      g({ serializableCheck: false }).prepend(recorder).concat(customMiddleware),
  });

  return { store, seen };
}
```

- [ ] **Step 3: Prove the harness works before relying on it**

Create `src/tests/setup/harness.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { stubDomGlobals } from './domStub';

vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { stubDomGlobals: s } = require('./domStub');
  s();
});

vi.mock('../../utils/functions/external', () => ({
  loadFromFirestore: vi.fn(async () => undefined),
  saveToFirestore: vi.fn(async () => undefined),
  displayToast: vi.fn(),
}));

import { makeTestStore } from './makeStore';

describe('test harness', () => {
  it('stubs window.screen so slices can be imported', () => {
    stubDomGlobals();
    expect((globalThis as any).window.screen.height).toBe(1080);
  });

  it('builds a store with the real middleware', () => {
    const { store } = makeTestStore();
    expect(store.getState().tabContainerDataState.tabGroups).toEqual([]);
  });
});
```

If the `require` inside `vi.hoisted` trips the ESLint config or TS, inline the two assignment lines from `domStub.ts` directly in the `vi.hoisted` block instead and keep `domStub.ts` for the non-hoisted call. The hoisted block must not depend on an ES import — that is the whole reason it exists.

- [ ] **Step 4: Run it**

Run: `npx vitest run src/tests/setup/harness.test.ts --reporter=verbose`
Expected: 2 passed.

- [ ] **Step 5: Confirm the baseline still passes**

Run: `npx vitest run`
Expected: 83 passed (81 existing + 2 new).

- [ ] **Step 6: Commit**

```bash
git checkout -b fix/kan-33-validate-localstorage
git add src/tests/setup/
git commit -m "test: add harness for slice-level tests

common.ts reads window.screen at module load, so no test could import a
Redux slice. Adds a hoisted stub plus a store builder mirroring
src/redux/store.tsx with an action recorder."
```

---

## Task 2: `loadFromLocalStorage` returns `unknown`

**Files:**
- Modify: `src/utils/functions/local.ts:160-169`
- Modify: `src/App.tsx:114`, `src/App.tsx:161`
- Modify: `src/config/i18n.tsx:10`
- Modify: `src/redux/slices/settingsDataStateSlice.ts:42`
- Modify: `src/components/modals/RateAndReviewModal.tsx:40`
- Test: `src/tests/utils/functions/local.test.ts` (existing, must keep passing)

**Interfaces:**
- Consumes: nothing.
- Produces: `loadFromLocalStorage(key: string): unknown` — every caller must now narrow.

- [ ] **Step 1: Verify the validator accepts real saved data before trusting it**

This is a gate, not a formality. `isValidTabMasterContainer` requires `createdTime`, `windowCount`, `tabCount`, `isAutoSave` and `isSelected` on every group. If real saved sessions predate any of those, wiring it in would reject valid data.

Build and load the extension per the E2E recipe, save two or three sessions with multiple windows, then in the popup's console:

```js
copy(localStorage.getItem('tabContainerData'))
```

Save that to `src/tests/fixtures/realTabContainerData.json` and assert on it:

```ts
// src/tests/utils/functions/realData.test.ts
import { describe, it, expect } from 'vitest';
import real from '../../fixtures/realTabContainerData.json';
import { isValidTabMasterContainer } from '../../../utils/functions/local';

describe('validator against real saved data', () => {
  it('accepts a container captured from a real profile', () => {
    expect(isValidTabMasterContainer(real)).toBe(true);
  });
});
```

**If this fails, stop and report which field is missing.** The fix is to relax that field in the validator, not to skip validation. Do not proceed to Step 2 until it passes.

- [ ] **Step 2: Change the return type**

```ts
// src/utils/functions/local.ts
// Returns `unknown` rather than `any`: the parsed value is whatever happens to
// be in localStorage, which a caller must narrow before use. Under automatic
// sync merging an unvalidated container is written back to Firestore, so an
// implicit `any` here silently propagates local corruption to the cloud copy.
export const loadFromLocalStorage = (key: string): unknown => {
  try {
    const serializedState = localStorage.getItem(key);
    if (!serializedState) return undefined;
    return JSON.parse(serializedState);
  } catch (error) {
    console.error('Error loading state from localStorage: ', error);
    return undefined;
  }
};
```

- [ ] **Step 3: Run the compiler to find every break**

Run: `npx tsc --noEmit`
Expected: FAIL, listing the call sites that destructure or assign the result.

- [ ] **Step 4: Narrow the five non-sync call sites**

These read settings, not session data, and none is on the write-to-cloud path. Add a local record guard rather than reaching for a cast:

```ts
// src/App.tsx — replace `loadFromLocalStorage('settingsData') || {}`
const settings = loadFromLocalStorage('settingsData');
const {
  /* ...existing destructured names, unchanged... */
} = (typeof settings === 'object' && settings !== null ? settings : {}) as Partial<SettingsData>;
```

Apply the same shape at `src/config/i18n.tsx:10`, `src/redux/slices/settingsDataStateSlice.ts:42`, and `src/components/modals/RateAndReviewModal.tsx:40`. For `src/App.tsx:161` (`tabContainerData` in the signed-out branch), guard with the real validator instead:

```ts
const candidate = loadFromLocalStorage('tabContainerData');
const tabDataFromLocalStorage = isValidTabMasterContainer(candidate)
  ? candidate
  : undefined;
```

Import `isValidTabMasterContainer` from `../utils/functions/local`.

- [ ] **Step 5: Verify the compiler is clean and tests still pass**

Run: `npx tsc --noEmit && npx vitest run && npm run lint`
Expected: tsc silent, 83 tests + the new real-data test passing, lint 0 errors.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: loadFromLocalStorage returns unknown

Forces every caller to narrow. The sync path asserted the result as
TabMasterContainer without validating, so corrupted localStorage flowed
straight into the merge."
```

---

## Task 3: Validate before the sync consumes it

**Files:**
- Modify: `src/redux/slices/globalStateSlice.ts:92-93`
- Test: `src/tests/redux/syncValidation.test.ts` (create)

**Interfaces:**
- Consumes: `loadFromLocalStorage(key): unknown` (Task 2), `makeTestStore()` and `stubDomGlobals()` (Task 1).
- Produces: the sync thunk treats invalid local storage as absent.

- [ ] **Step 1: Write the failing test**

```ts
// src/tests/redux/syncValidation.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.hoisted(() => {
  const g = globalThis as any;
  g.window = g.window ?? globalThis;
  g.window.screen = { height: 1080, width: 1920 };
});

const mocks = vi.hoisted(() => ({
  loadFromFirestore: vi.fn(async (): Promise<any> => undefined),
  saveToFirestore: vi.fn(async () => undefined),
}));

vi.mock('../../utils/functions/external', () => ({
  loadFromFirestore: mocks.loadFromFirestore,
  saveToFirestore: mocks.saveToFirestore,
  displayToast: vi.fn(),
}));

import {
  setSignedIn,
  setUserId,
  syncStateWithFirestore,
} from '../../redux/slices/globalStateSlice';
import { makeTestStore } from '../setup/makeStore';

const goodCloud = {
  lastModified: 5000,
  selectedTabGroupId: 'cloud-1',
  tabGroups: [
    {
      tabGroupId: 'cloud-1',
      title: 'Cloud session',
      createdTime: '2026-08-31 00:00:00',
      windowCount: 1,
      tabCount: 1,
      isAutoSave: false,
      isSelected: true,
      windows: [
        {
          windowId: 'w1',
          windowHeight: 100,
          windowWidth: 100,
          windowOffsetTop: 0,
          windowOffsetLeft: 0,
          tabCount: 1,
          title: 't',
          tabs: [
            { tabId: 't1', favicon: '', title: 't', url: 'https://a.co' },
          ],
        },
      ],
    },
  ],
};

describe('sync with invalid localStorage', () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.loadFromFirestore.mockReset().mockResolvedValue(goodCloud);
    mocks.saveToFirestore.mockReset().mockResolvedValue(undefined);
  });

  it.each([
    ['null', 'null'],
    ['a bare string', '"corrupted"'],
    ['an array', '[]'],
    ['missing tabGroups', '{"lastModified":9999,"selectedTabGroupId":null}'],
    ['tabGroups not an array', '{"lastModified":9999,"selectedTabGroupId":null,"tabGroups":"x"}'],
  ])('treats %s as absent and keeps the cloud copy', async (_label, raw) => {
    localStorage.setItem('tabContainerData', raw);

    const { store } = makeTestStore();
    store.dispatch(setSignedIn());
    store.dispatch(setUserId('u1'));
    await store.dispatch(syncStateWithFirestore() as never);

    // the intact cloud session survives
    expect(
      store.getState().tabContainerDataState.tabGroups.map((g) => g.tabGroupId)
    ).toEqual(['cloud-1']);
    // and nothing invalid was pushed back up
    expect(mocks.saveToFirestore).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run src/tests/redux/syncValidation.test.ts --reporter=verbose`
Expected: FAIL. `null` and the malformed objects currently reach the comparison at `globalStateSlice.ts:97-98`; `"corrupted".lastModified` is `undefined`, so `localTimestamp !== cloudTimestamp` is true and the branch behaves unpredictably rather than falling through to the cloud-only path.

- [ ] **Step 3: Implement the guard**

```ts
// src/redux/slices/globalStateSlice.ts — replace lines 92-93
// localStorage is user-writable and survives extension updates, so whatever
// comes back here is genuinely unknown. Validate before the sync can act on
// it: an invalid container is treated as absent, which falls through to the
// cloud-only branch below and leaves the intact cloud copy alone.
const localCandidate = loadFromLocalStorage('tabContainerData');
const tabDataFromLocalStorage: TabMasterContainer | undefined =
  isValidTabMasterContainer(localCandidate) ? localCandidate : undefined;
if (localCandidate !== undefined && tabDataFromLocalStorage === undefined) {
  console.warn(
    'Ignoring unreadable tabContainerData in localStorage; using cloud copy.'
  );
}
```

Add `isValidTabMasterContainer` to the existing import from `../../utils/functions/local`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/tests/redux/syncValidation.test.ts --reporter=verbose`
Expected: 5 passed.

- [ ] **Step 5: Revert the guard and watch it fail**

Temporarily restore the old two lines, re-run, confirm failures, then restore the guard. A test that passes against the unguarded code is not a test.

- [ ] **Step 6: Full check and commit**

Run: `npx tsc --noEmit && npx vitest run && npm run lint`

```bash
git add -A
git commit -m "fix: validate localStorage before the sync merge (KAN-33)

Corrupted localStorage reached the conflict comparison unvalidated. Under
automatic merging the same object is written back to Firestore, so this
closes the path before that lands."
```

- [ ] **Step 7: Open PR one**

Push and open a PR titled `Validate localStorage before sync (KAN-33)`. Body states what was verified: the real-data fixture check from Task 2 Step 1, the five invalid shapes, and the revert-and-fail result. **Stop here and let PR one merge before starting Task 4.**

---

## Task 4: Persisted shape — types only

**Files:**
- Modify: `src/redux/slices/tabContainerDataStateSlice.ts:38-56`

**Interfaces:**
- Consumes: nothing.
- Produces: `tabContainerData.lastModified?: number`, `deletedTabGroup { tabGroupId: string; deletedAt: number }`, `TabMasterContainer.deletedTabGroups?: deletedTabGroup[]`.

- [ ] **Step 1: Add the fields**

```ts
export interface tabContainerData {
  tabGroupId: string;
  title: string;
  createdTime: string;
  windowCount: number;
  tabCount: number;
  isAutoSave: boolean;
  isSelected: boolean;
  windows: windowGroupData[];
  // Optional because every document written before this change lacks it.
  // Readers fall back to the container's lastModified; see mergeTabData.ts.
  lastModified?: number;
}

// A deleted session has to leave a trace. Merging by tabGroupId alone would
// let the device that still holds a session re-add it on every sync, so the
// user could never delete it from either device.
export interface deletedTabGroup {
  tabGroupId: string;
  deletedAt: number;
}

export interface TabMasterContainer {
  lastModified: number;
  selectedTabGroupId: string | null;
  tabGroups: tabContainerData[];
  deletedTabGroups?: deletedTabGroup[];
}
```

- [ ] **Step 2: Verify nothing broke**

Run: `npx tsc --noEmit && npx vitest run`
Expected: clean, all tests pass. Both fields are optional, so no call site changes.

- [ ] **Step 3: Commit**

```bash
git checkout -b feat/kan-32-auto-merge-sync   # off main, after PR one merges
git add -A
git commit -m "feat: add per-session lastModified and tombstone types"
```

---

## Task 5: The pure merge — union and per-session LWW

Split from tombstones (Task 6) so each half gets its own test cycle.

**Files:**
- Create: `src/utils/functions/mergeTabData.ts`
- Create: `src/tests/utils/functions/mergeTabData.test.ts`

**Interfaces:**
- Consumes: the types from Task 4, imported with `import type`.
- Produces: `mergeTabContainers(local, cloud, now): MergeResult` where `MergeResult = { merged: TabMasterContainer; changedFromLocal: boolean; changedFromCloud: boolean }`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/tests/utils/functions/mergeTabData.test.ts
import { describe, it, expect } from 'vitest';
import { mergeTabContainers } from '../../../utils/functions/mergeTabData';
import type {
  TabMasterContainer,
  tabContainerData,
} from '../../../redux/slices/tabContainerDataStateSlice';

const NOW = 1_000_000;

function group(id: string, lastModified?: number): tabContainerData {
  return {
    tabGroupId: id,
    title: id,
    createdTime: '2026-08-31 00:00:00',
    windowCount: 1,
    tabCount: 1,
    isAutoSave: false,
    isSelected: false,
    windows: [
      {
        windowId: `w-${id}`,
        windowHeight: 100,
        windowWidth: 100,
        windowOffsetTop: 0,
        windowOffsetLeft: 0,
        tabCount: 1,
        title: 't',
        tabs: [{ tabId: `t-${id}`, favicon: '', title: 't', url: 'https://a.co' }],
      },
    ],
    ...(lastModified === undefined ? {} : { lastModified }),
  };
}

function container(
  lastModified: number,
  tabGroups: tabContainerData[],
  selectedTabGroupId: string | null = null
): TabMasterContainer {
  return { lastModified, selectedTabGroupId, tabGroups };
}

const ids = (c: TabMasterContainer) => c.tabGroups.map((g) => g.tabGroupId);

describe('mergeTabContainers - union and per-session LWW', () => {
  it('keeps a session that exists only on the local side', () => {
    const local = container(10, [group('a', 10)]);
    const cloud = container(20, [group('b', 20)]);
    expect(ids(mergeTabContainers(local, cloud, NOW).merged).sort()).toEqual([
      'a',
      'b',
    ]);
  });

  it('keeps a session that exists only on the cloud side', () => {
    const local = container(20, [group('b', 20)]);
    const cloud = container(10, [group('a', 10)]);
    expect(ids(mergeTabContainers(local, cloud, NOW).merged).sort()).toEqual([
      'a',
      'b',
    ]);
  });

  it('takes the newer version when both sides edited the same session', () => {
    const localA = { ...group('a', 50), title: 'LOCAL' };
    const cloudA = { ...group('a', 99), title: 'CLOUD' };
    const { merged } = mergeTabContainers(
      container(50, [localA]),
      container(99, [cloudA]),
      NOW
    );
    expect(merged.tabGroups).toHaveLength(1);
    expect(merged.tabGroups[0].title).toBe('CLOUD');
  });

  it('takes local when local is newer', () => {
    const localA = { ...group('a', 99), title: 'LOCAL' };
    const cloudA = { ...group('a', 50), title: 'CLOUD' };
    const { merged } = mergeTabContainers(
      container(99, [localA]),
      container(50, [cloudA]),
      NOW
    );
    expect(merged.tabGroups[0].title).toBe('LOCAL');
  });

  it('gives an exact tie to cloud, so two devices converge', () => {
    const localA = { ...group('a', 77), title: 'LOCAL' };
    const cloudA = { ...group('a', 77), title: 'CLOUD' };
    const { merged } = mergeTabContainers(
      container(77, [localA]),
      container(77, [cloudA]),
      NOW
    );
    expect(merged.tabGroups[0].title).toBe('CLOUD');
  });

  it('falls back to the container timestamp for pre-migration sessions', () => {
    // neither side has per-session timestamps
    const local = container(10, [group('a'), group('shared')]);
    const cloud = container(20, [{ ...group('shared'), title: 'CLOUD' }, group('b')]);
    const { merged } = mergeTabContainers(local, cloud, NOW);
    expect(ids(merged).sort()).toEqual(['a', 'b', 'shared']);
    // cloud container is newer (20 > 10), so its version of `shared` wins
    expect(merged.tabGroups.find((g) => g.tabGroupId === 'shared')!.title).toBe(
      'CLOUD'
    );
  });

  it('handles one migrated side and one not', () => {
    const local = container(10, [{ ...group('a', 999), title: 'LOCAL' }]);
    const cloud = container(20, [{ ...group('a'), title: 'CLOUD' }]);
    const { merged } = mergeTabContainers(local, cloud, NOW);
    // local's explicit 999 beats cloud's inherited 20
    expect(merged.tabGroups[0].title).toBe('LOCAL');
  });

  it('survives an empty local side', () => {
    const { merged } = mergeTabContainers(
      container(10, []),
      container(20, [group('a', 20)]),
      NOW
    );
    expect(ids(merged)).toEqual(['a']);
  });

  it('survives an empty cloud side', () => {
    const { merged } = mergeTabContainers(
      container(20, [group('a', 20)]),
      container(10, []),
      NOW
    );
    expect(ids(merged)).toEqual(['a']);
  });

  it('normalizes every surviving session to carry a lastModified', () => {
    const { merged } = mergeTabContainers(
      container(10, [group('a')]),
      container(20, [group('b')]),
      NOW
    );
    expect(merged.tabGroups.every((g) => typeof g.lastModified === 'number')).toBe(
      true
    );
  });

  it('takes the max container timestamp, never `now`', () => {
    const { merged } = mergeTabContainers(
      container(10, []),
      container(20, []),
      NOW
    );
    expect(merged.lastModified).toBe(20);
  });

  it('sorts newest first', () => {
    const { merged } = mergeTabContainers(
      container(30, [group('old', 1), group('new', 30)]),
      container(20, [group('mid', 20)]),
      NOW
    );
    expect(ids(merged)).toEqual(['new', 'mid', 'old']);
  });

  it('keeps the local selection when its session survives', () => {
    const { merged } = mergeTabContainers(
      container(30, [group('a', 30)], 'a'),
      container(20, [group('b', 20)], 'b'),
      NOW
    );
    expect(merged.selectedTabGroupId).toBe('a');
    expect(merged.tabGroups.find((g) => g.tabGroupId === 'a')!.isSelected).toBe(
      true
    );
    expect(merged.tabGroups.find((g) => g.tabGroupId === 'b')!.isSelected).toBe(
      false
    );
  });

  it('reports both sides unchanged when they already agree', () => {
    const same = () => container(30, [group('a', 30)], 'a');
    const r = mergeTabContainers(same(), same(), NOW);
    expect(r.changedFromLocal).toBe(false);
    expect(r.changedFromCloud).toBe(false);
  });

  it('reports changedFromCloud when local contributes a session', () => {
    const r = mergeTabContainers(
      container(30, [group('a', 30)]),
      container(20, []),
      NOW
    );
    expect(r.changedFromCloud).toBe(true);
    expect(r.changedFromLocal).toBe(false);
  });

  it('reports changedFromLocal when cloud contributes a session', () => {
    const r = mergeTabContainers(
      container(20, []),
      container(30, [group('a', 30)]),
      NOW
    );
    expect(r.changedFromLocal).toBe(true);
    expect(r.changedFromCloud).toBe(false);
  });
});
```

- [ ] **Step 2: Run to confirm it fails**

Run: `npx vitest run src/tests/utils/functions/mergeTabData.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/utils/functions/mergeTabData.ts
// `import type` is load-bearing, not stylistic. A value import pulls in the
// slice, which pulls in src/utils/constants/common.ts, which reads
// window.screen.height at module load - and this module must stay DOM-free so
// it can be unit-tested under vitest's node environment.
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
function collect(
  events: Map<string, Event>,
  side: TabMasterContainer
): void {
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
  _now: number
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
  };

  const mergedSig = signature(events);
  return {
    merged,
    changedFromLocal: mergedSig !== signature(sideEvents(local)),
    changedFromCloud: mergedSig !== signature(sideEvents(cloud)),
  };
}

export type { deletedTabGroup };
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/tests/utils/functions/mergeTabData.test.ts --reporter=verbose`
Expected: all 16 passing.

- [ ] **Step 5: Prove the module is DOM-free**

Add to the test file:

```ts
it('does not require a DOM (no window.screen at import time)', async () => {
  const saved = (globalThis as any).window;
  delete (globalThis as any).window;
  try {
    const fresh = await import('../../../utils/functions/mergeTabData?raw-check');
    expect(typeof fresh.mergeTabContainers).toBe('function');
  } finally {
    (globalThis as any).window = saved;
  }
});
```

If the `?raw-check` suffix confuses Vite's resolver, drop the suffix and instead assert statically: run `npx vitest run src/tests/utils/functions/mergeTabData.test.ts` with no DOM stub anywhere in the file — which is already the case — and note in a comment that the absence of a stub *is* the assertion. The point is that this file must never need `stubDomGlobals()`.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add pure per-session merge (union + LWW)

Cloud takes exact ties, which is the only convergent choice. Tombstones
land in the next commit."
```

---

## Task 6: Tombstones and garbage collection

**Files:**
- Modify: `src/utils/functions/mergeTabData.ts`
- Modify: `src/tests/utils/functions/mergeTabData.test.ts`

**Interfaces:**
- Consumes: `mergeTabContainers` from Task 5.
- Produces: same signature; `merged.deletedTabGroups` now populated and GC'd. Exports `TOMBSTONE_TTL_MS` and `TOMBSTONE_MAX`.

- [ ] **Step 1: Write the failing tests**

```ts
describe('mergeTabContainers - tombstones', () => {
  const withTombstones = (
    c: TabMasterContainer,
    t: { tabGroupId: string; deletedAt: number }[]
  ): TabMasterContainer => ({ ...c, deletedTabGroups: t });

  it('a delete on one side removes the session held by the other', () => {
    const local = withTombstones(container(90, []), [
      { tabGroupId: 'a', deletedAt: 90 },
    ]);
    const cloud = container(50, [group('a', 50)]);
    const { merged } = mergeTabContainers(local, cloud, NOW);
    expect(ids(merged)).toEqual([]);
    expect(merged.deletedTabGroups).toEqual([{ tabGroupId: 'a', deletedAt: 90 }]);
  });

  it('an edit later than the delete wins and the session comes back', () => {
    const local = withTombstones(container(50, []), [
      { tabGroupId: 'a', deletedAt: 50 },
    ]);
    const cloud = container(90, [{ ...group('a', 90), title: 'EDITED' }]);
    const { merged } = mergeTabContainers(local, cloud, NOW);
    expect(ids(merged)).toEqual(['a']);
    expect(merged.tabGroups[0].title).toBe('EDITED');
    expect(merged.deletedTabGroups ?? []).toEqual([]);
  });

  it('is idempotent - a second round trip does not resurrect', () => {
    const local = withTombstones(container(90, []), [
      { tabGroupId: 'a', deletedAt: 90 },
    ]);
    const cloud = container(50, [group('a', 50)]);
    const once = mergeTabContainers(local, cloud, NOW).merged;
    const twice = mergeTabContainers(once, cloud, NOW).merged;
    expect(ids(twice)).toEqual([]);
    expect(twice.deletedTabGroups).toEqual(once.deletedTabGroups);
  });

  it('drops tombstones older than the TTL', () => {
    const stale = NOW - TOMBSTONE_TTL_MS - 1;
    const local = withTombstones(container(NOW, []), [
      { tabGroupId: 'old', deletedAt: stale },
      { tabGroupId: 'fresh', deletedAt: NOW - 1000 },
    ]);
    const { merged } = mergeTabContainers(local, container(1, []), NOW);
    expect(merged.deletedTabGroups!.map((t) => t.tabGroupId)).toEqual(['fresh']);
  });

  it('caps tombstones at TOMBSTONE_MAX, keeping the newest', () => {
    const many = Array.from({ length: TOMBSTONE_MAX + 50 }, (_, i) => ({
      tabGroupId: `g${i}`,
      deletedAt: NOW - i, // g0 newest
    }));
    const local = withTombstones(container(NOW, []), many);
    const { merged } = mergeTabContainers(local, container(1, []), NOW);
    expect(merged.deletedTabGroups).toHaveLength(TOMBSTONE_MAX);
    expect(merged.deletedTabGroups![0].tabGroupId).toBe('g0');
  });
});
```

Add `TOMBSTONE_TTL_MS, TOMBSTONE_MAX` to the imports at the top of the test file.

- [ ] **Step 2: Run to confirm it fails**

Run: `npx vitest run src/tests/utils/functions/mergeTabData.test.ts`
Expected: FAIL — `TOMBSTONE_TTL_MS` is not exported; `merged.deletedTabGroups` is `undefined`.

- [ ] **Step 3: Implement**

Add to `mergeTabData.ts`:

```ts
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
```

In `mergeTabContainers`, rename the `_now` parameter to `now` and add to the `merged` object literal:

```ts
    deletedTabGroups: collectTombstones(events, now),
```

- [ ] **Step 4: Run to verify**

Run: `npx vitest run src/tests/utils/functions/mergeTabData.test.ts --reporter=verbose`
Expected: all passing, including Task 5's.

- [ ] **Step 5: Revert and watch it fail**

Comment out the `deletedTabGroups` line in the `merged` literal. Re-run. The resurrection and idempotence tests must fail. Restore.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: tombstones with TTL and cap in the merge

Union-merge by tabGroupId alone resurrects deleted sessions permanently.
Bounded at 30 days and 500 entries against the 1 MiB document limit."
```

---

## Task 7: Reducers write per-session timestamps and tombstones

**Files:**
- Modify: `src/redux/slices/tabContainerDataStateSlice.ts` — reducers at lines 367-619
- Test: `src/tests/redux/tabContainerReducers.test.ts` (create)

**Interfaces:**
- Consumes: types from Task 4.
- Produces: content mutations set `group.lastModified`; group removals append to `state.deletedTabGroups`. `selectTabContainer` does neither.

- [ ] **Step 1: Write the failing tests**

```ts
// src/tests/redux/tabContainerReducers.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.hoisted(() => {
  const g = globalThis as any;
  g.window = g.window ?? globalThis;
  g.window.screen = { height: 1080, width: 1920 };
});

import reducer, {
  saveToTabContainerInternal,
  selectTabContainer,
  updateTabGroupTitle,
  deleteTabContainerInternal,
} from '../../redux/slices/tabContainerDataStateSlice';
import type { tabContainerData } from '../../redux/slices/tabContainerDataStateSlice';

function group(id: string): tabContainerData {
  return {
    tabGroupId: id,
    title: id,
    createdTime: '2026-08-31 00:00:00',
    windowCount: 1,
    tabCount: 1,
    isAutoSave: false,
    isSelected: false,
    windows: [
      {
        windowId: `w-${id}`,
        windowHeight: 100,
        windowWidth: 100,
        windowOffsetTop: 0,
        windowOffsetLeft: 0,
        tabCount: 1,
        title: 't',
        tabs: [{ tabId: `t-${id}`, favicon: '', title: 't', url: 'https://a.co' }],
      },
    ],
  };
}

const base = { lastModified: 1, selectedTabGroupId: null, tabGroups: [] };

describe('per-session timestamps', () => {
  beforeEach(() => localStorage.clear());

  it('saving a session stamps it', () => {
    const s = reducer(base, saveToTabContainerInternal(group('a')));
    expect(typeof s.tabGroups[0].lastModified).toBe('number');
  });

  it('editing a title restamps only that session', () => {
    let s = reducer(base, saveToTabContainerInternal(group('a')));
    s = reducer(s, saveToTabContainerInternal(group('b')));
    const before = s.tabGroups.map((g) => g.lastModified!);

    vi.spyOn(Date, 'now').mockReturnValue(9_999_999);
    s = reducer(s, updateTabGroupTitle({ tabGroupId: 'a', editableTitle: 'X' }));
    vi.restoreAllMocks();

    const a = s.tabGroups.find((g) => g.tabGroupId === 'a')!;
    const b = s.tabGroups.find((g) => g.tabGroupId === 'b')!;
    expect(a.lastModified).toBe(9_999_999);
    expect(b.lastModified).toBe(before[s.tabGroups.indexOf(b)] ?? b.lastModified);
    expect(b.lastModified).not.toBe(9_999_999);
  });

  it('SELECTION DOES NOT restamp a session', () => {
    let s = reducer(base, saveToTabContainerInternal(group('a')));
    s = reducer(s, saveToTabContainerInternal(group('b')));
    const before = s.tabGroups.map((g) => g.lastModified);

    vi.spyOn(Date, 'now').mockReturnValue(9_999_999);
    s = reducer(s, selectTabContainer('a'));
    vi.restoreAllMocks();

    expect(s.tabGroups.map((g) => g.lastModified)).toEqual(before);
  });
});

describe('tombstones', () => {
  beforeEach(() => localStorage.clear());

  it('deleting a session records a tombstone', () => {
    let s = reducer(base, saveToTabContainerInternal(group('a')));
    s = reducer(s, deleteTabContainerInternal('a'));
    expect(s.tabGroups).toEqual([]);
    expect(s.deletedTabGroups!.map((t) => t.tabGroupId)).toEqual(['a']);
  });

  it('does not duplicate a tombstone for the same id', () => {
    let s = reducer(base, saveToTabContainerInternal(group('a')));
    s = reducer(s, deleteTabContainerInternal('a'));
    s = reducer(s, saveToTabContainerInternal(group('a')));
    s = reducer(s, deleteTabContainerInternal('a'));
    expect(s.deletedTabGroups).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to confirm it fails**

Run: `npx vitest run src/tests/redux/tabContainerReducers.test.ts`
Expected: FAIL — no `lastModified` on groups, no `deletedTabGroups`, and the selection test fails only after Step 3 changes selection (before that it passes vacuously, since nothing stamps groups at all). Note which assertions fail so the revert check in Step 5 is meaningful.

- [ ] **Step 3: Implement**

Add two helpers near the top of the slice, above `tabContainerDataStateSlice`:

```ts
// Only content changes advance a session's timestamp. Selection must not:
// selectTabContainer already bumps the container-wide lastModified on every
// click and on every search keystroke, and letting that reach per-session
// timestamps would make browsing on one device outrank a real edit on another.
function touch(group: tabContainerData): void {
  group.lastModified = Date.now();
}

function bury(state: TabMasterContainer, tabGroupId: string): void {
  const graves = (state.deletedTabGroups ??= []);
  const existing = graves.find((g) => g.tabGroupId === tabGroupId);
  if (existing) {
    existing.deletedAt = Date.now();
  } else {
    graves.push({ tabGroupId, deletedAt: Date.now() });
  }
}
```

Then, inside the slice:

- `saveToTabContainerInternal`: after `state.tabGroups.unshift(action.payload)`, add `touch(state.tabGroups[0]);`
- `addCurrWindowToTabGroupInternal`, `addCurrTabToWindowInternal`, `updateTabGroupTitle`, `updateWindowGroupTitle`: inside the `if (tabGroupIndex !== -1)` block, add `touch(state.tabGroups[tabGroupIndex]);` as the last statement.
- `deleteTabContainerInternal`: inside `if (tabGroupIndex !== -1)`, call `bury(state, toBeDeletedTabGroupId);` **before** `state.tabGroups.splice(tabGroupIndex, 1);`
- `deleteWindowInternal` and `deleteTabInternal`: where the group survives, `touch(state.tabGroups[tabGroupIndex]);`. On the cascade path where `windowCount === 0` and the group is spliced out, call `bury(state, state.tabGroups[tabGroupIndex].tabGroupId);` immediately before the splice.
- `selectTabContainer`: **unchanged**. Do not add `touch`.

- [ ] **Step 4: Run to verify**

Run: `npx vitest run src/tests/redux/tabContainerReducers.test.ts --reporter=verbose`
Expected: all passing.

- [ ] **Step 5: Revert and watch it fail**

Add `touch(state.tabGroups[i])` into `selectTabContainer` temporarily. The "SELECTION DOES NOT restamp" test must fail. Remove it.

- [ ] **Step 6: Full check and commit**

Run: `npx tsc --noEmit && npx vitest run && npm run lint`

```bash
git add -A
git commit -m "feat: reducers stamp sessions and record tombstones

Selection deliberately does not stamp: it already bumps the container
timestamp on every click and search keystroke, so letting it reach
per-session timestamps would let browsing outrank a real edit."
```

---

## Task 8: Wire the merge into the sync thunk

**Files:**
- Modify: `src/redux/slices/globalStateSlice.ts:95-133`
- Modify: `src/utils/constants/common.ts` — `TOAST_MESSAGES`
- Test: `src/tests/redux/syncMerge.test.ts` (create)

**Interfaces:**
- Consumes: `mergeTabContainers` (Tasks 5–6), `makeTestStore` (Task 1).
- Produces: `syncStateWithFirestore` merges instead of prompting. `TOAST_MESSAGES.SYNC_MERGED`.

- [ ] **Step 1: Add the toast message**

In `src/utils/constants/common.ts`, inside `TOAST_MESSAGES`:

```ts
  SYNC_MERGED: 'Synced changes from another device.',
```

Toast strings render through `t(toastText)` in `Toast.tsx:52`, but no existing `TOAST_MESSAGES` value appears in any locale file — they all fall through i18next's missing-key fallback to their literal English. Follow that; do not add a locale entry for this one alone.

- [ ] **Step 2: Write the failing test**

```ts
// src/tests/redux/syncMerge.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.hoisted(() => {
  const g = globalThis as any;
  g.window = g.window ?? globalThis;
  g.window.screen = { height: 1080, width: 1920 };
});

const mocks = vi.hoisted(() => ({
  loadFromFirestore: vi.fn(async (): Promise<any> => undefined),
  saveToFirestore: vi.fn(async () => undefined),
}));

vi.mock('../../utils/functions/external', () => ({
  loadFromFirestore: mocks.loadFromFirestore,
  saveToFirestore: mocks.saveToFirestore,
  displayToast: vi.fn(),
}));

import {
  setSignedIn,
  setUserId,
  syncStateWithFirestore,
} from '../../redux/slices/globalStateSlice';
import { makeTestStore } from '../setup/makeStore';
import type { TabMasterContainer } from '../../redux/slices/tabContainerDataStateSlice';

function group(id: string, lastModified: number) {
  return {
    tabGroupId: id,
    title: id,
    createdTime: '2026-08-31 00:00:00',
    windowCount: 1,
    tabCount: 1,
    isAutoSave: false,
    isSelected: false,
    lastModified,
    windows: [
      {
        windowId: `w-${id}`,
        windowHeight: 100,
        windowWidth: 100,
        windowOffsetTop: 0,
        windowOffsetLeft: 0,
        tabCount: 1,
        title: 't',
        tabs: [{ tabId: `t-${id}`, favicon: '', title: 't', url: 'https://a.co' }],
      },
    ],
  };
}

async function runSync(local: TabMasterContainer, cloud: TabMasterContainer) {
  localStorage.setItem('tabContainerData', JSON.stringify(local));
  mocks.loadFromFirestore.mockResolvedValue(cloud);
  const { store, seen } = makeTestStore();
  store.dispatch(setSignedIn());
  store.dispatch(setUserId('u1'));
  seen.length = 0;
  mocks.saveToFirestore.mockClear();
  await store.dispatch(syncStateWithFirestore() as never);
  return { store, seen };
}

describe('sync merges instead of prompting', () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.loadFromFirestore.mockReset();
    mocks.saveToFirestore.mockReset().mockResolvedValue(undefined);
  });

  it('unions both sides - neither is discarded', async () => {
    const { store } = await runSync(
      { lastModified: 10, selectedTabGroupId: 'a', tabGroups: [group('a', 10)] },
      { lastModified: 20, selectedTabGroupId: 'b', tabGroups: [group('b', 20)] }
    );
    expect(
      store.getState().tabContainerDataState.tabGroups.map((g) => g.tabGroupId).sort()
    ).toEqual(['a', 'b']);
  });

  it('never opens a conflict modal - the state is gone', async () => {
    const { store } = await runSync(
      { lastModified: 10, selectedTabGroupId: 'a', tabGroups: [group('a', 10)] },
      { lastModified: 20, selectedTabGroupId: 'b', tabGroups: [group('b', 20)] }
    );
    expect('isConflictModalOpen' in store.getState().globalState).toBe(false);
  });

  it('writes to Firestore when local contributed something', async () => {
    await runSync(
      { lastModified: 10, selectedTabGroupId: 'a', tabGroups: [group('a', 10)] },
      { lastModified: 20, selectedTabGroupId: 'b', tabGroups: [group('b', 20)] }
    );
    expect(mocks.saveToFirestore).toHaveBeenCalled();
  });

  it('does NOT write when the two sides already agree', async () => {
    const same = (): TabMasterContainer => ({
      lastModified: 10,
      selectedTabGroupId: 'a',
      tabGroups: [group('a', 10)],
      deletedTabGroups: [],
    });
    await runSync(same(), same());
    expect(mocks.saveToFirestore).not.toHaveBeenCalled();
  });

  it('a deletion on this device survives a sync with a stale cloud', async () => {
    const { store } = await runSync(
      {
        lastModified: 90,
        selectedTabGroupId: null,
        tabGroups: [],
        deletedTabGroups: [{ tabGroupId: 'a', deletedAt: 90 }],
      },
      { lastModified: 50, selectedTabGroupId: 'a', tabGroups: [group('a', 50)] }
    );
    expect(store.getState().tabContainerDataState.tabGroups).toEqual([]);
  });
});
```

- [ ] **Step 3: Run to confirm it fails**

Run: `npx vitest run src/tests/redux/syncMerge.test.ts`
Expected: FAIL — the union test fails (one side is discarded) and the modal test fails (`isConflictModalOpen` still exists).

- [ ] **Step 4: Implement**

Replace `globalStateSlice.ts:95-133` (the `if (tabDataFromCloud && tabDataFromLocalStorage)` block through its `else` for the no-conflict case) with:

```ts
    if (tabDataFromCloud && tabDataFromLocalStorage) {
      // Both sides hold data. Merge per session rather than making the user
      // discard one side: the old prompt only appeared when the cloud was
      // newer, while a newer local silently overwrote the cloud, so a whole
      // side was already being dropped without asking in one direction.
      const { merged, changedFromLocal, changedFromCloud } = mergeTabContainers(
        tabDataFromLocalStorage,
        tabDataFromCloud,
        Date.now()
      );

      thunkAPI.dispatch(replaceState(merged));

      if (changedFromCloud) {
        thunkAPI.dispatch(setIsDirty());
        thunkAPI.dispatch(saveToFirestoreIfDirty());
      } else {
        thunkAPI.dispatch(setIsNotDirty());
      }

      if (changedFromLocal) {
        thunkAPI.dispatch(
          showToast({ toastText: TOAST_MESSAGES.SYNC_MERGED, duration: 3000 })
        );
      }

      if (!state.globalState.hasSyncedBefore) {
        thunkAPI.dispatch(
          setPresentStartup({ tabContainerDataState: merged })
        );
      }
      thunkAPI.dispatch(setHasSyncedBefore());
    } else if (tabDataFromCloud) {
```

Add imports: `mergeTabContainers` from `../../utils/functions/mergeTabData`, and `TOAST_MESSAGES` from `../../utils/constants/common`.

- [ ] **Step 5: Run to verify**

Run: `npx vitest run src/tests/redux/syncMerge.test.ts --reporter=verbose`
Expected: the union, write, no-write and deletion tests pass. The "modal state is gone" test still fails — that state is removed in Task 9.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: merge on sync instead of prompting (KAN-32)

Both sides are now unioned per session. The write fires only when the
merged result differs from the cloud, so a converged pair of devices
produces no commits."
```

---

## Task 9: Delete the conflict modal

**Files:**
- Delete: `src/components/modals/ConflictModal.tsx`
- Modify: `src/redux/slices/globalStateSlice.ts` — lines 16-19, 32, 34-35, 49, 51-52, 210-218, 320-321
- Modify: `src/components/MainContainer.tsx:145` and its import
- Modify: `public/locales/{de,en,es,fr,hi,it,ja,pt,ru,zh}/translation.json`

**Interfaces:**
- Consumes: Task 8's merge branch (nothing dispatches `openConflictModal` any more).
- Produces: `Global` no longer has `isConflictModalOpen`, `tabDataLocal`, `tabDataCloud`.

- [ ] **Step 1: Confirm nothing still references the modal**

Run:
```bash
grep -rn "ConflictModal\|isConflictModalOpen\|tabDataLocal\|tabDataCloud\|openConflictModal\|closeConflictModal" src/
```
Expected before edits: hits only in `ConflictModal.tsx`, `globalStateSlice.ts`, `MainContainer.tsx`, and `src/tests/redux/syncMerge.test.ts`.

- [ ] **Step 2: Delete the component and its render site**

```bash
git rm src/components/modals/ConflictModal.tsx
```

In `MainContainer.tsx`, remove the `ConflictModal` import, the `isConflictModalOpen` selector, and the `{isConflictModalOpen && <ConflictModal />}` line at 145.

- [ ] **Step 3: Delete the Redux state**

In `globalStateSlice.ts` remove: the `ConflictModalPayload` interface (16-19); `isConflictModalOpen`, `tabDataLocal`, `tabDataCloud` from `Global` (32, 34-35) and from `initialState` (49, 51-52); the `openConflictModal` and `closeConflictModal` reducers (210-218); and both names from the `export const { ... }` block (320-321).

- [ ] **Step 4: Remove the eight locale keys**

For each of the 10 locale files, remove these keys — verified as referenced only by the deleted component:

`Local Data`, `Cloud Data`, `LATEST`, `Last updated`, `Saved sessions`, `Saved session` (all ten files), plus `SyncConflictHeader`, `SyncConflictDismissLabel` (`en` only).

After editing, confirm every file is still valid JSON:

```bash
for f in public/locales/*/translation.json; do
  node -e "JSON.parse(require('fs').readFileSync('$f','utf8'))" || echo "INVALID: $f"
done
```
Expected: no output.

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit && npx vitest run && npm run lint`
Expected: tsc clean, **all** tests pass including "never opens a conflict modal", lint 0 errors.

Then confirm the grep from Step 1 returns hits only in the test file.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: delete the sync conflict modal (KAN-32)

The prompt is replaced by the automatic merge. Removes the component,
its Redux state and reducers, its render site, and the eight i18n keys
that were exclusive to it."
```

---

## Task 10: Guard against the DOM dependency creeping back

The merge module's purity is the reason the matrix is unit-testable at all. Nothing currently stops a future edit from turning `import type` into a value import.

**Files:**
- Create: `src/tests/utils/functions/mergePurity.test.ts`

- [ ] **Step 1: Write the test**

```ts
// src/tests/utils/functions/mergePurity.test.ts
// mergeTabData.ts must not pull in the Redux slice, which transitively reads
// window.screen.height at module load (src/utils/constants/common.ts:19). This
// file deliberately installs NO DOM stub - if the import below starts
// requiring one, this test fails and that is the signal.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { mergeTabContainers } from '../../../utils/functions/mergeTabData';

describe('mergeTabData purity', () => {
  it('imports with no DOM present', () => {
    expect(typeof mergeTabContainers).toBe('function');
  });

  it('imports slice types with `import type`, not a value import', () => {
    const src = readFileSync('src/utils/functions/mergeTabData.ts', 'utf8');
    const sliceImports = src
      .split('\n')
      .filter((l) => l.includes('tabContainerDataStateSlice'));
    expect(sliceImports.length).toBeGreaterThan(0);
    for (const line of sliceImports) {
      expect(line).toMatch(/^import type|^} from|^\s/);
    }
    expect(src).not.toMatch(/^import \{[^}]*\} from '.*tabContainerDataStateSlice'/m);
  });
});
```

- [ ] **Step 2: Run to verify it passes**

Run: `npx vitest run src/tests/utils/functions/mergePurity.test.ts --reporter=verbose`
Expected: 2 passed.

- [ ] **Step 3: Revert and watch it fail**

Change `import type {` to `import {` in `mergeTabData.ts`. Re-run — the second test must fail, and depending on module ordering the first may throw `ReferenceError: window is not defined`. Restore.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "test: lock mergeTabData's freedom from the DOM"
```

---

## Task 11: End-to-end verification in Chrome

Unit and store-level tests prove the merge and the wiring. This proves the real artifact.

**Files:** none — verification only.

- [ ] **Step 1: Build what actually ships**

```bash
npm run build
INDEX_FILE=$(find ./dist/assets -name 'index-*.js')
sed -i '' -e 's|https://apis\.google\.com/js/api\.js[^`"]*||g' \
          -e 's|https://www\.google\.com/recaptcha/[^`"]*||g' "$INDEX_FILE"
```

(BSD `sed` for macOS; CI uses GNU `sed -i` with no argument.)

- [ ] **Step 2: Load and open the popup as a tab**

`install_extension` with the absolute path to `dist/`. If it errors with "Target closed", call `list_pages` once and retry. Then open `chrome-extension://<id>/index.html` as a normal page — the real popup closes when focus moves and `evaluate_script` then fails.

- [ ] **Step 3: Run the matrix**

For each case: save sessions, let the sync settle, then rewrite `localStorage.tabContainerData` to stage the second device and reload.

- [ ] Session added on device A only → appears alongside B's, neither lost
- [ ] Deleted on A while edited on B → later timestamp wins; verify both orderings
- [ ] Same session edited on both sides → cloud wins the tie, no modal
- [ ] Empty local, populated cloud → cloud restored intact
- [ ] Populated local, empty cloud → local pushed up
- [ ] Pre-migration document (strip `lastModified` from every group and remove `deletedTabGroups` from the Firestore copy) → merges without error, sessions preserved
- [ ] Deletion survives a full round trip — reload twice, session stays gone

To prove a read really came from Firestore, clear `localStorage` and reload.

- [ ] **Step 4: Confirm the modal is unreachable**

Stage the old cloud-newer conflict. Expected: sessions merge, a toast appears, no dialog. Check the console for errors.

- [ ] **Step 5: Record the evidence**

Write down which cases passed with what was observed. **State plainly which could not be tested.** Known limit: a genuinely concurrent two-device race cannot be reproduced — staging via localStorage exercises the same code path but not real wall-clock simultaneity.

- [ ] **Step 6: Open PR two**

Title: `Replace the sync conflict prompt with automatic per-session merge (KAN-32)`.

Body must be written from what the change does, not from a summary prompt, and must include: the asymmetry evidence that justifies deleting the modal rather than keeping it as a fallback; the tie-breaking rule and why cloud wins; the tombstone TTL and its resurrection tradeoff; the one-time session reorder users will see; and the E2E results including what was not tested.

Do **not** clear `pending-release` on any ticket — that happens only when a build reaches users.

---

## Self-Review

**Spec coverage:** §2 sequencing → Tasks 1–3, gated by Step 7. §3 data model → Task 4. §4 merge → Tasks 5–6 (flags defined in Task 5's implementation comments; GC in Task 6). §5 reducers → Task 7, including the explicit "selection must not stamp" test. §6 sync branch and toast → Task 8. §7 deletions → Task 9, all eight keys and ten locale files named. §8 testing → Tasks 5, 6, 8, 10, 11 across all three levels; the `import type` constraint gets its own regression test in Task 10. §9 constraints → Global Constraints. §10 out of scope → not implemented, correctly.

**Placeholder scan:** no TBD/TODO. Every code step carries real code. The two steps with a judgement call (Task 1 Step 3's `require`-in-`hoisted`, Task 5 Step 5's `?raw-check`) state the fallback explicitly rather than leaving it open.

**Type consistency:** `mergeTabContainers(local, cloud, now)` returns `MergeResult { merged, changedFromLocal, changedFromCloud }` in Tasks 5, 6 and 8 alike. `TOMBSTONE_TTL_MS` / `TOMBSTONE_MAX` named identically in Task 6's tests, implementation and comments. `deletedTabGroup { tabGroupId, deletedAt }` matches across Tasks 4, 6 and 7. `touch` / `bury` used only within Task 7. `makeTestStore()` returns `{ store, seen }` in Task 1 and is destructured that way in Tasks 3 and 8.

**One known rough edge:** Task 7 Step 2 notes that the selection test passes vacuously before the implementation exists. The revert check in Step 5 is what makes it meaningful — do not skip it.
