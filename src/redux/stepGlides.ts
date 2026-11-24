import {
  panes,
  prepareLayoutGlide,
  type GlideKind,
} from '../components/common/layoutGlide';

// KAN-993 (his rule, round 1b). An undo plays its step's motion backwards and
// a redo plays it again: an add taken back goes up the way it came, a delete
// taken back comes in as its gap opens, a drop taken back leaves its landing
// the way it came (KAN-994). A sort, Ungroup or End split glides back and
// again; Remove duplicates' copies come back lit, and leave again as the kept
// ones light up (KAN-996). Only steps noted here draw anything; every other
// step still lands at once.

type StepPane = 'detail' | 'sessions';
type StepAction = 'add' | 'delete' | 'drop' | 'reorder' | 'dedupe';

const MOTION: Record<StepAction, Record<'undo' | 'redo', GlideKind>> = {
  add: { undo: 'depart', redo: 'arrive' },
  delete: { undo: 'delete', redo: 'delete' },
  // What a drop added goes back up and comes back down; what it moved glides back and again.
  drop: { undo: 'depart', redo: 'arrive' },
  reorder: { undo: 'reorder', redo: 'reorder' },
  dedupe: { undo: 'delete', redo: 'delete' },
};

const noted = new Map<
  number,
  {
    panes: readonly StepPane[];
    action: StepAction;
    // Remove duplicates: the tab ids of the copies it kept.
    kept: readonly string[];
  }
>();
// Far more than the undo history holds: the oldest notes go first.
const NOTES_KEPT = 200;

/** Notes what `step` did to rows in `pane` (or each of `panes`), so its undo and redo glide there; `kept`: the tab ids a Remove duplicates kept. */
export function noteStep(
  step: number | null,
  pane: StepPane | readonly StepPane[],
  action: StepAction,
  kept: readonly string[] = []
): void {
  if (step === null) return;
  noted.set(step, {
    panes: typeof pane === 'string' ? [pane] : pane,
    action,
    kept,
  });
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
  const roots = note.panes.flatMap((pane) => panes(pane));
  const kind = MOTION[note.action][direction];
  if (note.action !== 'dedupe') {
    prepareLayoutGlide(roots, kind);
    return;
  }
  // Remove duplicates: its copies come back lit; again, the kept ones light up.
  prepareLayoutGlide(
    roots,
    kind,
    'this page',
    direction === 'undo' ? { lightReturns: true } : { light: note.kept }
  );
}
