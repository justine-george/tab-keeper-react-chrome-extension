import {
  createAsyncThunk,
  createSlice,
  PayloadAction,
  type AsyncThunkConfig,
  type GetThunkAPI,
  type ThunkAction,
  type UnknownAction,
} from '@reduxjs/toolkit';

import { AppDispatch, RootState } from '../store';
import { resetHistory, setPresentStartup } from './undoRedoSlice';
import { isDragHeld, whenDragReleases } from '../dragHold';
import { selectCategory, SettingsCategory } from './settingsCategoryStateSlice';
import {
  mergeSessionsFromBackupInternal,
  replaceState,
  restoreContainer,
  selectTabContainer,
  TabMasterContainer,
} from './tabContainerDataStateSlice';
import {
  deleteFromFirestore,
  ensureCloudSessionReady,
  loadFromFirestore,
  saveToFirestore,
} from '../../utils/functions/external';
import {
  bytesToMB,
  estimateFirestoreBytes,
  FIRESTORE_MAX_DOCUMENT_BYTES,
  isValidTabMasterContainer,
  loadFromLocalStorage,
  saveToLocalStorage,
  SYNC_SIZE_REFUSAL,
  TranslatableError,
} from '../../utils/functions/local';
import { mergeTabContainers } from '../../utils/functions/mergeTabData';
import { withOwnSelection } from '../../utils/functions/withOwnSelection';
import { TOAST_MESSAGES } from '../../utils/constants/common';
import { TAB_CONTAINER_SLICE_NAME } from '../../utils/constants/actionTypes';
import {
  recordSyncedNow,
  recordValueMoment,
  setAutoSync,
} from './settingsDataStateSlice';

export interface Global {
  hasSyncedBefore: boolean;
  // KAN-294. The sessions in this store are still the slice's placeholder:
  // the empty initial container, which nothing has loaded, taken in, edited,
  // or confirmed. Its null selection is no one's choice, so while this holds
  // the next load keeps its source's selection; after, every load keeps this
  // page's own (loadSessionsIntoPage).
  //
  // Any tabContainerDataState action ends it -- a load (replaceState), another
  // page's sessions taken in (hydrateFromOtherPage), or this page's own edit
  // -- and so does a sync that finds no sessions anywhere, which loads
  // nothing but settles that empty IS this page's state. Page-local like the
  // rest of this slice: never written to localStorage, never synced, never
  // in undo.
  holdsPlaceholderSessions: boolean;
  // "a usable document id exists in chrome.storage.sync". A LOCAL read: no
  // network, no authentication. This app has no accounts - sync identity is a
  // client uuid - so "signed in" genuinely means "has a sync identity", and it
  // is what the settings pane renders LoggedIn/NotLoggedIn from.
  //
  // It is NOT permission to call Firestore. See isFirebaseAuthed (KAN-70).
  isSignedIn: boolean;
  // "Firebase anonymous auth has landed", i.e. request.auth is non-null and the
  // security rules will accept a request. Written ONLY by onAuthStateChanged.
  //
  // Separate from isSignedIn because the two resolve at different times: the
  // chrome.storage.sync read returns in milliseconds, the sign-in is a network
  // round trip. Gating on isSignedIn alone opened the gate ~500ms early and
  // every request in that window was denied by the rules.
  isFirebaseAuthed: boolean;
  // "This build was given a cloud to talk to" (config/firebase.ts, KAN-147).
  // Constant for the life of the popup; it is in the store so the sync status
  // card can derive from state alone and tests can set it, rather than the
  // card importing config/firebase.ts and every test inheriting whatever
  // .env the machine happens to have (KAN-248). App.tsx writes it at boot.
  isCloudConfigured: boolean;
  userId: string | null;
  isDirty: boolean;
  isSettingsPage: boolean;
  isSearchPanel: boolean;
  searchInputText: string;
  syncStatus: 'idle' | 'loading' | 'success' | 'error';
  isToastOpen: boolean;
  // An i18n KEY, not a display string -- Toast renders t(toastText). Every
  // fixed message in TOAST_MESSAGES is an English sentence used as its own
  // key, which is why that reads as if it were already the text.
  toastText: string;
  // Interpolation values for the key above, when it takes any (KAN-86).
  //
  // This exists because a toast built by string concatenation can never be
  // translated: the composed result matches no key, so t() hands it straight
  // back and the user sees English whatever their language. Slices dispatch a
  // key plus its values and Toast does the interpolation, which keeps the
  // existing division of labour -- nothing outside the component tree calls
  // t(), because nothing outside it has a `t` to call.
  toastParams?: Record<string, string | number>;
  isRateAndReviewModalOpen: boolean;
  // KAN-74. How many live tab groups the "turn on tab group support?" offer is
  // about, or null when the offer is not showing. One field rather than an
  // open flag beside a count, so an open prompt without a count is
  // unrepresentable -- the same shape, and for the same reason, as
  // focusRequest below.
  //
  // Session-only, like every other flag here: whether the offer is SHOWING is
  // a fact about this popup, while whether it may be shown AGAIN is persisted
  // in settingsData.
  tabGroupsPromptCount: number | null;
  focusRequest: FocusRequest | null;
  // KAN-254. The "Delete cloud data" confirm dialog.
  isDeleteCloudDataModalOpen: boolean;
  // KAN-252. A backup that has been read and validated but not yet applied:
  // the "Replace your saved sessions?" dialog is open exactly while this is
  // set. Session-only, like the other dialog flags.
  pendingImport: PendingImport | null;
  // KAN-259. The cloud question, and which wording: 'welcome' for a fresh
  // install, 'existing' for a user whose sessions are already synced.
  isCloudConsentModalOpen: boolean;
  cloudConsentVariant: CloudConsentVariant;
  cloudConsentThen: CloudConsentThen | null;
  // "the tabGroups permission is granted right now". Mirrors
  // chrome.permissions.contains(), re-read on every popup mount and updated by
  // the permission change listeners -- never persisted, because the user can
  // revoke it from chrome://extensions while the extension is not running.
  hasTabGroupsPermission: boolean;
  // Which windows of the selected session are folded shut in the right pane,
  // and which session they belong to (KAN-206). Null when nothing is folded.
  //
  // Session-only, like every other flag here, and that is a requirement rather
  // than a convention: this is a view preference, so it must never reach
  // Firestore and must never land on the undo stack. Both follow from living
  // in globalState -- customMiddleware captures undo only when
  // tabContainerDataState changes identity, and syncs only on setIsDirty.
  //
  // PAIRED WITH ITS SESSION rather than a bare windowId list. Naming the owner
  // is what lets a reader ask "is this set about the session in front of me?",
  // and what lets the selectTabContainer case below tell a real session change
  // from re-selecting the one already open. Same shape and the same reason as
  // tabGroupsPromptCount above -- one field, so a folded set with no owner is
  // unrepresentable.
  //
  // THE PAIRING IS NOT THE RESET, and an earlier version of this comment
  // claimed it was. Ignoring a set that belongs to another session covers
  // leaving group-1 for group-3; it does nothing about coming BACK to group-1,
  // where the set still names the session on screen and folds it on arrival.
  // Forgetting on a session change is a separate act, and it lives in
  // extraReducers below.
  //
  // Both halves together replace a reset that used to be free:
  // WindowEntryContainer held its own useState(true) and
  // TabGroupDetailsContainer keys each window by windowId, so switching
  // sessions remounted every row and re-ran it.
  collapsedWindows: CollapsedWindows | null;
  // KAN-269. One sync at a time. How many of the two cloud thunks (the sync
  // and its write) are running, and whether a sync was asked for meanwhile.
  // The sync's own write is dispatched, not awaited, so it outlives the sync
  // thunk -- counting both is what keeps a second sync out until the write
  // lands. Session-only, like every flag here.
  syncsInFlight: number;
  isSyncQueued: boolean;
}

