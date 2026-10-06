import { createSlice, PayloadAction } from '@reduxjs/toolkit';

import {
  asDefaultView,
  type DefaultView,
} from '../../utils/functions/defaultView';
import {
  asFirstRun,
  asRunStep,
  nextWelcomeShows,
  type FirstRun,
  type RunEnding,
  type RunStep,
} from '../../utils/functions/firstRun';
import {
  asPartialSettings,
  loadFromLocalStorage,
  saveToLocalStorage,
} from '../../utils/functions/local';
// `import type`, so nothing is emitted: the generator imports this slice's
// tabContainerData type in the other direction, and a value edge either way
// would complete a cycle. Same reason as the RootState note in the container
// slice.
import type { ExportLayout } from '../../utils/functions/sessionExportHtml';
import {
  matchUiLanguage,
  readUiLanguage,
} from '../../utils/functions/uiLanguage';
// `import type`, same technique and same reason as the ExportLayout import
// above and the RootState note in the container slice: a value edge back to
// store.tsx (which combines this slice into storeConfig) would complete a
// cycle. RootState is used solely as a parameter type below, so the erased
// import leaves no runtime edge.
import type { RootState } from '../store';

export enum Theme {
  LIGHT = 'Light',
  WARM_LIGHT = 'WarmLight',
  BB_PINK = 'BBPink',
  DARKENHEIMER = 'Darkenheimer',
  BLUE = 'Blue',
}

export type CloudConsent = 'granted' | 'declined' | '';

// KAN-7. Where this machine is in the new-install setup.
export type SetupState = 'none' | 'pending' | 'done';

export enum Language {
  DE = 'de',
  EN = 'en',
  ES = 'es',
  FR = 'fr',
  HI = 'hi',
  IT = 'it',
  JA = 'ja',
  KO = 'ko',
  PT = 'pt',
  RU = 'ru',
  SV = 'sv',
  // Simplified. A BCP 47 tag, hyphenated, because the value goes straight to
  // Intl -- the manifest's zh_TW spelling throws there (KAN-283).
  ZH = 'zh',
  ZH_TW = 'zh-TW',
}

