import React, { useEffect, useRef, useState } from 'react';
import { useDispatch } from 'react-redux';
import { useTranslation } from 'react-i18next';

import Button from '../../common/Button';
import { askToDeleteCloudData } from '../../../redux/slices/globalStateSlice';
import type { AppDispatch } from '../../../redux/store';

// KAN-719. A check that ends inside this shows no change at all.
const CHECKING_FACE_DELAY_MS = 300;

// The press asks whether the cloud holds anything. Busy for the whole check
// (the guard against a second one); "Checking…" only if it runs past 300ms.
const DeleteCloudDataButton: React.FC = () => {
  const { t } = useTranslation();
  const dispatch: AppDispatch = useDispatch();
  const [busy, setBusy] = useState(false);
  const [checkingShown, setCheckingShown] = useState(false);
  const faceTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => () => clearTimeout(faceTimer.current), []);

  const press = async () => {
    setBusy(true);
    faceTimer.current = setTimeout(
      () => setCheckingShown(true),
      CHECKING_FACE_DELAY_MS
    );
    try {
      await dispatch(askToDeleteCloudData());
    } finally {
      clearTimeout(faceTimer.current);
      setBusy(false);
      setCheckingShown(false);
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
        iconType: 'cloud_sync',
        text: t('Checking…'),
        shown: checkingShown,
      }}
      onClick={press}
    />
  );
};

export default DeleteCloudDataButton;