// The windows folded shut in one session. `windowIds` may hold ids that the
// session no longer has -- deleting a folded window leaves its id behind -- and
// that is harmless: every reader asks whether a window it is rendering is in
// the set, never the other way round.
export interface CollapsedWindows {
  tabGroupId: string;
  windowIds: string[];
}

/**
 * Which of `tabGroupId`'s windows are folded shut -- empty for any session that
 * does not own the recorded set (KAN-206).
 *
 * Answers empty for a set belonging to a different session. That is HALF of
 * "collapse resets when you switch sessions" -- the half that stops one
 * session's folds being read as another's. The other half, forgetting the set
 * when the selection moves, is the selectTabContainer case in extraReducers;
 * without it, returning to a folded session finds its own set still recorded.
 *
 * One function rather than the same conditional in both components. The header
 * decides what the control offers and each window decides whether to draw its
 * tabs; those are two readings of one fact, and two copies of a rule eventually
 * disagree about it.
 *
 * Callers pass this through a selector returning a BOOLEAN, not the array --
 * the empty case is a fresh [] on every call, and handing that straight to
 * useSelector would report a new result every render.
 *
 * Takes the recorded set, not the whole Global. Both call sites have the set
 * and only one of them has a Global to offer, so the wider parameter would be
 * a parameter one caller has to fake.
 */
export const collapsedWindowIdsOf = (
  collapsed: CollapsedWindows | null,
  tabGroupId: string
): string[] =>
  collapsed?.tabGroupId === tabGroupId ? collapsed.windowIds : [];

// The session a pending "switch to this session?" confirmation is about, how
// many windows it would close, and whether closing them would save anything
// first -- it does not when those windows are already stored as a session, and
// the dialog has to say which of the two is about to happen. Null when no
// confirmation is open, so the fields can never disagree about whether there
// is something to confirm.
// 'welcome': a fresh install's first open. 'existing': a synced user's first
// open after the update. 'enable': a user who declined, or never answered,
// and is now asking for the cloud -- the sync button or the Auto Sync toggle
// -- so the question is asked plainly, not as a greeting (KAN-259).
export type CloudConsentVariant = 'welcome' | 'existing' | 'enable';

// What a yes to the 'enable' question does afterwards (KAN-259). 'syncNow'
// is the cloud button: one sync, Auto Sync left as it was -- the user asked
// for a sync, not a setting. 'autoSync' is the Auto Sync toggle: turn it on.
export type CloudConsentThen = 'syncNow' | 'autoSync';

export interface CloudConsentRequest {
  variant: CloudConsentVariant;
  then?: CloudConsentThen;
}

export interface FocusRequest {
  tabGroupId: string;
  windowCount: number;
  willSave: boolean;
}

// KAN-252. A backup read from disk, waiting on the user's answer. The file
// name is what the dialog shows; the container is what Replace applies.
export interface PendingImport {
  container: TabMasterContainer;
  fileName: string;
}