export interface SettingsData {
  theme: Theme;
  /**
   * Which layout an exported session uses (KAN-190). Chosen on the export
   * preview page rather than in Settings, because there the effect is visible.
   *
   * DEVICE-LOCAL, like everything else here: saveToFirestore sends
   * tabContainerData and nothing else.
   */
  exportLayout: ExportLayout;
  language: Language;
  isAutoSync: boolean;
  // KAN-410. '' never syncs and the welcome records 'declined', so only a yes uploads (see cloudSyncAllowed).
  cloudConsent: CloudConsent;
  extensionInstalledTime: number | '';
  isSkippedUserReviewOnce: boolean;
  isUserRatedAndReviewed: boolean;
  isNeverAskAgainToRate: boolean;
  lastReviewRequestTime: number | '';
  /**
   * When the extension last visibly paid off for this user -- a session
   * restored, a substantial save, sessions arriving from another device
   * (KAN-149). It is what the review prompt waits for, in place of the install
   * date it used to wait on.
   *
   * DEVICE-LOCAL, like everything else here: saveToFirestore sends
   * tabContainerData and nothing else, so this needs no merge rule and cannot
   * make one device's payoff into another device's prompt.
   */
  lastValueMomentTime: number | '';
  // KAN-255. When this device last completed a sync, ms since epoch; '' until
  // the first. Per device, like the rest of this slice: the other device's
  // last sync is its own fact.
  lastSyncedTime: number | '';
  // KAN-74. The tab-groups permission offer. Two flags and no timestamp: the
  // offer fires on every popup open that finds groups open, so there is
  // nothing to schedule -- only an escalating opt-out to remember.
  //
  // Neither flag mirrors whether the permission is GRANTED. That stays
  // hasTabGroupsPermission()'s job, so a user who grants and later revokes
  // from chrome://extensions -- the most explicit "no" available -- cannot be
  // re-armed into being asked again by a stale boolean.
  isTabGroupsPromptAnsweredOnce: boolean;
  isNeverAskAgainForTabGroups: boolean;
  /**
   * Which date the session rows show, and therefore which word labels it
   * (KAN-141). Set by the two date items in the sort menu, so the number on
   * the row always describes the order the list is in.
   *
   * It lives HERE, in device-local settings, rather than on the container.
   * `saveToFirestore` sends tabContainerData and nothing else, so a preference
   * kept here needs no merge rule -- the same reasoning that kept the sort mode
   * derived in KAN-130 and KAN-136 rather than stored.
   *
   * The consequence is accepted and documented: the ORDER syncs, through ranks,
   * and this does not. Sort by date saved here, open on another device, and
   * that device shows edited dates in created order until its own menu is
   * touched. Cosmetic, confined to the multi-device-plus-explicit-sort corner,
   * and cheaper than a container field with its own last-writer-wins rule.
   */
  sessionDateBasis: SessionDateBasis;
  /**
   * Whether the tab view opens with the saved session folded away, so Open
   * now takes its column (KAN-280 O4/O5). True until the fold button is
   * pressed, so a first open is folded. Only that button writes it: a peek
   * (globalState.isPeekingSavedSession) shows the session for now and leaves
   * this alone.
   *
   * DEVICE-LOCAL, like everything else here: saveToFirestore sends
   * tabContainerData and nothing else.
   */
  foldSavedSessionInTabView: boolean;
  /**
   * The width the user dragged Open now to (KAN-321 O1a), in CSS px, or null
   * for the O1 default. The STORED choice, not what is shown: the shown width
   * is clamped to the window's current limits at render (openNowWidth.ts),
   * so a window that narrows and widens again gets this back.
   *
   * DEVICE-LOCAL, like everything else here: saveToFirestore sends
   * tabContainerData and nothing else. Screens differ between devices.
   */
  openNowWidth: number | null;
  // KAN-7. 'pending' as the welcome opens, so a popup closed on it still gets setup.
  setupState: SetupState;
  // KAN-7 §4. Skip or ✕ on the pin guide; a pin does not set it.
  isPinGuideDismissed: boolean;
  // KAN-7 §6. Set when the full view mounts.
  hasOpenedFullView: boolean;
  // KAN-7 §6. Try it, ✕, Esc or ⤢ on the full-view callout.
  isFullViewCalloutSeen: boolean;
  // KAN-7 §7. Mirrored to chrome.storage.local for the service worker.
  defaultView: DefaultView;
  // The guided first run on this machine, running or ended; one per machine.
  firstRun: FirstRun | null;
  // Set when an upgrader's What's new Hello first shows; no later open starts one.
  isWhatsNew2Seen: boolean;
  // Settings → Sounds; on unless turned off, including for settings saved before it existed.
  isUiSoundOn: boolean;
}

/**
 * A stored Open now width, if it is one: a finite number above zero, rounded
 * to whole px. Anything else reads as null (the default). asPartialSettings
 * checks only that settingsData is an object, so without this a hand-edited or
 * corrupted value would reach the grid as `NaNpx`. Range is not checked here:
 * the limits depend on the window, which storage cannot know.
 */
export function asOpenNowWidth(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : null;
}

export type OnboardingSettings = Pick<
  SettingsData,
  | 'setupState'
  | 'isPinGuideDismissed'
  | 'hasOpenedFullView'
  | 'isFullViewCalloutSeen'
  | 'defaultView'
  | 'firstRun'
  | 'isWhatsNew2Seen'
>;

export const ONBOARDING_DEFAULTS: OnboardingSettings = {
  setupState: 'none',
  isPinGuideDismissed: false,
  hasOpenedFullView: false,
  isFullViewCalloutSeen: false,
  defaultView: 'compact',
  firstRun: null,
  isWhatsNew2Seen: false,
};

export function asSetupState(value: unknown): SetupState {
  return value === 'pending' || value === 'done' ? value : 'none';
}

const asFlag = (value: unknown): boolean => value === true;

/**
 * KAN-7. The onboarding fields of a stored settings object, each guarded: a
 * value of the wrong shape reads as the default, an absent one keeps
 * `fallback`'s (an older page wrote it, or nothing has been saved yet).
 */
