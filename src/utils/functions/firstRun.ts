import type { tabContainerData } from '../../redux/slices/tabContainerDataStateSlice';
import { isValidDate } from './local';
import { createdInstant } from './mergeTabData';
import type { TourLockState } from './tourLock';

// The guided first run's record, one per machine, and what each open does with it.

export type RunView = 'popup' | 'full';
export type RunHello = 'welcome' | 'whatsNew';
export type RunEnding = 'finished' | 'skipped' | 'sessionGone' | 'unanswered';
// Q7: the welcome reopens while unanswered, up to this many shows; the next open ends it.
const MAX_WELCOME_SHOWS = 5;
export type WelcomeShows = 1 | 2 | 3 | 4 | 5;
const WELCOME_SHOWS: readonly WelcomeShows[] = [1, 2, 3, 4, 5];

function asWelcomeShows(value: unknown): WelcomeShows | null {
  return WELCOME_SHOWS.find((n) => n === value) ?? null;
}

// The count after one more show; null once it is at the most.
export function nextWelcomeShows(shows: WelcomeShows): WelcomeShows | null {
  return asWelcomeShows(shows + 1);
}

export type RunStep = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export interface FirstRun {
  view: RunView;
  step: RunStep;
  // Null until the save step or the latest-session pick sets it.
  sessionId: string | null;
  hello: RunHello;
  // How many times the welcome opened; a popup record at step 0 only.
  welcomeShows: WelcomeShows | null;
  ended: RunEnding | null;
}

// The last card; step 0 is Hello in the full view and the welcome in the popup.
export const RUN_STEPS: Record<RunView, RunStep> = { full: 8, popup: 7 };

export type RunStepKind =
  | 'hello'
  | 'welcome'
  | 'openNow'
  | 'findAndFit'
  | 'save'
  | 'row'
  | 'open'
  | 'switch'
  | 'delete'
  | 'windows'
  | 'twoViews'
  | 'fullView';

// The full view draws no Switch, so its run has no Switch step.
const KINDS: Record<RunView, readonly RunStepKind[]> = {
  full: [
    'hello',
    'openNow',
    'findAndFit',
    'save',
    'row',
    'open',
    'delete',
    'windows',
    'twoViews',
  ],
  popup: [
    'welcome',
    'save',
    'row',
    'open',
    'switch',
    'delete',
    'windows',
    'fullView',
  ],
};

export type RunSaveCard = 'save' | 'nothingToSave' | 'sessions';

const STEPS: readonly RunStep[] = [0, 1, 2, 3, 4, 5, 6, 7, 8];
const ENDINGS: readonly RunEnding[] = [
  'finished',
  'skipped',
  'sessionGone',
  'unanswered',
];

export function asRunStep(view: RunView, value: unknown): RunStep | null {
  const step = STEPS.find((s) => s === value);
  return step !== undefined && step <= RUN_STEPS[view] ? step : null;
}

export function runStepKind(view: RunView, step: RunStep): RunStepKind | null {
  return step <= RUN_STEPS[view] ? KINDS[view][step] : null;
}

export function needsSession(kind: RunStepKind): boolean {
  return (
    kind === 'row' ||
    kind === 'open' ||
    kind === 'switch' ||
    kind === 'delete' ||
    kind === 'windows'
  );
}

export function nextRunStep(view: RunView, step: RunStep): RunStep | null {
  return asRunStep(view, step + 1);
}

// Back exists from step 2 on.
export function previousRunStep(view: RunView, step: RunStep): RunStep | null {
  return step >= 2 ? asRunStep(view, step - 1) : null;
}

export function newRun(
  view: RunView,
  step: RunStep,
  hello: RunHello = 'welcome'
): FirstRun {
  return {
    view,
    step,
    sessionId: null,
    hello,
    welcomeShows: view === 'popup' && step === 0 ? 1 : null,
    ended: null,
  };
}

// A stored record, if it is one; anything else reads as no record.
export function asFirstRun(value: unknown): FirstRun | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const view: unknown = Reflect.get(value, 'view');
  if (view !== 'popup' && view !== 'full') return null;
  const step = asRunStep(view, Reflect.get(value, 'step'));
  const rawId: unknown = Reflect.get(value, 'sessionId');
  const sessionId = typeof rawId === 'string' ? rawId : null;
  const hello: unknown = Reflect.get(value, 'hello');
  const welcomeShows = asWelcomeShows(Reflect.get(value, 'welcomeShows'));
  const rawEnded: unknown = Reflect.get(value, 'ended');
  const ended = ENDINGS.find((e) => e === rawEnded) ?? null;
  if (step === null) return null;
  if (rawId !== null && sessionId === null) return null;
  if (hello !== 'welcome' && hello !== 'whatsNew') return null;
  if (rawEnded !== null && ended === null) return null;
  if ((view === 'popup' && step === 0) !== (welcomeShows !== null)) return null;
  return { view, step, sessionId, hello, welcomeShows, ended };
}