export const initialState: Global = {
  hasSyncedBefore: false,
  holdsPlaceholderSessions: true,
  isSignedIn: false,
  isFirebaseAuthed: false,
  isCloudConfigured: false,
  userId: null,
  isDirty: false,
  isSettingsPage: false,
  isSearchPanel: false,
  searchInputText: '',
  syncStatus: 'idle',
  isToastOpen: false,
  toastText: '',
  isRateAndReviewModalOpen: false,
  tabGroupsPromptCount: null,
  focusRequest: null,
  isDeleteCloudDataModalOpen: false,
  pendingImport: null,
  isCloudConsentModalOpen: false,
  cloudConsentVariant: 'welcome',
  cloudConsentThen: null,
  hasTabGroupsPermission: false,
  collapsedWindows: null,
  syncsInFlight: 0,
  isSyncQueued: false,
};

// save data to Firestore if dirty, saves latest to localStorage at the end
export const saveToFirestoreIfDirty = createAsyncThunk(
  'global/saveToFirestoreIfDirty',
  async (_, thunkAPI) => {
    const state = thunkAPI.getState() as RootState;

    try {
      if (state.globalState.isDirty) {
        // Firestore rejects an over-limit document, and the rejection leaves
        // isDirty set, so every later change retries the same doomed write and
        // sync wedges with nothing on screen to explain it. readImportedContainer
        // already refuses this on the import path; this is the same refusal on
        // the sync path, phrased the same way.
        const bytes = estimateFirestoreBytes(state.tabContainerDataState);
        if (bytes > FIRESTORE_MAX_DOCUMENT_BYTES) {
          // A key plus its values, not a composed sentence: this used to be
          // built by concatenation, which matched no key and so reached every
          // locale in English (KAN-86). The numbers travel as params and Toast
          // interpolates them.
          const params = {
            used: bytesToMB(bytes, state.settingsDataState.language),
            limit: bytesToMB(
              FIRESTORE_MAX_DOCUMENT_BYTES,
              state.settingsDataState.language
            ),
          };
          thunkAPI.dispatch(
            showToast({
              toastText: SYNC_SIZE_REFUSAL,
              toastParams: params,
              duration: 6000,
            })
          );
          // The rejection reason stays the key. Nothing renders it -- the
          // toast above is the whole user-facing report -- and it is what the
          // requestStatus consumers already treat as opaque.
          throw new TranslatableError(SYNC_SIZE_REFUSAL, params);
        }

        await saveToFirestore(
          state.globalState.userId!,
          state.tabContainerDataState
        );
        // Save to localStorage after successful Firestore update. The CURRENT
        // state, not `state` from before the await (KAN-291): an edit made
        // while the write was in flight has already persisted itself, and
        // writing the old copy put it back over that edit.
        saveToLocalStorage(
          'tabContainerData',
          (thunkAPI.getState() as RootState).tabContainerDataState
        );
        thunkAPI.dispatch(setIsNotDirty());
        // KAN-255. A write that landed is a completed sync -- the third of
        // the three success paths (the other two are in syncStateWithFirestore).
        thunkAPI.dispatch(recordSyncedNow());
      }
    } catch (error: any) {
      console.warn('Error updating Firestore: ', error.message);
      // Reject so the `saveToFirestoreIfDirty.rejected` case sets syncStatus to
      // 'error'. Catching here left the write silently failed while the UI
      // reported success.
      throw error;
    }
  }
);

// KAN-294. App's startup read of localStorage and each sync branch load a
// whole container into this page from localStorage or the cloud, and the
// selection there is whichever page or device wrote last. (The storage-event
// hydrate is the other route in; it applies withOwnSelection itself.)
// Selection is per page (KAN-279 D9), so a load over the placeholder takes
// the source's: a lone page must open on its stored selection exactly as
// before. Every other load keeps this page's own. Returns the container it
// loaded, for the caller to hand to any undo `present` it sets, so undo and
// the screen agree. Its replaceState ends the placeholder (extraReducers).
export const loadSessionsIntoPage =
  (
    loaded: TabMasterContainer
  ): ThunkAction<TabMasterContainer, RootState, unknown, UnknownAction> =>
  (dispatch, getState) => {
    const { globalState, tabContainerDataState } = getState();
    const next = globalState.holdsPlaceholderSessions
      ? loaded
      : withOwnSelection(loaded, tabContainerDataState.selectedTabGroupId);
    dispatch(replaceState(next));
    return next;
  };

// syncs data with Firestore
export const syncStateWithFirestore = createAsyncThunk<
  void,
  void,
  { state: RootState }