export function guardOnboarding(
  stored: unknown,
  fallback: OnboardingSettings
): OnboardingSettings {
  const read = <K extends keyof OnboardingSettings>(
    key: K,
    guard: (value: unknown) => OnboardingSettings[K]
  ): OnboardingSettings[K] =>
    typeof stored === 'object' &&
    stored !== null &&
    !Array.isArray(stored) &&
    key in stored
      ? guard(Reflect.get(stored, key))
      : fallback[key];
  return {
    setupState: read('setupState', asSetupState),
    isPinGuideDismissed: read('isPinGuideDismissed', asFlag),
    hasOpenedFullView: read('hasOpenedFullView', asFlag),
    isFullViewCalloutSeen: read('isFullViewCalloutSeen', asFlag),
    defaultView: read('defaultView', asDefaultView),
    firstRun: read('firstRun', asFirstRun),
    isWhatsNew2Seen: read('isWhatsNew2Seen', asFlag),
  };
}

/**
 * `edited` is the default because it is what the list is ordered by when
 * nothing has been pinned.
 */
export type SessionDateBasis = 'edited' | 'created';

// Keys only unreleased builds wrote: dropped once, and settings written back without them.
const RETIRED_KEYS: readonly string[] = [
  'sampleTour',
  'isFullViewOfferAnswered',
];

const withoutRetiredKeys = (stored: unknown): unknown =>
  typeof stored === 'object' && stored !== null && !Array.isArray(stored)
    ? Object.fromEntries(
        Object.entries(stored).filter(([key]) => !RETIRED_KEYS.includes(key))
      )
    : stored;

const storedSettings = loadFromLocalStorage('settingsData');
const hasRetiredKeys =
  typeof storedSettings === 'object' &&
  storedSettings !== null &&
  RETIRED_KEYS.some((key) => key in storedSettings);
if (hasRetiredKeys) {
  saveToLocalStorage('settingsData', withoutRetiredKeys(storedSettings));
}

// Retrieve settings from localStorage
const settingsDataLocal = asPartialSettings<SettingsData>(
  withoutRetiredKeys(storedSettings)
);

export const SHIPPED_LANGUAGES = Object.values(Language);

/**
 * The language the popup opens in (KAN-282): the one saved here, else the
 * browser's UI language mapped onto one this build ships, else English.
 *
 * Every user who has ever changed any setting has `language` saved, because
 * each setting write persists the whole object -- so detection only ever
 * decides a first run, and never moves an existing user.
 *
 * A saved value this build does not ship counts as nothing saved rather than
 * being handed to i18next, which would fetch a locale file that does not exist
 * (#42). The quote strip predates this: #42's `i18nextLng` key was JSON-quoted.
 */
export function startupLanguage(stored: unknown, uiTag: unknown): Language {
  return (
    asShippedLanguage(stored) ??
    matchUiLanguage(uiTag, SHIPPED_LANGUAGES) ??
    Language.EN
  );
}

/**
 * A stored language value, if it names one this build ships; else undefined.
 * Anything else handed to i18next makes it fetch a locale file that does not
 * exist (#42). Quotes are stripped first: #42's `i18nextLng` key was
 * JSON-quoted. Also guards another page's settings write (KAN-279 D9).
 */
