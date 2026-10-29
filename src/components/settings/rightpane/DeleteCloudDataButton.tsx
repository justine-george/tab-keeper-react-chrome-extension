import React, { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';

import Button from '../../common/Button';
import SyncGlyph from '../../common/SyncGlyph';
import { CROSSFADE_MS } from '../../common/syncMotion';
import { askToDeleteCloudData } from '../../../redux/slices/globalStateSlice';
import type { AppDispatch, RootState } from '../../../redux/store';

// KAN-719. A check (or delete) that ends inside this shows no change at all.
const BUSY_FACE_DELAY_MS = 300;

type BusyLabel = 'Checking…' | 'Deleting…';

// The busy face: what it says, and the run (check or delete) it is for.
interface BusyFace {
  label: BusyLabel;
  startedAt: number;
}

const isFaceDue = (startedAt: number): boolean =>
  performance.now() - startedAt >= BUSY_FACE_DELAY_MS;

// KAN-719. Busy for the whole check (guards a second press); "Checking…" shows only past 300ms.
// KAN-750 R20. The check is the store's, so a remount mid-check shows it as it stands.
// KAN-750. The delete after the confirm shows "Deleting…" by the same rules.
const DeleteCloudDataButton: React.FC<{ describedBy?: string }> = ({
  describedBy,
}) => {
  const { t } = useTranslation();
  const dispatch: AppDispatch = useDispatch();
  const checkStartedAt = useSelector(
    (state: RootState) => state.globalState.deleteCheckStartedAt
  );
  const deletingStartedAt = useSelector(
    (state: RootState) => state.globalState.deletingStartedAt
  );
  const label: BusyLabel =
    deletingStartedAt !== null ? 'Deleting…' : 'Checking…';
  const startedAt = deletingStartedAt ?? checkStartedAt;
  const busy = startedAt !== null;
  // The run whose face is due; it keeps naming the face while it fades out.
  const [faceFor, setFaceFor] = useState<BusyFace | null>(() =>
    startedAt !== null && isFaceDue(startedAt) ? { label, startedAt } : null
  );
  const faceShown = busy && faceFor?.startedAt === startedAt;
  // KAN-750. Its arrows turn from the face's show until its fade-out ends.
  const [turning, setTurning] = useState(faceShown);

  useEffect(() => {
    if (startedAt === null || faceFor?.startedAt === startedAt) return;
    const show = setTimeout(
      () => {
        setFaceFor({ label, startedAt });
        setTurning(true);
      },
      BUSY_FACE_DELAY_MS - (performance.now() - startedAt)
    );
    return () => clearTimeout(show);
  }, [label, startedAt, faceFor]);

  // Stops once the face has faded out; a new press or the unmount drops the stop.
  useEffect(() => {
    if (!turning || busy) return;
    const stop = setTimeout(() => setTurning(false), CROSSFADE_MS);
    return () => clearTimeout(stop);
  }, [turning, busy]);

  const press = () => {
    void dispatch(askToDeleteCloudData());
  };

  return (
    <Button
      text={t('Delete cloud data')}
      // KAN-719. The shown face hides the resting one from the name, so say it.
      ariaLabel={t('Delete cloud data')}
      ariaDescribedBy={describedBy}
      iconType="delete"
      variant="danger"
      busy={busy}
      secondFace={{
        iconType: 'sync',
        // KAN-750. The sync button's arrows, turning while it checks or deletes.
        renderGlyph: (glyphCss) => (
          <SyncGlyph glyph="sync" turning={turning} glyphCss={glyphCss} />
        ),
        text: t(faceFor?.label ?? label),
        shown: faceShown,
        durationMs: CROSSFADE_MS,
      }}
      onClick={press}
    />
  );
};

export default DeleteCloudDataButton;