>(
  'global/syncStateWithFirestore',
  async (_, thunkAPI) => {
    const state = thunkAPI.getState();

    // load from Firestore
    const cloudCandidate = await loadFromFirestore(state.globalState.userId!);

    // The cloud side gets the same treatment localStorage gets below. Without
    // this, an unrecognised document reaches mergeTabContainers and throws
    // `side.tabGroups is not iterable`, rejecting the thunk with no message.
    //
    // Unreadable is deliberately NOT treated as absent. "Absent" falls through
    // to the local-only branch, which writes local state over the document -
    // and a document we failed to parse may be a NEWER FORMAT rather than
    // corruption, so overwriting would destroy data we merely could not read.
    // Stop instead: keep local data, leave the document untouched, report it.
    if (
      cloudCandidate !== undefined &&
      !isValidTabMasterContainer(cloudCandidate)
    ) {
      console.warn(
        'Unreadable Firestore document for this user; leaving it untouched.'
      );
      thunkAPI.dispatch(setSyncStatus('error'));
      // The glyph alone says "something is wrong" without saying what, or
      // whether the sessions on this device survived it (KAN-72).
      thunkAPI.dispatch(
        showToast({
          toastText: TOAST_MESSAGES.UNREADABLE_CLOUD_DOCUMENT,
          duration: 6000,
        })
      );
      return;
    }
    const tabDataFromCloud: TabMasterContainer | undefined = cloudCandidate;

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

      // KAN-279 D12. A row is held: applying this would move the list under
      // the pointer. It waits for the drop, and nothing is written meanwhile --
      // saveToFirestoreIfDirty would send the PRE-merge state, over the other
      // device's change. applyHeldCloudMerge re-syncs once it has applied.
      if (changedFromLocal && isDragHeld()) {
        whenDragReleases(() => thunkAPI.dispatch(applyHeldCloudMerge(merged)));
        return;
      }

      const loaded = thunkAPI.dispatch(loadSessionsIntoPage(merged));

      if (changedFromCloud) {
        thunkAPI.dispatch(setIsDirtyWithoutSync());
        // saveToFirestoreIfDirty's own fulfilled reducer reports the success.
        thunkAPI.dispatch(saveToFirestoreIfDirty());
      } else {
        // Nothing to write, which is the MOST in-sync a user can be and the
        // usual outcome of opening the popup. It has to say so: syncStatus is
        // what the header icon reads, and leaving it at the initial 'idle'
        // showed the actionable "sync now" icon on a session just confirmed up
        // to date (KAN-79).
        //
        // `setIsNotDirty` alone is not enough, and deriving the icon from
        // isDirty instead would not work either: globalState is rebuilt on
        // every popup open, so `isDirty === false` means "no edits yet this
        // session", not "the two sides agree". Only a completed sync knows
        // that, so only a completed sync may claim it.
        thunkAPI.dispatch(setIsNotDirty());
        thunkAPI.dispatch(setSyncStatus('success'));
        thunkAPI.dispatch(recordSyncedNow());
      }

      if (changedFromLocal) {
        thunkAPI.dispatch(
          showToast({ toastText: TOAST_MESSAGES.SYNC_MERGED, duration: 3000 })
        );

        // KAN-149. A value moment, but only when a SESSION arrived.
        //
        // `changedFromLocal` is deliberately not the test: it is also true for
        // a tombstone propagating, a rank settling, or a timestamp moving --
        // none of which the user can see, let alone be pleased by. "A session I
        // saved elsewhere is now here" is the one that demonstrates sync works,
        // and it is the only one worth spending a prompt on.
        const localIds = new Set(
          tabDataFromLocalStorage.tabGroups.map((group) => group.tabGroupId)
        );
        const arrived = merged.tabGroups.some(
          (group) => !localIds.has(group.tabGroupId)
        );
        if (arrived) thunkAPI.dispatch(recordValueMoment());
      }

      if (changedFromLocal) {
        // D12 (KAN-279). The merge brought in a change this page did not make;
        // an undo must never reverse it. The toast above names the moment.
        thunkAPI.dispatch(resetHistory({ tabContainerDataState: loaded }));
      } else if (!state.globalState.hasSyncedBefore) {
        // reset presentState in the undoRedoState
        thunkAPI.dispatch(setPresentStartup({ tabContainerDataState: loaded }));
      }
      thunkAPI.dispatch(setHasSyncedBefore());
    } else if (tabDataFromCloud) {
      // newly installed returning user - data present only on cloud
      const loaded = thunkAPI.dispatch(loadSessionsIntoPage(tabDataFromCloud));
      thunkAPI.dispatch(setIsNotDirty());
      thunkAPI.dispatch(setSyncStatus(`success`));
      thunkAPI.dispatch(recordSyncedNow());
      if (!state.globalState.hasSyncedBefore) {
        // reset presentState in the undoRedoState
        thunkAPI.dispatch(
          setPresentStartup({
            tabContainerDataState: loaded,
          })
        );
      }
      thunkAPI.dispatch(setHasSyncedBefore());
    } else if (tabDataFromLocalStorage) {
      // data only on localStorage
      // save back to Firestore
      const loaded = thunkAPI.dispatch(
        loadSessionsIntoPage(tabDataFromLocalStorage)
      );
      thunkAPI.dispatch(setIsDirtyWithoutSync());
      thunkAPI.dispatch(saveToFirestoreIfDirty());
      if (!state.globalState.hasSyncedBefore) {
        // reset presentState in the undoRedoState
        thunkAPI.dispatch(
          setPresentStartup({
            tabContainerDataState: loaded,
          })
        );
      }
      thunkAPI.dispatch(setHasSyncedBefore());
    } else {
      // new user - hey there!
      // KAN-294. Nothing to load, but the empty container is now this page's
      // real state, not a placeholder: a later load keeps its selection.
      thunkAPI.dispatch(endPlaceholderSessions());
      thunkAPI.dispatch(setIsDirtyWithoutSync());
      thunkAPI.dispatch(saveToFirestoreIfDirty());
      thunkAPI.dispatch(setHasSyncedBefore());
    }
  },
  {
    // KAN-269. A sync asked for while one (or its write) is running does not
    // start: it would read, merge and write over the running one. It is not
    // DROPPED either -- the request is often an edit the running sync never
    // saw -- so the rejection is dispatched and becomes isSyncQueued, and the
    // middleware runs one more sync when the count falls to zero.
    condition: (_, { getState }) => getState().globalState.syncsInFlight === 0,
    dispatchConditionRejection: true,
  }
);

