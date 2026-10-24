import React, { useEffect, useRef, useState } from 'react';
import { useDispatch } from 'react-redux';
import { useTranslation } from 'react-i18next';

import Button from '../../common/Button';
import SyncGlyph from '../../common/SyncGlyph';
import { CROSSFADE_MS } from '../../common/syncMotion';
import { askToDeleteCloudData } from '../../../redux/slices/globalStateSlice';
import type { AppDispatch } from '../../../redux/store';

// KAN-719. A check that ends inside this shows no change at all.
const CHECKING_FACE_DELAY_MS = 300;

// KAN-719. Busy for the whole check (guards a second press); "Checking…" shows only past 300ms.
const DeleteCloudDataButton: React.FC = () => {
  const { t } = useTranslation();
  const dispatch: AppDispatch = useDispatch();
  const [busy, setBusy] = useState(false);
  const [checkingShown, setCheckingShown] = useState(false);
  // KAN-750. Its arrows turn from the face's show until its fade-out ends.
  const [turning, setTurning] = useState(false);
  const faceTimer = useRef<ReturnType<typeof setTimeout>>();
  const turnTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(
    () => () => {
      clearTimeout(faceTimer.current);
      clearTimeout(turnTimer.current);
    },
    []
  );

  const press = async () => {
    setBusy(true);
    clearTimeout(turnTimer.current);
    faceTimer.current = setTimeout(() => {
      setCheckingShown(true);
      setTurning(true);
    }, CHECKING_FACE_DELAY_MS);
    try {
      await dispatch(askToDeleteCloudData());
    } finally {
      clearTimeout(faceTimer.current);
      setBusy(false);
      setCheckingShown(false);
      turnTimer.current = setTimeout(() => setTurning(false), CROSSFADE_MS);
    }
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