// settingsData as stored before this open wrote anything: unvalidated.
export interface StoredAtOpen {
  firstRun?: unknown;
  isWhatsNew2Seen?: unknown;
  setupState?: unknown;
  hasOpenedFullView?: unknown;
  cloudConsent?: unknown;
  lastSyncedTime?: unknown;
}

const hasSetupStarted = (s: StoredAtOpen): boolean =>
  s.setupState === 'pending' || s.setupState === 'done';

// Q8. Answered on 1.9, never saved or synced, and no 2.0 welcome or run here.
export function isNeverSaved19User(
  stored: StoredAtOpen,
  storedSessions: number
): boolean {
  return (
    (stored.cloudConsent === 'granted' || stored.cloudConsent === 'declined') &&
    storedSessions === 0 &&
    !isValidDate(stored.lastSyncedTime) &&
    !hasSetupStarted(stored) &&
    asFirstRun(stored.firstRun) === null &&
    stored.isWhatsNew2Seen !== true
  );
}

// Existing by KAN-410's rule, with no 2.0 welcome and no run on this machine.
export function isUpgrader(
  stored: StoredAtOpen,
  storedSessions: number
): boolean {
  return (
    stored.isWhatsNew2Seen !== true &&
    asFirstRun(stored.firstRun) === null &&
    !hasSetupStarted(stored) &&
    (storedSessions > 0 || isValidDate(stored.lastSyncedTime))
  );
}

// R13. A 2.0 install's first full-view visit with no full-view run recorded.
export function isFirstFullViewVisit(stored: StoredAtOpen): boolean {
  return (
    stored.hasOpenedFullView !== true &&
    hasSetupStarted(stored) &&
    asFirstRun(stored.firstRun)?.view !== 'full'
  );
}

// What <html data-run-check> reports for an open.
export type RunCheck =
  | 'none'
  | 'ended'
  | 'otherView'
  | 'elsewhere'
  | 'unknown'
  | 'resumed'
  | 'reshown'
  | 'unanswered'
  | 'started';

export type RunAtOpen =
  | {
      action: 'nothing';
      check: 'none' | 'ended' | 'otherView' | 'elsewhere' | 'unknown';
    }
  | { action: 'resume'; check: 'resumed' }
  | { action: 'reshowWelcome'; check: 'reshown' }
  | { action: 'endUnanswered'; check: 'unanswered' }
  | { action: 'start'; check: 'started'; run: FirstRun; beginsSetup: boolean };

const start = (run: FirstRun, beginsSetup: boolean): RunAtOpen => ({
  action: 'start',
  check: 'started',
  run,
  beginsSetup,
});

// The lock is asked only about a running record of this view.
export async function runAtOpen(
  view: RunView,
  stored: StoredAtOpen,
  storedSessions: number,
  lockState: () => Promise<TourLockState>
): Promise<RunAtOpen> {
  const record = asFirstRun(stored.firstRun);
  const isRunning = record !== null && record.ended === null;
  if (isRunning && record.view === view) {
    const lock = await lockState();
    if (lock === 'held') return { action: 'nothing', check: 'elsewhere' };
    if (lock === 'unknown') return { action: 'nothing', check: 'unknown' };
    if (record.welcomeShows !== null) {
      return record.welcomeShows < MAX_WELCOME_SHOWS
        ? { action: 'reshowWelcome', check: 'reshown' }
        : { action: 'endUnanswered', check: 'unanswered' };
    }
    return { action: 'resume', check: 'resumed' };
  }
  if (view === 'full') {
    if (isNeverSaved19User(stored, storedSessions))
      return start(newRun('full', 0, 'welcome'), true);
    // A popup record means the welcome was seen, and it was the hello.
    if (isFirstFullViewVisit(stored))
      return start(
        record === null ? newRun('full', 0, 'welcome') : newRun('full', 1),
        false
      );
    if (isUpgrader(stored, storedSessions))
      return start(newRun('full', 0, 'whatsNew'), false);
  } else if (isNeverSaved19User(stored, storedSessions)) {
    return start(newRun('popup', 0), true);
  }
  const check = isRunning ? 'otherView' : record === null ? 'none' : 'ended';
  return { action: 'nothing', check };
}

// R10. The session saved last, by its creation instant.
export function latestSession(
  groups: readonly tabContainerData[]
): tabContainerData | undefined {
  return groups.reduce<tabContainerData | undefined>(
    (latest, group) =>
      latest === undefined || createdInstant(group) > createdInstant(latest)
        ? group
        : latest,
    undefined
  );
}

// Loaded, or nothing on disk to load: a fresh install never loads.
export function isSessionListSettled(
  holdsPlaceholder: boolean,
  storedOnDisk: number
): boolean {
  return !holdsPlaceholder || storedOnDisk === 0;
}