// KAN-279 D12. Plain thunk, synchronous on purpose: dropOnTop applies this and
// then the drop in one tick, and the drop must land on the merged list.
// Merged with localStorage as it is NOW: another page may have written while
// the row was held, and the merge is what combines both without loss.
export const applyHeldCloudMerge =
  (
    merged: TabMasterContainer
  ): ThunkAction<void, RootState, unknown, UnknownAction> =>
  (dispatch, getState) => {
    const local = loadFromLocalStorage('tabContainerData');
    const combined = isValidTabMasterContainer(local)
      ? mergeTabContainers(local, merged, Date.now()).merged
      : merged;
    const loaded = dispatch(loadSessionsIntoPage(combined));
    dispatch(resetHistory({ tabContainerDataState: loaded }));
    dispatch(
      showToast({ toastText: TOAST_MESSAGES.SYNC_MERGED, duration: 3000 })
    );

    // KAN-149, mirrored from syncStateWithFirestore's both-sides branch: a
    // value moment only when a SESSION arrived, judged against what
    // localStorage held right before THIS merge -- not what the popup had
    // when the drag began, since another page may have written since.
    const localIds = new Set(
      isValidTabMasterContainer(local)
        ? local.tabGroups.map((group) => group.tabGroupId)
        : []
    );
    const arrived = combined.tabGroups.some(
      (group) => !localIds.has(group.tabGroupId)
    );
    if (arrived) dispatch(recordValueMoment());

    // KAN-290. The same gate drainQueuedSync (customMiddleware.ts) uses, not
    // cloudSyncAllowed: that also requires Auto Sync, but "Sync now" is a
    // manual sync that works with Auto Sync OFF, and a manual sync held by a
    // drag must still re-sync once released. A re-sync fired after the drop
    // must not run if sign-in or consent was withdrawn while the row was held.
    const { globalState, settingsDataState } = getState();
    if (
      globalState.isSignedIn &&
      globalState.isFirebaseAuthed &&
      settingsDataState.cloudConsent === 'granted'
    ) {
      dispatch(syncStateWithFirestore());
    } else {
      // The held run returned before it could settle syncStatus off
      // 'loading' (it deferred to this re-sync instead). With the gate
      // closed, that re-sync never happens, so nothing else will -- without
      // this the header's spinner sticks on 'loading' for good.
      dispatch(setSyncStatus('idle'));
    }
  };

// KAN-254. Deletes the document under the token and turns Auto Sync off on
// THIS device -- otherwise the next edit re-uploads everything and the delete
// was theatre. Local sessions are untouched, and so is the token: minting a
// fresh one would detach this device from the document but leave it standing.
// Other devices on the same profile will upload their copy again on their
// next sync unless auto sync is off there too; the dialog says so.
//
// On failure nothing changes but the toast: reporting "deleted" for a
// document that is still there is the one outcome worse than an error.
/**
 * A sync someone asked for: the header's Sync now and the consent dialog's
 * sync-once. It waits for the Firebase session first (KAN-266), because a
 * read before sign-in lands is denied and a denied read is not "no document".
 *
 * A failed sign-in ends here as a failed sync (KAN-289): the sync_problem
 * glyph and the "Last sync failed" card, and no read, since without
 * request.auth the rules would deny it anyway. The next click signs in again.
 */
export const syncNowWhenSignedIn =
  () =>
  async (dispatch: AppDispatch): Promise<void> => {
    try {
      await ensureCloudSessionReady(dispatch);
    } catch (error) {
      console.warn('Sync not started: sign-in failed:', error);
      dispatch(setSyncStatus('error'));
      return;
    }
    await dispatch(syncStateWithFirestore());
  };

export const deleteCloudData = createAsyncThunk(
  'global/deleteCloudData',
  async (_: void, thunkAPI) => {
    const { userId } = (thunkAPI.getState() as RootState).globalState;
    thunkAPI.dispatch(closeDeleteCloudDataModal());
    if (!userId) return;
    try {
      // KAN-259. The rules need request.auth; with lazy sign-in a user who
      // declined the cloud may never have signed in, so start the session
      // here and wait for it before the delete.
      await ensureCloudSessionReady(thunkAPI.dispatch as AppDispatch);
      await deleteFromFirestore(userId);
    } catch (error) {
      console.warn('deleteCloudData: delete failed:', error);
      thunkAPI.dispatch(
        showToast({ toastText: TOAST_MESSAGES.CLOUD_DATA_DELETE_FAILED })
      );
      return;
    }
    thunkAPI.dispatch(setAutoSync(false));
    thunkAPI.dispatch(setSyncStatus('idle'));
    thunkAPI.dispatch(
      showToast({ toastText: TOAST_MESSAGES.CLOUD_DATA_DELETED })
    );
  }
);

/**
 * The tail every answer to "Load sessions from a backup" shares (KAN-252,
 * KAN-261): mark dirty, write to the cloud only with Auto Sync on (KAN-257 --
 * off, the container stays dirty and the next manual sync carries it, like
 * any edit), and say how it went. The local change is done and persisted
 * before the write, so the toast reports the state of the WRITE --
 * requestStatus, not unwrap(): a rejection here is a sync problem, and "Error
 * restoring tabs" would be the one untrue thing to say.
 *
 * `changed` false means the load altered nothing (a merge with nothing new):
 * no dirty flag, so no cloud write of nothing, but the load itself went fine.
 */