export function asShippedLanguage(value: unknown): Language | undefined {
  return typeof value === 'string'
    ? SHIPPED_LANGUAGES.find((l) => l === value.replace(/"/g, ''))
    : undefined;
}

const defaultSettings: SettingsData = {
  language: Language.EN, // overridden by startupLanguage in initialState
  theme: Theme.LIGHT,
  exportLayout: 'compact',
  isAutoSync: true,
  cloudConsent: '',
  extensionInstalledTime: '',
  isSkippedUserReviewOnce: false,
  isUserRatedAndReviewed: false,
  isNeverAskAgainToRate: false,
  lastReviewRequestTime: '',
  lastValueMomentTime: '',
  lastSyncedTime: '',
  isTabGroupsPromptAnsweredOnce: false,
  isNeverAskAgainForTabGroups: false,
  sessionDateBasis: 'edited',
  // KAN-280 O5. Also what a user whose saved settings predate the field
  // gets: initialState lays the stored object over these defaults.
  foldSavedSessionInTabView: true,
  openNowWidth: null,
  isUiSoundOn: true,
  ...ONBOARDING_DEFAULTS,
};

export const initialState: SettingsData = {
  ...defaultSettings,
  ...settingsDataLocal,
  // KAN-282. Decided here, and read by i18n.tsx from here, so what renders
  // and what the first setting write saves are the same language. Detecting
  // only in i18n.tsx showed German once: this still held `en`, the first-run
  // consent answer saved it, and every later open was English.
  language: startupLanguage(settingsDataLocal.language, readUiLanguage()),
  // KAN-321 O1a. Guarded rather than spread straight through: settingsDataLocal
  // is unvalidated (asPartialSettings checks only "is an object"), so a
  // hand-edited or corrupted value must not survive into the grid.
  openNowWidth: asOpenNowWidth(settingsDataLocal.openNowWidth),
  // KAN-7. Guarded like openNowWidth: settingsDataLocal is unvalidated.
  ...guardOnboarding(settingsDataLocal, ONBOARDING_DEFAULTS),
};

export const settingsDataStateSlice = createSlice({
  name: 'settingsDataState',
  initialState,
  reducers: {
    setTheme: (state, action: PayloadAction<Theme>) => {
      state.theme = action.payload;

      // Save updated state to localStorage
      saveToLocalStorage('settingsData', state);
    },

    setLanguage: (state, action: PayloadAction<Language>) => {
      state.language = action.payload;

      // Save updated state to localStorage
      saveToLocalStorage('settingsData', state);
    },

    // KAN-259. Only the existing and enable dialogs grant; each caller sets Auto Sync, as one sync asked is not a setting.
    grantCloudConsent: (state) => {
      state.cloudConsent = 'granted';
      saveToLocalStorage('settingsData', state);
    },

    declineCloudConsent: (state) => {
      state.cloudConsent = 'declined';
      state.isAutoSync = false;
      saveToLocalStorage('settingsData', state);
    },

    // KAN-254. Deleting cloud data turns auto sync off; a toggle would flip
    // whatever it was, and it must land on off.
    setAutoSync: (state, action: PayloadAction<boolean>) => {
      state.isAutoSync = action.payload;

      // Save updated state to localStorage
      saveToLocalStorage('settingsData', state);
    },

    toggleAutoSync: (state) => {
      state.isAutoSync = !state.isAutoSync;

      // Save updated state to localStorage
      saveToLocalStorage('settingsData', state);
    },

    setExtensionInstalledTime: (state) => {
      state.extensionInstalledTime = Date.now();

      // Save updated state to localStorage
      saveToLocalStorage('settingsData', state);
    },

    setSkippedUserReviewOnce: (state) => {
      state.isSkippedUserReviewOnce = true;

      // Save updated state to localStorage
      saveToLocalStorage('settingsData', state);
    },

    setUserRatedAndReviewed: (state) => {
      state.isUserRatedAndReviewed = true;

      // Save updated state to localStorage
      saveToLocalStorage('settingsData', state);
    },

    setNeverAskAgainToRate: (state) => {
      state.isNeverAskAgainToRate = true;

      // Save updated state to localStorage
      saveToLocalStorage('settingsData', state);
    },

    /**
     * Record that the extension just did something worth being asked about.
     *
     * Deliberately last-write-wins on a single timestamp rather than a count:
     * the prompt only ever asks "has anything happened since I last asked",
     * so a tally would be state nothing reads.
     */
    // KAN-255. Stamped by the sync thunk on the success path only; a failed
    // or refused sync leaves the last true time standing.
    recordSyncedNow: (state) => {
      state.lastSyncedTime = Date.now();
      saveToLocalStorage('settingsData', state);
    },

    // For tests and seeds; the app stamps through recordSyncedNow.
    setLastSyncedTime: (state, action: PayloadAction<number | ''>) => {
      state.lastSyncedTime = action.payload;
      saveToLocalStorage('settingsData', state);
    },

    recordValueMoment: (state) => {
      state.lastValueMomentTime = Date.now();

      // Save updated state to localStorage
      saveToLocalStorage('settingsData', state);
    },

    updateLastReviewRequestTime: (state) => {
      state.lastReviewRequestTime = Date.now();

      // Save updated state to localStorage
      saveToLocalStorage('settingsData', state);
    },

    setTabGroupsPromptAnsweredOnce: (state) => {
      state.isTabGroupsPromptAnsweredOnce = true;

      // Save updated state to localStorage
      saveToLocalStorage('settingsData', state);
    },

    setNeverAskAgainForTabGroups: (state) => {
      state.isNeverAskAgainForTabGroups = true;

      // Save updated state to localStorage
      saveToLocalStorage('settingsData', state);
    },

    setExportLayout: (state, action: PayloadAction<ExportLayout>) => {
      state.exportLayout = action.payload;

      // Save updated state to localStorage
      saveToLocalStorage('settingsData', state);
    },

    setSessionDateBasis: (state, action: PayloadAction<SessionDateBasis>) => {
      state.sessionDateBasis = action.payload;

      // Save updated state to localStorage
      saveToLocalStorage('settingsData', state);
    },

    // KAN-280 O5. The fold button's choice, and nothing else's.
    setFoldSavedSessionInTabView: (state, action: PayloadAction<boolean>) => {
      state.foldSavedSessionInTabView = action.payload;

      // Save updated state to localStorage
      saveToLocalStorage('settingsData', state);
    },

    setUiSoundOn: (state, action: PayloadAction<boolean>) => {
      state.isUiSoundOn = action.payload;
      saveToLocalStorage('settingsData', state);
    },

    // KAN-321 O1a. The grip's release, an arrow key, or a double-click (null).
    setOpenNowWidth: (state, action: PayloadAction<number | null>) => {
      state.openNowWidth = action.payload;

      // Save updated state to localStorage
      saveToLocalStorage('settingsData', state);
    },

    // KAN-7. Only from 'none': a finished setup never restarts.
    beginSetup: (state) => {
      if (state.setupState !== 'none') return;
      state.setupState = 'pending';
      saveToLocalStorage('settingsData', state);
    },

    finishSetup: (state) => {
      state.setupState = 'done';
      saveToLocalStorage('settingsData', state);
    },

    // Run setup again: pending from any state, where beginSetup only starts it.
    restartSetup: (state) => {
      state.setupState = 'pending';
      saveToLocalStorage('settingsData', state);
    },

    dismissPinGuide: (state) => {
      state.isPinGuideDismissed = true;
      saveToLocalStorage('settingsData', state);
    },

    // Every full-view open dispatches this; only the first writes.
    markFullViewOpened: (state) => {
      if (state.hasOpenedFullView) return;
      state.hasOpenedFullView = true;
      saveToLocalStorage('settingsData', state);
    },

    // ⤢ dispatches this on every press; only the first writes.
    markFullViewCalloutSeen: (state) => {
      if (state.isFullViewCalloutSeen) return;
      state.isFullViewCalloutSeen = true;
      saveToLocalStorage('settingsData', state);
    },

    setDefaultView: (state, action: PayloadAction<DefaultView>) => {
      state.defaultView = action.payload;
      saveToLocalStorage('settingsData', state);
    },

    // Every start writes a new record, replacing any other.
    recordFirstRun: (state, action: PayloadAction<FirstRun>) => {
      state.firstRun = action.payload;
      saveToLocalStorage('settingsData', state);
    },

    // Both ways: Next, Back and actions move it; only a start writes step 0.
    setFirstRunStep: (state, action: PayloadAction<RunStep>) => {
      const run = state.firstRun;
      if (run === null || run.ended !== null || action.payload === 0) return;
      const step = asRunStep(run.view, action.payload);
      if (step === null || step === run.step) return;
      run.step = step;
      run.welcomeShows = null;
      saveToLocalStorage('settingsData', state);
    },

    setFirstRunSession: (state, action: PayloadAction<string>) => {
      const run = state.firstRun;
      if (run === null || run.ended !== null) return;
      run.sessionId = action.payload;
      saveToLocalStorage('settingsData', state);
    },

    // Q7. One more opening of the welcome, up to the most it shows.
    countWelcomeShow: (state) => {
      const run = state.firstRun;
      if (run === null || run.ended !== null || run.welcomeShows === null) {
        return;
      }
      const next = nextWelcomeShows(run.welcomeShows);
      if (next === null) return;
      run.welcomeShows = next;
      saveToLocalStorage('settingsData', state);
    },

    endFirstRun: (state, action: PayloadAction<RunEnding>) => {
      const run = state.firstRun;
      if (run === null || run.ended !== null) return;
      run.ended = action.payload;
      saveToLocalStorage('settingsData', state);
    },

    markWhatsNew2Seen: (state) => {
      if (state.isWhatsNew2Seen) return;
      state.isWhatsNew2Seen = true;
      saveToLocalStorage('settingsData', state);
    },

    replaceState: (state, action: PayloadAction<typeof state>) => {
      // Save updated state to localStorage
      saveToLocalStorage('settingsData', state);

      return action.payload;
    },

    // KAN-279 D9. Another page wrote this; localStorage already holds it.
    // Unlike every other reducer here it never writes back -- a write here
    // would fire a storage event in the other page and the two would echo
    // forever.
    hydrateSettingsFromOtherPage: (
      _state,
      action: PayloadAction<SettingsData>
    ) => action.payload,
  },
});

export const {
  setTheme,
  setLanguage,
  toggleAutoSync,
  setAutoSync,
  grantCloudConsent,
  declineCloudConsent,
  setNeverAskAgainToRate,
  setUserRatedAndReviewed,
  setSkippedUserReviewOnce,
  setExtensionInstalledTime,
  updateLastReviewRequestTime,
  recordValueMoment,
  recordSyncedNow,
  setLastSyncedTime,
  setTabGroupsPromptAnsweredOnce,
  setNeverAskAgainForTabGroups,
  setSessionDateBasis,
  setExportLayout,
  setFoldSavedSessionInTabView,
  setOpenNowWidth,
  setUiSoundOn,
  beginSetup,
  finishSetup,
  restartSetup,
  dismissPinGuide,
  markFullViewOpened,
  markFullViewCalloutSeen,
  setDefaultView,
  recordFirstRun,
  setFirstRunStep,
  setFirstRunSession,
  countWelcomeShow,
  endFirstRun,
  markWhatsNew2Seen,
  hydrateSettingsFromOtherPage,
} = settingsDataStateSlice.actions;

export default settingsDataStateSlice.reducer;

/**
 * Whether this device may sync right now (KAN-259): the user said yes, and
 * has not since turned Auto Sync off. Every sync starter reads this, never
 * `isAutoSync` alone.
 */
export const cloudSyncAllowed = (settings: SettingsData): boolean =>
  settings.isAutoSync && settings.cloudConsent === 'granted';

/**
 * Whether the tab view's own periodic/on-focus cloud read (KAN-279 D11) may
 * fire right now. Mirrors App's startup-sync condition --
 * `isSignedIn && isFirebaseAuthed && userId && cloudSyncAllowed(settings)`,
 * see App.tsx's sync effect -- including App's own truthiness check on
 * `userId` (`string | null`), not merely `!== null`: an empty string would
 * pass a null-check but fail App's `&&`, and this must refuse exactly when
 * App's effect would. Deliberately NOT drainQueuedSync's gate
 * (customMiddleware.ts), which is consent alone. A timed read is a sync
 * nobody asked for, and syncStateWithFirestore also uploads local edits, so
 * with Auto Sync off (consent granted or not) the tab must never sync on its
 * own. Do not "unify" this with drainQueuedSync's gate: they read different
 * things on purpose.
 */
export const timedCloudReadAllowed = (state: RootState): boolean =>
  state.globalState.isSignedIn &&
  state.globalState.isFirebaseAuthed &&
  !!state.globalState.userId &&
  cloudSyncAllowed(state.settingsDataState);
