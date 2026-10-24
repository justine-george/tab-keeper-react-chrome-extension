import React, { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';

import Button from '../../common/Button';
import SyncGlyph from '../../common/SyncGlyph';
import { CROSSFADE_MS } from '../../common/syncMotion';
import { askToDeleteCloudData } from '../../../redux/slices/globalStateSlice';
import type { AppDispatch, RootState } from '../../../redux/store';

// KAN-719. A check that ends inside this shows no change at all.
const CHECKING_FACE_DELAY_MS = 300;

const isFaceDue = (startedAt: number | null): boolean =>
  startedAt !== null && performance.now() - startedAt >= CHECKING_FACE_DELAY_MS;

// KAN-719. Busy for the whole check (guards a second press); "Checking…" shows only past 300ms.
// KAN-750 R20. The check is the store's, so a remount mid-check shows it as it stands.
const DeleteCloudDataButton: React.FC = () => {
  const { t } = useTranslation();
  const dispatch: AppDispatch = useDispatch();
  const startedAt = useSelector(
    (state: RootState) => state.globalState.deleteCheckStartedAt
  );
  const busy = startedAt !== null;
  // The check whose "Checking…" face is due.
  const [faceFor, setFaceFor] = useState(() =>
    isFaceDue(startedAt) ? startedAt : null
  );
  const checkingShown = busy && faceFor === startedAt;
  // KAN-750. Its arrows turn from the face's show until its fade-out ends.
  const [turning, setTurning] = useState(checkingShown);

  useEffect(() => {
    if (startedAt === null || faceFor === startedAt) return;
    const show = setTimeout(
      () => {
        setFaceFor(startedAt);
        setTurning(true);
      },
      CHECKING_FACE_DELAY_MS - (performance.now() - startedAt)
    );
    return () => clearTimeout(show);
  }, [startedAt, faceFor]);

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
      iconType="delete"
      variant="danger"
      busy={busy}
      secondFace={{
        iconType: 'sync',
        // KAN-750. The sync button's arrows, turning while it checks.
        renderGlyph: (glyphCss) => (
          <SyncGlyph glyph="sync" turning={turning} glyphCss={glyphCss} />
        ),
        text: t('Checking…'),
        shown: checkingShown,
        durationMs: CROSSFADE_MS,
      }}
      onClick={press}
    />
  );
};

export default DeleteCloudDataButton;