async function finishBackupLoad(
  thunkAPI: Pick<GetThunkAPI<AsyncThunkConfig>, 'dispatch' | 'getState'>,
  changed: boolean
): Promise<void> {
  thunkAPI.dispatch(cancelReplaceSessions());
  let syncFailed = false;
  if (changed) {
    thunkAPI.dispatch(setIsDirty());
    const { isAutoSync } = (thunkAPI.getState() as RootState).settingsDataState;
    if (isAutoSync) {
      const saveResult = await thunkAPI.dispatch(saveToFirestoreIfDirty());
      syncFailed = saveResult.meta.requestStatus === 'rejected';
    }
  }
  thunkAPI.dispatch(
    showToast({
      toastText: syncFailed
        ? TOAST_MESSAGES.IMPORT_SYNC_FAILED
        : TOAST_MESSAGES.IMPORT_SUCCESS,
      duration: 3000,
    })
  );
}

/**
 * Replace: the backup in place of everything saved here (KAN-252). The step
 * that used to run straight from the file picker, now the dialog's Replace
 * -- or straight away when nothing is saved here to replace.
 *
 * restoreContainer, not replaceState: a backup written before a session was
 * deleted still contains it and carries no tombstone, but the cloud may hold
 * the one that delete pushed up. Replacing blind lets the next merge re-apply
 * the delete, so the import appears to work and then silently drops it.
 */
export const replaceSessionsFromBackup = createAsyncThunk(
  'global/replaceSessionsFromBackup',
  async (container: TabMasterContainer, thunkAPI) => {
    thunkAPI.dispatch(
      restoreContainer({ ...container, lastModified: Date.now() })
    );
    await finishBackupLoad(thunkAPI, true);
  }
);

/**
 * A backup has been read and validated; ask, or apply. With nothing saved
 * here the two answers would do the same thing, so it just applies
 * (KAN-252); otherwise the dialog asks Merge or Replace.
 *
 * KAN-265. A thunk, not a component-side branch, because the decision must
 * read the store at DISPATCH time. The component's copy of the container is
 * the render that handled the click, and the file lands seconds later when
 * the OS picker closes -- long enough for a fresh device's boot sync to bring
 * the other device's sessions in. The stale closure still saw nothing here,
 * Replaced without asking, and (KAN-262) buried every one of them cloud-wide.
 */
export const loadSessionsFromBackup = createAsyncThunk(
  'global/loadSessionsFromBackup',
  async (pending: PendingImport, thunkAPI) => {
    const { tabGroups } = (thunkAPI.getState() as RootState)
      .tabContainerDataState;
    if (tabGroups.length === 0) {
      await thunkAPI.dispatch(replaceSessionsFromBackup(pending.container));
    } else {
      thunkAPI.dispatch(askToReplaceSessions(pending));
    }
  }
);

/**
 * Merge: the backup's sessions that are not here yet, added on top of
 * everything saved here (KAN-261). The reducer holds the rules; this only
 * has to know whether it changed anything, which decides the dirty flag.
 */
export const mergeSessionsFromBackup = createAsyncThunk(
  'global/mergeSessionsFromBackup',
  async (container: TabMasterContainer, thunkAPI) => {
    const before = (thunkAPI.getState() as RootState).tabContainerDataState;
    thunkAPI.dispatch(mergeSessionsFromBackupInternal(container));
    const after = (thunkAPI.getState() as RootState).tabContainerDataState;
    await finishBackupLoad(thunkAPI, after !== before);
  }
);

export const openSettingsPage = createAsyncThunk(
  'global/openSettingsPage',
  async (settingsName: SettingsCategory | undefined, thunkAPI) => {
    if (settingsName) thunkAPI.dispatch(selectCategory(settingsName));
  }
);

interface ShowToastPayload {
  toastText: string;
  toastParams?: Record<string, string | number>;
  duration?: number;
}

let toastTimeout: null | ReturnType<typeof setTimeout> = null;
export const showToast = createAsyncThunk(
  'global/showToast',
  async (
    { toastText, toastParams, duration = 5000 }: ShowToastPayload,
    thunkAPI
  ) => {
    if (toastText) {
      // If there's an existing toast timeout, clear it
      if (toastTimeout !== null) {
        clearTimeout(toastTimeout);
        toastTimeout = null;
      }

      thunkAPI.dispatch(setToastText({ text: toastText, params: toastParams }));
      thunkAPI.dispatch(openToast());

      // Set the new timeout for the current toast
      toastTimeout = setTimeout(() => {
        thunkAPI.dispatch(closeToast());
      }, duration);
    }
  }
);

// Never below zero: a settle without a counted start would otherwise let the
// next real sync through while another runs.
function endCloudCall(state: Global): void {
  state.syncsInFlight = Math.max(0, state.syncsInFlight - 1);
}

function markDirty(state: Global): void {
  state.isDirty = true;
  state.syncStatus = 'idle';
}

