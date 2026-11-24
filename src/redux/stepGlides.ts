import { panes, prepareLayoutGlide } from '../components/common/layoutGlide';

// KAN-993 (his pick B). Undoing an add closes up as a delete does, and redoing
// it arrives as the add did. Only steps an add noted draw anything; every
// other step still lands at once.

type AddedIn = 'detail' | 'sessions';

const paneOfStep = new Map<number, AddedIn>();
// Far more than the undo history holds: the oldest notes go first.
const NOTES_KEPT = 200;

/** Notes that `step` added a row in `pane`, so its undo and redo glide there. */
export function noteAddStep(step: number | null, pane: AddedIn): void {
  if (step === null) return;
  paneOfStep.set(step, pane);
  for (const oldest of paneOfStep.keys()) {
    if (paneOfStep.size <= NOTES_KEPT) break;
    paneOfStep.delete(oldest);
  }
}

/** Call just before undoing or redoing saved step `step`; draws nothing for a step no add noted. */
export function prepareStepGlide(
  step: number | undefined,
  direction: 'undo' | 'redo'
): void {
  const pane = step === undefined ? undefined : paneOfStep.get(step);
  if (pane === undefined) return;
  prepareLayoutGlide(panes(pane), direction === 'undo' ? 'delete' : 'arrive');
}
