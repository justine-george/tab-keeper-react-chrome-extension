import { useState } from 'react';
import { useDispatch } from 'react-redux';
import { useTranslation } from 'react-i18next';

import { PictureCard, PictureCardRow } from './PictureCard';
import { BookmarksImportArt } from '../modals/defaultViewArt';
import {
  isNothingToImport,
  NOTHING_TO_IMPORT_TEXT,
  startBookmarkImport,
} from '../../redux/startBookmarkImport';
import type { NothingToImport } from '../../utils/functions/bookmarkImport';
import type { AppDispatch } from '../../redux/store';

// KAN-862. Setup's import step: one card per place to import from, Chrome bookmarks the only one so far. A press
// opens that source's import over setup; once something has come in since setup opened, the card shows pressed.
// A press that finds nothing left to import says so in the card's line, pressed: a toast would sit under setup (R23).
export default function ImportSourceCards({
  importedInSetup,
}: {
  importedInSetup: number;
}) {
  const { t } = useTranslation();
  const dispatch: AppDispatch = useDispatch();
  const hasImported = importedInSetup > 0;
  // What the last press found when it opened no dialog for want of anything to import.
  const [nothingLeft, setNothingLeft] = useState<NothingToImport | null>(null);
  const sources = [
    {
      id: 'bookmarks',
      label: t('Chrome bookmarks'),
      subline: t('Pick folders. Each becomes a saved session.'),
      art: <BookmarksImportArt />,
      start: () =>
        void dispatch(startBookmarkImport()).then((start) =>
          setNothingLeft(isNothingToImport(start) ? start : null)
        ),
    },
  ];

  return (
    <PictureCardRow>
      {sources.map((source) => (
        <PictureCard
          key={source.id}
          isPressed={hasImported || nothingLeft !== null}
          label={source.label}
          caption={
            nothingLeft !== null
              ? t(NOTHING_TO_IMPORT_TEXT[nothingLeft])
              : hasImported
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