export const globalStateSlice = createSlice({
  name: 'globalState',
  initialState,
  reducers: {
    openRateAndReviewModal: (state) => {
      state.isRateAndReviewModalOpen = true;
    },

    closeRateAndReviewModal: (state) => {
      state.isRateAndReviewModalOpen = false;
    },

    openTabGroupsPrompt: (state, action: PayloadAction<number>) => {
      state.tabGroupsPromptCount = action.payload;
    },

    closeTabGroupsPrompt: (state) => {
      state.tabGroupsPromptCount = null;
    },

    openFocusModal: (state, action: PayloadAction<FocusRequest>) => {
      state.focusRequest = action.payload;
    },

    closeFocusModal: (state) => {
      state.focusRequest = null;
    },

    openDeleteCloudDataModal: (state) => {
      state.isDeleteCloudDataModalOpen = true;
    },

    closeDeleteCloudDataModal: (state) => {
      state.isDeleteCloudDataModalOpen = false;
    },

    // KAN-252. Opens "Replace your saved sessions?" for a backup that has
    // already been read and validated. Cancel forgets it; Replace is the
    // replaceSessionsFromBackup thunk, which clears it on the way.
    askToReplaceSessions: (state, action: PayloadAction<PendingImport>) => {
      state.pendingImport = action.payload;
    },

    cancelReplaceSessions: (state) => {
      state.pendingImport = null;
    },

    openCloudConsentModal: (
      state,
      action: PayloadAction<CloudConsentRequest>
    ) => {
      state.isCloudConsentModalOpen = true;
      state.cloudConsentVariant = action.payload.variant;
      state.cloudConsentThen = action.payload.then ?? null;
    },

    closeCloudConsentModal: (state) => {
      state.isCloudConsentModalOpen = false;
    },

    openSearchPanel: (state) => {
      state.isSearchPanel = true;
    },

    closeSearchPanel: (state) => {
      state.isSearchPanel = false;
    },

    setSearchInputText: (state, action: PayloadAction<string>) => {
      state.searchInputText = action.payload;
    },

    openToast: (state) => {
      state.isToastOpen = true;
    },

    closeToast: (state) => {
      state.isToastOpen = false;
    },

    // params is overwritten on every toast, never merged: leaving a previous
    // toast's values behind would let a key silently interpolate numbers from
    // an unrelated message.
    setToastText: (
      state,
      action: PayloadAction<{
        text: string;
        params?: Record<string, string | number>;
      }>
    ) => {
      state.toastText = action.payload.text;
      state.toastParams = action.payload.params;
    },

    closeSettingsPage: (state) => {
      state.isSettingsPage = false;
    },

    setIsNotDirty: (state) => {
      state.isDirty = false;
    },

    // "The user changed something." customMiddleware watches for this action
    // and schedules a debounced sync, so it must only be dispatched from
    // outside a sync.
    setIsDirty: (state) => {
      markDirty(state);
    },

    // The same flag, deliberately a different action type.
    //
    // The three branches of syncStateWithFirestore that persist something all
    // need isDirty set, because that is what saveToFirestoreIfDirty checks -
    // but they run *inside* a sync. Dispatching setIsDirty there makes the
    // middleware schedule another full sync, so every write costs an extra
    // round trip, and any state the two sides keep disagreeing on becomes an
    // unbounded write loop.
    setIsDirtyWithoutSync: (state) => {
      markDirty(state);
    },

    setSignedIn: (state) => {
      state.isSignedIn = true;
    },

    // Dispatched only by observeAuthState. Deliberately does not touch
    // isSignedIn: conflating the two is the defect these exist to separate.
    setFirebaseAuthed: (state) => {
      state.isFirebaseAuthed = true;
    },

    setFirebaseUnauthed: (state) => {
      state.isFirebaseAuthed = false;
    },

    setCloudConfigured: (state, action: PayloadAction<boolean>) => {
      state.isCloudConfigured = action.payload;
    },

    setHasSyncedBefore: (state) => {
      state.hasSyncedBefore = true;
    },

    endPlaceholderSessions: (state) => {
      state.holdsPlaceholderSessions = false;
    },

    // KAN-269. The middleware takes the queued sync as it runs it, so a
    // second drain in the same tick finds nothing to run.
    takeQueuedSync: (state) => {
      state.isSyncQueued = false;
    },

    setLoggedOut: (state) => {
      state.isSignedIn = false;
      state.syncStatus = 'idle';
    },

    setSyncStatus: (
      state,
      action: PayloadAction<'idle' | 'loading' | 'success' | 'error'>
    ) => {
      state.syncStatus = action.payload;
    },

    setUserId: (state, action: PayloadAction<string>) => {
      state.userId = action.payload;
    },

    removeUserId: (state) => {
      state.userId = null;
    },

    replaceState: (state, action: PayloadAction<typeof state>) =>
      action.payload,

    setHasTabGroupsPermission: (state, action: PayloadAction<boolean>) => {
      state.hasTabGroupsPermission = action.payload;
    },

    // One window's chevron (KAN-206). Folding a window in a session other than
    // the one currently recorded DISCARDS the old set rather than merging into
    // it: the set names a single session, and two sessions' ids in one list is
    // the bare-list shape this deliberately avoids.
    //
    // Neither this nor setAllWindowsCollapsed calls markDirty, and that is the
    // whole of what keeps a fold out of Firestore and off the undo stack.
    // Adding markDirty here is the control for the test that says so.
    toggleWindowCollapse: (
      state,
      action: PayloadAction<{ tabGroupId: string; windowId: string }>
    ) => {
      const { tabGroupId, windowId } = action.payload;
      const current =
        state.collapsedWindows?.tabGroupId === tabGroupId
          ? state.collapsedWindows.windowIds
          : [];
      const next = current.includes(windowId)
        ? current.filter((id) => id !== windowId)
        : [...current, windowId];
      state.collapsedWindows = { tabGroupId, windowIds: next };
    },

    // The header control (KAN-206). The caller decides WHICH windows are
    // folded, because it is the one holding the session's window list; this
    // only records the answer. Passing [] is how "expand all" is said.
    setAllWindowsCollapsed: (
      state,
      action: PayloadAction<{ tabGroupId: string; windowIds: string[] }>
    ) => {
      state.collapsedWindows = action.payload;
    },
  },

  extraReducers: (builder) => {
    builder
      // KAN-206. Leaving a session forgets how it was folded.
      //
      // This is the half of the reset that the tabGroupId pairing does NOT
      // provide, and believing otherwise is the mistake this case exists to
      // correct. Pairing stops one session's folds reaching a DIFFERENT
      // session; it does nothing about returning to the same one, where the
      // recorded set still names the session on screen and folds it on arrival.
      // collapseAllWindows.test.tsx switches away AND BACK for that reason --
      // the intuitive "switch away and check the other session" passes without
      // this case.
      //
      // Guarded on the session actually CHANGING rather than clearing on every
      // selection, because selecting the session already open is reachable:
      // clicking its row in the left pane dispatches this with the id it
      // already holds (TabGroupEntryContainer:229). Unguarded, clicking the row
      // you are already reading would unfold everything you had just folded.
      //
      // NOT for the reason a first draft of this comment gave. It cited the
      // search effect re-selecting the first result on every keystroke, which
      // customMiddleware's viewStateOnlyActions note still describes -- but
      // that effect has since grown a guard of its own
      // (TabGroupEntryContainer:104) and keeps the selection when it is still
      // among the results, so it does not re-dispatch per keystroke.
      .addCase(selectTabContainer, (state, action) => {
        if (
          state.collapsedWindows &&
          state.collapsedWindows.tabGroupId !== action.payload
        ) {
          state.collapsedWindows = null;
        }
      })
      // KAN-263. A sync is read-then-write, and the header reads syncStatus.
      // Only the write's pending was wired, so for the whole cloud read the
      // status stayed where the last edit left it ('idle', via markDirty) and
      // the header offered "sync now" for a sync already running -- a live
      // button that starts a second, overlapping sync (KAN-264). The thunk
      // body sets every completion status itself; it cannot set the start.
      .addCase(syncStateWithFirestore.pending, (state) => {
        state.syncStatus = 'loading';
        state.syncsInFlight += 1;
      })
      .addCase(syncStateWithFirestore.fulfilled, (state) => {
        endCloudCall(state);
      })
      .addCase(syncStateWithFirestore.rejected, (state, action) => {
        // KAN-269. Postponed, not failed: the condition declined it because
        // another sync is running. It never started, so there is nothing to
        // count down and no failure to paint.
        if (action.meta.condition) {
          state.isSyncQueued = true;
          return;
        }
        endCloudCall(state);
        state.syncStatus = 'error';
      })
      .addCase(saveToFirestoreIfDirty.pending, (state) => {
        state.syncStatus = 'loading';
        state.syncsInFlight += 1;
      })
      .addCase(saveToFirestoreIfDirty.fulfilled, (state) => {
        endCloudCall(state);
        if (state.isSignedIn && !state.isDirty) {
          state.syncStatus = 'success';
        } else {
          state.syncStatus = 'idle';
        }
      })
      .addCase(saveToFirestoreIfDirty.rejected, (state) => {
        endCloudCall(state);
        state.syncStatus = 'error';
      })
      .addCase(openSettingsPage.fulfilled, (state) => {
        state.isSettingsPage = true;
      })
      .addCase(showToast.fulfilled, () => {})
      // KAN-294. Any action of the sessions slice means the store no longer
      // holds the placeholder: a load, another page's sessions taken in, or
      // this page's own edit. By prefix, because it is every reducer of that
      // slice, present and future; its thunks are 'global/...' and do not
      // match, but each ends in one of its reducers, which does.
      .addMatcher(
        (action: UnknownAction) =>
          action.type.startsWith(`${TAB_CONTAINER_SLICE_NAME}/`),
        (state) => {
          state.holdsPlaceholderSessions = false;
        }
      );
  },
});

export const {
  openRateAndReviewModal,
  closeRateAndReviewModal,
  openTabGroupsPrompt,
  closeTabGroupsPrompt,
  openFocusModal,
  closeFocusModal,
  openDeleteCloudDataModal,
  closeDeleteCloudDataModal,
  askToReplaceSessions,
  cancelReplaceSessions,
  openCloudConsentModal,
  closeCloudConsentModal,
  openSearchPanel,
  closeSearchPanel,
  setSearchInputText,
  openToast,
  closeToast,
  setToastText,
  closeSettingsPage,
  setIsDirty,
  setIsDirtyWithoutSync,
  setIsNotDirty,
  setSignedIn,
  setFirebaseAuthed,
  takeQueuedSync,
  setCloudConfigured,
  setFirebaseUnauthed,
  setHasSyncedBefore,
  endPlaceholderSessions,
  setLoggedOut,
  setSyncStatus,
  setUserId,
  removeUserId,
  setHasTabGroupsPermission,
  toggleWindowCollapse,
  setAllWindowsCollapsed,
} = globalStateSlice.actions;

export default globalStateSlice.reducer;
