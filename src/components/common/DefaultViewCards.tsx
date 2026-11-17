import type { ReactNode } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';

import { PictureCard, PictureCardRow } from './PictureCard';
import { CompactViewArt, FullViewArt } from '../modals/defaultViewArt';
import { chooseDefaultView } from '../../redux/defaultViewChoice';
import type { AppDispatch, RootState } from '../../redux/store';
import type { DefaultView } from '../../utils/functions/defaultView';

// KAN-7 §5 step 3, and Settings › Default view since KAN-749: the two views as
// picture cards, each a toggle button that sets Default view. One component, so
// setup and Settings cannot drift apart.
export default function DefaultViewCards() {
  const { t } = useTranslation();
  const dispatch: AppDispatch = useDispatch();
  const defaultView = useSelector(
    (s: RootState) => s.settingsDataState.defaultView
  );
  const card = (
    view: DefaultView,
    label: string,
    caption: string,
    art: ReactNode
  ) => (
    <PictureCard
      key={view}
      isPressed={defaultView === view}
      label={label}
      caption={caption}
      art={art}
      onPress={() => void dispatch(chooseDefaultView(view))}
    />
  );

  return (
    <PictureCardRow>
      {card(
        'compact',
        t('Compact view'),
        t('Opens under the toolbar icon'),
        <CompactViewArt />
      )}
      {card('full', t('Full view'), t('Opens in its own tab'), <FullViewArt />)}
    </PictureCardRow>
  );
}
