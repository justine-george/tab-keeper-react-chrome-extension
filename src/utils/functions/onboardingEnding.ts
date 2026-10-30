import type { TFunction } from 'i18next';

import type { tabContainerData } from '../../redux/slices/tabContainerDataStateSlice';
import type { FirstRun } from './firstRun';
import { createdInstant } from './mergeTabData';
import { isSampleSession } from './sampleSession';

// The tour's ending card: which row it points at, and the three lines it says (KAN-879).

export type EndingTarget =
  | { kind: 'session'; sessionId: string; isNameTyped: boolean }
  | { kind: 'save' };

// The run's own session, else the newest real one; the example is never the target.
export function endingTarget(
  run: FirstRun | null,
  sessions: readonly tabContainerData[]
): EndingTarget {
  const real = sessions.filter((s) => !isSampleSession(s.tabGroupId));
  const held = real.find((s) => s.tabGroupId === run?.sessionId);
  if (run && held) {
    return {
      kind: 'session',
      sessionId: held.tabGroupId,
      isNameTyped: run.isSessionNameTyped,
    };
  }
  const newest = real.reduce<tabContainerData | null>(
    (best, s) => (!best || createdInstant(s) > createdInstant(best) ? s : best),
    null
  );
  return newest
    ? { kind: 'session', sessionId: newest.tabGroupId, isNameTyped: false }
    : { kind: 'save' };
}

// `title` is the target session's current title; '' for a save target.
export function endingLines(
  target: EndingTarget,
  title: string,
  t: TFunction
): readonly [string, string, string] {
  const signOff = t('Have a good day!');
  if (target.kind === 'save') {
    return [
      t("You're all set."),
      t('Save your tabs here whenever you like.'),
      signOff,
    ];
  }
  return target.isNameTyped
    ? [
        t("You're all set. {{name}} is saved.", { name: title }),
        t('Open brings its tabs back, any time.'),
        signOff,
      ]
    : [
        t("You're all set. Your tabs are saved here."),
        t('Open brings them back, any time.'),
        signOff,
      ];
}
