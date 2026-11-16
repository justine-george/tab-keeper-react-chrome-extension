import { useDispatch } from 'react-redux';
import { useTranslation } from 'react-i18next';

import { PictureCard, PictureCardRow } from './PictureCard';
import { BookmarksImportArt } from '../modals/defaultViewArt';
import { startBookmarkImport } from '../../redux/startBookmarkImport';
import type { AppDispatch } from '../../redux/store';

// KAN-862. Setup's import step: one card per place to import from, Chrome bookmarks the only one so far. A press
// opens that source's import over setup; once something has come in since setup opened, the card shows pressed.
export default function ImportSourceCards({
  importedInSetup,
}: {
  importedInSetup: number;
}) {
  const { t } = useTranslation();
  const dispatch: AppDispatch = useDispatch();
  const hasImported = importedInSetup > 0;
  const sources = [
    {
      id: 'bookmarks',
      label: t('Chrome bookmarks'),
      subline: t('Pick folders. Each becomes a saved session.'),
      art: <BookmarksImportArt />,
      start: () => void dispatch(startBookmarkImport()),
    },
  ];

  return (
    <PictureCardRow>
      {sources.map((source) => (
        <PictureCard
          key={source.id}
          isPressed={hasImported}
          label={source.label}
          caption={
            hasImported
              ? t('ImportedInSetup', { count: importedInSetup })
              : source.subline
          }
          art={source.art}
          onPress={source.start}
        />
      ))}
    </PictureCardRow>
  );
}
