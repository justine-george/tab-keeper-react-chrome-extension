import type { tabContainerData } from '../../redux/slices/tabContainerDataStateSlice';
import { isSampleSession } from './sampleSession';

// KAN-413. The tour's record, one per machine, and what counts as doing each step.

export const TOUR_STEPS = 5;
export type TourStep = 1 | 2 | 3 | 4 | 5;
export type TourView = 'popup' | 'full';

export interface SampleTour {
  sampleId: string;
  step: TourStep;
  view: TourView;
}

const STEPS: readonly TourStep[] = [1, 2, 3, 4, 5];

export function asTourStep(value: unknown): TourStep | null {
  return STEPS.find((step) => step === value) ?? null;
}

// A stored record, if it is one; anything else reads as no tour.
export function asSampleTour(value: unknown): SampleTour | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const sampleId: unknown = Reflect.get(value, 'sampleId');
  const step = asTourStep(Reflect.get(value, 'step'));
  const view: unknown = Reflect.get(value, 'view');
  if (typeof sampleId !== 'string' || !isSampleSession(sampleId)) return null;
  if (step === null || (view !== 'popup' && view !== 'full')) return null;
  return { sampleId, step, view };
}

export function nextTourStep(step: TourStep): TourStep | null {
  return asTourStep(step + 1);
}

// What a step's own action changes, taken when the step starts and on each change.
export interface TourSnapshot {
  title: string;
  tabLayout: string;
  folds: string;
}

export function tourSnapshot(
  sample: tabContainerData,
  foldedWindowIds: readonly string[]
): TourSnapshot {
  return {
    title: sample.title,
    tabLayout: sample.windows
      .map((w) => `${w.windowId}:${w.tabs.map((t) => t.tabId).join(',')}`)
      .join('|'),
    folds: [...foldedWindowIds].sort().join(','),
  };
}

// Step 1 a fold, step 3 a rename, step 4 any tab moved, in or out; 2 and 5 never.
export function stepWasDone(
  step: TourStep,
  before: TourSnapshot,
  now: TourSnapshot
): boolean {
  switch (step) {
    case 1:
      return now.folds !== before.folds;
    case 3:
      return now.title !== before.title;
    case 4:
      return now.tabLayout !== before.tabLayout;
    default:
      return false;
  }
}
