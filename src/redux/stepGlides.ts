import {
  panes,
  prepareLayoutGlide,
  type GlideKind,
} from '../components/common/layoutGlide';

// KAN-993 (his rule, round 1b). An undo plays its step's motion backwards and
// a redo plays it again: an add taken back goes up the way it came, a delete
// taken back comes in as its gap opens. Only steps an add or a delete noted
// draw anything; every other step still lands at once.

type StepPane = 'detail' | 'sessions';
type StepAction = 'add' | 'delete';

const MOTION: Record<StepAction, Record<'undo' | 'redo', GlideKind>> = {
  add: { undo: 'depart', redo: 'arrive' },
  delete: { undo: 'delete', redo: 'delete' },
};

const noted = new Map<number, { pane: StepPane; action: StepAction }>();
// Far more than the undo history holds: the oldest notes go first.
const NOTES_KEPT = 200;

/** Notes that `step` added or deleted a row in `pane`, so its undo and redo glide there. */
export function noteStep(
  step: number | null,
  pane: StepPane,
  action: StepAction
): void {
  if (step === null) return;
  noted.set(step, { pane, action });
  for (const oldest of noted.keys()) {
    if (noted.size <= NOTES_KEPT) break;
    noted.delete(oldest);
  }
}

/** Call just before undoing or redoing saved step `step`; draws nothing for a step nothing noted. */
export function prepareStepGlide(
  step: number | undefined,
  direction: 'undo' | 'redo'
): void {
  const note = step === undefined ? undefined : noted.get(step);
  if (note === undefined) return;
  prepareLayoutGlide(panes(note.pane), MOTION[note.action][direction]);
}
